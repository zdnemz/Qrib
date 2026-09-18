// Durable, idempotent transitions. Every transition persists the new status
// + an audit row (actor/reason/prior state) before any side effect runs.
// Replaying the same target state is a no-op returning current state.

import { and, desc, eq, sql } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { paymentAttempts, paymentIntents } from "../db/schema.js";
import { canTransition, InvalidTransition } from "./states.js";

export type Intent = typeof paymentIntents.$inferSelect;

/** Transaction handle for composing transitions + ledger posts atomically. */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function getIntent(db: Db, id: string): Promise<Intent | undefined> {
  const rows = await db.select().from(paymentIntents).where(eq(paymentIntents.id, id)).limit(1);
  return rows[0];
}

export async function transition(
  db: Db,
  id: string,
  to: string,
  opts: { actor?: string; reason?: string; txHash?: string } = {},
): Promise<Intent> {
  return db.transaction((tx) => transitionWith(tx, id, to, opts));
}

export async function transitionWith(
  tx: DbTx,
  id: string,
  to: string,
  opts: { actor?: string; reason?: string; txHash?: string } = {},
): Promise<Intent> {
    const rows = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, id)).limit(1);
    const intent = rows[0];
    if (!intent) throw new Error(`unknown payment ${id}`);
    if (intent.status === to) return intent; // idempotent replay
    if (!canTransition(intent.status, to)) {
      throw new InvalidTransition(`${intent.status} → ${to}`);
    }
    const prior = intent.status;
    const [agg] = await tx
      .select({ max: sql<number | null>`max(${paymentAttempts.attemptNo})` })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.paymentId, id));
    await tx.insert(paymentAttempts).values({
      paymentId: id,
      attemptNo: (agg?.max ?? 0) + 1,
      state: to,
      txHash: opts.txHash,
      actor: opts.actor ?? "system",
      reason: opts.reason ?? `${prior} → ${to}`,
    });
    const [updated] = await tx
      .update(paymentIntents)
      .set({
        status: to,
        stateEnteredAt: new Date(),
        updatedAt: new Date(),
        failureReason: to === "FAILED" || to === "RECONCILIATION_REQUIRED" ? opts.reason ?? null : intent.failureReason,
      })
      .where(eq(paymentIntents.id, id))
      .returning();
    return updated;
}

/** Recent intents, newest first. */
export async function listIntents(db: Db, limit = 50): Promise<Intent[]> {
  return db.select().from(paymentIntents).orderBy(desc(paymentIntents.createdAt)).limit(limit);
}

/** Sum of today's quoted+ fiat for a user (daily cap, §9.3). Null when no user. */
export async function dailyTotalIdr(db: Db, userId: string): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string | null>`coalesce(sum(${paymentIntents.fiatAmount}), 0)` })
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.userId, userId),
        sql`${paymentIntents.createdAt} > now() - interval '24 hours'`,
      ),
    );
  return BigInt(row?.total ?? "0");
}

export async function latestAttempts(db: Db, paymentId: string) {
  return db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.paymentId, paymentId))
    .orderBy(desc(paymentAttempts.attemptNo))
    .limit(20);
}

export async function stuckIntents(db: Db, now: Date, dwellSec: Record<string, number>) {
  const rows = await db.select().from(paymentIntents);
  return rows.filter((r) => {
    const dwell = dwellSec[r.status];
    return dwell !== undefined && now.getTime() - r.stateEnteredAt.getTime() > dwell * 1000;
  });
}
