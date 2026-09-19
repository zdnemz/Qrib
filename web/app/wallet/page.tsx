"use client";

import { useEffect, useState } from "react";
import { getBalance, getReceive } from "../../lib/api";

const input =
  "w-full rounded-2xl border border-zinc-300 px-4 py-3 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900";
const btn =
  "rounded-full px-6 py-3 text-base font-semibold transition-colors active:scale-[0.98] disabled:opacity-50";
const primary = `${btn} bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-400 dark:text-zinc-950 dark:hover:bg-emerald-300`;
const card = "rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800";
const KEY = "qrib-address";

export default function Wallet() {
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [receive, setReceive] = useState<{ uri: string; warning: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setAddress(localStorage.getItem(KEY) ?? "");
  }, []);

  const save = (v: string) => {
    setAddress(v);
    localStorage.setItem(KEY, v);
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
      <p className="mt-2 max-w-[65ch] text-zinc-600 dark:text-zinc-400">
        Cek saldo USDC dan minta transfer masuk. Kunci privat tidak pernah lewat sini.
      </p>

      {error && (
        <p role="alert" className={`${card} mt-6 border-red-300 text-red-700 dark:border-red-800 dark:text-red-300`}>
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
          className={`${input} mt-2`}
        />
        <button onClick={onCheck} disabled={busy || !address} className={`${primary} mt-4`}>
          Cek saldo
        </button>
      </section>

      {balance !== null && (
        <section className={`${card} mt-6 bg-zinc-50 dark:bg-zinc-900`}>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Saldo</p>
          <p className="font-mono text-3xl font-bold tracking-tight">{balance}</p>
        </section>
      )}

      {receive && (
        <section className={`${card} mt-6`}>
          <h2 className="text-xl font-semibold">Terima</h2>
          <p className="mt-2 break-all font-mono text-sm">{receive.uri}</p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{receive.warning}</p>
          <button onClick={onCopy} className={`${primary} mt-4`}>
            {copied ? "Tersalin" : "Salin"}
          </button>
        </section>
      )}
    </main>
  );
}
