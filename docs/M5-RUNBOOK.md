# M5 Runbook — the correctness bar

**Goal:** 20 real, complete USDC→QRIS payments with zero silent failures and
100% ledger reconciliation (PRD §15). **Current: 2 / 20.**

This runbook exists so the remaining 18 can be run without an assistant and
without re-deriving anything. One payment takes ~10 minutes, mostly waiting
for the manual legs.

---

## Before you start (once)

1. `docker compose up -d db`
2. `cp .env.example .env.paymentN` and fill it in (see the template below).
   Keep the file `chmod 600`. It holds a funded key — never commit it; `.gitignore`
   already excludes `.env.*`.
3. `pnpm db:migrate`
4. `set -a; . ./.env.paymentN; set +a; pnpm dev &`
5. `curl localhost:3000/health` → `{"ok":true}`

### Env template

```sh
DATABASE_URL=postgresql://qris:qris@localhost:5435/qris_wallet
PORT=3000
OPERATOR_SECRET=<openssl rand -hex 32>
ENGINE_OFFRAMP=manual
ENGINE_PAYMENT=manual
MANUAL_IDR_PER_USDC=<today's IDR/USDC from your exchange, decimals OK>
ENGINE_CHAIN=real
ENGINE_NETWORK=base-sepolia          # "base" = REAL MONEY. Do not use with real merchant QRs.
FUNDING_PRIVATE_KEY=0x...            # the wallet holding your USDC
FUNDING_DESTINATION=0x...            # where the USDC lands (your off-ramp wallet)
```

**Testnet vs mainnet:** on `base-sepolia` the USDC is valueless, so a payment
proves the *engine*, not the money. On `base` real USDC leaves your wallet but
**the merchant is still not paid** (no PJP integration), so you pay yourself and
lose the on-chain amount. Use testnet for the 20; mainnet only when a licensed
partner exists (§6.4).

---

## Per payment

```sh
export OPERATOR_SECRET=$(grep '^OPERATOR_SECRET=' .env.paymentN | cut -d= -f2)
```

**1. Parse the QR** (read-only, no funds move — safe to try any QR):
```sh
curl -s -X POST localhost:3000/qris/parse -H 'Content-Type: application/json' \
  -d '{"payload":"<paste the QR payload>"}'
```
- `initiation: dynamic` → note `amountIdr` (that is the amount to pay)
- `initiation: static` → you choose the amount
- `next: enter-amount` vs `confirm` tells the UI which screen follows
- **If it errors:** stop and record it. Do not work around it — a parse
  failure is a bug worth more than the payment.

**2. Quote** (amount is IDR, integer string):
```sh
curl -s -X POST localhost:3000/payments/quote \
  -H 'Idempotency-Key: '"$(uuidgen)" -H 'Content-Type: application/json' \
  -d '{"fiatAmount":"15000","merchantName":"<name>","merchantId":"<id>"}'
```
Check the returned `cryptoAmount`, `rate`, `expiresAt`. A quote is valid for
**90 seconds** — work quickly from here.

**3. Authorize then execute** (execute is what moves real USDC):
```sh
ID=<paymentId>
curl -s -X POST localhost:3000/payments/$ID/authorize -H 'Idempotency-Key: '"$(uuidgen)"
curl -s -X POST localhost:3000/payments/$ID/execute  -H 'Idempotency-Key: '"$(uuidgen)" \
  -H 'Content-Type: application/json' -d '{}'
```
Expect `CONVERSION_PENDING`. Record the tx hash:
```sh
curl -s localhost:3000/payments/$ID | grep -o '"txHash":"0x[0-9a-f]*"' | head -1
```
Verify on https://sepolia.basescan.org/tx/<hash> — status must be `success`.

**4. Sell the USDC for IDR on your own exchange account**, then:
```sh
pnpm operator list --status PENDING
pnpm operator complete <conversion-task-id> \
  --status COMPLETED --reference <exchange-ref> \
  --fiat <idr-delivered> --rate <rate*1e6>
```
`--fiat` must be **at least** the quoted amount. Less → the payment correctly
goes to `RECONCILIATION_REQUIRED` for review instead of pretending to succeed.

**5. Pay the merchant QRIS from your own bank/e-wallet app**, then:
```sh
pnpm operator list --status PENDING
pnpm operator complete <settlement-task-id> \
  --status COMPLETED --reference <qris-ref> --proof <receipt-id>
```

**6. Verify — all three must pass:**
```sh
curl -s localhost:3000/payments/$ID | grep -o '"status":"[A-Z_]*"' | head -1   # COMPLETED
pnpm reconcile --all      # {"issues":[],"stuck":[]}
pnpm report               # your payment appears with gas + fees + realized spread
```

**7. Record the cost.** Copy the row from `pnpm report` into your tally. The
per-transaction cost model (§15) is the real deliverable — it is the number a
future provider conversation starts from.

---

## Logging each payment

Keep a running tally. Suggested columns:

| # | date | merchant | QR | amount IDR | USDC | tx hash | conversion ref | settlement ref | gas IDR | fee IDR | spread IDR |
|---|------|----------|----|-----------|------|---------|----------------|----------------|---------|---------|------------|
| 1 | | TOKO BERKAH | dynamic | 15000 | 0.876081 | 0x1a8e0e… | EX-P1 | QRIS-P1 | 0.01 | 320 | 77 |
| 2 | | KIOS DEWI | static | 12000 | 0.704865 | 0x7461a3… | EX-P2 | QRIS-P2 | 0.00 | 320 | 62 |

M5 closes at 20 payments across ≥5 distinct merchants, including both static
and dynamic QRIS, with zero silent failures (§15).

---

## When something goes wrong

**Every failure has a defined state and a defined exit. None of them is "retry
blindly".**

| what you see | what it means | what to do |
|---|---|---|
| `EXPIRED` | quote lapsed before you authorized | re-quote. Costs nothing. |
| `FAILED` | nothing left the wallet | safe to redo from step 2. |
| `RECONCILIATION_REQUIRED` | the system cannot prove the truth | **stop.** Investigate, then `pnpm operator resolve`. |
| `REFUND_REQUIRED` | USDC left the wallet but the merchant will not be paid | return the USDC on-chain, then `pnpm operator refund` (below) |
| `CRYPTO_SUBMITTED` and stuck | broadcast happened, confirmations unknown | re-run `execute` — it polls the recorded hash, never re-broadcasts |
| parse error | malformed or unsupported QR | record it, keep the payload, do not work around |

**Refunds.** §14.1: return the USDC to the source address minus documented
network cost. Send the USDC on-chain yourself, then report the tx hash — a
refund without on-chain evidence is refused:
```sh
pnpm operator refund <paymentId> --reference 0x<refund-tx-hash> --cost <usdc-micros>
```
The loss is booked explicitly and the books balance; the books never silently
absorb a discrepancy.

**Resolution is a decision, not a retry:**
```sh
pnpm operator resolve <paymentId> --to REFUND_REQUIRED --reason "merchant QR expired, refunding"
```
Unfunded intents may `FAILED` or retry `AUTHORIZED`; funded ones may only
`REFUND_REQUIRED` (history is append-only — nothing may walk back over the point
of no return).

---

## Weekly hygiene

```sh
crontab ops/reconcile.cron     # edit QRIS_WALLET_DIR first
```
Runs `reconcile --all` every 5 minutes; exits non-zero on any issue and POSTs to
`ALERT_WEBHOOK_URL` when set. A stuck manual leg pages you instead of aging
silently.

---

## Known gaps (do not pretend otherwise)

- **Phone-camera scanning has never been tested.** The parser is unit-tested and
  the PWA's camera code exists, but no one has pointed a real phone at a real
  merchant QR. Do that once early — it is the largest untested surface.
- **`MANUAL_IDR_PER_USDC` and the operator-reported rate are typed by hand.**
  The cost model is structurally correct but only as real as those numbers.
  Until a licensed off-ramp exists there is no way to automate this.
- **The per-payment lock is in-process only.** Two server instances could still
  race; a DB advisory lock is the fix when that matters.
- **§6.4 gate is not cleared.** No third party's money may touch this system
  until the legal checklist is done. A friend is a third party.
