// M4: first-party assisted settlement through operator tasks (§6.2, §10).
// Manual legs are provider implementations — downstream (ledger, reconciler)
// cannot tell them from licensed ones. That indistinguishability is the test.

import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { signOperator } from "../src/api/operator.js";
import { paymentNets } from "../src/engine/ledger.js";
import { MockChainGateway, MockOffRampProvider } from "../src/engine/providers.mock.js";
import { ManualOffRampProvider, ManualQrisSettlementProvider } from "../src/engine/providers.manual.js";
import { createQuote } from "../src/engine/quote.js";
import {
  authorize,
  completeOperatorTask,
  completeSettlement,
  execute,
  refund,
} from "../src/engine/service.js";
import { transition } from "../src/engine/store.js";
import { conversions } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { dbTaskStore, listTasks } from "../src/engine/tasks.js";
import { testDb } from "./helpers.js";

const db = testDb();
const REF6 = 16_000_000_000n;

const manual = () => {
  const store = dbTaskStore(db);
  return {
    offRamp: new ManualOffRampProvider(store, REF6),
    payment: new ManualQrisSettlementProvider(store),
    chain: new MockChainGateway(),
  };
};

async function fundedIntent(fiat = "27500") {
  const quote = await createQuote(db, new MockOffRampProvider(), { fiatAmountIdr: BigInt(fiat) });
  await authorize(db, quote.paymentId);
  return quote;
}

const convResult = (fiat: string) => ({
  status: "COMPLETED" as const,
  reference: "EX-1",
  fiatAmountIdr: fiat,
  rateExecuted6: REF6.toString(),
});

describe("manual conversion + settlement", () => {
  it("runs to COMPLETED through two signed operator actions", async () => {
    const quote = await fundedIntent();
    expect((await execute(db, quote.paymentId, manual())).status).toBe("CONVERSION_PENDING");
    expect((await listTasks(db, "PENDING")).map((t) => t.kind)).toEqual(["CONVERSION"]);

    const [convTask] = await listTasks(db, "PENDING");
    const resumed = await completeOperatorTask(db, manual(), convTask.id, convResult(quote.fiatAmount));
    expect(resumed.intent.status).toBe("FIAT_SETTLEMENT_PENDING");
    expect(resumed.replayed).toBe(false);
    expect((await listTasks(db, "PENDING")).map((t) => t.kind)).toEqual(["FIAT_SETTLEMENT"]);

    const [settleTask] = await listTasks(db, "PENDING");
    const done = await completeOperatorTask(db, manual(), settleTask.id, {
      status: "COMPLETED",
      reference: "QRIS-1",
      proof: "struk-001.jpg",
    });
    expect(done.intent.status).toBe("COMPLETED");
    expect(await paymentNets(db, quote.paymentId)).toEqual({ USDC: 0n, IDR: 0n });
  });

  it("operator conversion failure refunds; short conversion holds for review", async () => {
    const q1 = await fundedIntent("10000");
    await execute(db, q1.paymentId, manual());
    const [t1] = (await listTasks(db, "PENDING")).filter((t) => t.paymentId === q1.paymentId);
    const failed = await completeOperatorTask(db, manual(), t1.id, { status: "FAILED", note: "exchange rejected" });
    expect(failed.intent.status).toBe("REFUND_REQUIRED");
    expect((await refund(db, q1.paymentId)).status).toBe("REFUNDED");

    const q2 = await fundedIntent("10000");
    await execute(db, q2.paymentId, manual());
    const [t2] = (await listTasks(db, "PENDING")).filter((t) => t.paymentId === q2.paymentId);
    const short = await completeOperatorTask(db, manual(), t2.id, {
      ...convResult((BigInt(q2.fiatAmount) - 1n).toString()),
      reference: "EX-2",
    });
    expect(short.intent.status).toBe("RECONCILIATION_REQUIRED");
  });

  it("operator settlement failure refunds after funding", async () => {
    const quote = await fundedIntent("12000");
    await execute(db, quote.paymentId, manual());
    const [convTask] = (await listTasks(db, "PENDING")).filter((t) => t.paymentId === quote.paymentId);
    await completeOperatorTask(db, manual(), convTask.id, { ...convResult(quote.fiatAmount), reference: "EX-3" });
    const [settleTask] = (await listTasks(db, "PENDING")).filter((t) => t.paymentId === quote.paymentId);
    const out = await completeOperatorTask(db, manual(), settleTask.id, { status: "FAILED", note: "merchant QR invalid" });
    expect(out.intent.status).toBe("REFUND_REQUIRED");
  });

  it("identical replays are no-ops; conflicting reports are rejected", async () => {
    const quote = await fundedIntent("11000");
    await execute(db, quote.paymentId, manual());
    const [task] = (await listTasks(db, "PENDING")).filter((t) => t.paymentId === quote.paymentId);
    const result = { ...convResult(quote.fiatAmount), reference: "EX-4" };
    expect((await completeOperatorTask(db, manual(), task.id, result)).intent.status).toBe("FIAT_SETTLEMENT_PENDING");
    expect((await completeOperatorTask(db, manual(), task.id, result)).replayed).toBe(true);
    await expect(
      completeOperatorTask(db, manual(), task.id, { status: "FAILED", note: "changed my mind" }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("locked rate honors drift as explicit loss", () => {
  it("adverse execution still balances through the spread account", async () => {
    // A licensed off-ramp may settle below the lock; the founder absorbs it
    // (§14.1) and the books must still balance. Driven at the state-machine
    // level: legal states, a short conversion row, then settlement.
    const quote = await fundedIntent("15000");
    for (const s of ["CRYPTO_SUBMITTED", "CRYPTO_CONFIRMED", "CONVERSION_PENDING", "FIAT_SETTLEMENT_PENDING"] as const) {
      await transition(db, quote.paymentId, s, { actor: "test" });
    }
    await db.insert(conversions).values({
      paymentId: quote.paymentId,
      provider: "test",
      cryptoAmount: quote.usdcMicros.toString(),
      fiatAmount: (BigInt(quote.fiatAmount) - 100n).toString(),
      rateExecuted: REF6.toString(),
      reference: "EX-LOSS",
      status: "COMPLETED",
    });
    const out = await completeSettlement(db, quote.paymentId, "test-ref", BigInt(quote.fiatAmount), {
      fiatAmountIdr: BigInt(quote.fiatAmount) - 100n,
    });
    expect(out.status).toBe("COMPLETED");
    expect(await paymentNets(db, quote.paymentId)).toEqual({ IDR: 0n });
    expect(
      (await db.select().from(conversions).where(eq(conversions.paymentId, quote.paymentId))).length,
    ).toBe(1);
  });
});

describe("operator HTTP channel", () => {
  const app = createApp(db);
  const SECRET = "test-operator-secret";
  process.env.OPERATOR_SECRET = SECRET;

  const signed = (method: string, path: string, body?: unknown) => {
    const raw = body === undefined ? "" : JSON.stringify(body);
    return {
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `op-${Math.random().toString(36).slice(2)}`,
        "X-Operator-Signature": signOperator(SECRET, method, path, raw),
      },
      raw,
    };
  };

  it("rejects unsigned and mis-signed requests", async () => {
    expect((await app.request("/internal/tasks")).status).toBe(401);
    expect(
      (await app.request("/internal/tasks", { headers: { "X-Operator-Signature": "00" } })).status,
    ).toBe(401);
    const { headers } = signed("GET", "/internal/tasks");
    expect((await app.request("/internal/tasks?status=PENDING", { headers })).status).toBe(200);
  });

  it("completes a manual conversion leg over HTTP", async () => {
    const quote = await fundedIntent("13000");
    await execute(db, quote.paymentId, manual());
    const [task] = (await listTasks(db, "PENDING")).filter((t) => t.paymentId === quote.paymentId);

    const body = { status: "COMPLETED", reference: "EX-HTTP", fiatAmountIdr: quote.fiatAmount, rateExecuted6: REF6.toString() };
    const path = `/internal/tasks/${task.id}/complete`;
    const first = await app.request(path, { method: "POST", headers: signed("POST", path, body).headers, body: JSON.stringify(body) });
    expect(first.status).toBe(200);
    // Conversion was manual; settlement falls through to env providers
    // (mocks here), which settle synchronously — one call finishes all.
    expect(await first.json()).toMatchObject({ ok: true, replayed: false, status: "COMPLETED" });

    const again = await app.request(path, { method: "POST", headers: signed("POST", path, body).headers, body: JSON.stringify(body) });
    expect(await again.json()).toMatchObject({ ok: true, replayed: true });
    expect(await paymentNets(db, quote.paymentId)).toEqual({ USDC: 0n, IDR: 0n });
  });
});
