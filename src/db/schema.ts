// v1 tables per PRD §11.1. Deferred post-v1: beneficiaries, bank_accounts,
// ewallet_accounts, payouts.
// Conventions: uuid PKs, timestamptz created_at/updated_at, money as numeric
// (never float), raw provider payloads as jsonb for reconciliation (§14.3).

import {
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// --- Identity / wallet (§4.1, §7.3) ---

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const wallets = pgTable("wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  // Encrypted keystore blob. Key material never leaves the device unencrypted
  // in production; server stores only what the client uploads (v1: non-custodial, §7.4).
  encryptedKeystore: text("encrypted_keystore").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const walletAddresses = pgTable("wallet_addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletId: uuid("wallet_id")
    .notNull()
    .references(() => wallets.id),
  address: text("address").notNull(),
  chain: text("chain").notNull(), // v1: single EVM chain (§17), stored per row so the constraint is data, not schema
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull(), // v1: USDC only (§4.2 out of scope: multi-asset)
  chain: text("chain").notNull(),
  decimals: integer("decimals").notNull(),
  contractAddress: text("contract_address"),
});

// --- Merchants (parsed from QRIS, §7.2) ---

export const merchants = pgTable("merchants", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: text("merchant_id"), // parsed EMVCo merchant account info, nullable until parse lands (M3)
  name: text("name"),
  rawPayload: text("raw_payload"), // original QRIS string for audit
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Payments: intent + quote + attempts (§8, §9) ---

export const paymentIntents = pgTable("payment_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  merchantId: uuid("merchant_id").references(() => merchants.id),
  // Human intent first: fiat amount in minor units ("bayar Rp27.500" → 27500, §3.2).
  fiatAmount: numeric("fiat_amount").notNull(),
  currency: text("currency").notNull().default("IDR"),
  // §8.1 state names as data. Forward-only enforced in code (M2), not CHECK,
  // so staging fault-injection can assert unexpected states without a migration.
  status: text("status").notNull().default("CREATED"),
  stateEnteredAt: timestamp("state_entered_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const paymentQuotes = pgTable("payment_quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => paymentIntents.id),
  asset: text("asset").notNull().default("USDC"),
  cryptoAmount: numeric("crypto_amount").notNull(),
  fiatAmount: numeric("fiat_amount").notNull(),
  rate: numeric("rate").notNull(),
  spreadBps: integer("spread_bps").notNull(),
  feeCrypto: numeric("fee_crypto").notNull(),
  feeFiat: numeric("fee_fiat").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // hard expiry, server-enforced (§9.2)
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const paymentAttempts = pgTable("payment_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => paymentIntents.id),
  attemptNo: integer("attempt_no").notNull(),
  state: text("state").notNull(),
  txHash: text("tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const blockchainTransactions = pgTable("blockchain_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").references(() => paymentIntents.id),
  txHash: text("tx_hash").notNull(),
  chain: text("chain").notNull(),
  fromAddress: text("from_address").notNull(),
  toAddress: text("to_address").notNull(),
  amount: numeric("amount").notNull(),
  confirmations: integer("confirmations").notNull().default(0),
  status: text("status").notNull().default("SUBMITTED"),
  rawReceipt: jsonb("raw_receipt"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  uniqueIndex("blockchain_transactions_tx_hash_uidx").on(t.txHash),
]);

// --- Settlement legs (§6.2, §10): conversion + fiat settlement ---

export const conversions = pgTable("conversions", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => paymentIntents.id),
  provider: text("provider").notNull(), // ManualOffRampProvider in v1 prod, Mock/Faulty in test (§10)
  cryptoAmount: numeric("crypto_amount").notNull(),
  fiatAmount: numeric("fiat_amount"),
  rateExecuted: numeric("rate_executed"),
  reference: text("reference"), // operator-supplied (exchange sell ref)
  status: text("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const fiatSettlements = pgTable("fiat_settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => paymentIntents.id),
  provider: text("provider").notNull(), // ManualQrisSettlementProvider in v1 prod (§10)
  fiatAmount: numeric("fiat_amount").notNull(),
  merchantId: uuid("merchant_id").references(() => merchants.id),
  reference: text("reference"), // operator-supplied (QRIS payment ref)
  proof: jsonb("proof"), // receipt image pointer / metadata
  status: text("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Manual legs are provider implementations backed by an operator task queue:
// execute() creates a task and returns pending; a signed operator action
// completes it (§10). Downstream cannot tell manual from licensed.
export const operatorTasks = pgTable("operator_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => paymentIntents.id),
  kind: text("kind").notNull(), // CONVERSION | FIAT_SETTLEMENT
  status: text("status").notNull().default("PENDING"),
  payload: jsonb("payload").notNull(),
  result: jsonb("result"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// --- Webhooks, ledger, idempotency (§12, §11.2, §13) ---

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  payload: jsonb("payload").notNull(),
  processed: integer("processed").notNull().default(0),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  uniqueIndex("webhook_events_provider_event_uidx").on(t.provider, t.eventId),
]);

// Double-entry, internal, authoritative for accounting (§11.2).
// Invariant (checked by reconciler, M2): sum(debit - credit) = 0 per payment.
export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => paymentIntents.id),
  account: text("account").notNull(), // user_balance | merchant_settlement | fees | spread
  debit: numeric("debit").notNull().default("0"),
  credit: numeric("credit").notNull().default("0"),
  currency: text("currency").notNull().default("IDR"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Every mutating endpoint requires Idempotency-Key (§12); replay returns stored result.
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code"),
  response: jsonb("response"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});
