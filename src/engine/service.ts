// Payment orchestration (§7.1, §14.1). Every step persists state before its
// side effect; unknowns age into RECONCILIATION_REQUIRED, never FAILED.

import { desc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import {
  blockchainTransactions,
  conversions,
  fiatSettlements,
  paymentQuotes,
  webhookEvents,
} from "../db/schema.js";
import { engineConfig } from "./config.js";
import { postEntries } from "./ledger.js";
import type { ChainGateway, OffRampProvider, PaymentProvider } from "./providers.js";
import { ProviderTimeout } from "./providers.js";
import { getIntent, transition, transitionWith, type Intent } from "./store.js";
import type { DbTx } from "./store.js";

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

async function recordChainTx(tx: DbTx, args: { paymentId: string; txHash: string }) {
  await tx
    .insert(blockchainTransactions)
    .values({
      paymentId: args.paymentId,
      txHash: args.txHash,
      chain: "mock",
      fromAddress: "mock-funding",
      toAddress: "mock-offramp",
      amount: "0",
      confirmations: 12,
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
  await db.transaction(async (tx) => {
    await recordChainTx(tx, { paymentId: id, txHash });
    await transitionWith(tx, id, "CRYPTO_CONFIRMED", { reason: "chain confirmations reached" });
    await postEntries(tx, id, [
      { account: "provider:conversion", debit: usdcMicros, credit: 0n, currency: "USDC" },
      { account: "user:crypto", debit: 0n, credit: usdcMicros, currency: "USDC" },
    ]);
  });

  // Conversion leg (USDC → IDR).
  intent = await transition(db, id, "CONVERSION_PENDING", { reason: "off-ramp started" });
  let conversion: { reference: string; fiatAmountIdr: bigint; rateExecuted6: bigint };
  try {
    conversion = await providers.offRamp.execute({ paymentId: id, usdcMicros, expectedFiatIdr: fiatIdr });
  } catch (err) {
    return transition(db, id, "RECONCILIATION_REQUIRED", {
      reason: `conversion outcome unknown: ${err instanceof Error ? err.message : err}`,
    });
  }
  if (conversion.fiatAmountIdr < fiatIdr) {
    // Partial evidence is not completion (§14.1) — hold for human review.
    await db.insert(conversions).values({
      paymentId: id,
      provider: providers.offRamp.name,
      cryptoAmount: usdcMicros.toString(),
      fiatAmount: conversion.fiatAmountIdr.toString(),
      rateExecuted: conversion.rateExecuted6.toString(),
      reference: conversion.reference,
      status: "PARTIAL",
    });
    return transition(db, id, "RECONCILIATION_REQUIRED", {
      reason: `partial conversion: ${conversion.fiatAmountIdr} < ${fiatIdr}`,
    });
  }
  await db.insert(conversions).values({
    paymentId: id,
    provider: providers.offRamp.name,
    cryptoAmount: usdcMicros.toString(),
    fiatAmount: conversion.fiatAmountIdr.toString(),
    rateExecuted: conversion.rateExecuted6.toString(),
    reference: conversion.reference,
    status: "COMPLETED",
  });

  // Settlement leg (IDR → merchant).
  intent = await transition(db, id, "FIAT_SETTLEMENT_PENDING", { reason: "merchant settlement started" });
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
  // Still pending: leave the state for webhook completion (§14.1 partial/
  // async rule). Dwell watchdog + reconciler own the timeout from here.
  intent = (await getIntent(db, id))!;
  return intent;
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
  const spreadIdr = conversion.fiatAmountIdr - fiatIdr; // ≥ 0 by construction (partials divert earlier)
  const feeIdr = BigInt(q.feeFiat);
  return db.transaction(async (tx) => {
    await tx.update(fiatSettlements).set({ status: "COMPLETED" }).where(eq(fiatSettlements.reference, ref));
    await postEntries(tx, id, [
      { account: "merchant:fiat", debit: fiatIdr, credit: 0n, currency: "IDR" },
      { account: "provider:conversion", debit: 0n, credit: fiatIdr, currency: "IDR" },
      { account: "provider:conversion", debit: feeIdr, credit: 0n, currency: "IDR" },
      { account: "fees", debit: 0n, credit: feeIdr, currency: "IDR" },
      { account: "provider:conversion", debit: spreadIdr, credit: 0n, currency: "IDR" },
      { account: "spread", debit: 0n, credit: spreadIdr, currency: "IDR" },
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
