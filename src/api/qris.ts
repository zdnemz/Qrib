import { Hono } from "hono";

import { parseQris, QrisError } from "../qris/parse.js";

// Read-only: parsing has no side effects, so no Idempotency-Key.
// Response tells the scanner UI what to do next: dynamic → confirm,
// static → prompt for amount, then POST /payments/quote.

const qris = new Hono();

qris.post("/parse", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const r = parseQris(body.payload);
    return c.json({
      ok: true,
      ...r,
      next: r.initiation === "dynamic" ? "confirm" : "enter-amount",
      payload: undefined,
    });
  } catch (err) {
    if (err instanceof QrisError) return c.json({ ok: false, error: err.message }, 422);
    throw err;
  }
});

export { qris };
