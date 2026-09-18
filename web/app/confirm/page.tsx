"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authorize, execute, idr, requestQuote, type QrisParse, type Quote } from "../../lib/api";
import { SCAN_KEY } from "../scan/page";

type Scan = QrisParse & { payload: string };

export default function Confirm() {
  const router = useRouter();
  const [scan, setScan] = useState<Scan | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(SCAN_KEY);
    if (!raw) {
      router.replace("/scan");
      return;
    }
    const s = JSON.parse(raw) as Scan;
    setScan(s);
    if (s.amountIdr) setAmount(s.amountIdr);
  }, [router]);

  useEffect(() => {
    if (!quote) return;
    const update = () => setLeft(Math.max(0, Math.floor((new Date(quote.expiresAt).getTime() - Date.now()) / 1000)));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [quote]);

  if (!scan) return <p className="muted">Memuat…</p>;
  const needAmount = scan.initiation === "static";

  const askQuote = async () => {
    setError(null);
    setBusy(true);
    try {
      const fiat = needAmount ? amount.replace(/\D/g, "") : (scan.amountIdr ?? "");
      if (!fiat || BigInt(fiat) <= 0n) throw new Error("Nominal tidak valid");
      setQuote(await requestQuote({ fiatAmount: fiat, merchantName: scan.merchantName, merchantId: scan.merchantPan }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quote gagal");
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!quote) return;
    setError(null);
    setBusy(true);
    try {
      await authorize(quote.paymentId);
      const { payment } = await execute(quote.paymentId);
      router.push(`/payment/${payment.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pembayaran gagal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Konfirmasi</h1>
      <div className="card">
        <div className="row"><span className="muted">Merchant</span><strong>{scan.merchantName}</strong></div>
        <div className="row"><span className="muted">Kota</span><span>{scan.merchantCity}</span></div>
        {needAmount ? (
          <>
            <label>Nominal (Rp) — QR statis, isi sendiri</label>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="27500" />
          </>
        ) : (
          <div className="row"><span className="muted">Nominal</span><strong>{idr(scan.amountIdr ?? "0")}</strong></div>
        )}
      </div>

      {!quote ? (
        <button onClick={askQuote} disabled={busy}>Minta Quote</button>
      ) : (
        <div className="card">
          <div className="row"><span className="muted">Bayar</span><strong>{idr(quote.fiatAmount)}</strong></div>
          <div className="row"><span className="muted">USDC</span><span>{quote.cryptoAmount}</span></div>
          <div className="row"><span className="muted">Biaya</span><span>{quote.fee.crypto} USDC + Rp{quote.fee.fiat}</span></div>
          <div className="row"><span className="muted">Kurs</span><span>{Number(quote.rate).toLocaleString("id-ID")}</span></div>
          <div className="row"><span className="muted">Berlaku</span><span>{left ?? "…"} dtk</span></div>
          {(left ?? 1) > 0 ? (
            <button onClick={pay} disabled={busy}>Bayar {idr(quote.fiatAmount)}</button>
          ) : (
            <button className="secondary" onClick={() => setQuote(null)}>Quote kedaluwarsa — minta baru</button>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}
