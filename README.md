# QRIS Wallet (v1)

Payment wallet that spends USDC directly on real QRIS merchants: scan → confirm → paid.
Spec: `docs/PRD.md`. Status: **M3a QRIS parse** (EMVCo TLV + CRC, static/dynamic, `POST /qris/parse`; PWA shell next).

## Engine (M2, mocked providers)

```sh
# quote → authorize → execute (Idempotency-Key required on POSTs)
curl -X POST localhost:3000/payments/quote -H 'Idempotency-Key: a' \
  -d '{"fiatAmount":"27500","merchantName":"Kopi Kenangan"}'
curl -X POST localhost:3000/payments/<id>/authorize -H 'Idempotency-Key: b'
curl -X POST localhost:3000/payments/<id>/execute -H 'Idempotency-Key: c'
# staging fault injection: -d '{"provider":"faulty-settle-fail"}' on execute
# scan a QRIS code (read-only, no key needed):
curl -X POST localhost:3000/qris/parse -d '{"payload":"0002...6304XXXX"}'
pnpm test            # fault-injection suite (needs Postgres on :5435)
pnpm reconcile --all # chain ↔ provider ↔ ledger truth-check (exit 1 on issues)
```

Deliberately deferred: `POST /internal/tasks/:id/complete` (lands with manual
providers, M4), cron schedule for reconcile (explicit runbook until M5),
concurrent same-key races (single-node dogfood; `pg_advisory_xact_lock` when measured).

## Wallet (M1, Base Sepolia testnet)

```sh
export WALLET_PASSPHRASE="..."
pnpm wallet generate --out ./keystore.json   # prints address; fund at faucet.circle.com
WALLET_SECRET="<key|mnemonic>" pnpm wallet import --out ./keystore.json  # existing wallet; secret via env, never argv
pnpm wallet balance 0x...                    # live USDC balance
pnpm wallet receive 0x... --amount 1.50      # EIP-681 URI + chain warning
pnpm wallet send --keystore ./keystore.json --to 0x... --amount 0.01
```

HTTP (keyless reads only — no `POST /wallet/send` by design, §13):

```sh
curl "localhost:3000/wallet/balance?address=0x..."
curl "localhost:3000/wallet/receive?address=0x...&amount=27.5"
```

Mainnet needs explicit `?network=base`; everything defaults to `base-sepolia`.


## Run (dev)

```sh
cp .env.example .env
docker compose up -d db
pnpm install
pnpm db:migrate
pnpm dev          # http://localhost:3000/health
```

## Layout

- `src/app.ts` — Hono service (health/ready now; §12 surface lands M2/M3)
- `src/db/schema.ts` — v1 tables per PRD §11.1
- `drizzle/` — generated migrations (commit these)
- `docs/PRD.md` — spec; §6.4 gate before any third-party funds
```
