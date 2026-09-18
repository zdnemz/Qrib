// Idempotency-Key enforcement (§12, §13). Every mutating engine endpoint
// requires the header; replaying a key replays the stored response instead
// of re-executing. Same key on a different route → 422 (likely a client bug).
//
// Known limit: concurrent same-key races can double-execute (check-then-act
// without an advisory lock). Acceptable at v1 dogfood volume; fix with
// pg_advisory_xact_lock when a measurement demands it.

import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { idempotencyKeys } from "../db/schema.js";

type Variables = { db: Db };

export async function idempotency(c: Context<{ Variables: Variables }>, next: Next) {
  const key = c.req.header("Idempotency-Key");
  if (!key) return c.json({ ok: false, error: "Idempotency-Key header required" }, 400);
  const db = c.get("db");
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;

  const existing = (
    await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).limit(1)
  )[0];
  if (existing) {
    if (existing.method !== method || existing.path !== path) {
      return c.json({ ok: false, error: "idempotency key already used on another endpoint" }, 422);
    }
    return c.json(existing.response, (existing.statusCode ?? 200) as ContentfulStatusCode);
  }

  await next();
  let body: unknown = null;
  try {
    body = await c.res.clone().json();
  } catch {
    return; // non-JSON responses are never replayable; don't store
  }
  await db
    .insert(idempotencyKeys)
    .values({
      key,
      method,
      path,
      statusCode: c.res.status,
      response: body as Record<string, unknown>,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    })
    .onConflictDoNothing({ target: idempotencyKeys.key });
}
