// Browser keystore: same v1 envelope as src/wallet/keystore.ts, PBKDF2 leg.
// WebCrypto has no scrypt, so the PWA writes pbkdf2 files; the server reads
// both legs (see keystore.test.ts "reads PWA (PBKDF2) files"). Raw keys live
// in memory only and are never stored or logged.

import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

const ITERATIONS = 600_000;

const hex = (b: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

const unhex = (s: string): Uint8Array => {
  if (!/^[0-9a-fA-F]*$/.test(s) || s.length % 2 !== 0) throw new Error("bukan file keystore yang valid");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

async function derive(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptPrivateKey(privateKey: `0x${string}`, passphrase: string): Promise<string> {
  if (passphrase.length < 8) throw new Error("passphrase minimal 8 karakter");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    await derive(passphrase, salt),
    unhex(privateKey.slice(2)) as BufferSource,
  );
  const bytes = new Uint8Array(ct);
  return JSON.stringify({
    version: 1,
    kdf: { name: "pbkdf2", iterations: ITERATIONS, hash: "SHA-256", salt: hex(salt) },
    cipher: { name: "aes-256-gcm", iv: hex(iv) },
    ciphertext: hex(bytes.slice(0, -16)),
    tag: hex(bytes.slice(-16)),
  });
}

export async function decryptPrivateKey(keystoreJson: string, passphrase: string): Promise<`0x${string}`> {
  let file: {
    version: number;
    kdf: { name: string; iterations?: number; salt: string };
    cipher: { name: string; iv: string };
    ciphertext: string;
    tag: string;
  };
  try {
    file = JSON.parse(keystoreJson);
  } catch {
    throw new Error("bukan file keystore yang valid");
  }
  if (file.version !== 1 || file.cipher?.name !== "aes-256-gcm" || file.kdf?.name !== "pbkdf2") {
    throw new Error("keystore tidak didukung di peramban (hanya PBKDF2)");
  }
  if ((file.kdf.iterations ?? 0) < 100_000) throw new Error("KDF keystore terlalu lemah");
  const raw = new Uint8Array([...unhex(file.ciphertext), ...unhex(file.tag)]);
  // Re-derive with the file's own iteration count so hardened files keep working.
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: unhex(file.kdf.salt) as BufferSource, iterations: file.kdf.iterations!, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unhex(file.cipher.iv) as BufferSource },
      key,
      raw as BufferSource,
    );
    const s = hex(pt);
    if (!/^[0-9a-f]{64}$/.test(s)) throw new Error("decrypt failed");
    return `0x${s}`;
  } catch {
    throw new Error("passphrase salah atau keystore rusak");
  }
}

/** Create EOA. Raw key is encrypted immediately and never returned. */
export async function createWallet(passphrase: string): Promise<{ address: string; keystore: string }> {
  const privateKey = generatePrivateKey();
  return { address: privateKeyToAccount(privateKey).address, keystore: await encryptPrivateKey(privateKey, passphrase) };
}

/** Import from 0x private key or BIP-39 mnemonic. */
export async function importWallet(secret: string, passphrase: string): Promise<{ address: string; keystore: string }> {
  const input = secret.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(input)) {
    const key = input as `0x${string}`;
    return { address: privateKeyToAccount(key).address, keystore: await encryptPrivateKey(key, passphrase) };
  }
  const account = mnemonicToAccount(input); // throws on invalid mnemonic
  const priv = account.getHdKey().privateKey;
  if (!priv) throw new Error("tidak bisa membaca private key dari mnemonic");
  const key = `0x${hex(priv)}` as `0x${string}`;
  return { address: account.address, keystore: await encryptPrivateKey(key, passphrase) };
}
