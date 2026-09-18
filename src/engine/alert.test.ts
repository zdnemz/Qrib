import { describe, expect, it } from "vitest";
import { createServer } from "node:http";

import { alertIfNeeded } from "./alert.js";

function stubServer(capture: { body: string }) {
  return createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      capture.body = data;
      res.writeHead(200).end("ok");
    });
  });
}

describe("watchdog alert", () => {
  it("skips when quiet, posts issues otherwise", async () => {
    expect(await alertIfNeeded("http://x", { issues: [], stuck: [] })).toBe("skipped");
    expect(await alertIfNeeded(undefined, { issues: [{ a: 1 }], stuck: [] })).toBe("skipped");

    const capture = { body: "" };
    const server = stubServer(capture);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const noisy = { issues: [{ paymentId: "p", check: "dwell", detail: "stuck" }], stuck: ["p"] };
    expect(await alertIfNeeded(`http://127.0.0.1:${port}/hook`, noisy)).toBe("sent");
    expect(JSON.parse(capture.body)).toMatchObject({ source: "qrib-reconcile", stuck: ["p"] });
    server.close();
  });

  it("reports failure instead of throwing when the hook is down", async () => {
    expect(await alertIfNeeded("http://127.0.0.1:1/hook", { issues: [{ a: 1 }], stuck: [] })).toBe("failed");
  });
});
