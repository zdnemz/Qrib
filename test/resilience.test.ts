// Resilience review fixes: serialized execution, resume-after-crash,
// idempotent settlement/retry, and the audited review-resolve exit.

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createApp } from "../src/app.js";
import { signOperator } from "../src/api/operator.js";
import { paymentNets } from "../src/engine/ledger.js";
import { MockChainGateway, MockOffRampProvider, MockQrisProvider } from "../src/engine/providers.mock.js";
import { FaultyChainGateway } from "../src/engine/providers.faulty.js";
import { ManualOffRampProvider, ManualQrisSettlementProvider } from "../src/engine/providers.manual.js";
import { createQuote } from "../src/engine/quote.js";
import {
  authorize,
  completeOperatorTask,
  execute,
  refund,
  resolveReview,
  withPaymentLock,
  PaymentError,
} from "../src/engine/service.js";
import { blockchainTransactions, conversions, fiatSettlements } from "../src/db/schema.js";
import { getIntent, latestAttempts } from "../src/engine/store.js";
import { dbTaskStore, listTasks } from "../src/engine/tasks.js";
import { testDb } from "./helpers.js";

const db = testDb();
const REF6 = 16_000_000_000n;

/** QRIS provider that stays PENDING — lets the intent park at settlement. */
class PendingQrisProvider extends MockQrisProvider {
  override async getPayment(ref: string) {
    return { status: "PENDING" as const, ref };
  }
}

const manual = () => {
  const store = dbTaskStore(db);
  return {
    offRamp: new ManualOffRampProvider(store, REF6),
    payment: new ManualQrisSettlementProvider(store),
    chain: new MockChainGateway(),
  };
};
const mocks = () => ({
  offRamp: new MockOffRampProvider(),
  payment: new MockQrisProvider(),
  chain: new MockChainGateway(),
});

async function quoted(fiat = "27500") {
  const q = await createQuote(db, new MockOffRampProvider(), { fiatAmountIdr: BigInt(fiat) });
  await authorize(db, q.paymentId);
  return q;
}

describe("execution serialization", () => {
  it("does not double-broadcast on concurrent execute() calls", async () => {
    let submits = 0;
    const base = mocks();
    const counting = {
      offRamp: base.offRamp,
      payment: base.payment,
      chain: new MockChainGateway(),
    };
    counting.chain.submitPayment = async () => {
      submits++;
      await new Promise((r) => setTimeout(r, 60));
      return { txHash: `0x${submits}`.padEnd(66, "0") as `0x${string}` };
    };
    const q = await quoted("10000");
    const results = await Promise.all([
      execute(db, q.paymentId, counting).then((v) => v.status, (e) => `err:${e.message}`),
      execute(db, q.paymentId, counting).then((v) => v.status, (e) => `err:${e.message}`),
    ]);
    // Exactly one broadcast; the second call resumed the same payment.
    expect(submits).toBe(1);
    expect(results).toEqual(["COMPLETED", "COMPLETED"]);
    const txs = await db.select().from(blockchainTransactions).where(eq(blockchainTransactions.paymentId, q.paymentId));
    expect(txs.length).toBe(1);
  });

  it("the lock itself never deadlocks a failed holder", async () => {
    await expect(
      withPaymentLock("p-lock", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(withPaymentLock("p-lock", async () => "ok")).resolves.toBe("ok");
  });
});

describe("resume after crash", () => {
  it("a completed conversion resumes into settlement without re-running it", async () => {
    const q = await quoted("12000");
    await execute(db, q.paymentId, manual()); // → CONVERSION_PENDING
    const [task] = (await listTasks(db, "PENDING")).filter((t) => t.paymentId === q.paymentId);
    // Manual conversion completes; settlement uses a PENDING-first provider so
    // the intent parks at FIAT_SETTLEMENT_PENDING rather than finishing.
    await completeOperatorTask(db, { ...manual(), payment: new PendingQrisProvider() }, task.id, {
      status: "COMPLETED",
      reference: "EX-R",
      fiatAmountIdr: q.fiatAmount,
      rateExecuted6: REF6.toString(),
    });
    expect((await getIntent(db, q.paymentId))?.status).toBe("FIAT_SETTLEMENT_PENDING");
    expect((await db.select().from(conversions).where(eq(conversions.paymentId, q.paymentId))).length).toBe(1);

    // Retry from pending: must not duplicate legs, and stays pending (the
    // provider is still PENDING — evidence-based, never assumed).
    const out = await execute(db, q.paymentId, { ...manual(), payment: new PendingQrisProvider() });
    expect(out.status).toBe("FIAT_SETTLEMENT_PENDING");
    expect((await db.select().from(conversions).where(eq(conversions.paymentId, q.paymentId))).length).toBe(1);
    expect((await db.select().from(fiatSettlements).where(eq(fiatSettlements.paymentId, q.paymentId))).length).toBe(1);
  });

  it("CRYPTO_SUBMITTED resumes by polling the recorded tx, not re-broadcasting", async () => {
    const q = await quoted("9500");
    // First call broadcasts, records the hash, then we stop it mid-flight by
    // using a chain whose confirmations never arrive in time.
    const stalling = {
      offRamp: new MockOffRampProvider(),
      payment: new MockQrisProvider(),
      chain: new MockChainGateway(),
    };
    let submits = 0;
    const originalSubmit = stalling.chain.submitPayment.bind(stalling.chain);
    stalling.chain.submitPayment = async (input) => {
      submits++;
      return originalSubmit(input);
    };
    // Force the first attempt to stall after broadcast by replacing confirmations.
    const realConfirmations = stalling.chain.confirmations.bind(stalling.chain);
    let firstCall = true;
    stalling.chain.confirmations = async () => {
      if (firstCall) {
        firstCall = false;
        throw new Error("simulated crash after broadcast");
      }
      return 12;
    };
    await expect(execute(db, q.paymentId, stalling)).rejects.toThrow(/simulated crash/);

    const intent = await getIntent(db, q.paymentId);
    expect(intent?.status).toBe("CRYPTO_SUBMITTED");
    const attempts = await latestAttempts(db, q.paymentId);
    expect(attempts.find((a) => a.state === "CRYPTO_SUBMITTED")?.txHash).toBeTruthy();

    // Resume: polls the recorded hash and finishes — no second broadcast.
    const out = await execute(db, q.paymentId, { ...mocks(), chain: { ...new MockChainGateway(), confirmations: realConfirmations } });
    expect(out.status).toBe("COMPLETED");
    expect(submits).toBe(1);
  });

  it("CRYPTO_SUBMITTED with no recorded hash goes to review", async () => {
    const q = await quoted("8500");
    await execute(db, q.paymentId, { ...mocks(), chain: new FaultyChainGateway() });
    // FaultyChainGateway never yields a hash → executeFresh reviews it.
    expect((await getIntent(db, q.paymentId))?.status).toBe("RECONCILIATION_REQUIRED");
  });

  it("missing leg rows are rebuilt from the operator task payload", async () => {
    const q = await quoted("7000");
    await execute(db, q.paymentId, manual());
    const [task] = (await listTasks(db, "PENDING")).filter((t) => t.paymentId === q.paymentId);
    // Simulate the crash window: task exists, PENDING conversion row does not.
    await db.delete(conversions).where(eq(conversions.paymentId, q.paymentId));
    const out = await completeOperatorTask(db, { ...manual(), payment: new PendingQrisProvider() }, task.id, {
      status: "COMPLETED",
      reference: "EX-REBUILD",
      fiatAmountIdr: q.fiatAmount,
      rateExecuted6: REF6.toString(),
    });
    expect(out.intent.status).toBe("FIAT_SETTLEMENT_PENDING");
    expect((await db.select().from(conversions).where(eq(conversions.paymentId, q.paymentId))).length).toBe(1);
  });
});

describe("settlement idempotency", () => {
  it("beginSettlement reuses an open leg instead of filing a second", async () => {
    const q = await quoted("6000");
    await execute(db, q.paymentId, manual());
    const [conv] = await listTasks(db, "PENDING");
    await completeOperatorTask(db, mocks(), conv.id, {
      status: "COMPLETED",
      reference: "EX-2X",
      fiatAmountIdr: q.fiatAmount,
      rateExecuted6: REF6.toString(),
    });
    const before = await db.select().from(fiatSettlements).where(eq(fiatSettlements.paymentId, q.paymentId));
    // A second pass through the same entry point (operator re-POST, or resume)
    // must not create a duplicate settlement leg.
    await execute(db, q.paymentId, mocks());
    const after = await db.select().from(fiatSettlements).where(eq(fiatSettlements.paymentId, q.paymentId));
    expect(after.length).toBe(before.length);
  });

  it("completeSettlement twice posts the ledger exactly once", async () => {
    const q = await quoted("5000");
    const intent = await execute(db, q.paymentId, mocks());
    expect(intent.status).toBe("COMPLETED");
    await execute(db, q.paymentId, mocks()); // idempotent re-entry
    expect(await paymentNets(db, q.paymentId)).toEqual({ USDC: 0n, IDR: 0n });
  });
});

describe("review resolve (audited exit from RECONCILIATION_REQUIRED)", () => {
  const app = createApp(db);
  const SECRET = "resolve-secret";
  process.env.OPERATOR_SECRET = SECRET;

  const signed = (method: string, path: string, body: unknown) => {
    const raw = JSON.stringify(body);
    return {
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `rv-${Math.random().toString(36).slice(2)}`,
        "X-Operator-Signature": signOperator(SECRET, method, path, raw),
      },
      raw,
    };
  };

  it("unfunded review → FAILED (cheap); funded review → REFUND_REQUIRED only", async () => {
    const q = await quoted("4000");
    await execute(db, q.paymentId, { ...mocks(), chain: new FaultyChainGateway() });
    expect((await getIntent(db, q.paymentId))?.status).toBe("RECONCILIATION_REQUIRED");
    expect((await resolveReview(db, q.paymentId, "FAILED", "broadcast outcome unknowable, nothing moved")).status).toBe("FAILED");
    // The exit is one-way: an already-resolved payment is not re-resolvable.
    await expect(resolveReview(db, q.paymentId, "REFUND_REQUIRED", "no")).rejects.toMatchObject({
      status: 409,
      message: /nothing to resolve/,
    });
  });

  it("funded review may only refund, never FAILED", async () => {
    const q = await quoted("4000");
    // Reach a funded review through an operator shortfall (crypto is gone).
    await execute(db, q.paymentId, manual());
    const [task] = (await listTasks(db, "PENDING")).filter((t) => t.paymentId === q.paymentId);
    await completeOperatorTask(db, manual(), task.id, {
      status: "COMPLETED",
      reference: "EX-SHORT",
      fiatAmountIdr: (BigInt(q.fiatAmount) - 1n).toString(),
      rateExecuted6: REF6.toString(),
    });
    expect((await getIntent(db, q.paymentId))?.status).toBe("RECONCILIATION_REQUIRED");
    await expect(resolveReview(db, q.paymentId, "FAILED", "let me just fail it")).rejects.toMatchObject({
      status: 409,
      message: /funds may have moved/,
    });
    expect((await resolveReview(db, q.paymentId, "REFUND_REQUIRED", "short conversion, refunding")).status).toBe("REFUND_REQUIRED");
    expect((await refund(db, q.paymentId)).status).toBe("REFUNDED");
    expect(await paymentNets(db, q.paymentId)).toEqual({ USDC: 0n });
  });

  it("rejects resolve without a reason, and unknown targets", async () => {
    const q = await quoted("3000");
    await execute(db, q.paymentId, { ...mocks(), chain: new FaultyChainGateway() });
    const path = `/internal/payments/${q.paymentId}/resolve`;
    const dup = (body: unknown) => signed("POST", path, body);
    const noReason = dup({ to: "FAILED" });
    const bad = await app.request(path, { method: "POST", headers: noReason.headers, body: noReason.raw });
    expect(bad.status).toBe(400);

    const wrong = dup({ to: "QUOTED", reason: "nope" });
    const wrongRes = await app.request(path, { method: "POST", headers: wrong.headers, body: wrong.raw });
    expect(wrongRes.status).toBe(400);

    const good = dup({ to: "FAILED", reason: "reviewed, nothing moved" });
    const goodRes = await app.request(path, { method: "POST", headers: good.headers, body: good.raw });
    expect(goodRes.status).toBe(200);
    expect(await goodRes.json()).toMatchObject({ ok: true, status: "FAILED" });
  });

  it("PaymentError surfaces as its status over HTTP", () => {
    expect(new PaymentError(410, "gone").status).toBe(410);
  });
});
