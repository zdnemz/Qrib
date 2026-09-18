// Payment state machine (§8). Forward-only except into exception states.
// CRYPTO_CONFIRMED is the point of no return: after it the only exits are
// COMPLETED, REFUNDED (via REFUND_REQUIRED), or RECONCILIATION_REQUIRED.

export const TERMINAL = [
  "COMPLETED",
  "EXPIRED",
  "FAILED",
  "REFUNDED",
  "RECONCILIATION_REQUIRED",
] as const;

const EDGES: Record<string, string[]> = {
  CREATED: ["QUOTED", "FAILED"],
  QUOTED: ["AUTHORIZED", "EXPIRED", "FAILED"],
  AUTHORIZED: ["CRYPTO_SUBMITTED", "FAILED"],
  CRYPTO_SUBMITTED: ["CRYPTO_CONFIRMED", "RECONCILIATION_REQUIRED"],
  CRYPTO_CONFIRMED: ["CONVERSION_PENDING", "RECONCILIATION_REQUIRED"],
  CONVERSION_PENDING: ["FIAT_SETTLEMENT_PENDING", "REFUND_REQUIRED", "RECONCILIATION_REQUIRED"],
  FIAT_SETTLEMENT_PENDING: ["COMPLETED", "REFUND_REQUIRED", "RECONCILIATION_REQUIRED"],
  REFUND_REQUIRED: ["REFUNDED", "RECONCILIATION_REQUIRED"],
  COMPLETED: [],
  EXPIRED: [],
  FAILED: [],
  REFUNDED: [],
  RECONCILIATION_REQUIRED: [],
};

export function canTransition(from: string, to: string): boolean {
  return EDGES[from]?.includes(to) ?? false;
}

export class InvalidTransition extends Error {}

// Max dwell per state in seconds (§8.3). Breach → review, never silent retry.
export const DWELL_SEC: Record<string, number> = {
  QUOTED: 90,
  CRYPTO_SUBMITTED: 600,
  CONVERSION_PENDING: 1800,
  FIAT_SETTLEMENT_PENDING: 1800,
};
