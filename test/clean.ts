// Test isolation against one shared Postgres database, independent of how
// the runner parallelizes files: each file holds a Postgres advisory lock
// for its whole run, and truncates before every test.

import { afterAll, beforeAll, beforeEach } from "vitest";
import { Client } from "pg";

const TABLES = [
  "webhook_events",
  "ledger_entries",
  "idempotency_keys",
  "operator_tasks",
  "fiat_settlements",
  "conversions",
  "blockchain_transactions",
  "payment_attempts",
  "payment_quotes",
  "payment_intents",
  "merchants",
  "wallet_addresses",
  "wallets",
  "users",
  "assets",
];

let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  await client.query("SELECT pg_advisory_lock(424242)");
}, 60_000);

beforeEach(async () => {
  await client.query(`TRUNCATE ${TABLES.join(", ")} CASCADE`);
});

afterAll(async () => {
  await client.query("SELECT pg_advisory_unlock(424242)");
  await client.end();
});
