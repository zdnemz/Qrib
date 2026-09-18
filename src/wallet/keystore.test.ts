import { describe, expect, it } from "vitest";

import { createWallet, decryptPrivateKey, importWallet } from "./keystore.js";
describe("keystore", () => {
  it("roundtrips generate → encrypt → decrypt", () => {
    const { address, keystore } = createWallet("correct horse 123");
    const again = importWallet(decryptPrivateKey(keystore, "correct horse 123"), "correct horse 123");
    expect(again.address).toBe(address);
  });

  it("rejects wrong passphrase", () => {
    const { keystore } = createWallet("correct horse 123");
    expect(() => decryptPrivateKey(keystore, "wrong passphrase")).toThrow(/wrong passphrase/);
  });

  it("rejects short passphrase", () => {
    expect(() => createWallet("short")).toThrow(/at least 8/);
  });

  it("imports a known private key to its known address", () => {
    // Vector cross-checked with Python eth_keys (independent secp256k1 impl).
    const { address } = importWallet(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7b4d3ff3c0",
      "correct horse 123",
    );
    expect(address).toBe("0xa15aD99F774F173a894A8277ac8E9EF7E478f5cF");
  });

  it("imports a known mnemonic to its known address", () => {
    const { address } = importWallet(
      "test test test test test test test test test test test junk",
      "correct horse 123",
    );
    expect(address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  });

  it("rejects garbage secrets and keystores", () => {
    expect(() => importWallet("not a secret", "correct horse 123")).toThrow();
    expect(() => decryptPrivateKey("{nope", "correct horse 123")).toThrow(/valid keystore/);
  });

  it("reads PWA (PBKDF2) files — KDF split, same envelope", async () => {
    // Fixture built with node:crypto exactly the way web/lib/keystore.ts
    // builds it with WebCrypto (PBKDF2-SHA256, AES-GCM, tag split off).
    const { pbkdf2Sync, randomBytes, createCipheriv } = await import("node:crypto");
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const k = pbkdf2Sync("correct horse 123", salt, 600_000, 32, "sha256");
    const cipher = createCipheriv("aes-256-gcm", k, iv);
    const raw = Buffer.from("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7b4d3ff3c0", "hex");
    const ct = Buffer.concat([cipher.update(raw), cipher.final()]);
    const file = JSON.stringify({
      version: 1,
      kdf: { name: "pbkdf2", iterations: 600_000, hash: "SHA-256", salt: salt.toString("hex") },
      cipher: { name: "aes-256-gcm", iv: iv.toString("hex") },
      ciphertext: ct.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
    });
    expect(decryptPrivateKey(file, "correct horse 123")).toBe(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7b4d3ff3c0",
    );
    expect(() => decryptPrivateKey(file, "wrong passphrase")).toThrow(/wrong passphrase/);
  }, 30_000);
});
