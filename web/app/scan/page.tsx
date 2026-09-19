"use client";

import { useState } from "react";
import {
  authorize,
  cancel,
  execute,
  getPayment,
  idr,
  parseQris,
  requestQuote,
  statusId,
  type Payment,
  type QrisParse,
  type Quote,
} from "../../lib/api";
import { card, errorCard, input, muted, primary, secondary, tint } from "../../lib/ui";

const TERMINAL = new Set([
  "COMPLETED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "RECONCILIATION_REQUIRED",
  "REFUND_REQUIRED",
]);

export default function Scan() {
  const [payload, setPayload] = useState("");
  const [parsed, setParsed] = useState<QrisParse | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setBusy(false);
    }
  };

  const onParse = () =>
    run(async () => {
      const r = await parseQris(payload.trim());
      setParsed(r);
      setAmount(r.amountIdr ?? "");
      setQuote(null);
      setPayment(null);
    });

  const onQuote = () =>
    run(async () => {
      if (!parsed || !/^\d+$/.test(amount)) throw new Error("nominal rupiah harus angka bulat");
      const q = await requestQuote({
        fiatAmount: amount,
        merchantName: parsed.merchantName,
        merchantId: parsed.merchantId ?? undefined,
      });
      setQuote(q);
    });

  const onPay = () =>
    run(async () => {
      if (!quote) return;
      const a = await authorize(quote.paymentId);
      const e = await execute(a.payment.id);
      setPayment(e.payment);
    });

  const onRefresh = () =>
    run(async () => {
      if (!payment) return;
      setPayment((await getPayment(payment.id)).payment);
    });

  const onCancel = () =>
    run(async () => {
      if (!payment && !quote) return;
      const id = payment?.id ?? quote?.paymentId;
      if (!id) return;
      setPayment((await cancel(id)).payment);
    });

  return (
    <main className="mx-auto max-w-7xl px-4 py-12">
      <h1 className="text-4xl font-bold tracking-tighter">Pindai QR</h1>
      <p className={`mt-2 max-w-[65ch] ${muted}`}>Tempel payload QRIS, kunci kurs, bayar.</p>

      {error && (
        <p role="alert" className={`${errorCard} mt-6`}>
          {error}
        </p>
      )}

      <section className={`${card} mt-6`}>
        <label htmlFor="payload" className="font-medium">
          Payload QRIS
        </label>
        <textarea
          id="payload"
          rows={3}
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          placeholder="000201010212..."
          className={`${input} mt-2 font-mono text-sm`}
        />
        <button onClick={onParse} disabled={busy || !payload.trim()} className={`${primary} mt-4`}>
          Baca QR
        </button>
      </section>

      {parsed && (
        <section className={`${card} mt-6`}>
          <h2 className="text-xl font-semibold">{parsed.merchantName}</h2>
          <p className={muted}>
            {parsed.merchantCity} - {idr(parsed.amountIdr ?? amount ?? "0")}
          </p>
          {parsed.next === "enter-amount" && (
            <div className="mt-4">
              <label htmlFor="amount" className="font-medium">
                Nominal (Rp)
              </label>
              <input
                id="amount"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="27500"
                className={`${input} mt-2 font-mono`}
              />
            </div>
          )}
          <button
            onClick={onQuote}
            disabled={busy || !/^\d+$/.test(amount)}
            className={`${primary} mt-4`}
          >
            Minta quote
          </button>
        </section>
      )}

      {quote && (
        <section className={`${tint} mt-6`}>
          <h2 className="text-xl font-semibold">Quote</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight">{idr(quote.fiatAmount)}</p>
          <p className={`mt-1 font-mono text-sm ${muted}`}>
            {quote.cryptoAmount} USDC - berlaku hingga{" "}
            {new Date(quote.expiresAt).toLocaleTimeString("id-ID")}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={onPay} disabled={busy} className={primary}>
              Bayar
            </button>
          </div>
        </section>
      )}

      {payment && (
        <section className={`${card} mt-6`}>
          <h2 className="text-xl font-semibold">Status: {statusId(payment.status)}</h2>
          {payment.failureReason && (
            <p className="mt-1 text-red-700 dark:text-red-300">{payment.failureReason}</p>
          )}
          <ol className={`mt-4 space-y-1 font-mono text-sm ${muted}`}>
            {payment.attempts.map((a, i) => (
              <li key={i}>
                {statusId(a.state)} - {new Date(a.createdAt).toLocaleTimeString("id-ID")}
              </li>
            ))}
          </ol>
          {!TERMINAL.has(payment.status) && (
            <div className="mt-4 flex flex-wrap gap-3">
              <button onClick={onRefresh} disabled={busy} className={secondary}>
                Perbarui status
              </button>
              <button onClick={onCancel} disabled={busy} className={secondary}>
                Batalkan
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
