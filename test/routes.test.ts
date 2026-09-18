import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { MockOffRampProvider } from "../src/engine/providers.mock.js";
import { createQuote } from "../src/engine/quote.js";
import { reconcileAll, reconcilePayment } from "../src/engine/reconcile.js";
import { ledgerEntries } from "../src/db/schema.js";
import { testDb } from "./helpers.js";

const db = testDb();
const app = createApp(db);

const post = (path: string, body: unknown, key: string) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });

describe("HTTP surface (§12)", () => {
  it("requires Idempotency-Key on mutating endpoints", async () => {
    const res = await app.request("/payments/quote", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
  });

  it("runs quote → authorize → execute → get over HTTP", async () => {
    const q = await post("/payments/quote", { fiatAmount: "27500", merchantName: "Kopi Kenangan" }, "k-quote-1");
    expect(q.status).toBe(200);
    const { paymentId } = (await q.json()) as { paymentId: string };

    const a = await post(`/payments/${paymentId}/authorize`, {}, "k-auth-1");
    expect((await a.json() as { payment: { status: string } }).payment.status).toBe("AUTHORIZED");

    const e = await post(`/payments/${paymentId}/execute`, {}, "k-exec-1");
    expect((await e.json() as { payment: { status: string } }).payment.status).toBe("COMPLETED");

    const g = await app.request(`/payments/${paymentId}`);
    expect((await g.json() as { payment: { attempts: unknown[] } }).payment.attempts.length).toBe(7);

    const list = (await (await app.request("/payments")).json()) as { payments: unknown[] };
    expect(list.payments.length).toBe(1);
  });

  it("replays the same key without re-executing; rejects key reuse across routes", async () => {
    const q = await post("/payments/quote", { fiatAmount: "10000" }, "k-quote-2");
    const { paymentId } = (await q.json()) as { paymentId: string };

    const first = await post(`/payments/${paymentId}/authorize`, {}, "k-auth-2");
    const firstBody = await first.json();
    const replay = await post(`/payments/${paymentId}/authorize`, {}, "k-auth-2");
    expect(await replay.json()).toEqual(firstBody);

    const attempts = (
      (await (await app.request(`/payments/${paymentId}`)).json()) as {
        payment: { attempts: { state: string }[] };
      }
    ).payment.attempts.filter((a) => a.state === "AUTHORIZED");
    expect(attempts.length).toBe(1);

    const cross = await post(`/payments/${paymentId}/cancel`, {}, "k-auth-2");
    expect(cross.status).toBe(422);
  });

  it("staging fault injection is triggerable via body.provider", async () => {
    const q = await post("/payments/quote", { fiatAmount: "15000" }, "k-quote-3");
    const { paymentId } = (await q.json()) as { paymentId: string };
    await post(`/payments/${paymentId}/authorize`, {}, "k-auth-3");
    const e = await post(`/payments/${paymentId}/execute`, { provider: "faulty-settle-fail" }, "k-exec-3");
    expect((await e.json() as { payment: { status: string } }).payment.status).toBe("REFUND_REQUIRED");
  });
});

describe("reconciler (§14.3)", () => {
  it("flags tampered books and stuck intents, passes clean ones", async () => {
    const q = await createQuote(db, new MockOffRampProvider(), { fiatAmountIdr: 20_000n });
    // Direct write bypassing postEntries: simulates corruption, must be caught.
    await db.insert(ledgerEntries).values({
      paymentId: q.paymentId,
      account: "attacker",
      debit: "1",
      credit: "0",
      currency: "IDR",
    });
    const issues = await reconcilePayment(db, q.paymentId);
    expect(issues.map((i) => i.check)).toContain("ledger-balanced");

    // Dwell breach is time-travelled, not slept.
    const future = new Date(Date.now() + 2 * 3600 * 1000);
    expect((await reconcilePayment(db, q.paymentId, future)).map((i) => i.check)).toContain("dwell");
    expect((await reconcileAll(db, future)).stuck).toContain(q.paymentId);
  });
});
