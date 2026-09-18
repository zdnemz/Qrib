import type { Context } from "hono";
import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";

import type { Db } from "../db/index.js";
import { paymentQuotes } from "../db/schema.js";
import { MockChainGateway, MockOffRampProvider, MockQrisProvider } from "../engine/providers.mock.js";
import { FaultyQrisProvider } from "../engine/providers.faulty.js";
import { createQuote } from "../engine/quote.js";
import { authorize, cancel, execute, providersFromEnv, refund, PaymentError } from "../engine/service.js";
import { InvalidTransition } from "../engine/states.js";
import { getIntent, latestAttempts, listIntents } from "../engine/store.js";
import { idempotency } from "./idempotency.js";

type Variables = { db: Db };
const payments = new Hono<{ Variables: Variables }>();

function shapeQuote(q: typeof paymentQuotes.$inferSelect) {
  return {
    asset: q.asset,
    cryptoAmount: q.cryptoAmount,
    fiatAmount: q.fiatAmount,
    rate: q.rate,
    spreadBps: q.spreadBps,
    fee: { crypto: q.feeCrypto, fiat: q.feeFiat },
    expiresAt: q.expiresAt,
  };
}

async function shape(db: Db, id: string) {
  const intent = await getIntent(db, id);
  if (!intent) throw new PaymentError(404, "unknown payment");
  const quotes = await db
    .select()
    .from(paymentQuotes)
    .where(eq(paymentQuotes.paymentId, id))
    .orderBy(desc(paymentQuotes.createdAt))
    .limit(1);
  return { ...intent, quote: quotes[0] ? shapeQuote(quotes[0]) : null, attempts: await latestAttempts(db, id) };
}

function errJson(c: Context, err: unknown) {
  if (err instanceof PaymentError) return c.json({ ok: false, error: err.message }, err.status as 400);
  if (err instanceof InvalidTransition) return c.json({ ok: false, error: err.message }, 409);
  return c.json({ ok: false, error: err instanceof Error ? err.message : "unknown error" }, 500);
}

function bigintOrNull(s: unknown): bigint | null {
  if (typeof s !== "string" || !/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

function pid(c: Context): string {
  // Route guarantees :id; the guard is for the type-checker, not runtime.
  const id = c.req.param("id");
  if (!id) throw new PaymentError(400, "missing payment id");
  return id;
}

payments.post("/quote", idempotency, async (c) => {
  const db = c.get("db");
  const body = await c.req.json().catch(() => ({}));
  const fiat = bigintOrNull(body.fiatAmount);
  if (fiat === null) return c.json({ ok: false, error: "fiatAmount (IDR integer string) required" }, 400);
  try {
    const quote = await createQuote(db, providersFromEnv(db).offRamp, {
      fiatAmountIdr: fiat,
      merchantName: body.merchantName,
      merchantRef: body.merchantId,
      userId: body.userId,
    });
    return c.json({ ok: true, ...quote, usdcMicros: quote.usdcMicros.toString(), expiresAt: quote.expiresAt.toISOString() });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : "unknown error" }, 422);
  }
});

payments.post("/:id/authorize", idempotency, async (c) => {
  try {
    const intent = await authorize(c.get("db"), pid(c));
    return c.json({ ok: true, payment: await shape(c.get("db"), intent.id) });
  } catch (err) {
    return errJson(c, err);
  }
});

payments.post("/:id/execute", idempotency, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    // Staging fault injection (§14.2): body.provider selects the faulty set.
    // Otherwise providers come from env (mocks by default, manual/real in prod).
    const db = c.get("db");
    const providers =
      body.provider === "faulty-settle-fail"
        ? { offRamp: new MockOffRampProvider(), payment: new FaultyQrisProvider("failed"), chain: new MockChainGateway() }
        : providersFromEnv(db);
    const intent = await execute(c.get("db"), pid(c), providers);
    return c.json({ ok: true, payment: await shape(c.get("db"), intent.id) });
  } catch (err) {
    return errJson(c, err);
  }
});

payments.post("/:id/cancel", idempotency, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const intent = await cancel(c.get("db"), pid(c), body.reason);
    return c.json({ ok: true, payment: await shape(c.get("db"), intent.id) });
  } catch (err) {
    return errJson(c, err);
  }
});

payments.post("/:id/refund", idempotency, async (c) => {
  try {
    const intent = await refund(c.get("db"), pid(c));
    return c.json({ ok: true, payment: await shape(c.get("db"), intent.id) });
  } catch (err) {
    return errJson(c, err);
  }
});

payments.get("/:id", async (c) => {
  try {
    return c.json({ ok: true, payment: await shape(c.get("db"), pid(c)) });
  } catch (err) {
    return errJson(c, err);
  }
});

payments.get("/", async (c) => {
  return c.json({ ok: true, payments: await listIntents(c.get("db"), 50) });
});

export { payments };
