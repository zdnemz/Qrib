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
});
