// Provider contracts (§10). Manual v1 implementations (M4) and licensed
// integrations (post-v1) satisfy these same interfaces — swapping is wiring,
// not a rewrite. Mocks below; faulty variants live in providers.faulty.ts
// for the staging fault-injection suite (§14.2).

export type QuoteInput = { fiatAmountIdr: bigint; merchantRef?: string };

/** Reference rate: IDR per USDC, scaled by 1e6 (integer math, never float). */
export interface OffRampProvider {
  readonly name: string;
  refRate6(): Promise<bigint>;
  execute(input: { paymentId: string; usdcMicros: bigint; expectedFiatIdr: bigint }): Promise<{
    reference: string;
    /** Manual providers return PENDING — the human leg completes later. */
    status: "COMPLETED" | "PENDING";
    fiatAmountIdr?: bigint;
    rateExecuted6?: bigint;
  }>;
}

export type SettlementState = "PENDING" | "COMPLETED" | "FAILED";

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: { paymentId: string; fiatAmountIdr: bigint }): Promise<{ ref: string }>;
  getPayment(ref: string): Promise<{ status: SettlementState; ref: string; fiatAmountIdr?: bigint }>;
}

/** Chain funding leg. M4 swaps the mock for viem + Base (M1 modules). */
export interface ChainGateway {
  readonly name: string;
  submitPayment(input: { paymentId: string; usdcMicros: bigint }): Promise<{ txHash: string }>;
  confirmations(txHash: string): Promise<number>;
  /** Funding endpoints for the books; null when the gateway doesn't disclose. */
  legParties?(): { from: string; to: string } | null;
}

export class ProviderTimeout extends Error {}
export class ProviderFailure extends Error {}
