"use client";

import { useState } from "react";
import { getBalance, getReceive } from "../../lib/api";
import { card, errorCard, input, muted, primary, tint } from "../../lib/ui";

const KEY = "qrib-address";

const stored = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

export default function Wallet() {
  const [address, setAddress] = useState(stored);
  const [balance, setBalance] = useState<string | null>(null);
  const [receive, setReceive] = useState<{ uri: string; warning: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const save = (v: string) => {
    setAddress(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // private mode: address just does not persist
    }
  };

  const onCheck = async () => {
    setBusy(true);
    setError(null);
    try {
      const b = await getBalance(address.trim());
      setBalance(`${b.balance} ${b.asset}`);
      const r = await getReceive(address.trim());
      setReceive(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    if (!receive) return;
    await navigator.clipboard.writeText(receive.uri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-12">
      <h1 className="text-4xl font-bold tracking-tighter">Dompet</h1>
      <p className={`mt-2 max-w-[65ch] ${muted}`}>
        Cek saldo USDC dan minta transfer masuk. Kunci privat tidak pernah lewat sini.
      </p>

      {error && (
        <p role="alert" className={`${errorCard} mt-6`}>
          {error}
        </p>
      )}

      <section className={`${card} mt-6`}>
        <label htmlFor="address" className="font-medium">
          Alamat wallet
        </label>
        <input
          id="address"
          value={address}
          onChange={(e) => save(e.target.value.trim())}
          placeholder="0x..."
          className={`${input} mt-2 font-mono text-sm`}
        />
        <button onClick={onCheck} disabled={busy || !address} className={`${primary} mt-4`}>
          Cek saldo
        </button>
      </section>

      {balance !== null && (
        <section className={`${tint} mt-6`}>
          <p className={`text-sm ${muted}`}>Saldo</p>
          <p className="font-mono text-3xl font-bold tracking-tight">{balance}</p>
        </section>
      )}

      {receive && (
        <section className={`${card} mt-6`}>
          <h2 className="text-xl font-semibold">Terima</h2>
          <p className="mt-2 break-all font-mono text-sm">{receive.uri}</p>
          <p className={`mt-2 text-sm ${muted}`}>{receive.warning}</p>
          <button onClick={onCopy} className={`${primary} mt-4`}>
            {copied ? "Tersalin" : "Salin"}
          </button>
        </section>
      )}
    </main>
  );
}
