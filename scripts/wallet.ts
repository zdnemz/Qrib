// Founder CLI for M1 dogfood on Base Sepolia (valueless testnet USDC).
// The raw key is decrypted in memory only and never printed or logged.
// Passphrase via WALLET_PASSPHRASE env (never argv — argv leaks to ps).
//
//   pnpm wallet generate --out ./keystore.json
//   WALLET_SECRET="0x..." pnpm wallet import --out ./keystore.json
//   pnpm wallet balance 0x... [--network base]
//   pnpm wallet receive 0x... [--network base] [--amount 1.50]
//   pnpm wallet send --keystore ./keystore.json --to 0x... --amount 0.01

import "dotenv/config";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

import { parseNetwork, publicClientFor } from "../src/chain/config.js";
import { createWallet, decryptPrivateKey, importWallet } from "../src/wallet/keystore.js";
import { checkedAddress, getUsdcBalance, receiveInfo, sendUsdc } from "../src/wallet/usdc.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function passphrase(): string {
  const p = process.env.WALLET_PASSPHRASE;
  if (!p) throw new Error("set WALLET_PASSPHRASE env first");
  return p;
}

async function main() {
  const [cmd, positional] = process.argv.slice(2);
  const network = parseNetwork(flag("network"));

  if (cmd === "generate") {
    const out = flag("out");
    if (!out) throw new Error("usage: pnpm wallet generate --out ./keystore.json");
    const { address, keystore } = createWallet(passphrase());
    writeFileSync(out, keystore, { mode: 0o600 });
    chmodSync(out, 0o600);
    console.log(JSON.stringify({
      address,
      keystore: out,
      next: "fund with testnet USDC at faucet.circle.com, then: pnpm wallet balance " + address,
    }, null, 2));
  } else if (cmd === "import") {
    // Existing key only — private key or mnemonic via env, never argv/chat.
    const out = flag("out");
    const secret = process.env.WALLET_SECRET;
    if (!out || !secret) throw new Error("usage: WALLET_SECRET=<key|mnemonic> pnpm wallet import --out ./keystore.json");
    const { address, keystore } = importWallet(secret, passphrase());
    writeFileSync(out, keystore, { mode: 0o600 });
    chmodSync(out, 0o600);
    console.log(JSON.stringify({ address, keystore: out }, null, 2));
  } else if (cmd === "balance") {
    const address = checkedAddress(positional);
    const r = await getUsdcBalance(publicClientFor(network), network, address);
    console.log(JSON.stringify({ network, address, asset: "USDC", ...r }, null, 2));
  } else if (cmd === "receive") {
    const address = checkedAddress(positional);
    console.log(JSON.stringify({ network, ...receiveInfo(network, address, flag("amount")) }, null, 2));
  } else if (cmd === "send") {
    const ks = flag("keystore");
    const to = checkedAddress(flag("to"));
    const amount = flag("amount");
    if (!ks || !amount) throw new Error("usage: pnpm wallet send --keystore <f> --to <addr> --amount <usdc>");
    const key = decryptPrivateKey(readFileSync(ks, "utf8"), passphrase());
    const r = await sendUsdc({ publicClient: publicClientFor(network), privateKey: key, network, to, amount });
    console.log(JSON.stringify({ network, to, amount, ...r }, null, 2));
  } else {
    throw new Error("usage: pnpm wallet <generate|import|balance|receive|send> …");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
