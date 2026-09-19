// Browser chain access for client-side USDC send. Reads (balance, receive)
// stay on the API; signing stays on this device and the key never leaves
// memory (§13). Testnet default: a missing network must never resolve to
// real money.

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseUnits,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const USDC = {
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const,
  "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
};

const CHAINS = { "base-sepolia": baseSepolia, base } as const;

export type NetworkName = keyof typeof USDC;

export const EXPLORER = {
  "base-sepolia": "https://sepolia.basescan.org",
  base: "https://basescan.org",
} as const;

const erc20Abi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

/** Parse "1.50" to micros. Rejects >6dp, negatives, garbage (USDC has 6 decimals). */
export function parseUsdcAmount(input: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(input.trim())) throw new Error(`nominal USDC tidak valid: ${input}`);
  return parseUnits(input.trim(), 6);
}

/**
 * Plain USDC transfer signed on this device. `privateKey` lives in the
 * caller's memory only. Testnet first; mainnet only by explicit name.
 */
export async function sendUsdc(args: {
  privateKey: `0x${string}`;
  network?: NetworkName;
  to: string;
  amount: string;
}): Promise<{ hash: string; explorer: string }> {
  const network = args.network ?? "base-sepolia";
  const value = parseUsdcAmount(args.amount);
  if (value === BigInt(0)) throw new Error("nominal harus lebih dari 0");
  if (!/^0x[0-9a-fA-F]{40}$/.test(args.to)) throw new Error("alamat tujuan tidak valid");
  const account = privateKeyToAccount(args.privateKey);
  const chain = CHAINS[network];
  const transport = http();
  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });
  const hash = await wallet.writeContract({
    address: USDC[network],
    abi: erc20Abi,
    functionName: "transfer",
    args: [args.to as Address, value],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash, explorer: `${EXPLORER[network]}/tx/${hash}` };
}
