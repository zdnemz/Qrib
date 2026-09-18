// Scheduled truth-check (§14.3): chain ↔ provider ↔ ledger must agree for
// every payment in the window. Any mismatch → human review + alert, never an
// automatic state change. Wired as `pnpm reconcile`; the cron schedule lands
// with prod ops (M5) — at v1 volume an explicit runbook beats a scheduler.

import { eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import {
  blockchainTransactions,
  conversions,
  fiatSettlements,
} from "../db/schema.js";
import { paymentNets } from "./ledger.js";
import { DWELL_SEC } from "./states.js";
import { getIntent, listIntents, stuckIntents } from "./store.js";

export type Issue = { paymentId: string; check: string; detail: string };

const PAST_FUNDING = ["CRYPTO_CONFIRMED", "CONVERSION_PENDING", "FIAT_SETTLEMENT_PENDING", "COMPLETED", "REFUND_REQUIRED", "REFUNDED"];

export async function reconcilePayment(db: Db, id: string, now = new Date()): Promise<Issue[]> {
  const issues: Issue[] = [];
  const intent = await getIntent(db, id);
  if (!intent) return [{ paymentId: id, check: "exists", detail: "intent missing" }];

  for (const [currency, net] of Object.entries(await paymentNets(db, id))) {
    if (net !== 0n) issues.push({ paymentId: id, check: "ledger-balanced", detail: `${currency} nets ${net}` });
  }
  if (PAST_FUNDING.includes(intent.status)) {
    const txs = await db.select().from(blockchainTransactions).where(eq(blockchainTransactions.paymentId, id));
    if (!txs.length) issues.push({ paymentId: id, check: "chain-receipt", detail: "no on-chain record past funding" });
  }
  if (intent.status === "COMPLETED") {
    const conv = (await db.select().from(conversions).where(eq(conversions.paymentId, id)))[0];
    const settle = (await db.select().from(fiatSettlements).where(eq(fiatSettlements.paymentId, id)))[0];
    if (!conv?.reference) issues.push({ paymentId: id, check: "conversion-ref", detail: "completed without conversion reference" });
    if (!settle?.reference) issues.push({ paymentId: id, check: "settlement-ref", detail: "completed without settlement reference" });
  }
  const dwell = DWELL_SEC[intent.status];
  if (dwell !== undefined && now.getTime() - intent.stateEnteredAt.getTime() > dwell * 1000) {
    issues.push({ paymentId: id, check: "dwell", detail: `stuck in ${intent.status} past ${dwell}s` });
  }
  return issues;
}

export async function reconcileAll(db: Db, now = new Date()): Promise<{ issues: Issue[]; stuck: string[] }> {
  const intents = await listIntents(db, 500);
  const issues: Issue[] = [];
  for (const i of intents) issues.push(...(await reconcilePayment(db, i.id, now)));
  const stuck = (await stuckIntents(db, now, DWELL_SEC)).map((i) => i.id);
  return { issues, stuck };
}
