"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { idr, listPayments, type Payment } from "../../lib/api";

export default function History() {
  const [payments, setPayments] = useState<Payment[] | null>(null);

  useEffect(() => {
    listPayments().then((r) => setPayments(r.payments)).catch(() => setPayments([]));
  }, []);

  return (
    <>
      <h1>Riwayat</h1>
      {payments === null ? (
        <p className="muted">Memuat…</p>
      ) : payments.length === 0 ? (
        <p className="muted">Belum ada pembayaran.</p>
      ) : (
        payments.map((p) => (
          <Link key={p.id} className="btn secondary" href={`/payment/${p.id}`}>
            {idr(p.fiatAmount)} · {p.status}
          </Link>
        ))
      )}
      <Link className="btn secondary" href="/">Kembali</Link>
    </>
  );
}
