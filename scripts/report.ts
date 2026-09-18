// Per-payment cost model (§15): the byproduct that decides whether this is a
// business. Reads settled payments and reports, per payment and in aggregate,
// gas + fees + realized spread against the locked quote.
//
// Gas is fetched live from the chain (receipt.gasUsed × effectiveGasPrice);
// ETH→IDR uses MANUAL_IDR_PER_USDC as a stand-in until a fee oracle exists.
// Realized spread = (rateExecuted − quotedRate) × USDC, the money the locked
// rate actually earned or lost.

import "dotenv/config";

import { desc, eq } from "drizzle-orm";

import { publicClientFor, parseNetwork } from "../src/chain/config.js";
import { db, pool } from "../src/db/index.js";
import { blockchainTransactions, conversions, paymentIntents, paymentQuotes } from "../src/db/schema.js";

const micros = (raw: string | null | undefined): number => (raw ? Number(raw) / 1e6 : 0);

async function gasFor(txHash: string, network: "base-sepolia" | "base"): Promise<{ eth: string; wei: bigint }> {
  try {
    const client = publicClientFor(network);
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    const wei = receipt.gasUsed * receipt.effectiveGasPrice;
    return { eth: (Number(wei) / 1e18).toExponential(4), wei };
  } catch {
    return { eth: "?", wei: 0n };
  }
}

async function main() {
  const network = parseNetwork(process.env.ENGINE_NETWORK);
  const idrPerUsdc = process.env.MANUAL_IDR_PER_USDC ?? process.env.MOCK_IDR_PER_USDC ?? "16000";

  const intents = await db
    .select()
    .from(paymentIntents)
    .orderBy(desc(paymentIntents.createdAt));

  const rows: Record<string, unknown>[] = [];
  let totalFeeFiat = 0;
  let totalSpreadIdr = 0;
  let totalGasIdr = 0;

  for (const i of intents) {
    const [q] = await db.select().from(paymentQuotes).where(eq(paymentQuotes.paymentId, i.id));
    if (!q) continue;
    const [conv] = await db.select().from(conversions).where(eq(conversions.paymentId, i.id));
    const [tx] = await db.select().from(blockchainTransactions).where(eq(blockchainTransactions.paymentId, i.id));

    const gas = tx?.txHash ? await gasFor(tx.txHash, network) : { eth: tx ? "mock" : "-", wei: 0n };
    const quoted = Number(q.rate) / 1e6;
    const executed = conv?.rateExecuted ? Number(conv.rateExecuted) / 1e6 : null;
    const usdc = micros(q.cryptoAmount);
    const spreadIdr = executed !== null ? (executed - quoted) * usdc : 0;
    const gasIdr = Number(gas.wei) / 1e18 * Number(idrPerUsdc);

    totalFeeFiat += Number(q.feeFiat);
    totalSpreadIdr += spreadIdr;
    totalGasIdr += gasIdr;

    rows.push({
      id: i.id.slice(0, 8),
      status: i.status,
      fiatIdr: Number(q.fiatAmount),
      usdc,
      quotedRate: quoted,
      executedRate: executed,
      feeFiatIdr: Number(q.feeFiat),
      feeCryptoUsdc: micros(q.feeCrypto),
      spreadIdr: Math.round(spreadIdr),
      gasEth: gas.eth,
      gasIdr: Number(gasIdr.toFixed(2)),
    });
  }

  const completed = rows.filter((r) => r.status === "COMPLETED").length;
  console.log(JSON.stringify({
    network,
    idrPerUsdcUsed: Number(idrPerUsdc),
    payments: rows.length,
    completed,
    totals: {
      feeFiatIdr: totalFeeFiat,
      spreadIdr: Math.round(totalSpreadIdr),
      gasIdr: Number(totalGasIdr.toFixed(2)),
    },
    perPayment: rows,
  }, null, 2));

  // Non-zero exit if any completed payment has no executed rate — the cost
  // model is only trustworthy when every settled payment carries its fill.
  const missing = rows.filter((r) => r.status === "COMPLETED" && r.executedRate === null);
  if (missing.length) {
    console.error(`incomplete cost data for: ${missing.map((m) => m.id).join(", ")}`);
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  })
  .finally(() => pool.end());
