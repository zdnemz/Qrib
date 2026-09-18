// Shared engine-test wiring: test DB handle + default mock providers.

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { Db } from "../src/db/index.js";
import * as schema from "../src/db/schema.js";
import { MockChainGateway, MockOffRampProvider, MockQrisProvider } from "../src/engine/providers.mock.js";
import { createQuote } from "../src/engine/quote.js";
import { authorize } from "../src/engine/service.js";

export function testDb(): Db {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  return drizzle(pool, { schema }) as Db;
}

export const mocks = () => ({
  offRamp: new MockOffRampProvider(),
  payment: new MockQrisProvider(),
  chain: new MockChainGateway(),
});

export async function quotedPayment(db: Db, fiat = "27500") {
  const quote = await createQuote(db, mocks().offRamp, { fiatAmountIdr: BigInt(fiat) });
  const intent = await authorize(db, quote.paymentId);
  return { quote, intent };
}
