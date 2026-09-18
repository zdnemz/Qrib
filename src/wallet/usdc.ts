// Plain USDC transfer on one chain (PRD §4.1 Send / Receive).
// Read paths (balance, receive URI) are keyless and served by the API.
// sendUsdc() signs — call it only from the founder's device/CLI (M3), never
// from a server route with a transmitted key (§13).

import {
  createWalletClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseUnits,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { NETWORKS, rpcUrlFor, type ChainClient, type NetworkName } from "../chain/config.js";

const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export function checkedAddress(input: unknown): Address {
  if (typeof input !== "string" || !isAddress(input)) throw new Error("invalid address");
  return getAddress(input); // checksummed
}

/** Live USDC balance. Returns display string + raw units (money is never float). */
export async function getUsdcBalance(
  client: ChainClient,
  network: NetworkName,
  holder: Address,
): Promise<{ balance: string; raw: string; decimals: number }> {
  const usdc = NETWORKS[network].usdc;
  const [raw, decimals] = await Promise.all([
    client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
    client.readContract({ address: usdc, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { balance: formatUnits(raw, decimals), raw: raw.toString(), decimals };
}

/** Receive info for §7.3 (address + explicit chain/asset warning + EIP-681 URI). */
export function receiveInfo(network: NetworkName, holder: Address, amount?: string) {
  const cfg = NETWORKS[network];
  if (amount !== undefined) parseUsdcAmount(amount); // validate early, throws
  const params = new URLSearchParams({ address: holder });
  if (amount !== undefined) params.set("uint256", parseUsdcAmount(amount).toString());
  return {
    address: holder,
    chain: cfg.chain.name,
    chainId: cfg.chain.id,
    asset: "USDC",
    usdc: cfg.usdc,
    warning: `USDC on ${cfg.chain.name} only — other assets/chains will be lost`,
    uri: `ethereum:${cfg.usdc}@${cfg.chain.id}/transfer?${params}`,
  };
}

/** Parse "1.50" → 1500000n. Rejects >6dp, negatives, garbage (USDC has 6 decimals). */
export function parseUsdcAmount(input: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(input.trim())) throw new Error(`invalid USDC amount: ${input}`);
  return parseUnits(input.trim(), 6);
}

export type SendResult = { hash: `0x${string}`; explorer: string };

/**
 * Plain USDC transfer. `privateKey` lives in the caller's memory only.
 * Testnet proof: `pnpm wallet send …`; v1 prod: founder's device (M3/M4).
 */
export async function sendUsdc(args: {
  publicClient: ChainClient;
  privateKey: `0x${string}`;
  network: NetworkName;
  to: Address;
  amount: string;
}): Promise<SendResult> {
  const { publicClient, privateKey, network, to } = args;
  const cfg = NETWORKS[network];
  const value = parseUsdcAmount(args.amount);
  if (value === 0n) throw new Error("amount must be > 0");
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: cfg.chain,
    transport: http(rpcUrlFor(network)),
  });
  const hash = await walletClient.writeContract({
    address: cfg.usdc,
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, value],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash, explorer: `${cfg.explorer}/tx/${hash}` };
}
