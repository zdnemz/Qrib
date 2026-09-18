import { Hono } from "hono";
import { requestId } from "hono/request-id";

import { payments } from "./api/payments.js";
import { webhooks } from "./api/webhooks.js";
import { db, type Db } from "./db/index.js";
import { logger } from "./logger.js";
import { wallet } from "./wallet/routes.js";

type Variables = { db: Db };

export function createApp(database: Db) {
  const app = new Hono<{ Variables: Variables }>();
  app.use("*", requestId());
  app.use("*", async (c, next) => {
    c.set("db", database);
    await next();
  });
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

  app.get("/health", (c) => c.json({ ok: true, version: "0.2.0" }));

  app.get("/ready", async (c) => {
    try {
      await c.get("db").execute("select 1");
      return c.json({ ok: true });
    } catch (err) {
      logger.error({ msg: "readiness check failed", err: String(err) });
      return c.json({ ok: false }, 503);
    }
  });

  app.route("/wallet", wallet);
  app.route("/payments", payments);
  app.route("/webhooks", webhooks);

  return app;
}

export const app = createApp(db);
export type App = ReturnType<typeof createApp>;

// Unknown routes stay 404 so missing-surface bugs surface loudly.
