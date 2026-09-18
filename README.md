# Qrib (v1)

Payment wallet that spends USDC directly on real QRIS merchants: scan → confirm → paid.
Spec: `docs/PRD.md`. Status: **M4 manual settlement** (first-party operator tasks + signed channel; mocks still default).

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
pnpm report          # per-payment cost model: gas + fees + realized spread (§15)
```

Deliberately deferred: cron schedule for reconcile (explicit runbook until M5),
concurrent same-key races (single-node dogfood; `pg_advisory_xact_lock` when measured).

## First-Party Settlement (M4, your money only — §6.2/§6.4)

```sh
export OPERATOR_SECRET="$(openssl rand -hex 32)"
export ENGINE_OFFRAMP=manual ENGINE_PAYMENT=manual MANUAL_IDR_PER_USDC=15900
pnpm dev &
# pay from the PWA as usual; the legs stop at operator tasks:
pnpm operator list --status PENDING
# sell USDC on your own exchange account, then:
pnpm operator complete <convTask> --status COMPLETED --reference EX-1 \
  --fiat 27500 --rate 16000000000
# pay the merchant QRIS from your own bank app, then:
pnpm operator complete <settleTask> --status COMPLETED --reference QRIS-1 --proof struk.jpg
pnpm reconcile --all
```

`ENGINE_CHAIN=real` (plus `FUNDING_PRIVATE_KEY`, `FUNDING_DESTINATION`,
`ENGINE_NETWORK`) swaps the mock funding leg for a real Base transfer with
confirmation polling. Default everything-mock is staging; default network is
testnet — mainnet must be named explicitly, twice (ENGINE_NETWORK=base).

**Recovery.** A retry never double-broadcasts: `execute()` is serialized per
payment and resumes `CRYPTO_SUBMITTED`/`CONVERSION_PENDING`/
`FIAT_SETTLEMENT_PENDING` from recorded evidence. A payment stuck in
`RECONCILIATION_REQUIRED` is resolved by a signed operator action that
records the reason and only permits safe exits (unfunded → `FAILED`
or retry; funded → `REFUND_REQUIRED`):

```sh
pnpm operator resolve <paymentId> --to REFUND_REQUIRED --reason "merchant QR expired, refunding"
```

## Watchdog (reconcile on a schedule, §14.3)

```sh
crontab ops/reconcile.cron   # every 5 min; edit QRIS_WALLET_DIR first
```

`pnpm reconcile --all` exits 1 on any issue and, when `ALERT_WEBHOOK_URL`
is set, POSTs the payload there. Covers ledger imbalance, missing
chain/provider records, and dwell breaches on the async manual legs.

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

## PWA (M3, Base Sepolia testnet)

```sh
cp web/.env.example web/.env.local   # API URL, default localhost:3000
pnpm --filter qrib-web dev     # http://localhost:3100 (kamera: localhost = secure context)
```

Alur: Dompet (buat/impor, kunci PBKDF2 di localStorage — server tetap bisa
membaca formatnya) → Pindai (kamera + jsQR, atau tempel payload di laptop) →
Konfirmasi (statis: isi nominal; dinamis: langsung quote + countdown 90 dtk) →
Bayar → progres live → struk. API mengizinkan origin PWA via `ALLOWED_ORIGINS`.

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
