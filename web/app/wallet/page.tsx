"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { getBalance, getReceive } from "../../lib/api";
import { clearWallet, createWallet, importWallet, savedWallet, saveWallet } from "../../lib/keystore";
import type { Address } from "viem";

export default function Wallet() {
  const [address, setAddress] = useState<Address | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [warning, setWarning] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [secret, setSecret] = useState("");
  const [mode, setMode] = useState<"create" | "import">("create");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const w = savedWallet();
    if (!w) return;
    setAddress(w.address);
    getBalance(w.address).then((b) => setBalance(b.balance)).catch(() => setBalance("?"));
    getReceive(w.address)
      .then(async (r) => {
        setQr(await QRCode.toDataURL(r.uri, { margin: 1, width: 220 }));
        setWarning(r.warning);
      })
      .catch(() => {});
  }, []);

  const create = async () => {
    setError(null);
    if (pass.length < 8) return setError("Passphrase minimal 8 karakter");
    if (pass !== pass2) return setError("Konfirmasi passphrase tidak sama");
    setBusy(true);
    try {
      const ref = await createWallet(pass);
      saveWallet(ref);
      setAddress(ref.address);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat dompet");
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setError(null);
    if (pass.length < 8) return setError("Passphrase minimal 8 karakter");
    setBusy(true);
    try {
      const ref = await importWallet(secret, pass);
      saveWallet(ref);
      setAddress(ref.address);
    } catch (err) {
      setError("Secret tidak valid (private key 0x… atau mnemonic)");
    } finally {
      setBusy(false);
    }
  };

  if (!address) {
    return (
      <>
        <h1>Dompet</h1>
        <div className="card">
          <button className={mode === "create" ? "" : "secondary"} onClick={() => setMode("create")}>Baru</button>
          <button className={mode === "import" ? "" : "secondary"} onClick={() => setMode("import")}>Impor</button>
        </div>
        {mode === "import" && (
          <div className="card">
            <label>Private key (0x…) atau mnemonic — tidak pernah keluar dari perangkat ini</label>
            <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="0x… / abandon abandon …" />
          </div>
        )}
        <div className="card">
          <label>Passphrase (min. 8 karakter) — hanya Anda yang tahu</label>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
          {mode === "create" && (
            <>
              <label>Konfirmasi passphrase</label>
              <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
            </>
          )}
          <p className="muted">Hilang = dana hilang. Tidak ada pemulihan (non-custodial, §7.4).</p>
          <button onClick={mode === "create" ? create : doImport} disabled={busy}>
            {mode === "create" ? "Buat Dompet" : "Impor Dompet"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <Link className="btn secondary" href="/">Kembali</Link>
      </>
    );
  }

  return (
    <>
      <h1>Terima USDC</h1>
      <div className="card">
        <div className="muted">Saldo</div>
        <div className="big">{balance ?? "…"}</div>
        <div className="mono">{address}</div>
        {qr && <img src={qr} alt="QR terima USDC" width={220} height={220} />}
        {warning && <p className="muted">{warning}</p>}
      </div>
      <button
        className="secondary"
        onClick={() => {
          clearWallet();
          setAddress(null);
        }}
      >
        Ganti Dompet
      </button>
      <Link className="btn secondary" href="/">Kembali</Link>
    </>
  );
}
