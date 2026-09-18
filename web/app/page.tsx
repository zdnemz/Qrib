"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getBalance } from "../lib/api";
import { savedWallet } from "../lib/keystore";

export default function Home() {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    const w = savedWallet();
    setAddress(w?.address ?? null);
    if (w) getBalance(w.address).then((b) => setBalance(b.balance)).catch(() => setBalance("?"));
  }, []);

  return (
    <>
      <h1>Qrib</h1>
      <p className="muted">Bayar QRIS pakai USDC: pindai, konfirmasi, lunas.</p>
      {!address ? (
        <div className="card">
          <h2>Belum ada dompet</h2>
          <p className="muted">Buat dompet baru atau impor yang sudah ada. Kunci terenkripsi di perangkat ini.</p>
          <Link className="btn" href="/wallet">Buat / Impor Dompet</Link>
        </div>
      ) : (
        <div className="card">
          <div className="muted">Saldo USDC (Base Sepolia)</div>
          <div className="big">{balance ?? "…"}</div>
          <div className="mono muted">{address}</div>
          <Link className="btn" href="/scan">Pindai &amp; Bayar</Link>
          <Link className="btn secondary" href="/wallet">Terima</Link>
        </div>
      )}
      <div className="card">
        <Link className="btn secondary" href="/history">Riwayat Pembayaran</Link>
      </div>
      {address && (
        <p className="muted">Testnet: dana tidak bernilai. Gerbang §6.4 berlaku sebelum dana pihak ketiga.</p>
      )}
    </>
  );
}
