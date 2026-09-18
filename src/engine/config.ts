// Engine tuning via env. Defaults are the PRD's: 90s quote (§8.3), 50bps
// spread (§9.2), small first-party caps (§9.3).

const num = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`bad ${key}: ${raw}`);
  return n;
};

export const engineConfig = {
  quoteTtlSec: num("QUOTE_TTL_SEC", 90),
  spreadBps: num("SPREAD_BPS", 50),
  feeUsdcMicros: num("FEE_USDC_MICROS", 20_000), // 0.02 USDC
  feeIdr: num("FEE_IDR", 320),
  maxPaymentIdr: num("MAX_PAYMENT_IDR", 500_000),
  maxDailyIdr: num("MAX_DAILY_IDR", 2_000_000),
  mockIdrPerUsdc: num("MOCK_IDR_PER_USDC", 16_000),
  settlePolls: num("SETTLE_POLLS", 3),
};
