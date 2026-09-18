// Browser-local keystore (M3 PWA, non-custodial §7.3). Same JSON shape as
// the server module, but PBKDF2-SHA256 — WebCrypto has no scrypt. The kdf
// name travels in the file, so each side knows what it can unlock (the
// server accepts both; see src/wallet/keystore.ts).
//
// The encrypted blob lives in localStorage; the passphrase lives only in
// the user's head. Nothing here ever leaves the device.

import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

const VERSION = 1;
const ITERATIONS = 600_000; // OWASP minimum for PBKDF2-HMAC-SHA256

const enc = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) throw new Error("bad hex");
  const out: Uint8Array<ArrayBuffer> = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations, hash: "SHA-256" },
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
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const packed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, fromHex(privateKey.slice(2)));
  const bytes = new Uint8Array(packed);
  return JSON.stringify({
    version: VERSION,
    kdf: { name: "pbkdf2", iterations: ITERATIONS, hash: "SHA-256", salt: toHex(salt) },
    cipher: { name: "aes-256-gcm", iv: toHex(iv) },
    ciphertext: toHex(bytes.slice(0, -16)),
    tag: toHex(bytes.slice(-16)),
  });
}

export async function decryptPrivateKey(keystoreJson: string, passphrase: string): Promise<`0x${string}`> {
  let file: {
    version: number;
    kdf: { name: string; iterations: number; salt: string };
    cipher: { name: string; iv: string };
    ciphertext: string;
    tag: string;
  };
  try {
    file = JSON.parse(keystoreJson);
  } catch {
    throw new Error("bukan file keystore yang valid");
  }
  if (file.version !== VERSION || file.kdf?.name !== "pbkdf2" || file.cipher?.name !== "aes-256-gcm") {
    throw new Error("versi keystore tidak didukung");
  }
  if (file.kdf.iterations < 100_000) throw new Error("keystore terlalu lemah, buat ulang");
  const key = await deriveKey(passphrase, fromHex(file.kdf.salt), file.kdf.iterations);
  const packed: Uint8Array<ArrayBuffer> = new Uint8Array([...fromHex(file.ciphertext), ...fromHex(file.tag)]);
  let raw: ArrayBuffer;
  try {
    // Wrong passphrase and corruption both surface as OperationError here —
    // indistinguishable by design, same as GCM auth failure on the server.
    raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(file.cipher.iv) }, key, packed);
  } catch {
    throw new Error("passphrase salah atau keystore rusak");
  }
  const hex = toHex(new Uint8Array(raw));
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("keystore rusak");
  return `0x${hex}`;
}

export type WalletRef = { address: Address; keystore: string };

export async function createWallet(passphrase: string): Promise<WalletRef> {
  const privateKey = generatePrivateKey();
  return { address: privateKeyToAccount(privateKey).address, keystore: await encryptPrivateKey(privateKey, passphrase) };
}

export async function importWallet(secret: string, passphrase: string): Promise<WalletRef> {
  const input = secret.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(input)) {
    const key = input as `0x${string}`;
    return { address: privateKeyToAccount(key).address, keystore: await encryptPrivateKey(key, passphrase) };
  }
  const account = mnemonicToAccount(input);
  const privKey = account.getHdKey().privateKey;
  if (!privKey) throw new Error("tidak bisa membaca mnemonic ini");
  const key = `0x${toHex(privKey)}` as `0x${string}`;
  return { address: account.address, keystore: await encryptPrivateKey(key, passphrase) };
}

// --- Device storage: encrypted blob only, never the key. ---

const ADDR_KEY = "qw.address";
const STORE_KEY = "qw.keystore";

export function savedWallet(): { address: Address } | null {
  const address = localStorage.getItem(ADDR_KEY);
  return address ? { address: address as Address } : null;
}

export function saveWallet(ref: WalletRef): void {
  localStorage.setItem(ADDR_KEY, ref.address);
  localStorage.setItem(STORE_KEY, ref.keystore);
}

export function clearWallet(): void {
  localStorage.removeItem(ADDR_KEY);
  localStorage.removeItem(STORE_KEY);
}
