// Deterministic test doubles. MockChainGateway derives its fake hash from the
// payment id, so replays and retries never double-submit phantom txs.

import { createHash } from "node:crypto";

import { engineConfig } from "./config.js";
import type { ChainGateway, OffRampProvider, PaymentProvider } from "./providers.js";

export class MockOffRampProvider implements OffRampProvider {
  readonly name = "mock-offramp";
  async refRate6(): Promise<bigint> {
    return BigInt(engineConfig.mockIdrPerUsdc) * 1_000_000n;
  }
  async execute(input: { paymentId: string; usdcMicros: bigint; expectedFiatIdr: bigint }) {
    const rate = await this.refRate6();
    return {
      reference: `conv-${input.paymentId.slice(0, 8)}`,
      fiatAmountIdr: (input.usdcMicros * rate) / 1_000_000_000_000n,
      rateExecuted6: rate,
    };
  }
}

export class MockQrisProvider implements PaymentProvider {
  readonly name = "mock-qris";
  private calls = new Map<string, number>();
  async createPayment(input: { paymentId: string; fiatAmountIdr: bigint }) {
    const ref = `qris-${input.paymentId.slice(0, 8)}`;
    this.calls.set(ref, 0);
    return { ref };
  }
  async getPayment(ref: string) {
    // First poll settles — deterministic, no sleeping.
    const n = (this.calls.get(ref) ?? 0) + 1;
    this.calls.set(ref, n);
    return { status: "COMPLETED" as const, ref };
  }
}

export class MockChainGateway implements ChainGateway {
  readonly name = "mock-chain";
  async submitPayment(input: { paymentId: string; usdcMicros: bigint }) {
    const txHash =
      "0x" + createHash("sha256").update(`mock-tx:${input.paymentId}`).digest("hex").slice(0, 64);
    return { txHash };
  }
  async confirmations(): Promise<number> {
    return 12;
  }
}
