// Quote engine (§9). All money math in bigint: IDR are indivisible units,
// USDC in micros (6dp). Quoted rate = reference − spread; crypto rounds UP
// (ceiling) so drift inside the window is survivable. Hard expiry enforced
// server-side at authorize(); the client countdown is a courtesy.

import type { Db } from "../db/index.js";
import { merchants, paymentIntents, paymentQuotes } from "../db/schema.js";
import { engineConfig } from "./config.js";
import type { OffRampProvider } from "./providers.js";
import { dailyTotalIdr, transitionWith } from "./store.js";

export type Quote = {
  paymentId: string;
  asset: "USDC";
  cryptoAmount: string; // USDC incl. fee, 6dp display
  usdcMicros: bigint;
  fiatAmount: string;
  rate: string; // quoted IDR/USDC display
  spreadBps: number;
  fee: { crypto: string; fiat: string };
  expiresAt: Date;
};

export class QuoteRejected extends Error {}

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** 1500000n → "1.5". Money stays bigint internally; strings are display only. */
export function formatMicros(micros: bigint): string {
  const neg = micros < 0n;
  const s = (neg ? -micros : micros).toString().padStart(7, "0");
  const out = `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/\.?0+$/, "");
  return (neg ? "-" : "") + (out === "" ? "0" : out);
}

export async function createQuote(
  db: Db,
  offRamp: OffRampProvider,
  input: { fiatAmountIdr: bigint; merchantName?: string; merchantRef?: string; userId?: string; ttlSec?: number },
): Promise<Quote> {
  const { fiatAmountIdr } = input;
  if (fiatAmountIdr <= 0n) throw new QuoteRejected("amount must be > 0");
  if (fiatAmountIdr > BigInt(engineConfig.maxPaymentIdr)) {
    throw new QuoteRejected(`exceeds per-transaction cap of ${engineConfig.maxPaymentIdr} IDR`);
  }
  if (input.userId) {
    const day = await dailyTotalIdr(db, input.userId);
    if (day + fiatAmountIdr > BigInt(engineConfig.maxDailyIdr)) {
      throw new QuoteRejected(`exceeds daily cap of ${engineConfig.maxDailyIdr} IDR`);
    }
  }

  const ref6 = await offRamp.refRate6();
  const quoted6 = (ref6 * BigInt(10_000 - engineConfig.spreadBps)) / 10_000n;
  const cryptoMicros = ceilDiv(fiatAmountIdr * 1_000_000_000_000n, quoted6);
  const totalMicros = cryptoMicros + BigInt(engineConfig.feeUsdcMicros);
  const expiresAt = new Date(Date.now() + (input.ttlSec ?? engineConfig.quoteTtlSec) * 1000);

  return db.transaction(async (tx) => {
    let merchantId: string | undefined;
    if (input.merchantName || input.merchantRef) {
      const [m] = await tx
        .insert(merchants)
        .values({ merchantId: input.merchantRef, name: input.merchantName })
        .returning();
      merchantId = m.id;
    }
    const [intent] = await tx
      .insert(paymentIntents)
      .values({
        userId: input.userId,
        merchantId,
        fiatAmount: fiatAmountIdr.toString(),
        currency: "IDR",
        status: "CREATED",
      })
      .returning();
    await tx.insert(paymentQuotes).values({
      paymentId: intent.id,
      asset: "USDC",
      cryptoAmount: totalMicros.toString(),
      fiatAmount: fiatAmountIdr.toString(),
      rate: quoted6.toString(),
      spreadBps: engineConfig.spreadBps,
      feeCrypto: BigInt(engineConfig.feeUsdcMicros).toString(),
      feeFiat: BigInt(engineConfig.feeIdr).toString(),
      expiresAt,
    });
    // CREATED → QUOTED inside the same transaction: no intent ever escapes unquoted.
    await transitionWith(tx, intent.id, "QUOTED", { actor: "api", reason: "quote locked" });
    return {
      paymentId: intent.id,
      asset: "USDC" as const,
      cryptoAmount: formatMicros(totalMicros),
      usdcMicros: totalMicros,
      fiatAmount: fiatAmountIdr.toString(),
      rate: (quoted6 / 1_000_000n).toString(),
      spreadBps: engineConfig.spreadBps,
      fee: { crypto: formatMicros(BigInt(engineConfig.feeUsdcMicros)), fiat: engineConfig.feeIdr.toString() },
      expiresAt,
    };
  });
}
