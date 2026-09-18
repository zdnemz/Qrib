"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getPayment, idr, type Payment } from "../../../lib/api";

const STEPS = [
  ["QUOTED", "Quote dikunci"],
  ["AUTHORIZED", "Dikonfirmasi"],
  ["CRYPTO_SUBMITTED", "USDC dikirim"],
  ["CRYPTO_CONFIRMED", "USDC terkonfirmasi"],
  ["CONVERSION_PENDING", "Tukar ke Rupiah"],
  ["FIAT_SETTLEMENT_PENDING", "Bayar merchant"],
  ["COMPLETED", "Lunas"],
] as const;

const TERMINAL_FAILED = ["FAILED", "EXPIRED", "REFUND_REQUIRED", "REFUNDED", "RECONCILIATION_REQUIRED"];

export default function PaymentStatus() {
  const { id } = useParams<{ id: string }>();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const { payment: p } = await getPayment(id);
        if (!stop) setPayment(p);
        return p.status;
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : "Gagal memuat");
        return "ERROR";
      }
    };
    poll();
    const t = setInterval(async () => {
      const s = await poll();
      if (s === "COMPLETED" || TERMINAL_FAILED.includes(s) || s === "ERROR") clearInterval(t);
    }, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!payment) return <p className="muted">Memuat…</p>;

  if (payment.status === "COMPLETED") {
    return (
      <>
        <h1 className="ok">Lunas ✓</h1>
        <div className="card">
          <div className="big">{idr(payment.fiatAmount)}</div>
          <div className="row"><span className="muted">USDC</span><span>{payment.quote?.cryptoAmount}</span></div>
          <div className="row"><span className="muted">Biaya</span><span>{payment.quote?.fee.crypto} USDC + Rp{payment.quote?.fee.fiat}</span></div>
          <div className="mono muted">{payment.id}</div>
        </div>
        <Link className="btn secondary" href="/">Kembali</Link>
      </>
    );
  }

  if (TERMINAL_FAILED.includes(payment.status)) {
    return (
      <>
        <h1>Gagal diproses</h1>
        <div className="card">
          <div className="row"><span className="muted">Status</span><span>{payment.status}</span></div>
          {payment.failureReason && <p>{payment.failureReason}</p>}
          {payment.status === "REFUND_REQUIRED" && (
            <p className="muted">USDC sudah keluar tapi merchant belum dibayar — dana dikembalikan otomatis.</p>
          )}
        </div>
        <Link className="btn secondary" href="/">Kembali</Link>
      </>
    );
  }

  const reached = new Set(payment.attempts.map((a) => a.state));
  return (
    <>
      <h1>Memproses…</h1>
      <div className="card">
        <div className="big">{idr(payment.fiatAmount)}</div>
        <ul className="steps">
          {STEPS.map(([s, label]) => (
            <li key={s} className={reached.has(s) ? (s === payment.status ? "now" : "done") : ""}>{label}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
