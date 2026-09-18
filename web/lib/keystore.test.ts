import { describe, expect, it } from "vitest";

import { createWallet, decryptPrivateKey, importWallet } from "./keystore.js";

// Runs under Node (WebCrypto is global since Node 20) — no browser needed.
describe("browser keystore", () => {
  it("roundtrips generate → encrypt → decrypt", async () => {
    const { address, keystore } = await createWallet("kuda benar 123");
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(JSON.parse(keystore).kdf.name).toBe("pbkdf2");
    const again = await importWallet(await decryptPrivateKey(keystore, "kuda benar 123"), "kuda benar 123");
    expect(again.address).toBe(address);
  }, 30_000);

  it("rejects wrong passphrase and short passphrases", async () => {
    const { keystore } = await createWallet("kuda benar 123");
    await expect(decryptPrivateKey(keystore, "salah total")).rejects.toThrow(/salah/);
    await expect(createWallet("pendek")).rejects.toThrow(/8 karakter/);
  }, 30_000);

  it("imports the known vector to the verified address", async () => {
    const { address } = await importWallet(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7b4d3ff3c0",
      "kuda benar 123",
    );
    expect(address).toBe("0xa15aD99F774F173a894A8277ac8E9EF7E478f5cF");
  }, 30_000);
});
