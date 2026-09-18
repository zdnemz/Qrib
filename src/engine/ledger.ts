// Double-entry internal ledger (§11.2): the accounting truth. Every payment
// balances to zero per currency; the reconciler asserts this, and imbalance
// is an incident, never a rounding difference.

import { eq, sql } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { ledgerEntries } from "../db/schema.js";
import type { DbTx } from "./store.js";

export type Entry = { account: string; debit: bigint; credit: bigint; currency: "IDR" | "USDC" };

export class UnbalancedLedger extends Error {}

/** Post balanced entries. Must run inside the caller's transition transaction. */
export async function postEntries(tx: DbTx, paymentId: string, entries: Entry[]): Promise<void> {
  const byCurrency = new Map<string, bigint>();
  for (const e of entries) {
    if (e.debit < 0n || e.credit < 0n) throw new UnbalancedLedger("negative leg");
    byCurrency.set(e.currency, (byCurrency.get(e.currency) ?? 0n) + e.debit - e.credit);
  }
  for (const [currency, net] of byCurrency) {
    if (net !== 0n) throw new UnbalancedLedger(`unbalanced ${currency}: ${net}`);
  }
  await tx.insert(ledgerEntries).values(
    entries.map((e) => ({
      paymentId,
      account: e.account,
      debit: e.debit.toString(),
      credit: e.credit.toString(),
      currency: e.currency,
    })),
  );
}

/** Net (debit − credit) per currency for a payment. Zero everywhere = balanced. */
export async function paymentNets(db: Db, paymentId: string): Promise<Record<string, bigint>> {
  const rows = await db
    .select({
      currency: ledgerEntries.currency,
      net: sql<string>`sum(${ledgerEntries.debit} - ${ledgerEntries.credit})`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.paymentId, paymentId))
    .groupBy(ledgerEntries.currency);
  return Object.fromEntries(rows.map((r) => [r.currency, BigInt(r.net)]));
}
