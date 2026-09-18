// Payment orchestration (§7.1, §14.1). Every step persists state before its
// side effect; unknowns age into RECONCILIATION_REQUIRED, never FAILED.

import { desc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import {
  blockchainTransactions,
  conversions,
  fiatSettlements,
  operatorTasks,
  paymentQuotes,
  webhookEvents,
} from "../db/schema.js";
import { engineConfig } from "./config.js";
import { postEntries } from "./ledger.js";
import type { ChainGateway, OffRampProvider, PaymentProvider } from "./providers.js";
import { ProviderTimeout } from "./providers.js";
import { MockChainGateway, MockOffRampProvider, MockQrisProvider } from "./providers.mock.js";
import { ManualOffRampProvider, ManualQrisSettlementProvider } from "./providers.manual.js";
import { RealChainGateway } from "./providers.real.js";
import { getIntent, transition, transitionWith, type Intent } from "./store.js";
import type { DbTx } from "./store.js";
import { dbTaskStore, getTask } from "./tasks.js";

export type Providers = { offRamp: OffRampProvider; payment: PaymentProvider; chain: ChainGateway };

export class PaymentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function latestQuote(db: Db, paymentId: string) {
  const rows = await db
    .select()
    .from(paymentQuotes)
    .where(eq(paymentQuotes.paymentId, paymentId))
    .orderBy(desc(paymentQuotes.createdAt))
    .limit(1);
  const q = rows[0];
  if (!q) throw new PaymentError(409, "no quote for payment");
  return q;
}

/** Lock the quoted rate. Expired quotes cannot be authorized, period (§9.2). */
export async function authorize(db: Db, id: string, actor = "api"): Promise<Intent> {
  const intent = await getIntent(db, id);
  if (!intent) throw new PaymentError(404, "unknown payment");
  if (intent.status === "AUTHORIZED") return intent; // replay
  if (intent.status !== "QUOTED") throw new PaymentError(409, `cannot authorize from ${intent.status}`);
  const q = await latestQuote(db, id);
  if (q.expiresAt.getTime() <= Date.now()) {
    await transition(db, id, "EXPIRED", { actor, reason: "quote expired before authorization" });
    throw new PaymentError(410, "quote expired");
  }
  return transition(db, id, "AUTHORIZED", { actor, reason: `rate locked at ${q.rate}` });
}

/** Give up before any crypto moved — cheap failure (§8.2). */
export async function cancel(db: Db, id: string, reason = "cancelled by user"): Promise<Intent> {
  const intent = await getIntent(db, id);
  if (!intent) throw new PaymentError(404, "unknown payment");
  if (!["CREATED", "QUOTED", "AUTHORIZED"].includes(intent.status)) {
    throw new PaymentError(409, `cannot cancel from ${intent.status}`);
  }
  return transition(db, id, "FAILED", { actor: "api", reason });
}

async function recordChainTx(
  tx: DbTx,
  args: {
    paymentId: string;
    txHash: string;
    chain: string;
    fromAddress: string;
    toAddress: string;
    amountUsdcMicros: bigint;
    confirmations: number;
  },
) {
  await tx
    .insert(blockchainTransactions)
    .values({
      paymentId: args.paymentId,
      txHash: args.txHash,
      chain: args.chain,
      fromAddress: args.fromAddress,
      toAddress: args.toAddress,
      amount: args.amountUsdcMicros.toString(),
      confirmations: args.confirmations,
      status: "CONFIRMED",
    })
    .onConflictDoNothing({ target: blockchainTransactions.txHash });
}

/**
 * Drive AUTHORIZED → COMPLETED through the providers, or into the correct
 * exception state (§14.1). Stops at pending-async legs for webhook completion.
 */
export async function execute(db: Db, id: string, providers: Providers): Promise<Intent> {
  let intent = await getIntent(db, id);
  if (!intent) throw new PaymentError(404, "unknown payment");
  if (intent.status !== "AUTHORIZED") throw new PaymentError(409, `cannot execute from ${intent.status}`);
  const q = await latestQuote(db, id);
  const usdcMicros = BigInt(q.cryptoAmount);
  const fiatIdr = BigInt(q.fiatAmount);

  // Funding leg: persist first, broadcast second. Broadcast failure has an
  // unknowable outcome → review, never a false FAILED.
  intent = await transition(db, id, "CRYPTO_SUBMITTED", { reason: "funding broadcast" });
  let txHash: string;
  try {
    ({ txHash } = await providers.chain.submitPayment({ paymentId: id, usdcMicros }));
  } catch (err) {
    return transition(db, id, "RECONCILIATION_REQUIRED", {
      reason: `broadcast outcome unknown: ${err instanceof Error ? err.message : err}`,
    });
  }
  const confirmations = await waitConfirmations(providers, txHash);
  if (confirmations === null) {
    return transition(db, id, "RECONCILIATION_REQUIRED", {
      reason: `confirmations not reached for ${txHash} (reorg watch)`,
    });
  }
  await db.transaction(async (tx) => {
    const parties = providers.chain.legParties?.() ?? { from: "undisclosed", to: "undisclosed" };
    await recordChainTx(tx, {
      paymentId: id,
      txHash,
      chain: providers.chain.name,
      fromAddress: parties.from,
      toAddress: parties.to,
      amountUsdcMicros: usdcMicros,
      confirmations,
    });
    await transitionWith(tx, id, "CRYPTO_CONFIRMED", { reason: `${confirmations} chain confirmations` });
    await postEntries(tx, id, [
      { account: "provider:conversion", debit: usdcMicros, credit: 0n, currency: "USDC" },
      { account: "user:crypto", debit: 0n, credit: usdcMicros, currency: "USDC" },
    ]);
  });

  // Conversion leg (USDC → IDR).
  intent = await transition(db, id, "CONVERSION_PENDING", { reason: "off-ramp started" });
  let conversion: { reference: string; status: "COMPLETED" | "PENDING"; fiatAmountIdr?: bigint; rateExecuted6?: bigint };
  try {
    conversion = await providers.offRamp.execute({ paymentId: id, usdcMicros, expectedFiatIdr: fiatIdr });
  } catch (err) {
    return transition(db, id, "RECONCILIATION_REQUIRED", {
      reason: `conversion outcome unknown: ${err instanceof Error ? err.message : err}`,
    });
  }
  if (conversion.status === "PENDING") {
    // Manual leg: the operator task is the provider's execute(). The intent
    // waits here for the signed completion (§6.2); dwell watchdog owns timeout.
    await db.insert(conversions).values({
      paymentId: id,
      provider: providers.offRamp.name,
      cryptoAmount: usdcMicros.toString(),
      reference: conversion.reference,
      status: "PENDING",
    });
    return (await getIntent(db, id))!;
  }
  const done = { reference: conversion.reference, fiatAmountIdr: conversion.fiatAmountIdr!, rateExecuted6: conversion.rateExecuted6! };
  if (done.fiatAmountIdr < fiatIdr) {
    // Partial evidence is not completion (§14.1) — hold for human review.
    await db.insert(conversions).values({
      paymentId: id,
      provider: providers.offRamp.name,
      cryptoAmount: usdcMicros.toString(),
      fiatAmount: done.fiatAmountIdr.toString(),
      rateExecuted: done.rateExecuted6.toString(),
      reference: done.reference,
      status: "PARTIAL",
    });
    return transition(db, id, "RECONCILIATION_REQUIRED", {
      reason: `partial conversion: ${done.fiatAmountIdr} < ${fiatIdr}`,
    });
  }
  await db.insert(conversions).values({
    paymentId: id,
    provider: providers.offRamp.name,
    cryptoAmount: usdcMicros.toString(),
    fiatAmount: done.fiatAmountIdr.toString(),
    rateExecuted: done.rateExecuted6.toString(),
    reference: done.reference,
    status: "COMPLETED",
  });

  // Settlement leg (IDR → merchant).
  return beginSettlement(db, providers, id, fiatIdr, { reference: done.reference, fiatAmountIdr: done.fiatAmountIdr });
}

/** Poll chain confirmations (reorg protection §14.1). Null on timeout. Mocks answer instantly. */
async function waitConfirmations(providers: Providers, txHash: string): Promise<number | null> {
  const need = numEnv("REQUIRED_CONFIRMATIONS", 12);
  const deadline = Date.now() + numEnv("CONFIRM_TIMEOUT_SEC", 300) * 1000;
  for (;;) {
    const n = await providers.chain.confirmations(txHash);
    if (n >= need) return n;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const numEnv = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`bad ${key}: ${raw}`);
  return n;
};

/** Open the settlement leg; shared by execute() and operator resume. */
export async function beginSettlement(
  db: Db,
  providers: Providers,
  id: string,
  fiatIdr: bigint,
  conversion: { reference: string; fiatAmountIdr: bigint },
): Promise<Intent> {
  await transition(db, id, "FIAT_SETTLEMENT_PENDING", { reason: "merchant settlement started" });
  const { ref } = await providers.payment.createPayment({ paymentId: id, fiatAmountIdr: fiatIdr });
  await db.insert(fiatSettlements).values({
    paymentId: id,
    provider: providers.payment.name,
    fiatAmount: fiatIdr.toString(),
    reference: ref,
    status: "PENDING",
  });
  for (let i = 0; i < engineConfig.settlePolls; i++) {
    let observed: { status: string; ref: string; fiatAmountIdr?: bigint };
    try {
      observed = await providers.payment.getPayment(ref);
    } catch (err) {
      if (err instanceof ProviderTimeout) {
        return transition(db, id, "RECONCILIATION_REQUIRED", { reason: `settlement poll timed out on ${ref}` });
      }
      throw err;
    }
    if (observed.status === "COMPLETED") return completeSettlement(db, id, ref, fiatIdr, conversion);
    if (observed.status === "FAILED") {
      return transition(db, id, "REFUND_REQUIRED", { reason: `settlement ${ref} failed after crypto confirmed` });
    }
  }
  // Still pending: leave the state for webhook/operator completion (§14.1
  // partial/async rule). Dwell watchdog + reconciler own the timeout from here.
  return (await getIntent(db, id))!;
}

/** Settle the fiat side: merchant paid, fees + spread booked, COMPLETED. */
export async function completeSettlement(
  db: Db,
  id: string,
  ref: string,
  fiatIdr: bigint,
  conversion: { fiatAmountIdr: bigint },
): Promise<Intent> {
  const q = await latestQuote(db, id);
  // Surplus vs the locked rate is spread income. A shortfall is the founder's
  // loss (§14.1: the locked rate is honoured, spread absorbs the drift) —
  // booked explicitly so the books always balance and tell the truth.
  const driftIdr = conversion.fiatAmountIdr - fiatIdr;
  const feeIdr = BigInt(q.feeFiat);
  const spreadLegs =
    driftIdr >= 0n
      ? [
          { account: "provider:conversion", debit: driftIdr, credit: 0n, currency: "IDR" as const },
          { account: "spread", debit: 0n, credit: driftIdr, currency: "IDR" as const },
        ]
      : [
          { account: "spread", debit: -driftIdr, credit: 0n, currency: "IDR" as const },
          { account: "provider:conversion", debit: 0n, credit: -driftIdr, currency: "IDR" as const },
        ];
  return db.transaction(async (tx) => {
    await tx.update(fiatSettlements).set({ status: "COMPLETED" }).where(eq(fiatSettlements.reference, ref));
    await postEntries(tx, id, [
      { account: "merchant:fiat", debit: fiatIdr, credit: 0n, currency: "IDR" },
      { account: "provider:conversion", debit: 0n, credit: fiatIdr, currency: "IDR" },
      { account: "provider:conversion", debit: feeIdr, credit: 0n, currency: "IDR" },
      { account: "fees", debit: 0n, credit: feeIdr, currency: "IDR" },
      ...spreadLegs,
    ]);
    return transitionWith(tx, id, "COMPLETED", { reason: `settled via ${ref}` });
  });
}

/**
 * The single most important path (§14.1): crypto left the wallet but the
 * merchant will not be paid. Return funds to source minus documented cost.
 */
export async function refund(db: Db, id: string, networkCostUsdcMicros = 10_000n): Promise<Intent> {
  const intent = await getIntent(db, id);
  if (!intent) throw new PaymentError(404, "unknown payment");
  if (intent.status === "REFUNDED") return intent;
  if (intent.status !== "REFUND_REQUIRED") throw new PaymentError(409, `cannot refund from ${intent.status}`);
  const q = await latestQuote(db, id);
  const held = BigInt(q.cryptoAmount);
  return db.transaction(async (tx) => {
    await postEntries(tx, id, [
      { account: "user:crypto", debit: held - networkCostUsdcMicros, credit: 0n, currency: "USDC" },
      { account: "fees", debit: networkCostUsdcMicros, credit: 0n, currency: "USDC" },
      { account: "provider:conversion", debit: 0n, credit: held, currency: "USDC" },
    ]);
    return transitionWith(tx, id, "REFUNDED", { reason: `refunded minus ${networkCostUsdcMicros}µUSDC network cost` });
  });
}

/**
 * Provider callback (§12). Idempotent by (provider, eventId): redelivery is a
 * logged no-op (§14.1 duplicate webhook). Completes a pending settlement.
 */
export async function handleWebhook(
  db: Db,
  provider: string,
  event: { eventId: string; type: string; ref?: string },
): Promise<{ deduped: boolean; status: string }> {
  const inserted = await db
    .insert(webhookEvents)
    .values({ provider, eventId: event.eventId, payload: event })
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] })
    .returning();
  if (inserted.length === 0) return { deduped: true, status: "noop" };
  if (event.type === "settlement.completed" && event.ref) {
    const rows = await db.select().from(fiatSettlements).where(eq(fiatSettlements.reference, event.ref)).limit(1);
    const leg = rows[0];
    if (leg && leg.status === "PENDING") {
      const intent = await getIntent(db, leg.paymentId);
      const convRows = await db.select().from(conversions).where(eq(conversions.paymentId, leg.paymentId)).limit(1);
      if (intent?.status === "FIAT_SETTLEMENT_PENDING" && convRows[0]) {
        await completeSettlement(db, leg.paymentId, event.ref, BigInt(leg.fiatAmount), {
          fiatAmountIdr: BigInt(convRows[0].fiatAmount ?? leg.fiatAmount),
        });
        await db.update(webhookEvents).set({ processed: 1 }).where(eq(webhookEvents.id, inserted[0].id));
        return { deduped: false, status: "COMPLETED" };
      }
    }
  }
  await db.update(webhookEvents).set({ processed: 1 }).where(eq(webhookEvents.id, inserted[0].id));
  return { deduped: false, status: "recorded" };
}

/** Provider wiring from env. Defaults are mocks; prod sets ENGINE_* (M4/M5 ops). */
export function providersFromEnv(db: Db): Providers {
  const manualRate = process.env.MANUAL_IDR_PER_USDC;
  const offRamp =
    process.env.ENGINE_OFFRAMP === "manual"
      ? new ManualOffRampProvider(dbTaskStore(db), manualRef6(manualRate))
      : new MockOffRampProvider();
  const payment =
    process.env.ENGINE_PAYMENT === "manual"
      ? new ManualQrisSettlementProvider(dbTaskStore(db))
      : new MockQrisProvider();
  const chain = process.env.ENGINE_CHAIN === "real" ? new RealChainGateway() : new MockChainGateway();
  return { offRamp, payment, chain };
}

function manualRef6(raw: string | undefined): bigint {
  // Fail closed: real first-party pricing must come from the founder's own
  // exchange screen, never a hardcoded staging default.
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error("MANUAL_IDR_PER_USDC (integer IDR per USDC) required with ENGINE_OFFRAMP=manual");
  }
  return BigInt(raw) * 1_000_000n;
}

export type OperatorResult = {
  status: "COMPLETED" | "FAILED";
  reference?: string;
  fiatAmountIdr?: string;
  rateExecuted6?: string;
  proof?: unknown;
  note?: string;
};

async function markTask(db: Db, taskId: string, status: "COMPLETED" | "FAILED", result: OperatorResult) {
  await db
    .update(operatorTasks)
    .set({ status, result, completedAt: new Date() })
    .where(eq(operatorTasks.id, taskId));
}

function bigOr422(value: string | undefined, field: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new PaymentError(422, `${field} (non-negative integer string) required`);
  }
  return BigInt(value);
}

/**
 * Signed operator action resumes a manual leg (§10). Replay with the identical
 * result is a no-op; conflicting reports on a done task are rejected.
 */
export async function completeOperatorTask(
  db: Db,
  providers: Providers,
  taskId: string,
  result: OperatorResult,
): Promise<{ intent: Intent; replayed: boolean }> {
  const task = await getTask(db, taskId);
  if (!task) throw new PaymentError(404, "unknown task");
  if (task.status !== "PENDING") {
    const prior = task.result as OperatorResult | null;
    if (prior && JSON.stringify(prior) === JSON.stringify(result)) {
      return { intent: (await getIntent(db, task.paymentId))!, replayed: true };
    }
    throw new PaymentError(409, `task already ${task.status}`);
  }
  const id = task.paymentId;
  const intent = await getIntent(db, id);
  if (!intent) throw new PaymentError(404, "unknown payment");

  if (task.kind === "CONVERSION") {
    if (intent.status !== "CONVERSION_PENDING") {
      throw new PaymentError(409, `conversion task does not match payment state ${intent.status}`);
    }
    if (result.status === "FAILED") {
      await markTask(db, taskId, "FAILED", result);
      const out = await transition(db, id, "REFUND_REQUIRED", {
        actor: "operator",
        reason: result.note ?? "operator reported conversion failure",
      });
      return { intent: out, replayed: false };
    }
    if (!result.reference) throw new PaymentError(422, "reference required");
    const q = await latestQuote(db, id);
    const expected = BigInt(q.fiatAmount);
    const actual = bigOr422(result.fiatAmountIdr, "fiatAmountIdr");
    const rate = bigOr422(result.rateExecuted6, "rateExecuted6");
    await markTask(db, taskId, "COMPLETED", result);
    const legs = await db.select().from(conversions).where(eq(conversions.paymentId, id));
    const leg = legs.find((l) => l.status === "PENDING") ?? legs[0];
    if (!leg) throw new PaymentError(409, "no conversion leg for task");
    if (actual < expected) {
      await db.update(conversions).set({ fiatAmount: actual.toString(), rateExecuted: rate.toString(), reference: result.reference, status: "PARTIAL" }).where(eq(conversions.id, leg.id));
      const out = await transition(db, id, "RECONCILIATION_REQUIRED", {
        actor: "operator",
        reason: `operator short conversion: ${actual} < ${expected}`,
      });
      return { intent: out, replayed: false };
    }
    await db.update(conversions).set({ fiatAmount: actual.toString(), rateExecuted: rate.toString(), reference: result.reference, status: "COMPLETED" }).where(eq(conversions.id, leg.id));
    const out = await beginSettlement(db, providers, id, expected, { reference: result.reference, fiatAmountIdr: actual });
    return { intent: out, replayed: false };
  }

  if (intent.status !== "FIAT_SETTLEMENT_PENDING") {
    throw new PaymentError(409, `settlement task does not match payment state ${intent.status}`);
  }
  if (result.status === "FAILED") {
    await markTask(db, taskId, "FAILED", result);
    const out = await transition(db, id, "REFUND_REQUIRED", {
      actor: "operator",
      reason: result.note ?? "operator reported settlement failure",
    });
    return { intent: out, replayed: false };
  }
  if (!result.reference) throw new PaymentError(422, "reference required");
  const q = await latestQuote(db, id);
  const legs = await db.select().from(fiatSettlements).where(eq(fiatSettlements.paymentId, id));
  const leg = legs.find((l) => l.status === "PENDING") ?? legs[0];
  if (!leg?.reference) throw new PaymentError(409, "no settlement leg for task");
  const convRows = await db.select().from(conversions).where(eq(conversions.paymentId, id));
  const actual = BigInt(convRows[0]?.fiatAmount ?? leg.fiatAmount);
  await db.update(fiatSettlements).set({ proof: result.proof ?? null }).where(eq(fiatSettlements.id, leg.id));
  await markTask(db, taskId, "COMPLETED", result);
  const out = await completeSettlement(db, id, leg.reference, BigInt(q.fiatAmount), { fiatAmountIdr: actual });
  return { intent: out, replayed: false };
}
