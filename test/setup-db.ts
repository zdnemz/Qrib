// Test DB lifecycle: create qris_wallet_test once, migrate it, hand the URL
// to workers via env. Prod/dev databases are never touched.

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgresql://qris:qris@localhost:5435/postgres" });

export async function setup() {
  await admin.connect();
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'qris_wallet_test' AND pid <> pg_backend_pid()").catch(() => {});
  await admin.query("DROP DATABASE IF EXISTS qris_wallet_test");
  await admin.query("CREATE DATABASE qris_wallet_test");
  await admin.end();

  const url = (process.env.TEST_DATABASE_URL ?? "postgresql://qris:qris@localhost:5435/postgres").replace(/\/[^/]*$/, "/qris_wallet_test");
  process.env.TEST_DATABASE_URL = url;
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
}

export async function teardown() {}
