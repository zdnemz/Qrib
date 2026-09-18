// Payment orchestration (§7.1, §14.1). Every step persists state before its
// side effect; unknowns age into RECONCILIATION_REQUIRED, never FAILED.

import { and, desc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import {
  blockchainTransactions,
  conversions,
  fiatSettlements,
  operatorTasks,
  paymentAttempts,
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
import { getIntent, latestAttempts, transition, transitionWith, type Intent } from "./store.js";
import type { DbTx } from "./store.js";
import { dbTaskStore, getTask } from "./tasks.js";

export type Providers = { offRamp: OffRampProvider; payment: PaymentProvider; chain: ChainGateway };

export class PaymentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Per-payment mutex. Two concurrent execute() calls must never both pass the
 * AUTHORIZED check and double-broadcast on a real chain (double-tap on Bayar
 * is the most likely trigger). Single-node only — multi-instance needs a DB
 * advisory lock, same known limit as the idempotency race.
 */
const locks = new Map<string, Promise<void>>();

export async function withPaymentLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  while (locks.has(id)) {
    try {
      await locks.get(id);
    } catch {
      // Previous holder failed; we take our turn anyway.
    }
  }
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  locks.set(id, gate);
  try {
    return await fn();
  } finally {
    locks.delete(id);
    release();
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
 * exception state (§14.1). Serialized per payment (no double broadcast) and
 * resumable: CONVERSION_PENDING / FIAT_SETTLEMENT_PENDING resume their legs,
 * and CRYPTO_SUBMITTED resumes by polling the ALREADY-BROADCAST tx (never
 * re-broadcasts — a second broadcast of an unknown outcome could double-send).
 * A leg whose tx hash is not yet known is genuinely unresumable: review it.
 */
export async function execute(db: Db, id: string, providers: Providers): Promise<Intent> {
  return withPaymentLock(id, async () => {
    const intent = await getIntent(db, id);
    if (!intent) throw new PaymentError(404, "unknown payment");
    if (intent.status === "AUTHORIZED") return executeFresh(db, id, providers);
    if (intent.status === "CRYPTO_SUBMITTED") return resumeFunding(db, id, providers);
    if (intent.status === "CONVERSION_PENDING") return resumeConversion(db, id, providers);
    if (intent.status === "FIAT_SETTLEMENT_PENDING") return resumeSettlement(db, id, providers);
    // COMPLETED and terminal exception states: execute() is not the tool to
    // change them. COMPLETED reads back idempotently (a double-tap on Bayar
    // must not error); every other terminal state is a genuine conflict.
    if (intent.status === "COMPLETED") return intent;
    throw new PaymentError(409, `cannot execute from ${intent.status}`);
  });
}

/**
 * Resume a broadcast that never recorded confirmations. Uses the tx hash
 * from the audit trail — the ONLY safe resume, because it polls a known hash
 * instead of sending a new transaction.
 */
async function resumeFunding(db: Db, id: string, providers: Providers): Promise<Intent> {
  const attempts = await latestAttempts(db, id);
  const txHash = attempts.find((a) => a.state === "CRYPTO_SUBMITTED" && a.txHash)?.txHash;
  if (!txHash) {
    // Broadcast began but no hash was ever persisted: outcome unknowable to us.
    return transition(db, id, "RECONCILIATION_REQUIRED", {
      reason: "CRYPTO_SUBMITTED with no recorded tx hash — manual chain review",
    });
  }
  const confirmations = await waitConfirmations(providers, txHash);
  if (confirmations === null) {
    return transition(db, id, "RECONCILIATION_REQUIRED", {
      reason: `confirmations not reached for ${txHash} (reorg watch)`,
    });
  }
  const q = await latestQuote(db, id);
  await confirmFunding(db, id, providers, txHash, BigInt(q.cryptoAmount), confirmations);
  await transition(db, id, "CONVERSION_PENDING", { reason: "off-ramp started" });
  return settleRemainder(db, id, providers, BigInt(q.fiatAmount), BigInt(q.cryptoAmount));
}

/** Record the confirmed funding tx + post the USDC legs (idempotent). */
async function confirmFunding(
  db: Db,
  id: string,
  providers: Providers,
  txHash: string,
  usdcMicros: bigint,
  confirmations: number,
): Promise<void> {
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
}

/** Run (or reuse) the conversion leg, then open settlement. Shared by all resumes. */
async function settleRemainder(db: Db, id: string, providers: Providers, fiatIdr: bigint, usdcMicros: bigint): Promise<Intent> {
  const ran = await runConversionLeg(db, providers, id, fiatIdr, usdcMicros);
  if (!ran.conversion) return ran.intent;
  return beginSettlement(db, providers, id, fiatIdr, ran.conversion);
}

async function executeFresh(db: Db, id: string, providers: Providers): Promise<Intent> {
  const q = await latestQuote(db, id);
  const usdcMicros = BigInt(q.cryptoAmount);
  const fiatIdr = BigInt(q.fiatAmount);

  // Funding leg: persist first, broadcast second. Broadcast failure has an
  // unknowable outcome → review, never a false FAILED.
  await transition(db, id, "CRYPTO_SUBMITTED", { reason: "funding broadcast" });
  let txHash: string;
  try {
    ({ txHash } = await providers.chain.submitPayment({ paymentId: id, usdcMicros }));
  } catch (err) {
    return transition(db, id, "RECONCILIATION_REQUIRED", {
      reason: `broadcast outcome unknown: ${err instanceof Error ? err.message : err}`,
    });
  }
  // Persist the hash onto the CRYPTO_SUBMITTED attempt so a crash from here
  // is resumable by polling this exact tx (resumeFunding), not re-broadcasting.
  await db.update(paymentAttempts)
    .set({ txHash })
    .where(and(eq(paymentAttempts.paymentId, id), eq(paymentAttempts.state, "CRYPTO_SUBMITTED")));
  const confirmations = await waitConfirmations(providers, txHash);
  if (confirmations === null) {
    return transition(db, id, "RECONCILIATION_REQUIRED", {
      reason: `confirmations not reached for ${txHash} (reorg watch)`,
    });
  }
  await confirmFunding(db, id, providers, txHash, usdcMicros, confirmations);

  await transition(db, id, "CONVERSION_PENDING", { reason: "off-ramp started" });
  return settleRemainder(db, id, providers, fiatIdr, usdcMicros);
}

/** Resume after a crash/restart mid-conversion. Never re-runs a recorded leg. */
async function resumeConversion(db: Db, id: string, providers: Providers): Promise<Intent> {
  const q = await latestQuote(db, id);
  const legs = await db.select().from(conversions).where(eq(conversions.paymentId, id));
  // A PENDING/PARTIAL leg is operator-owned: the signed completion owns it,
  // not this call. Only an untouched or completed leg continues here.
  if (legs.some((l) => l.status === "PENDING" || l.status === "PARTIAL") && !legs.some((l) => l.status === "COMPLETED")) {
    return (await getIntent(db, id))!;
  }
  return settleRemainder(db, id, providers, BigInt(q.fiatAmount), BigInt(q.cryptoAmount));
}

/** Resume settlement polls (read-only until evidence). Reuses the open leg. */
async function resumeSettlement(db: Db, id: string, providers: Providers): Promise<Intent> {
  const q = await latestQuote(db, id);
  const legs = await db.select().from(conversions).where(eq(conversions.paymentId, id));
  const done = legs.find((l) => l.status === "COMPLETED");
  if (!done?.fiatAmount) {
    return transition(db, id, "RECONCILIATION_REQUIRED", {
      reason: "settlement resume without a completed conversion",
    });
  }
  return beginSettlement(db, providers, id, BigInt(q.fiatAmount), {
    reference: done.reference!,
    fiatAmountIdr: BigInt(done.fiatAmount),
  });
}

/**
 * Run the conversion leg once. Skips the provider entirely when a leg row
 * already exists — retries must never double-file operator tasks or
 * double-execute conversions.
 */
async function runConversionLeg(
  db: Db,
  providers: Providers,
  id: string,
  fiatIdr: bigint,
  usdcMicros: bigint,
): Promise<{ intent: Intent; conversion?: { reference: string; fiatAmountIdr: bigint } }> {
  const existing = await db.select().from(conversions).where(eq(conversions.paymentId, id));
  const done = existing.find((l) => l.status === "COMPLETED");
  if (done) return { intent: (await getIntent(db, id))!, conversion: { reference: done.reference!, fiatAmountIdr: BigInt(done.fiatAmount!) } };
  if (existing.length > 0) return { intent: (await getIntent(db, id))! }; // PENDING/PARTIAL: operator-owned.

  let conversion: { reference: string; status: "COMPLETED" | "PENDING"; fiatAmountIdr?: bigint; rateExecuted6?: bigint };
  try {
    conversion = await providers.offRamp.execute({ paymentId: id, usdcMicros, expectedFiatIdr: fiatIdr });
  } catch (err) {
    const intent = await transition(db, id, "RECONCILIATION_REQUIRED", {
      reason: `conversion outcome unknown: ${err instanceof Error ? err.message : err}`,
    });
    return { intent };
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
    return { intent: (await getIntent(db, id))! };
  }
  const finished = { reference: conversion.reference, fiatAmountIdr: conversion.fiatAmountIdr!, rateExecuted6: conversion.rateExecuted6! };
  if (finished.fiatAmountIdr < fiatIdr) {
    // Partial evidence is not completion (§14.1) — hold for human review.
    await db.insert(conversions).values({
      paymentId: id,
      provider: providers.offRamp.name,
      cryptoAmount: usdcMicros.toString(),
      fiatAmount: finished.fiatAmountIdr.toString(),
      rateExecuted: finished.rateExecuted6.toString(),
      reference: finished.reference,
      status: "PARTIAL",
    });
    const intent = await transition(db, id, "RECONCILIATION_REQUIRED", {
      reason: `partial conversion: ${finished.fiatAmountIdr} < ${fiatIdr}`,
    });
    return { intent };
  }
  await db.insert(conversions).values({
    paymentId: id,
    provider: providers.offRamp.name,
    cryptoAmount: usdcMicros.toString(),
    fiatAmount: finished.fiatAmountIdr.toString(),
    rateExecuted: finished.rateExecuted6.toString(),
    reference: finished.reference,
    status: "COMPLETED",
  });
  return { intent: (await getIntent(db, id))!, conversion: { reference: finished.reference, fiatAmountIdr: finished.fiatAmountIdr } };
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

/** Open the settlement leg; shared by execute(), resume, and operator replay.
 * Idempotent: re-entry reuses the open leg instead of filing a second one. */
export async function beginSettlement(
  db: Db,
  providers: Providers,
  id: string,
  fiatIdr: bigint,
  conversion: { reference: string; fiatAmountIdr: bigint },
): Promise<Intent> {
  const cur = await getIntent(db, id);
  if (!cur) throw new PaymentError(404, "unknown payment");
  if (cur.status === "COMPLETED") return cur;
  if (cur.status === "CONVERSION_PENDING") {
    await transition(db, id, "FIAT_SETTLEMENT_PENDING", { reason: "merchant settlement started" });
  } else if (cur.status !== "FIAT_SETTLEMENT_PENDING") {
    throw new PaymentError(409, `cannot settle from ${cur.status}`);
  }
  const open = await db.select().from(fiatSettlements).where(eq(fiatSettlements.paymentId, id));
  const pending = open.find((l) => l.status === "PENDING" && l.reference);
  let ref: string;
  if (pending?.reference) {
    ref = pending.reference; // resume: the filed leg, not a new one.
  } else {
    ({ ref } = await providers.payment.createPayment({ paymentId: id, fiatAmountIdr: fiatIdr }));
    await db.insert(fiatSettlements).values({
      paymentId: id,
      provider: providers.payment.name,
      fiatAmount: fiatIdr.toString(),
      reference: ref,
      status: "PENDING",
    });
  }
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

/** Settle the fiat side: merchant paid, fees + spread booked, COMPLETED.
 * Idempotent: a second call after completion returns the intent — ledger
 * rows are posted exactly once, which the money invariant depends on. */
export async function completeSettlement(
  db: Db,
  id: string,
  ref: string,
  fiatIdr: bigint,
  conversion: { fiatAmountIdr: bigint },
): Promise<Intent> {
  const cur = await getIntent(db, id);
  if (!cur) throw new PaymentError(404, "unknown payment");
  if (cur.status === "COMPLETED") return cur;
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
  //
  // The rate is accepted as a decimal (e.g. 17609.77) because real IDR/USDC
  // rates carry sub-rupiah precision — rounding to whole rupiah would misprice
  // every quote. Scaled to 6dp here; more than 6 decimals is rejected as noise.
  if (!raw || !/^\d+(\.\d{1,6})?$/.test(raw.trim())) {
    throw new Error("MANUAL_IDR_PER_USDC (IDR per USDC, up to 6 decimals) required with ENGINE_OFFRAMP=manual");
  }
  const [whole, frac = ""] = raw.trim().split(".");
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
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
 * Signed operator action resumes a manual leg (§10). Always advances: a
 * replay with the identical result re-runs the (idempotent) advancement
 * instead of returning a possibly-stale state — so a crash between "task
 * marked done" and "intent advanced" heals on retry. Conflicting reports
 * on a done task are rejected.
 */
export async function completeOperatorTask(
  db: Db,
  providers: Providers,
  taskId: string,
  result: OperatorResult,
): Promise<{ intent: Intent; replayed: boolean }> {
  const task = await getTask(db, taskId);
  if (!task) throw new PaymentError(404, "unknown task");
  const replayed = task.status !== "PENDING";
  if (replayed) {
    const prior = task.result as OperatorResult | null;
    if (!prior || JSON.stringify(prior) !== JSON.stringify(result)) {
      throw new PaymentError(409, `task already ${task.status}`);
    }
  }
  const id = task.paymentId;
  const intent = await getIntent(db, id);
  if (!intent) throw new PaymentError(404, "unknown payment");

  if (task.kind === "CONVERSION") {
    if (intent.status !== "CONVERSION_PENDING") {
      if (intent.status === "COMPLETED" || intent.status === "FIAT_SETTLEMENT_PENDING") {
        return { intent, replayed }; // already advanced past this leg.
      }
      throw new PaymentError(409, `conversion task does not match payment state ${intent.status}`);
    }
    if (result.status === "FAILED") {
      await markTask(db, taskId, "FAILED", result);
      const out = await transition(db, id, "REFUND_REQUIRED", {
        actor: "operator",
        reason: result.note ?? "operator reported conversion failure",
      });
      return { intent: out, replayed };
    }
    if (!result.reference) throw new PaymentError(422, "reference required");
    const q = await latestQuote(db, id);
    const expected = BigInt(q.fiatAmount);
    const actual = bigOr422(result.fiatAmountIdr, "fiatAmountIdr");
    const rate = bigOr422(result.rateExecuted6, "rateExecuted6");
    await markTask(db, taskId, "COMPLETED", result);
    // Crash window: provider filed the task but the PENDING leg row never
    // landed. Rebuild it from the task payload rather than stranding.
    let legs = await db.select().from(conversions).where(eq(conversions.paymentId, id));
    if (!legs.length) {
      const payload = task.payload as { usdcMicros?: string } | null;
      await db.insert(conversions).values({
        paymentId: id,
        provider: providers.offRamp.name,
        cryptoAmount: payload?.usdcMicros ?? BigInt(q.cryptoAmount).toString(),
        reference: result.reference,
        status: "PENDING",
      });
      legs = await db.select().from(conversions).where(eq(conversions.paymentId, id));
    }
    const leg = legs.find((l) => l.status === "PENDING") ?? legs[0];
    if (actual < expected) {
      await db.update(conversions).set({ fiatAmount: actual.toString(), rateExecuted: rate.toString(), reference: result.reference, status: "PARTIAL" }).where(eq(conversions.id, leg.id));
      const out = await transition(db, id, "RECONCILIATION_REQUIRED", {
        actor: "operator",
        reason: `operator short conversion: ${actual} < ${expected}`,
      });
      return { intent: out, replayed };
    }
    await db.update(conversions).set({ fiatAmount: actual.toString(), rateExecuted: rate.toString(), reference: result.reference, status: "COMPLETED" }).where(eq(conversions.id, leg.id));
    const out = await beginSettlement(db, providers, id, expected, { reference: result.reference, fiatAmountIdr: actual });
    return { intent: out, replayed };
  }

  if (task.kind === "FIAT_SETTLEMENT") {
    if (intent.status !== "FIAT_SETTLEMENT_PENDING") {
      if (intent.status === "COMPLETED") return { intent, replayed };
      throw new PaymentError(409, `settlement task does not match payment state ${intent.status}`);
    }
    if (result.status === "FAILED") {
      await markTask(db, taskId, "FAILED", result);
      const out = await transition(db, id, "REFUND_REQUIRED", {
        actor: "operator",
        reason: result.note ?? "operator reported settlement failure",
      });
      return { intent: out, replayed };
    }
    if (!result.reference) throw new PaymentError(422, "reference required");
    const q = await latestQuote(db, id);
    let legs = await db.select().from(fiatSettlements).where(eq(fiatSettlements.paymentId, id));
    if (!legs.length) {
      const payload = task.payload as { fiatAmountIdr?: string } | null;
      await db.insert(fiatSettlements).values({
        paymentId: id,
        provider: providers.payment.name,
        fiatAmount: payload?.fiatAmountIdr ?? q.fiatAmount,
        reference: `mqris-${taskId}`,
        status: "PENDING",
      });
      legs = await db.select().from(fiatSettlements).where(eq(fiatSettlements.paymentId, id));
    }
    const leg = legs.find((l) => l.status === "PENDING") ?? legs[0];
    if (!leg?.reference) throw new PaymentError(409, "no settlement leg for task");
    const convRows = await db.select().from(conversions).where(eq(conversions.paymentId, id));
    const actual = BigInt(convRows[0]?.fiatAmount ?? leg.fiatAmount);
    await db.update(fiatSettlements).set({ proof: result.proof ?? null }).where(eq(fiatSettlements.id, leg.id));
    await markTask(db, taskId, "COMPLETED", result);
    const out = await completeSettlement(db, id, leg.reference, BigInt(q.fiatAmount), { fiatAmountIdr: actual });
    return { intent: out, replayed };
  }

  if (task.kind === "REFUND") {
    // The ledger refund posted when refund() ran; the human now reports the
    // on-chain return hash. No state change — REFUNDED already means done.
    if (!result.reference) throw new PaymentError(422, "reference (refund tx hash) required");
    await markTask(db, taskId, "COMPLETED", result);
    return { intent, replayed };
  }

  throw new PaymentError(422, `unknown task kind ${task.kind}`);
}

/**
 * Audited exit from review (§14.3 bucket). Only safe targets, enforced
 * against the funding point of no return: unfunded intents may retry
 * (AUTHORIZED) or die cheap (FAILED); funded ones may only refund.
 * The free-text reason is mandatory — it is the incident record.
 */
export async function resolveReview(
  db: Db,
  id: string,
  to: "AUTHORIZED" | "FAILED" | "REFUND_REQUIRED",
  reason: string,
): Promise<Intent> {
  if (!reason?.trim()) throw new PaymentError(422, "reason (evidence note) required");
  const intent = await getIntent(db, id);
  if (!intent) throw new PaymentError(404, "unknown payment");
  if (intent.status !== "RECONCILIATION_REQUIRED") {
    throw new PaymentError(409, `nothing to resolve from ${intent.status}`);
  }
  const attempts = await latestAttempts(db, id);
  const funded = attempts.some((a) =>
    ["CRYPTO_CONFIRMED", "CONVERSION_PENDING", "FIAT_SETTLEMENT_PENDING", "COMPLETED", "REFUND_REQUIRED", "REFUNDED"].includes(a.state),
  );
  if (!funded && to === "REFUND_REQUIRED") throw new PaymentError(409, "nothing left the wallet — use FAILED, not refund");
  if (funded && to !== "REFUND_REQUIRED") {
    throw new PaymentError(409, "funds may have moved — history is append-only, refund instead");
  }
  return transition(db, id, to, { actor: "operator", reason });
}
