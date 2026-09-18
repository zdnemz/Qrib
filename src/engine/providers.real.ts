// Real funding leg on Base (M1 modules). First-party only: signs with the
// founder's key from env, testnet by default — mainnet needs explicit
// ENGINE_NETWORK=base. Never set FUNDING_PRIVATE_KEY on shared infra.

import { privateKeyToAccount } from "viem/accounts";

import { publicClientFor, parseNetwork, type NetworkName } from "../chain/config.js";
import { checkedAddress, sendUsdc } from "../wallet/usdc.js";
import { formatMicros } from "./quote.js";
import type { ChainGateway } from "./providers.js";

export class RealChainGateway implements ChainGateway {
  readonly name = "real-chain";
  private network: NetworkName;
  private key: `0x${string}`;
  private dest: `0x${string}`;

  constructor() {
    this.network = parseNetwork(process.env.ENGINE_NETWORK);
    const rawKey = (process.env.FUNDING_PRIVATE_KEY ?? "").trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
      throw new Error("FUNDING_PRIVATE_KEY (0x-prefixed hex) required for ENGINE_CHAIN=real");
    }
    this.key = rawKey as `0x${string}`;
    this.dest = checkedAddress(process.env.FUNDING_DESTINATION);
  }

  async submitPayment(input: { paymentId: string; usdcMicros: bigint }) {
    const { hash } = await sendUsdc({
      publicClient: publicClientFor(this.network),
      privateKey: this.key,
      network: this.network,
      to: this.dest,
      amount: formatMicros(input.usdcMicros),
    });
    return { txHash: hash };
  }

  async confirmations(txHash: string): Promise<number> {
    const n = await publicClientFor(this.network).getTransactionConfirmations({
      hash: txHash as `0x${string}`,
    });
    return Number(n);
  }

  legParties() {
    return { from: privateKeyToAccount(this.key).address, to: this.dest };
  }
}
