"use client";

import { useState } from "react";
import QRCode from "react-qr-code";
import { getBalance, getReceive } from "../../../lib/api";
import { sendUsdc } from "../../../lib/chain";
import { createWallet, decryptPrivateKey, importWallet } from "../../../lib/keystore";
import { card, errorCard, input, muted, primary, secondary, tint } from "../../../lib/ui";

const KS_KEY = "qrib-keystore";
const ADDR_KEY = "qrib-address";

const stored = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};

export default function Wallet() {
  const [address, setAddress] = useState(() => stored(ADDR_KEY));
  const [hasKeystore, setHasKeystore] = useState(() => stored(KS_KEY) !== "");
  const [key, setKey] = useState<`0x${string}` | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [secret, setSecret] = useState("");
  const [to, setTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendResult, setSendResult] = useState<{ hash: string; explorer: string } | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [receive, setReceive] = useState<{ uri: string; warning: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [armWipe, setArmWipe] = useState(false);

  const save = (addr: string, keystore: string) => {
    try {
      localStorage.setItem(ADDR_KEY, addr);
      localStorage.setItem(KS_KEY, keystore);
    } catch {
      throw new Error("penyimpanan peramban penuh atau diblokir");
    }
    setAddress(addr);
    setHasKeystore(true);
  };

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

  const onCreate = () =>
    run(async () => {
      const w = await createWallet(passphrase);
      save(w.address, w.keystore);
      setPassphrase("");
    });

  const onImport = () =>
    run(async () => {
      const w = await importWallet(secret, passphrase);
      save(w.address, w.keystore);
      setSecret("");
      setPassphrase("");
    });

  const onUnlock = () =>
    run(async () => {
      const ks = stored(KS_KEY);
      if (!ks) throw new Error("tidak ada keystore di perangkat ini");
      setKey(await decryptPrivateKey(ks, passphrase));
      setPassphrase("");
    });

  const onLock = () => {
    setKey(null);
    setSendResult(null);
  };

  const onWipe = () => {
    if (!armWipe) {
      setArmWipe(true);
      return;
    }
    try {
      localStorage.removeItem(KS_KEY);
      localStorage.removeItem(ADDR_KEY);
    } catch {
      // storage already unavailable; state reset still applies
    }
    setAddress("");
    setHasKeystore(false);
    setKey(null);
    setBalance(null);
    setReceive(null);
    setArmWipe(false);
  };

  const onSend = () =>
    run(async () => {
      if (!key) throw new Error("buka kunci dulu sebelum kirim");
      setSendResult(await sendUsdc({ privateKey: key, to: to.trim(), amount: sendAmount.trim() }));
    });

  const onCheck = () =>
    run(async () => {
      const addr = address.trim();
      if (!addr) throw new Error("isi alamat wallet dulu");
      const b = await getBalance(addr);
      setBalance(`${b.balance} ${b.asset}`);
      setReceive(await getReceive(addr));
    });

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
        Kunci terenkripsi di perangkat ini. Kunci mentah tidak pernah keluar dari memori.
      </p>

      {error && (
        <p role="alert" className={`${errorCard} mt-6`}>
          {error}
        </p>
      )}

      {!hasKeystore && (
        <>
          <section className={`${card} mt-6`}>
            <h2 className="text-xl font-semibold">Buat dompet</h2>
            <label htmlFor="new-pass" className="mt-4 block font-medium">
              Passphrase (minimal 8 karakter)
            </label>
            <input
              id="new-pass"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className={`${input} mt-2`}
            />
            <button onClick={onCreate} disabled={busy || passphrase.length < 8} className={`${primary} mt-4`}>
              Buat dompet
            </button>
          </section>

          <section className={`${card} mt-6`}>
            <h2 className="text-xl font-semibold">Impor dompet</h2>
            <label htmlFor="secret" className="mt-4 block font-medium">
              Private key atau mnemonic
            </label>
            <textarea
              id="secret"
              rows={2}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="0x... atau kata mnemonic"
              className={`${input} mt-2 font-mono text-sm`}
            />
            <label htmlFor="imp-pass" className="mt-4 block font-medium">
              Passphrase (minimal 8 karakter)
            </label>
            <input
              id="imp-pass"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className={`${input} mt-2`}
            />
            <button
              onClick={onImport}
              disabled={busy || !secret.trim() || passphrase.length < 8}
              className={`${primary} mt-4`}
            >
              Impor dompet
            </button>
          </section>
        </>
      )}

      {hasKeystore && (
        <section className={`${card} mt-6`}>
          <h2 className="text-xl font-semibold">Dompet ini</h2>
          <p className="mt-2 break-all font-mono text-sm">{address}</p>
          {key ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <button onClick={onLock} className={secondary}>
                Kunci
              </button>
              <button onClick={onWipe} className={secondary}>
                {armWipe ? "Ketuk lagi untuk hapus" : "Hapus dari perangkat"}
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <label htmlFor="unlock-pass" className="font-medium">
                Passphrase
              </label>
              <input
                id="unlock-pass"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className={`${input} mt-2`}
              />
              <div className="mt-4 flex flex-wrap gap-3">
                <button onClick={onUnlock} disabled={busy || !passphrase} className={primary}>
                  Buka kunci
                </button>
                <button onClick={onWipe} className={secondary}>
                  {armWipe ? "Ketuk lagi untuk hapus" : "Hapus dari perangkat"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {key && (
        <section className={`${card} mt-6`}>
          <h2 className="text-xl font-semibold">Kirim USDC</h2>
          <p className={`mt-1 text-sm ${muted}`}>Testnet Base Sepolia. Dana tidak bernilai.</p>
          <label htmlFor="send-to" className="mt-4 block font-medium">
            Alamat tujuan
          </label>
          <input
            id="send-to"
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
            placeholder="0x..."
            className={`${input} mt-2 font-mono text-sm`}
          />
          <label htmlFor="send-amount" className="mt-4 block font-medium">
            Nominal (USDC)
          </label>
          <input
            id="send-amount"
            inputMode="decimal"
            value={sendAmount}
            onChange={(e) => setSendAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.01"
            className={`${input} mt-2 font-mono`}
          />
          <button onClick={onSend} disabled={busy || !to || !sendAmount} className={`${primary} mt-4`}>
            Kirim
          </button>
          {sendResult && (
            <p className="mt-4 break-all font-mono text-sm">
              Terkirim:{" "}
              <a href={sendResult.explorer} target="_blank" rel="noreferrer" className="underline">
                {sendResult.hash}
              </a>
            </p>
          )}
        </section>
      )}

      <section className={`${card} mt-6`}>
        <h2 className="text-xl font-semibold">Saldo</h2>
        <label htmlFor="address" className="mt-4 block font-medium">
          Alamat wallet
        </label>
        <input
          id="address"
          value={address}
          onChange={(e) => {
            setAddress(e.target.value.trim());
            try {
              localStorage.setItem(ADDR_KEY, e.target.value.trim());
            } catch {
              // private mode: address just does not persist
            }
          }}
          placeholder="0x..."
          className={`${input} mt-2 font-mono text-sm`}
        />
        <button onClick={onCheck} disabled={busy || !address} className={`${primary} mt-4`}>
          Cek saldo
        </button>
        {balance !== null && (
          <div className={`${tint} mt-4`}>
            <p className="font-mono text-3xl font-bold tracking-tight">{balance}</p>
          </div>
        )}
      </section>

      {receive && (
        <section className={`${card} mt-6`}>
          <h2 className="text-xl font-semibold">Terima</h2>
          <div className="mt-4 inline-block rounded-2xl bg-white p-4">
            <QRCode value={receive.uri} size={160} />
          </div>
          <p className="mt-4 break-all font-mono text-sm">{receive.uri}</p>
          <p className={`mt-2 text-sm ${muted}`}>{receive.warning}</p>
          <button onClick={onCopy} className={`${primary} mt-4`}>
            {copied ? "Tersalin" : "Salin"}
          </button>
        </section>
      )}
    </main>
  );
}
