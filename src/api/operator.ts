import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";

import type { Db } from "../db/index.js";
import { completeOperatorTask, providersFromEnv, PaymentError } from "../engine/service.js";
import type { OperatorResult } from "../engine/service.js";
import { getTask, listTasks } from "../engine/tasks.js";
import { idempotency } from "./idempotency.js";
import type { Context } from "hono";

type Variables = { db: Db };
const internal = new Hono<{ Variables: Variables }>();

function secret(): string {
  const s = process.env.OPERATOR_SECRET;
  if (!s) throw new PaymentError(503, "operator channel not configured");
  return s;
}

/**
 * HMAC over METHOD + "\n" + path + "\n" + raw body. Shared secret, never
 * transmitted — the signature proves possession without revealing it.
 */
export function signOperator(secretKey: string, method: string, path: string, rawBody: string): string {
  return createHmac("sha256", secretKey).update(`${method}\n${path}\n${rawBody}`).digest("hex");
}

async function authed(c: Context<{ Variables: Variables }>, next: () => Promise<void>) {
  const key = secret();
  const raw = c.req.method === "GET" ? "" : await c.req.text();
  const sig = c.req.header("X-Operator-Signature") ?? "";
  const want = signOperator(key, c.req.method, new URL(c.req.url).pathname, raw);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(want, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return c.json({ ok: false, error: "bad operator signature" }, 401);
  }
  await next();
}

internal.use("*", authed);

internal.get("/tasks", async (c) => {
  const status = c.req.query("status") as "PENDING" | "COMPLETED" | "FAILED" | undefined;
  return c.json({ ok: true, tasks: await listTasks(c.get("db"), status) });
});

internal.get("/tasks/:id", async (c) => {
  const task = await getTask(c.get("db"), c.req.param("id") ?? "");
  if (!task) return c.json({ ok: false, error: "unknown task" }, 404);
  return c.json({ ok: true, task });
});

internal.post("/tasks/:id/complete", idempotency, async (c) => {
  const db = c.get("db");
  // Body was already consumed as text by the auth middleware (Hono caches
  // it), so parsing here does not touch the wire twice.
  const body = await c.req.json().catch(() => null) as OperatorResult | null;
  if (!body || (body.status !== "COMPLETED" && body.status !== "FAILED")) {
    return c.json({ ok: false, error: "status must be COMPLETED or FAILED" }, 400);
  }
  try {
    const { intent, replayed } = await completeOperatorTask(db, providersFromEnv(db), c.req.param("id") ?? "", body);
    return c.json({ ok: true, replayed, status: intent.status, paymentId: intent.id });
  } catch (err) {
    if (err instanceof PaymentError) return c.json({ ok: false, error: err.message }, err.status as 400);
    throw err;
  }
});

export { internal };
