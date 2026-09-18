import { describe, expect, it } from "vitest";

import { users } from "../db/schema.js";
import { paymentNets } from "./ledger.js";
import { MockOffRampProvider } from "./providers.mock.js";
import { createQuote, QuoteRejected } from "./quote.js";
import { authorize, cancel, execute, PaymentError } from "./service.js";
import { reconcilePayment } from "./reconcile.js";
import { getIntent, latestAttempts } from "./store.js";
import { mocks, quotedPayment, testDb } from "../../test/helpers.js";

const db = testDb();

describe("quote engine (§9)", () => {
  it("prices 27500 IDR with ceiling rounding, spread and fee", async () => {
    // ref 16000, spread 50bps → quoted 15920; ceil(27500e12/15920e6)=1727387µ + 20000µ fee
    const q = await createQuote(db, new MockOffRampProvider(), { fiatAmountIdr: 27_500n });
    expect(q.cryptoAmount).toBe("1.747387");
    expect(q.spreadBps).toBe(50);
    expect(q.fee).toEqual({ crypto: "0.02", fiat: "320" });
    expect(q.expiresAt.getTime() - Date.now()).toBeGreaterThan(80_000);
    expect((await getIntent(db, q.paymentId))?.status).toBe("QUOTED");
  });

  it("rejects zero amounts, over-cap, and daily-cap breach", async () => {
    await expect(createQuote(db, new MockOffRampProvider(), { fiatAmountIdr: 0n })).rejects.toThrow(QuoteRejected);
    await expect(
      createQuote(db, new MockOffRampProvider(), { fiatAmountIdr: 500_001n }),
    ).rejects.toThrow(/per-transaction cap/);
    // Per-tx cap is 500k, daily cap 2M: four 400k quotes fit, one more breaches.
    const [user] = await db.insert(users).values({}).returning();
    for (let i = 0; i < 4; i++) {
      await createQuote(db, new MockOffRampProvider(), { fiatAmountIdr: 400_000n, userId: user.id });
    }
    await expect(
      createQuote(db, new MockOffRampProvider(), { fiatAmountIdr: 400_001n, userId: user.id }),
    ).rejects.toThrow(/daily cap/);
  });
});

describe("happy path", () => {
  it("runs AUTHORIZED → COMPLETED with balanced books and clean reconcile", async () => {
    const { quote } = await quotedPayment(db);
    const done = await execute(db, quote.paymentId, mocks());
    expect(done.status).toBe("COMPLETED");

    const nets = await paymentNets(db, quote.paymentId);
    expect(nets).toEqual({ USDC: 0n, IDR: 0n });

    const attempts = await latestAttempts(db, quote.paymentId);
    expect(attempts.map((a) => a.state)).toEqual([
      "COMPLETED",
      "FIAT_SETTLEMENT_PENDING",
      "CONVERSION_PENDING",
      "CRYPTO_CONFIRMED",
      "CRYPTO_SUBMITTED",
      "AUTHORIZED",
      "QUOTED",
    ]);
    expect(await reconcilePayment(db, quote.paymentId)).toEqual([]);
  });

  it("re-authorize is a replay, execute-before-authorize is 409", async () => {
    const q = await createQuote(db, new MockOffRampProvider(), { fiatAmountIdr: 10_000n });
    await expect(execute(db, q.paymentId, mocks())).rejects.toMatchObject({ status: 409 });
    const a = await authorize(db, q.paymentId);
    expect((await authorize(db, q.paymentId)).status).toBe("AUTHORIZED");
    expect(a.status).toBe("AUTHORIZED");
  });
});

describe("cancel + expiry", () => {
  it("cancels cheaply before funding; refuses after", async () => {
    const q = await createQuote(db, new MockOffRampProvider(), { fiatAmountIdr: 10_000n });
    expect((await cancel(db, q.paymentId)).status).toBe("FAILED");
    const { quote } = await quotedPayment(db);
    await execute(db, quote.paymentId, mocks());
    await expect(cancel(db, quote.paymentId)).rejects.toMatchObject({ status: 409 });
  });

  it("an expired quote cannot be authorized, period", async () => {
    const q = await createQuote(db, new MockOffRampProvider(), { fiatAmountIdr: 10_000n, ttlSec: 0 });
    await expect(authorize(db, q.paymentId)).rejects.toMatchObject({ status: 410 });
    expect((await getIntent(db, q.paymentId))?.status).toBe("EXPIRED");
  });
});
