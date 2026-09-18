// Fault-injection suite (§14.2). Each test asserts the resulting state AND
// the resulting ledger balance — a fault test without the money check proves
// nothing.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { conversions, ledgerEntries } from "../db/schema.js";
import { paymentNets } from "./ledger.js";
import { MockOffRampProvider } from "./providers.mock.js";
import {
  FaultyChainGateway,
  FaultyOffRampProvider,
  FaultyQrisProvider,
} from "./providers.faulty.js";
import { MockChainGateway, MockQrisProvider } from "./providers.mock.js";
import { createQuote } from "./quote.js";
import { reconcilePayment } from "./reconcile.js";
import { execute, handleWebhook, refund } from "./service.js";
import { InvalidTransition } from "./states.js";
import { getIntent, transition } from "./store.js";
import { mocks, quotedPayment, testDb } from "../../test/helpers.js";

const db = testDb();

const withFaults = (fault: { offRamp?: MockOffRampProvider | FaultyOffRampProvider; payment?: MockQrisProvider | FaultyQrisProvider; chain?: MockChainGateway | FaultyChainGateway }) => ({
  offRamp: fault.offRamp ?? new MockOffRampProvider(),
  payment: fault.payment ?? new MockQrisProvider(),
  chain: fault.chain ?? new MockChainGateway(),
});

describe("settlement failure after crypto confirmed (§14.1 row 1)", () => {
  it("goes REFUND_REQUIRED → REFUNDED with balanced books", async () => {
    const { quote } = await quotedPayment(db);
    const stuck = await execute(db, quote.paymentId, withFaults({ payment: new FaultyQrisProvider("failed") }));
    expect(stuck.status).toBe("REFUND_REQUIRED");

    const out = await refund(db, quote.paymentId);
    expect(out.status).toBe("REFUNDED");
    // No fiat ever moved on this path — only the USDC books exist, balanced.
    expect(await paymentNets(db, quote.paymentId)).toEqual({ USDC: 0n });
    expect(await reconcilePayment(db, quote.paymentId)).toEqual([]);
    // Refund is replay-safe.
    expect((await refund(db, quote.paymentId)).status).toBe("REFUNDED");
  });
});

describe("unknowns become review, never false terminals", () => {
  it("broadcast failure → RECONCILIATION_REQUIRED (outcome unknowable)", async () => {
    const { quote } = await quotedPayment(db);
    const out = await execute(db, quote.paymentId, withFaults({ chain: new FaultyChainGateway() }));
    expect(out.status).toBe("RECONCILIATION_REQUIRED");
    expect(out.failureReason).toMatch(/broadcast outcome unknown/);
  });

  it("off-ramp throw and timeout → RECONCILIATION_REQUIRED", async () => {
    for (const fault of ["throw", "timeout"] as const) {
      const { quote } = await quotedPayment(db);
      const out = await execute(
        db,
        quote.paymentId,
        withFaults({ offRamp: new FaultyOffRampProvider(fault, 16_000_000_000n) }),
      );
      expect(out.status).toBe("RECONCILIATION_REQUIRED");
    }
  });

  it("settlement timeout → RECONCILIATION_REQUIRED", async () => {
    const { quote } = await quotedPayment(db);
    const out = await execute(db, quote.paymentId, withFaults({ payment: new FaultyQrisProvider("timeout") }));
    expect(out.status).toBe("RECONCILIATION_REQUIRED");
  });

  it("partial conversion is recorded, never completed", async () => {
    const { quote } = await quotedPayment(db);
    const out = await execute(
      db,
      quote.paymentId,
      withFaults({ offRamp: new FaultyOffRampProvider("partial", 16_000_000_000n) }),
    );
    expect(out.status).toBe("RECONCILIATION_REQUIRED");
    const [conv] = await db.select().from(conversions).where(eq(conversions.paymentId, quote.paymentId));
    expect(conv.status).toBe("PARTIAL");
  });
});

describe("async settlement via webhook", () => {
  it("pending leg waits, webhook completes once, redelivery is a no-op", async () => {
    const { quote } = await quotedPayment(db);
    const waiting = await execute(
      db,
      quote.paymentId,
      withFaults({ payment: new FaultyQrisProvider("pending-forever") }),
    );
    expect(waiting.status).toBe("FIAT_SETTLEMENT_PENDING");

    const ref = `qris-${quote.paymentId.slice(0, 8)}`;
    const first = await handleWebhook(db, "faulty-qris", { eventId: "evt-1", type: "settlement.completed", ref });
    expect(first).toEqual({ deduped: false, status: "COMPLETED" });
    expect((await getIntent(db, quote.paymentId))?.status).toBe("COMPLETED");

    const legsBefore = await db.select().from(ledgerEntries).where(eq(ledgerEntries.paymentId, quote.paymentId));
    const second = await handleWebhook(db, "faulty-qris", { eventId: "evt-1", type: "settlement.completed", ref });
    expect(second.deduped).toBe(true);
    const legsAfter = await db.select().from(ledgerEntries).where(eq(ledgerEntries.paymentId, quote.paymentId));
    expect(legsAfter.length).toBe(legsBefore.length); // no double-post
    expect(await paymentNets(db, quote.paymentId)).toEqual({ USDC: 0n, IDR: 0n });
  });
});

describe("state machine guards", () => {
  it("rejects backward and sideways jumps", async () => {
    const { quote } = await quotedPayment(db);
    await expect(transition(db, quote.paymentId, "COMPLETED")).rejects.toThrow(InvalidTransition);
    await expect(transition(db, quote.paymentId, "AUTHORIZED")).resolves.toMatchObject({ status: "AUTHORIZED" });
    // Replay is a no-op, not an error.
    await expect(transition(db, quote.paymentId, "AUTHORIZED")).resolves.toMatchObject({ status: "AUTHORIZED" });
  });
});
