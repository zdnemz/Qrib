// Device-key cryptography for v1 (non-custodial, §7.3–7.4).
// Stdlib only (node:crypto scrypt + AES-256-GCM) — no KDF dependency to audit.
// The keystore JSON is self-describing (kdf params inline) so params can be
// hardened later without breaking existing files.
//
// Security boundaries (§13): the raw key exists only in the caller's memory,
// is never logged, and server routes must NEVER call unlock() — in v1 prod
// signing happens on the founder's device (M3), the API only reads chain state.

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

const VERSION = 1;

type KeystoreFile = {
  version: number;
  kdf: { name: "scrypt"; n: number; r: number; p: number; salt: string };
  cipher: { name: "aes-256-gcm"; iv: string };
  ciphertext: string;
  tag: string;
};

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  // N=2^14: ~100ms unlock on laptop hardware. Raise N (recorded in-file) if
  // devices get faster — old files keep working because params travel with them.
  return scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
}

export function encryptPrivateKey(privateKey: `0x${string}`, passphrase: string): string {
  if (passphrase.length < 8) throw new Error("passphrase must be at least 8 characters");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(privateKey.slice(2), "hex")), cipher.final()]);
  const file: KeystoreFile = {
    version: VERSION,
    kdf: { name: "scrypt", n: 16384, r: 8, p: 1, salt: salt.toString("hex") },
    cipher: { name: "aes-256-gcm", iv: iv.toString("hex") },
    ciphertext: ciphertext.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
  return JSON.stringify(file);
}

export function decryptPrivateKey(keystoreJson: string, passphrase: string): `0x${string}` {
  let file: KeystoreFile;
  try {
    file = JSON.parse(keystoreJson);
  } catch {
    throw new Error("not a valid keystore file");
  }
  if (file.version !== VERSION || file.kdf?.name !== "scrypt" || file.cipher?.name !== "aes-256-gcm") {
    throw new Error("unsupported keystore version");
  }
  const key = scryptSync(passphrase, Buffer.from(file.kdf.salt, "hex"), 32, {
    N: file.kdf.n,
    r: file.kdf.r,
    p: file.kdf.p,
  });
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(file.cipher.iv, "hex"));
    decipher.setAuthTag(Buffer.from(file.tag, "hex"));
    const raw = Buffer.concat([
      decipher.update(Buffer.from(file.ciphertext, "hex")),
      decipher.final(),
    ]).toString("hex");
    if (!/^[0-9a-f]{64}$/.test(raw)) throw new Error("decrypt failed");
    return `0x${raw}`;
  } catch {
    // GCM auth failure and bad-passphrase are indistinguishable by design.
    throw new Error("wrong passphrase or corrupted keystore");
  }
}

export type WalletRef = { address: Address; keystore: string };

/** Generate EOA. Raw key is encrypted immediately and never returned. */
export function createWallet(passphrase: string): WalletRef {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  return { address, keystore: encryptPrivateKey(privateKey, passphrase) };
}

/** Import from `0x`-prefixed private key or BIP-39 mnemonic. */
export function importWallet(secret: string, passphrase: string): WalletRef {
  const input = secret.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(input)) {
    const key = input as `0x${string}`;
    return { address: privateKeyToAccount(key).address, keystore: encryptPrivateKey(key, passphrase) };
  }
  const account = mnemonicToAccount(input); // throws on invalid mnemonic
  const privKey = account.getHdKey().privateKey;
  if (!privKey) throw new Error("cannot extract private key from mnemonic");
  const key = `0x${Buffer.from(privKey).toString("hex")}` as `0x${string}`;
  return { address: account.address, keystore: encryptPrivateKey(key, passphrase) };
}
