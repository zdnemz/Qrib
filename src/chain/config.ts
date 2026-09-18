// Single-chain config per PRD §17 (multi-chain is §4.2 out of scope).
// USDC addresses are Circle's canonical deployments (developers.circle.com/stablecoins/usdc-contract-addresses):
// mainnet = native USDC on Base, testnet = USDC on Base Sepolia. Both 6 decimals.

import { createPublicClient, http, type HttpTransport, type PublicClient } from "viem";
import { base, baseSepolia } from "viem/chains";

export const NETWORKS = {
  "base-sepolia": {
    chain: baseSepolia,
    // Testnet USDC — valueless, for M1 proof + staging fault injection.
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const,
    envRpc: "BASE_SEPOLIA_RPC_URL",
    defaultRpc: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
  },
  base: {
    chain: base,
    // Native USDC on Base mainnet. Real money — §6.2 first-party only.
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
    envRpc: "BASE_RPC_URL",
    defaultRpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
  },
} as const;

export type NetworkName = keyof typeof NETWORKS;

/** Shared client type so money-path helpers stay typed without `any`. */
export type ChainClient = PublicClient<HttpTransport, typeof base | typeof baseSepolia>;

export function parseNetwork(input: unknown): NetworkName {
  // ponytail: testnet default. Mainnet must be asked for by name — a missing
  // param must never resolve to real money.
  if (input === undefined || input === null || input === "") return "base-sepolia";
  if (typeof input === "string" && input in NETWORKS) return input as NetworkName;
  throw new Error(`unknown network (want ${Object.keys(NETWORKS).join(" | ")})`);
}

export function rpcUrlFor(network: NetworkName): string {
  const cfg = NETWORKS[network];
  return process.env[cfg.envRpc] || cfg.defaultRpc;
}

export function publicClientFor(network: NetworkName): ChainClient {
  const cfg = NETWORKS[network];
  return createPublicClient({ chain: cfg.chain, transport: http(rpcUrlFor(network)) });
}
