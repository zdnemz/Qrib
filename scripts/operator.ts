// Founder's hands, scripted (§6.2). Lists pending manual legs and reports
// results back with an HMAC signature (OPERATOR_SECRET authorizes, never
// travels). First-party funds only — §6.4 gates everything else.
//
//   pnpm operator list
//   pnpm operator complete <taskId> --status COMPLETED --reference EX123 \
//     --fiat 27500 --rate 16000000000 [--proof ...] [--note ...]
//   pnpm operator complete <taskId> --status FAILED --note "reason"

import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";

const API = process.env.API_URL ?? "http://localhost:3000";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function sign(method: string, path: string, rawBody: string): string {
  const secret = process.env.OPERATOR_SECRET;
  if (!secret) throw new Error("set OPERATOR_SECRET env first");
  return createHmac("sha256", secret).update(`${method}\n${path}\n${rawBody}`).digest("hex");
}

async function call(method: string, path: string, body?: unknown) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
      "X-Operator-Signature": sign(method, path, raw),
    },
    body: body === undefined ? undefined : raw,
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json || json.ok === false) {
    throw new Error(json?.error ?? `HTTP ${res.status}`);
  }
  return json;
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "list") {
    const status = flag("status");
    console.log(JSON.stringify(await call("GET", `/internal/tasks${status ? `?status=${status}` : ""}`), null, 2));
  } else if (cmd === "complete") {
    const status = flag("status");
    if (status !== "COMPLETED" && status !== "FAILED") throw new Error("--status must be COMPLETED or FAILED");
    const body: Record<string, unknown> = { status };
    for (const f of ["reference", "fiatAmountIdr", "rateExecuted6", "proof", "note"]) {
      const v = flag(f);
      if (v !== undefined) body[f] = v;
    }
    if (!arg) throw new Error("usage: pnpm operator complete <taskId> --status …");
    console.log(JSON.stringify(await call("POST", `/internal/tasks/${arg}/complete`, body), null, 2));
  } else {
    throw new Error("usage: pnpm operator <list|complete> …");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
