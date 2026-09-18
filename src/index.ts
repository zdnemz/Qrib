import "dotenv/config";
import { serve } from "@hono/node-server";

import { app } from "./app.js";
import { logger } from "./logger.js";

const port = Number(process.env.PORT ?? 3000);

const server = serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ msg: "listening", port: info.port });
});

process.on("SIGINT", () => {
  logger.info({ msg: "shutting down" });
  server.close();
  process.exit(0);
});
