# Brand: Qrib

**Decided:** 19 September 2026 · **Status:** provisional, pending trademark clearance

## Decision

The product is named **Qrib**. Primary domain target: `qrib.id` (verified unreachable
→ registrable at time of decision); `qrib.com` and `qrib.app` are taken by others.

## Why this name

Chosen against the confirmed intent in `PRD.md` §0 and the product principles in §3:

- **Reads as "QR"** — the name points at the actual interaction (scan a QRIS code),
  so it does not have to be explained.
- **Feels like a protocol/dapp** — the short, hard-consonant shape matches how web3
  products name themselves, which keeps the door open to §19 item 9 (ship the engine
  as infrastructure rather than only a consumer wallet).
- **Does not imitate "QRIS"** — QRIS is Bank Indonesia / ASPI payment-system
  infrastructure, not a generic term. A name that reads as a QRIS variant invites a
  trademark problem and muddies the §6.4 legal review. "Qrib" borrows the QR morpheme,
  not the QRIS mark.
- **Does not advertise crypto** — §3.2 says the user thinks in rupiah. An explicit
  "crypto/coin/token" name would push away the v1 cohort for no benefit; the web3
  character comes from the shape of the name, not from shouting "crypto".

## Rejected candidates

| Candidate | Why not |
|---|---|
| Lunas / Lunaskan | Strong meaning, but broad fintech usage → trademark collision risk; `.com`/`.app` taken |
| Saku | Very common; high collision risk in financial services |
| Qrypt | Puts crypto first, contradicting §3.2; reads as a crypto wallet, not a payment wallet |
| Qrisa | Too close to the QRIS mark — rejected on the same ground as the "imitate QRIS" rule |
| Rupchain | Most descriptive, but rigid and leans infrastructure-only, pre-empting §19 item 9 |
| Benang | Safest and most local, but the web3 character is too thin for the chosen direction |

## Not yet done (blocking, do before any public use)

- [ ] **Trademark search at DJKI** (dgip.go.id), classes **36** (financial services)
      and **42** (software). A free domain is not a free mark — this is the real gate.
- [ ] Confirm no conflicting crypto/fintech brand named "Qrib"
- [ ] Register `qrib.id` (+ `qrib.com` if purchasable)
- [ ] Legal review alongside the §6.4 gate

## Naming scope applied

- Renamed: package names, UI titles, PWA manifest, README, alert webhook source.
- **Not renamed:** SQL database names (`qris_wallet`) — the DB name is not the brand,
  and changing it breaks local volumes and existing connection strings for no gain.
- The local working directory is still `qris-wallet/`; the git repository name is set
  when a remote is created.
