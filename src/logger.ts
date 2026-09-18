import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // JSON to stdout; PII/key material must never be logged at call sites (§13).
  formatters: {
    level: (label) => ({ level: label }),
  },
});
