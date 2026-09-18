// Scripted failure doubles for the staging fault-injection suite (§14.2).
// Each fault maps to exactly one required system response (§14.1).

import type { ChainGateway, OffRampProvider, PaymentProvider, SettlementState } from "./providers.js";
import { ProviderFailure, ProviderTimeout } from "./providers.js";

export type OffRampFault = "throw" | "timeout" | "partial";
export type SettleFault = "failed" | "timeout" | "pending-forever" | "partial";

/** Off-ramp that misbehaves on execute(). refRate() stays honest. */
export class FaultyOffRampProvider implements OffRampProvider {
  readonly name = "faulty-offramp";
  constructor(private fault: OffRampFault, private ref6: bigint) {}
  async refRate6(): Promise<bigint> {
    return this.ref6;
  }
  async execute(input: { paymentId: string; usdcMicros: bigint; expectedFiatIdr: bigint }) {
    if (this.fault === "throw") throw new ProviderFailure("off-ramp exploded");
    if (this.fault === "timeout") throw new ProviderTimeout("off-ramp timed out");
    // Partial: delivers 1 IDR under the locked quote — must never count as
    // complete, even though the shortfall is trivial (§14.1).
    return { reference: `conv-${input.paymentId.slice(0, 8)}`, fiatAmountIdr: input.expectedFiatIdr - 1n, rateExecuted6: this.ref6 };
  }
}

/** QRIS settlement that misbehaves after createPayment(). */
export class FaultyQrisProvider implements PaymentProvider {
  readonly name = "faulty-qris";
  constructor(private fault: SettleFault) {}
  async createPayment(input: { paymentId: string; fiatAmountIdr: bigint }) {
    return { ref: `qris-${input.paymentId.slice(0, 8)}` };
  }
  async getPayment(ref: string): Promise<{ status: SettlementState; ref: string; fiatAmountIdr?: bigint }> {
    if (this.fault === "failed") return { status: "FAILED", ref };
    if (this.fault === "timeout") throw new ProviderTimeout("qris provider timed out");
    return { status: "PENDING", ref }; // pending-forever + partial land here; partial detected on amounts
  }
}

/** Chain that fails at broadcast — outcome unknown, so review, never FAILED. */
export class FaultyChainGateway implements ChainGateway {
  readonly name = "faulty-chain";
  async submitPayment(): Promise<{ txHash: string }> {
    throw new ProviderFailure("broadcast rejected");
  }
  async confirmations(): Promise<number> {
    return 0;
  }
}
