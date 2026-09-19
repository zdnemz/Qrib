"use client";

import { useEffect, useState } from "react";
import Scanner from "../../../components/Scanner";
import Magnetic from "../../../components/Magnetic";
import Reveal from "../../../components/Reveal";
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
} from "../../../lib/api";
import { card, errorCard, input, muted, primary, secondary, tint } from "../../../lib/ui";

const TERMINAL = new Set([
  "COMPLETED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "RECONCILIATION_REQUIRED",
  "REFUND_REQUIRED",
]);

/** Live countdown to quote expiry. Bayar locks at zero until a fresh quote. */
function Countdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
  return (
    <p className={`mt-1 font-mono text-sm ${left === 0 ? "text-red-700 dark:text-red-300" : muted}`}>
      {left === 0 ? "Quote kedaluwarsa, minta lagi" : `Berlaku ${left} detik lagi`}
    </p>
  );
}

export default function Scan() {
  const [payload, setPayload] = useState("");
  const [parsed, setParsed] = useState<QrisParse | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteExpired, setQuoteExpired] = useState(false);
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

  const parse = async (text: string) => {
    const r = await parseQris(text);
    setParsed(r);
    setAmount(r.amountIdr ?? "");
    setQuote(null);
    setQuoteExpired(false);
    setPayment(null);
  };

  const onParse = () => run(() => parse(payload.trim()));

  const onScanned = (text: string) => {
    setPayload(text);
    run(() => parse(text));
  };

  const onQuote = () =>
    run(async () => {
      if (!parsed || !/^\d+$/.test(amount)) throw new Error("nominal rupiah harus angka bulat");
      const q = await requestQuote({
        fiatAmount: amount,
        merchantName: parsed.merchantName,
        merchantId: parsed.merchantId ?? undefined,
      });
      setQuote(q);
      setQuoteExpired(false);
    });

  useEffect(() => {
    if (!quote) return;
    const t = setInterval(() => {
      if (Date.now() >= new Date(quote.expiresAt).getTime()) {
        setQuoteExpired(true);
        clearInterval(t);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [quote]);

  const onPay = () =>
    run(async () => {
      if (!quote || quoteExpired) return;
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
      <p className={`mt-2 max-w-[65ch] ${muted}`}>Pindai dari kamera atau tempel payload, kunci kurs, bayar.</p>

      {error && (
        <p role="alert" className={`${errorCard} mt-6`}>
          {error}
        </p>
      )}

      <section className={`${card} mt-6`}>
        <Scanner onPayload={onScanned} disabled={busy} />
      </section>

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
        <Reveal>
          <section className={`${tint} mt-6`}>
            <h2 className="text-xl font-semibold">Quote</h2>
            <p className="mt-2 text-3xl font-bold tracking-tight">{idr(quote.fiatAmount)}</p>
            <p className={`mt-1 font-mono text-sm ${muted}`}>{quote.cryptoAmount} USDC</p>
            <Countdown expiresAt={quote.expiresAt} />
          <div className="mt-4 flex flex-wrap gap-3">
            <Magnetic>
              <button onClick={onPay} disabled={busy || quoteExpired} className={primary}>
                Bayar
              </button>
            </Magnetic>
          </div>
          </section>
        </Reveal>
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
