import { Hono } from "hono";

import type { Db } from "../db/index.js";
import { handleWebhook } from "../engine/service.js";

type Variables = { db: Db };
const webhooks = new Hono<{ Variables: Variables }>();

webhooks.post("/:provider", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.eventId !== "string" || typeof body.type !== "string") {
    return c.json({ ok: false, error: "eventId and type required" }, 400);
  }
  const result = await handleWebhook(c.get("db"), c.req.param("provider"), body);
  return c.json({ ok: true, ...result });
});

export { webhooks };
