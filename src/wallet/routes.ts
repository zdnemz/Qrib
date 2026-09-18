import { Hono } from "hono";

import { parseNetwork, publicClientFor } from "../chain/config.js";
import { logger } from "../logger.js";
import { checkedAddress, getUsdcBalance, receiveInfo } from "./usdc.js";

// Keyless reads only. There is deliberately no POST /wallet/send: the API
// never sees key material (§13) — signing stays on the founder's device/CLI.

export const wallet = new Hono();

wallet.get("/balance", async (c) => {
  try {
    const network = parseNetwork(c.req.query("network"));
    const address = checkedAddress(c.req.query("address"));
    const result = await getUsdcBalance(publicClientFor(network), network, address);
    return c.json({ ok: true, network, address, asset: "USDC", ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    const status = msg.startsWith("invalid") || msg.startsWith("unknown network") ? 400 : 502;
    if (status === 502) logger.error({ msg: "balance read failed", err: msg });
    return c.json({ ok: false, error: msg }, status);
  }
});

wallet.get("/receive", (c) => {
  try {
    const network = parseNetwork(c.req.query("network"));
    const address = checkedAddress(c.req.query("address"));
    const amount = c.req.query("amount");
    return c.json({ ok: true, network, ...receiveInfo(network, address, amount) });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : "unknown error" }, 400);
  }
});
