# PRD — Crypto Everyday Payment Wallet (v1)

**Status:** Draft v1.0 — derived from `CONTEXT_PACK.md` + confirmed intent interview
**Owner:** Solo founder
**Date:** 18 September 2026

---

## 0. Confirmed Intent

This PRD is downstream of an explicitly confirmed statement of intent. Everything below serves these six lines. If a decision in this document does not serve them, the decision is wrong, not the intent.

| | |
|---|---|
| **Outcome** | A payment wallet that spends USDC directly on real QRIS merchants: scan → confirm → paid. A payment wallet powered by crypto, not a crypto wallet with payments bolted on. |
| **User** | The founder first, then people like them: existing USDC holders who feel the exchange → sell → withdraw → bank → pay friction today. Mass-market Indonesians are the vision, not the v1 cohort. |
| **Why now** | The founder personally feels this friction as a crypto holder. No external deadline. |
| **Success** | A **correctness bar**, not a growth bar: N real, complete USDC→QRIS payments with zero silent state-machine failures. |
| **Constraint** | Solo, zero code, no licensed PJP or exchange partnership. v1 settles through a deliberately interim, capped mechanism. |
| **Out of scope** | Lending, NFTs, cards, multi-chain, bank/e-wallet payout, all-e-wallet support, in-app fiat onramp, custodial architecture, automated licensed settlement. |

**What this PRD is not:** a business plan, a fundraising deck, or legal advice. Section 6 and Section 18 contain the gates that must be cleared before this product touches anyone else's money.

---

## 1. Problem

A person in Indonesia holding 500 USDC cannot buy coffee with it.

To spend it, today they must:

```
USDC → exchange → sell → withdraw to bank → open bank app → scan QRIS → paid
```

Six steps, two apps, one withdrawal fee, and a delay measured in minutes-to-hours. The money is liquid, spendable-in-principle, and functionally stranded. The friction is bad enough that most holders simply don't spend stablecoin — they hold it, and spend IDR they got some other way.

The target experience is three steps:

```
Scan QRIS → Confirm → Paid
```

**What is actually hard here.** The wallet UI is not the hard part and is not the moat. The hard part is the orchestration underneath a single tap: quote, rate, fee, liquidity source, chain, gas, execution, fiat conversion, payment rail, settlement status, and reconciliation — any of which can fail independently, and several of which can fail *after* the user's crypto is already gone. A system that only handles the happy path is not a payment system.

---

## 2. Users

### 2.1 v1 user (the only one that matters now)

**The stablecoin holder who already wanted to spend it.** Holds USDC on a chain they chose themselves. Comfortable with wallets, addresses, and gas. Currently cashes out through an exchange when they need IDR and resents the round trip.

Starting cohort: the founder, dogfooding with their own funds.

### 2.2 Explicit non-users for v1

**Mass-market Indonesians with zero crypto.** They are the long-term vision and they are *not* the v1 audience, for a structural reason worth stating plainly: they have no USDC. Serving them requires a fiat→crypto onramp with KYC, which requires licensing and partnership that do not exist yet. Every hour spent on v1 features aimed at this group is an hour spent on a user who cannot use the product.

This is not a deferral of ambition. It is the recognition that the mass-market product is a *different product*, reachable only after the payment engine below is proven correct.

---

## 3. Product Principles

1. **Blockchain is the source of funds, not the settlement rail.** Indonesian merchants settle in IDR through payment infrastructure. Do not attempt to make merchants accept crypto.
2. **The user thinks in rupiah.** The user's intent is "bayar Rp27.500." Crypto amount, rate, and fee are consequences shown for confirmation, not decisions the user makes.
3. **Every state transition is idempotent and recorded.** `paid: boolean` is not a payment system.
4. **Providers are interfaces from day one.** The manual v1 implementation and a future licensed integration must satisfy the same contract.
5. **The internal ledger is the accounting truth.** The blockchain records that a transfer happened. It does not record that a user paid Rp50.000 to a merchant with a Rp500 fee. Double-entry, internally.
6. **Correctness before convenience, and before growth.** v1 ships when failures are handled, not when the UI is pretty.

---

## 4. v1 Scope

### 4.1 In scope

**Wallet**
- Create wallet (generate EOA, encrypted local keystore)
- Import wallet (seed phrase / private key)
- USDC balance on one chain
- Receive (display address + QR)
- Send (plain USDC transfer to an address)

**Payment**
- QRIS scan via camera
- QRIS payload parse (EMVCo TLV) → merchant name, merchant ID, amount if present
- Static vs dynamic QRIS handling (see §7.2)
- Quote: IDR amount → USDC amount, with rate, fee, and expiry
- Confirmation screen
- Payment execution with state tracking
- Payment status / live progress
- Receipt
- Transaction history

**Engine**
- Payment state machine with idempotent transitions (§8)
- Quote engine with hard expiry (§9)
- Provider abstraction + v1 implementations (§10)
- Double-entry internal ledger (§11)
- Reconciliation job: chain ↔ provider ↔ ledger (§14.3)
- Deterministic fault injection in staging (§14.2)

### 4.2 Out of scope for v1

Lending · NFTs · virtual/physical cards · multi-chain · multi-asset · bank transfer payout · e-wallet payout · in-app fiat onramp · custodial wallets · smart accounts / account abstraction · gas sponsorship · passkey auth · payment links · recurring payments · merchant dashboard · crypto-to-crypto payment · cross-border · public signup · third-party funds (gated, §6.4).

Smart accounts and gas abstraction are genuinely good ideas from `CONTEXT_PACK.md` §14 and they are deferred anyway: they improve UX for a user cohort v1 does not serve yet, and they add an infrastructure dependency a solo builder does not need while proving a state machine.

---

## 5. The One Thing v1 Must Prove

> A real payment intent, created from a real merchant QR, funded by real USDC, ending in a real IDR settlement to that merchant, with every intermediate state durable, idempotent, and reconciled — and with every failure mode either recovered automatically or surfaced as an explicit, actionable exception.

Everything in §4.1 exists to make that sentence testable.

---

## 6. Settlement Model for v1 — the interim mechanism

This section answers the open question from the interview: *what is the safest way to have real money in v1 without a licensed partner?*

### 6.1 The constraint nobody can engineer around

QRIS is Bank Indonesia payment-system infrastructure. Initiating a QRIS payment as a payer app requires being — or being sponsored by — a licensed payment service provider (PJP). A solo builder with no partnership **cannot** make their own app initiate a QRIS payment to a merchant. No amount of clever architecture changes this. Similarly, converting crypto to IDR as a service for other people is a regulated activity under the OJK framework (POJK 27/2024, per `CONTEXT_PACK.md` §17).

So "real money in v1" has exactly one honest shape.

### 6.2 Recommended model: **first-party assisted settlement**

**Rule: in v1, the only funds that move are the founder's own funds.**

The app orchestrates, prices, tracks, and reconciles a real payment. The two regulated legs — crypto→IDR conversion, and QRIS initiation — are executed by the founder personally, through accounts the founder already lawfully holds, and reported back into the app.

```
[ app ]  create payment intent from scanned QRIS
[ app ]  quote: IDR amount → USDC amount + fee + expiry
[ app ]  user confirms
[ app ]  on-chain USDC transfer  ← automated, real, verifiable
[ human] sell USDC for IDR on the founder's own exchange account
[ human] pay the merchant's QRIS from the founder's own licensed e-wallet/bank app
[ app ]  record settlement reference + proof, transition state, reconcile ledger
```

Every manual leg is wrapped in a provider implementation (`ManualOffRampProvider`, `ManualQrisSettlementProvider`) that satisfies the exact interface a licensed integration will later satisfy. The manual steps become app-driven tasks with required inputs: reference number, executed amount, executed rate, timestamp, receipt image.

### 6.3 Why this is the right call, not a compromise

- The success bar is **correctness**, and correctness is fully testable with first-party funds. Demand was never the risk; orchestration was.
- It produces the real artifact the next stage needs: a working engine, and a measured per-transaction cost model (trading fee + withdrawal fee + gas + spread), which is exactly what you bring to a provider conversation.
- It keeps the regulatory surface at approximately zero, because no third party's money is ever held, converted, or transmitted.
- It stress-tests the provider abstraction against a *genuinely different* implementation, which is the best possible proof the abstraction is real and not decorative.

The manual legs are slow and unscalable. That is fine and deliberate: v1's constraint is licensing, not throughput, and manual execution forces every state transition to be explicit, resumable, and auditable — which is exactly the property the automated version will need.

### 6.4 The gate — do not cross without clearing it

**Hard rule: the moment funds belong to someone who is not you, this model stops being available.**

Before any third party's money enters the system, all of the following must be true:

- [ ] Indonesian fintech/payments legal review completed on the specific activity, money flow, and custody boundary
- [ ] Regulatory classification of the activity determined (crypto side and payment side, separately)
- [ ] Licensed partner arrangements identified for conversion and for IDR settlement
- [ ] KYC / AML responsibility explicitly assigned to a named party
- [ ] Consumer-protection, refund, and dispute processes documented
- [ ] Custody boundary documented: who holds what, when, and under what agreement

A friend is a third party. A closed beta of ten known users is third parties. Charging no fee does not change the analysis. This checklist is not legal advice — it is the list of things the founder must take to a lawyer.

---

## 7. Core Flows

### 7.1 Primary flow — QRIS payment

```
Open app
   ↓
Scan QRIS (camera)
   ↓
Parse payload → merchant name, merchant ID, amount?
   ↓
[static QR] user enters amount
   ↓
POST /payments/quote  → cryptoAmount, rate, fee, expiresAt
   ↓
Confirmation screen: merchant · Rp amount · USDC amount · fee · countdown
   ↓
User confirms → sign transaction
   ↓
CRYPTO_SUBMITTED → poll → CRYPTO_CONFIRMED
   ↓
CONVERSION_PENDING     (manual leg: sell USDC → IDR, record ref)
   ↓
FIAT_SETTLEMENT_PENDING (manual leg: pay merchant QRIS, record ref + proof)
   ↓
COMPLETED → receipt
```

The user sees a single progress view with human-readable stages. They never see raw state names.

### 7.2 Static vs dynamic QRIS

| | Static QRIS | Dynamic QRIS |
|---|---|---|
| Amount in payload | No | Yes |
| User action | Enters amount manually | Confirms only |
| v1 support | **Yes** | **Yes — parse and display** |

Both are parsed. The target "scan → amount detected → pay" experience only exists with dynamic QR, so the UI must handle the static case gracefully rather than treating it as an error: show merchant, prompt for amount, proceed.

### 7.3 Wallet flows

- **Create:** generate keypair → encrypt with user passphrase → store in device keystore → display seed phrase with a forced confirmation step.
- **Import:** seed phrase or private key → same encryption path.
- **Receive:** address + QR + explicit chain + asset warning ("USDC on Base only").
- **Send:** address, amount, gas estimate, confirmation.

### 7.4 Recovery

v1 is non-custodial: lose the seed, lose the funds. The app states this in plain language at creation and does not pretend otherwise. No account recovery, no support backdoor — because a backdoor is custody, and custody is §6.4.

---

## 8. Payment State Machine

### 8.1 States

```
CREATED
   ↓
QUOTED                    quote locked, expiry running
   ↓
AUTHORIZED                user confirmed before expiry
   ↓
CRYPTO_SUBMITTED          tx broadcast, hash known
   ↓
CRYPTO_CONFIRMED          N confirmations reached
   ↓
CONVERSION_PENDING        USDC → IDR leg in progress
   ↓
FIAT_SETTLEMENT_PENDING   IDR → merchant leg in progress
   ↓
COMPLETED
```

Terminal / exception states:

```
EXPIRED                   quote expired before authorization
FAILED                    failed before any crypto left the wallet
REFUND_REQUIRED           crypto left the wallet, settlement will not complete
REFUNDED                  funds returned, ledger balanced
RECONCILIATION_REQUIRED   system cannot determine truth without human review
```

### 8.2 Rules

- **Every transition is idempotent.** Replaying a transition with the same idempotency key is a no-op returning the current state, never a double action.
- **Every transition is persisted before its side effect**, and every side effect carries an idempotency key the provider honours.
- **No transition is inferred from absence.** A missing webhook is not a failure; it is an unknown, and unknowns age into `RECONCILIATION_REQUIRED`, never into `FAILED`.
- **Forward-only**, except into exception states. No path returns to `QUOTED`.
- **`CRYPTO_CONFIRMED` is the point of no return.** Before it, failure is cheap: fail and stop. After it, failure is expensive: the only exits are `COMPLETED`, `REFUNDED`, or `RECONCILIATION_REQUIRED`. There is no state in which the system has taken the user's crypto and simply stopped.

### 8.3 Timeouts

Each non-terminal state carries a max dwell time. Exceeding it raises an alert and moves the intent into review — it does not silently retry forever.

| State | Timeout | On breach |
|---|---|---|
| `QUOTED` | 90s | → `EXPIRED` |
| `CRYPTO_SUBMITTED` | 10 min | alert; keep polling; stuck-tx runbook |
| `CONVERSION_PENDING` | 30 min | alert → manual review |
| `FIAT_SETTLEMENT_PENDING` | 30 min | alert → manual review |

---

## 9. Quote Engine & FX Risk

### 9.1 Quote

```http
POST /payments/quote
```

```json
{ "asset": "USDC", "fiatAmount": "27500", "currency": "IDR", "method": "QRIS", "merchantId": "..." }
```

```json
{
  "paymentId": "pay_...",
  "asset": "USDC",
  "cryptoAmount": "1.74",
  "fiatAmount": "27500",
  "rate": "15988",
  "spreadBps": 50,
  "fee": { "crypto": "0.02", "fiat": "320" },
  "expiresAt": "2026-09-18T07:21:30Z"
}
```

### 9.2 Policy

- **Hard expiry, enforced server-side.** An expired quote cannot be authorized, period. The client countdown is a courtesy; the server is the authority.
- **Locked at authorization.** The rate the user confirmed is the rate that settles, or the payment does not settle.
- **Spread buffer.** Quoted rate = reference rate − spread. v1 spread is a config value, initially sized to cover observed conversion cost + volatility over the quote window. The spread exists to make quote expiry survivable, not to make margin.
- **Rate source:** reference IDR/USDC rate polled from the exchange actually used for the conversion leg, not a global index — pricing against a rate you cannot execute is how quote liability appears.

### 9.3 Who bears FX risk — v1 answer

**The founder, on their own funds, capped by quote expiry and a per-transaction limit.** This is acceptable precisely because §6.2 keeps all funds first-party. It is *not* a model that survives contact with third-party funds: at that point FX risk becomes a liability to someone else, and §6.4 applies.

Per-transaction cap and daily cap are enforced in code, not policy: `MAX_PAYMENT_IDR` and `MAX_DAILY_IDR`, small by default.

---

## 10. Provider Abstraction

Provider-agnostic from the first commit. The point is that swapping the manual implementation for a licensed one is a wiring change, not a rewrite.

```typescript
interface OffRampProvider {
  quote(input: QuoteInput): Promise<Quote>
  execute(input: ExecuteInput): Promise<Settlement>
  getSettlement(id: string): Promise<SettlementStatus>
}

interface PaymentProvider {
  createPayment(input: PaymentInput): Promise<Payment>
  getPayment(id: string): Promise<PaymentStatus>
}
```

| Environment | OffRamp | Payment |
|---|---|---|
| Local / test | `MockOffRampProvider` | `MockQrisProvider` |
| Staging (fault injection) | `FaultyOffRampProvider` | `FaultyQrisProvider` |
| v1 production | `ManualOffRampProvider` | `ManualQrisSettlementProvider` |
| Future | `RealOffRampProvider` | `RealQrisProvider` (PJP) |

The manual providers implement the same interface, backed by an operator task queue: `execute()` creates a task and returns pending; a signed operator action supplies the reference and completes it. Everything downstream — the state machine, the ledger, the reconciler — cannot tell the difference. That is the test.

---

## 11. Data Model

### 11.1 v1 tables

```
users
wallets
wallet_addresses
assets

blockchain_transactions
payment_intents
payment_quotes
payment_attempts

conversions            (off-ramp leg: crypto → IDR)
fiat_settlements       (payment leg: IDR → merchant)
merchants              (parsed from QRIS)

operator_tasks         (manual legs, v1 only)
webhook_events
ledger_entries
idempotency_keys
```

Deferred to post-v1: `beneficiaries`, `bank_accounts`, `ewallet_accounts`, `payouts`.

### 11.2 Ledger

Double-entry, internal, authoritative for accounting.

The chain says: *transfer 1.74 USDC, tx 0xabc, confirmed.*
The ledger says: *user A paid Rp27.500 to merchant M for payment pay_x, cost Rp320 in fees, at rate 15988, funded by 1.74 USDC.*

These are different facts and the second one is the business. Every payment produces balanced entries across user balance, merchant settlement, fees, and spread. Reconciliation (§14.3) asserts the ledger, the chain, and the provider records agree — and an unreconciled payment is an incident, not a rounding difference.

---

## 12. API Surface (v1)

```http
POST   /payments/quote
POST   /payments/:id/authorize
POST   /payments/:id/execute
GET    /payments/:id
GET    /payments
POST   /payments/:id/cancel

GET    /wallet/balance
POST   /wallet/send

POST   /qris/parse

POST   /internal/tasks/:id/complete      (operator, signed)
POST   /webhooks/:provider               (signature-verified)
```

Every mutating endpoint requires an `Idempotency-Key` header and returns the same result on replay.

---

## 13. Security (v1 minimum)

**Authentication**
- Device-local encrypted keystore; passphrase or biometric unlock
- Session management with short-lived tokens
- Re-authentication required for transaction authorization

**Wallet**
- Key material never leaves the device unencrypted, never transmitted, never logged
- Transaction simulation before signing
- Nonce management and replay protection
- Spending limits enforced server-side as well as client-side

**Payment**
- Idempotency on every mutating operation
- Server-enforced quote expiry
- Webhook signature verification, timestamp checks, replay rejection
- Reconciliation as a scheduled job, not a manual habit
- Full audit trail: every state transition records actor, timestamp, reason, and prior state

**Operational**
- Secrets in a secret manager, never in the repo
- Structured logs with PII and key material redacted
- Alerting on: any `RECONCILIATION_REQUIRED`, any state dwell-time breach, any ledger imbalance

---

## 14. Failure Handling

The pack flagged questions 12–15 as the important ones. They are answered here, because the happy path is not the product.

### 14.1 Named failure modes and required responses

| Failure | Response |
|---|---|
| **Crypto confirmed, fiat settlement fails** | → `REFUND_REQUIRED`. Refund the USDC to the source address minus documented network cost, from a designated refund path. Never leave the user paid-but-not-paid. This is the single most important path in the system. |
| **Quote expires after user signs** | The rate locked at `AUTHORIZED` holds. The signed transaction is honoured at the locked rate; the spread absorbs the drift. If drift exceeds the spread beyond a configured tolerance, settle anyway and record the loss — do not renege on a confirmed payment. |
| **Crypto tx stuck / underpriced** | Stuck-tx runbook: monitor, replace-by-fee where supported, alert after timeout. Do not double-send. |
| **Chain reorg after `CRYPTO_CONFIRMED`** | Require N confirmations appropriate to the chain before advancing. On reorg detection, move to `RECONCILIATION_REQUIRED` and halt downstream legs. |
| **Duplicate webhook** | Idempotent by event ID; second delivery is a logged no-op. |
| **Provider outage / RPC failure** | Retry with backoff, circuit-break, fail forward into review rather than into a false terminal state. |
| **Partial settlement** | Never assume completion from partial evidence. Record the partial, flag for reconciliation. |
| **Wrong merchant / wrong amount** | Prevention: confirmation screen shows parsed merchant name and amount prominently. There is no post-hoc undo on a settled QRIS payment; the app must make the pre-confirmation moment clear. |
| **Payment sent, app crashes mid-flow** | State is durable server-side. On relaunch, the app resumes the intent from its persisted state. Nothing lives only in memory. |

### 14.2 Fault injection (staging)

Failures that cannot be triggered safely with real money must be triggered deliberately in staging: settlement failure, duplicate webhooks, reorg, provider timeout, expired quote at authorization, partial settlement, operator task abandoned mid-flow. Each has a test that asserts the resulting state and the resulting ledger balance.

### 14.3 Reconciliation

A scheduled job asserts, for every payment in a window:

1. Every `blockchain_transactions` row has a matching intent and a confirmed on-chain receipt
2. Every conversion has a provider record with matching amount and rate
3. Every settlement has a reference and matching fiat amount
4. Ledger entries balance to zero per payment and in aggregate

Any mismatch → `RECONCILIATION_REQUIRED` + alert. A payment system without reconciliation is a payment system that is wrong and does not know it.

---

## 15. Success Criteria

MVP is validated when all of the following hold. No user-count or volume target appears here by design.

**Primary (gating):**
- [ ] **20 real end-to-end payments** completed: scan → quote → confirm → on-chain → conversion → settlement → receipt
- [ ] Across **≥5 distinct real merchants**
- [ ] Including **both static and dynamic QRIS**
- [ ] **Zero silent failures** — every non-`COMPLETED` intent sits in a correct, explicit, actionable state with a recorded reason
- [ ] **100% ledger reconciliation** — every payment balances against chain and provider records
- [ ] **Zero unrecoverable states** — no intent where crypto left the wallet and the system cannot say what happened to it

**Secondary (informational, non-gating):**
- [ ] All §14.2 fault-injection tests pass in staging
- [ ] Per-transaction cost model measured: gas + trading fee + withdrawal fee + realised spread
- [ ] Median time from confirm → merchant paid, recorded across all 20

That cost model is the real byproduct: it is the number that determines whether this is a business, and it is the number a future provider conversation will start from.

---

## 16. Milestones

| | Milestone | Done when |
|---|---|---|
| **M0** | Foundation | Repo, Postgres + Drizzle schema, migrations, CI, structured logging |
| **M1** | Wallet | Create, import, balance, receive, send USDC on one chain. Real testnet transfer works end to end. |
| **M2** | Engine (mocked) | Payment intent, quote + expiry, full state machine, idempotency, ledger, mock providers, fault-injection suite green |
| **M3** | QRIS | Camera scan, EMVCo TLV parser, static + dynamic handling, merchant display, confirmation UI, receipt |
| **M4** | Real first-party payment | Manual providers + operator task queue wired. **First real payment with founder's own money completes end to end.** |
| **M5** | Correctness bar | §15 primary criteria met across 20 real payments |

M2 before M3 is deliberate: the engine is the product and the scanner is an input to it. Building the scanner first produces a demo, not a payment system.

Post-M5 is a decision point, not a milestone: either pursue provider/licensing conversations with a working engine and a real cost model, or don't — but that choice is made with evidence rather than speculation.

---

## 17. Technical Decisions

Stack, inherited from `CONTEXT_PACK.md` §5 with solo-scoping applied:

| Layer | Choice | Note |
|---|---|---|
| Frontend | Next.js | Camera access requires HTTPS; plan for a mobile-web-first PWA |
| Backend | Hono | Single service in v1 — do not split wallet/payment services yet |
| Database | PostgreSQL | Authoritative for state and ledger |
| ORM | Drizzle | |
| Chain | **One EVM chain with native USDC and low fees** | Single chain. Multi-chain is a §4.2 non-goal. |
| Chain lib | viem (+ wagmi if connecting external wallets) | |
| Infra | Docker | |
| Cache | **Redis deferred** | Quote locks, idempotency keys, and task queues all fit in Postgres at v1 volume. Add Redis when a measurement demands it, not before. |

**Deferred on purpose:** microservice split, Redis, smart accounts / ERC-4337, gas sponsorship, passkeys, multi-chain abstraction. Each is defensible later and each is a dependency a solo builder does not need while proving a state machine.

---

## 18. Open Questions

From `CONTEXT_PACK.md` §23, with v1 answers and the ones still open.

**Answered for v1:**

| # | Question | v1 answer |
|---|---|---|
| 1 | Custodial or non-custodial? | Non-custodial |
| 2 | Who converts crypto → IDR? | Founder, own exchange account, own funds (§6.2) |
| 3 | Who receives crypto? | The founder's own wallet — no third-party funds |
| 4 | Who settles IDR? | Founder, own licensed e-wallet/bank app |
| 6 | Does the company hold user fiat? | No |
| 7 | Does the company hold user crypto? | No |
| 8 | Who does KYC? | N/A in v1 — first-party only. Blocking question at §6.4 |
| 10 | How do refunds work? | §14.1, return to source address |
| 11 | Failed payments? | §8, §14.1 |
| 12 | Crypto confirmed, fiat failed? | `REFUND_REQUIRED` → `REFUNDED` (§14.1) |
| 13 | Quote expired after signing? | Locked rate honoured, spread absorbs (§14.1) |
| 14 | Who bears FX risk? | Founder, own funds, capped (§9.3) |
| 15 | Reconciliation? | §14.3 |

**Still open — must be answered before §6.4 is cleared:**

- **(5)** Which PJP / payment provider, and on what terms?
- **(9)** Who performs AML transaction monitoring?
- **(16)** What is the regulatory classification of the intended activity — assessed on the concrete money flow, not the product name?
- Which OJK-regulated venue for the conversion leg, and what are its API and settlement characteristics?
- What entity structure is required before any third-party funds?

---

## 19. Roadmap After v1

Strictly gated on §15 and §6.4, in roughly this order:

1. Real off-ramp provider integration (replacing `ManualOffRampProvider`)
2. Real QRIS settlement via PJP partnership (replacing `ManualQrisSettlementProvider`)
3. Limited real pilot with third-party users, full monitoring, hard caps
4. Bank transfer payout
5. E-wallet payout
6. Smart account + gas abstraction
7. Multi-chain / multi-asset behind a single displayed balance, with a payment router selecting the funding source
8. Fiat onramp + KYC — the unlock for the mass-market user in §2.2
9. Merchant/API product: the same engine exposed as crypto-to-fiat payment infrastructure

Item 9 is worth flagging: `CONTEXT_PACK.md` §20 is right that the engine, not the wallet UI, is the valuable asset. v1 builds that engine either way. Whether it eventually ships as a consumer wallet or as infrastructure is a decision that does not need to be made now, and is better made with a working engine in hand.

---

## Appendix A — What the interview changed

| `CONTEXT_PACK.md` said | This PRD says | Why |
|---|---|---|
| Target: everyday payments for general users | v1 targets existing USDC holders only | Mass-market users have no USDC; serving them needs an onramp + KYC that doesn't exist yet |
| Prototype uses mock fiat, mock QRIS, mock off-ramp | v1 moves **real money** via first-party assisted settlement | Confirmed intent: real startup, real money — but licensing reality forces the first-party constraint |
| Non-custodial recommended | Non-custodial, and no recovery backdoor | A backdoor is custody, and custody triggers §6.4 |
| Smart account / AA "where appropriate" | Deferred entirely | Improves UX for a cohort v1 doesn't serve; adds dependency a solo builder doesn't need |
| Redis in the stack | Deferred | Postgres is sufficient at v1 volume |
| Success implicitly = working prototype | Success = 20 clean real payments, 0 silent failures, 100% reconciliation | Confirmed intent: correctness bar, not growth bar |

---

## Appendix B — Legal Notice

This document is a product specification written by a non-lawyer. It contains no legal advice. Indonesian crypto activity sits under the OJK framework and payment-system activity sits under Bank Indonesia, and classification depends on the concrete flow of funds and the roles of each party — not on how a product describes itself. Section 6.4 must be cleared with qualified Indonesian counsel before this system handles any funds that are not the founder's own.
