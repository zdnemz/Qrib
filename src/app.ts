import { Hono } from "hono";
import { requestId } from "hono/request-id";

import { db } from "./db/index.js";
import { logger } from "./logger.js";

export const app = new Hono();

app.use("*", requestId());
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  logger.info({
    msg: "request",
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    requestId: c.get("requestId"),
    durationMs: Date.now() - start,
  });
});

app.get("/health", (c) => c.json({ ok: true, version: "0.1.0" }));

app.get("/ready", async (c) => {
  try {
    await db.execute("select 1");
    return c.json({ ok: true });
  } catch (err) {
    logger.error({ msg: "readiness check failed", err: String(err) });
    return c.json({ ok: false }, 503);
  }
});

// Wallet routes (M1) and engine surface (§12, M2) mount here next.
// Unknown routes stay 404 so missing-surface bugs surface loudly.
