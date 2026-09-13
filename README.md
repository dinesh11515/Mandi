# Mandi

**A human sets the rules. The agent spends the money. Every payment and every refusal lands on chain.**

Mandi is a procurement layer for autonomous agents: agents discover competing suppliers through ENS names, and a deterministic policy executor — the only thing holding the payment key — decides whether each call gets paid for, over x402 on Hedera.

- **Live console:** https://mandiserver-production.up.railway.app
- **Seller page:** https://mandiserver-production.up.railway.app/seller
- **Audit trail:** https://hashscan.io/testnet/topic/0.0.10454931
- **Names:** https://explorer.ens.dev/name/mandi.eth

Built solo for ETHOnline 2026 (Sept 4 to 16) by Dinesh. All code written during the event. Hedera testnet and the ENSv2 Sepolia beta throughout — nothing here touches mainnet.

## The problem

Giving an agent a credit card is the easy part. The hard part is that it then spends money in your name with nothing between its judgment and your balance: no cap it cannot talk its way past, no record of what it bought and why, and no way for you to prove afterwards which rules were in force when it paid.

The usual answer is a prompt — "don't spend more than $5" — which is a suggestion, not a control. And an agent that wants to buy something has no way to shop: no directory of services with prices it can read, no accreditation signal, no history of whether a given provider actually delivers.

So I split the decision from the recommendation. The agent is free to search, rank and argue for a supplier. It cannot pay. A separate module re-derives every fact from chain state, checks it against a policy the human signed with their own wallet, and either signs a payment or refuses with reasons. Both outcomes are anchored publicly.

> The agent can recommend a supplier. Only deterministic policy code can authorize the payment.

## What Mandi does — the demo loop

Five steps, both halves in a browser against the live deployment.

1. **A seller lists a service.** They connect MetaMask on `/seller`, sign a registration message, and the server mints `<label>.mandi.eth` on ENSv2 **to their wallet** and writes their price, capability and x402 endpoint into the resolver. The seller spends no ETH and never hands over a key.
2. **The seller proves they are human.** Selfie Check in World App, bound to the same wallet by a second signature, produces a verifier-signed attestation. That is the only thing a policy's accreditation requirement will accept.
3. **A buyer signs a mandate.** On the console they edit policy JSON — `maxPerCall`, `budgetTotal`, `minSuccessRate`, `requireVerifiedFor` — and sign its hash in MetaMask. The activation is anchored on HCS, so the rules are timestamped before any money moves.
4. **The buyer funds the agent from their own wallet.** MetaMask sends HBAR to the executor's Hedera account over the JSON-RPC relay. The executor may spend exactly that deposit for that signer, minus what it has already spent for them, and not a tinybar more.
5. **The agent runs the task.** It resolves every `*.mandi.eth` supplier, ranks them on accreditation, reliability and price, and asks the executor to authorize a purchase. The executor re-resolves the name itself, re-checks price, budget, funding, reliability and accreditation, pays per call over x402, and anchors a receipt and a decision. If the supplier fails, the payment is cancelled and the agent falls back to the next one. If nothing satisfies the policy, it refuses and says why.

## How it works

```
   MetaMask · seller wallet                 MetaMask · buyer wallet
   signs the registration message           signs the mandate, deposits HBAR
   EIP-191, no ETH spent                    chain 296 via the hashio relay
    └─────────────────────────┬───────────────┘
                              │
                       web/  (Vite + React, one page + /seller)
                              │ REST + SSE
┌─────────────────────────────▼──────────────────────────────────────────┐
│ server/  one Hono process                                              │
│                                                                        │
│  buyer/                              market/                           │
│  ┌──────────────┐  intent   ┌────────────────┐   402 / pay  ┌───────┐ │
│  │ agent.ts     │──────────►│ executor.ts    │─────────────►│x402.ts│ │
│  │ discovery,   │  decision │ only reader of │   @x402/fetch│ gate  │ │
│  │ preference,  │◄──────────│ BUYER_KEY      │              └───┬───┘ │
│  │ fallback     │           └───────┬────────┘                  │     │
│  └──────┬───────┘                   │ DECISION                  ▼     │
│         │ /directory /resolve       │            ┌────────────────┐   │
│  ┌──────▼───────┐           ┌───────▼────────┐   │ assess.ts      │   │
│  │ ens.ts       │           │ hedera.ts      │◄──│ risk-basic     │   │
│  │ ENSv2 Sepolia│           │ HCS topic +    │   │ risk-pro       │   │
│  │ via viem     │           │ mirror node    │   │ risk-pro-2     │   │
│  └──────────────┘           └───────┬────────┘   └───────┬────────┘   │
│  policy.ts   hash + wallet mandate  │ RECEIPT            │ Messari    │
│  sellers.ts  registration signature │                    │ subgraphs  │
│  funding.ts  deposits − spend       │ deposits           │            │
│  world.ts    Selfie Check signals   │                    │            │
└─────────────────────────────────────┼────────────────────┼────────────┘
                                      ▼                    ▼
                     Hedera testnet (HBAR settlement,    The Graph
                     HCS audit trail, buyer deposits)    (live TVL, utilization,
                                                          liquidations)
```

The boxes are modules, not processes. The arrow that carries the whole idea is the one from `agent.ts` to `executor.ts`: it carries an *intent* — a supplier name, a route, a policy hash — and nothing the executor is willing to take on trust. The executor resolves the name again, reads the price off ENS again, re-reads the funding ledger, and records every check it ran. `server/src/buyer/executor.ts` is the only file in the repo that reads `BUYER_KEY`.

The three seed suppliers are three rows in `server/src/config.ts`; sellers who register from the browser are appended to `server/data/sellers.json`. All of them are served by one handler behind one x402 middleware with per-route prices, so a "supplier" is a name plus records, not a deployment.

What the executor checks, in order, before it will sign:

| Check | Against |
|---|---|
| identity and chain | the `mandi:chain` record and the resolved endpoint |
| `maxPerCall` | the `mandi:price` record, re-read at decision time |
| remaining budget | the in-memory ledger for this policy hash, which a redeploy resets |
| funding | what this signer deposited, minus what has been spent for them |
| `minSuccessRate` | the reliability index, computed only from anchored receipts |
| `requireVerifiedFor` | a verifier-signed Selfie Check attestation |

Every check, passed or failed, is written into the `Decision` and anchored. Intents for one signer are serialized inside the executor, so two tabs on the same deposit cannot both be told the money is there.

### Where to look

Two packages, one server process, no build step for the server.

| Path | What is in it |
|---|---|
| `server/src/buyer/executor.ts` | Every policy check, and the only file that reads `BUYER_KEY` |
| `server/src/buyer/agent.ts` | Discovery, ranking, fallback. Can recommend, cannot pay |
| `server/src/buyer/policy.ts` | Canonical policy hashing, the mandate message, freshness and replay rules |
| `server/src/buyer/funding.ts` | The per-signer ledger: mirror-node deposits minus anchored spend |
| `server/src/market/x402.ts` | The `@x402/hono` gate and per-route pricing |
| `server/src/market/receipts.ts`, `reliability.ts` | Receipts off the topic, and the reliability index over them |
| `server/src/ens.ts` | ENSv2 Sepolia: subregistry, resolver, mint, records, directory |
| `server/src/sellers.ts` | Registration and Selfie Check signature verification, ownership, rate limits |
| `server/src/world.ts` | Selfie Check verification and verifier-signed attestations |
| `server/src/hedera.ts` | One SDK instance, HCS writes, mirror-node reads |
| `web/src/App.tsx`, `web/src/Seller.tsx` | The buyer console and the seller page |
| `server/test/` | 98 vitest cases, pure functions and injected dependencies, no network |

### The run, step by step

1. The agent plans the task (`Assess risk of Aave` → capability `financial-risk`, protocol `aave`), asks `/directory` for names, and resolves each name's ENSIP-26 and `mandi:*` records from ENSv2 Sepolia.
2. It ranks the candidates: accredited first, then success rate from receipts, then price. It submits a `PurchaseIntent {supplier, route, protocol, policyHash}` for the best one.
3. The executor resolves that name again — it does not trust the agent's copy — and runs every check in the table above, recording each one in a `Decision`.
4. On approval it calls the supplier endpoint. The supplier's gate answers 402 with HBAR requirements on `hedera:testnet`; `@x402/fetch` signs a Hedera transfer with the buyer key, but only inside the cap; Blocky402 verifies and settles; the handler runs; the response carries `PAYMENT-RESPONSE` with the transaction id.
5. The gate anchors `RECEIPT {supplier, route, amountHbar, txId, settled, fulfilled, latencyMs, policyHash}`. The executor anchors `DECISION {policyHash, supplier, status, reasons, priceHbar, signer, txId}`. The two join on `txId`, and `signer` is what the funding ledger sums as spend.
6. If the supplier fails after authorization, the payment is cancelled, the receipt records `fulfilled:false`, the reliability index absorbs the miss, and the agent moves to the next eligible supplier.
7. If no supplier passes, the run ends in `NO_ELIGIBLE_SUPPLIER` with every reason listed and nothing paid.

## Sponsor tracks

### Hedera — agentic payments over x402

Payments and the audit trail both run on Hedera testnet, settled through the **Blocky402** facilitator (`api.testnet.blocky402.com`, scheme `exact`, asset HBAR `0.0.0`).

- **The paid gate** is `server/src/market/x402.ts`: one `@x402/hono` middleware over every supplier route, quoting a different price for `/assess` and `/assess/deep`, computed from config at request time.
- **The payer** is `server/src/buyer/executor.ts`, using `@x402/fetch` and `@x402/hedera`. It signs a Hedera transfer only when the amount is inside the policy cap.
- **The buyer funds the agent from their own wallet.** MetaMask sends HBAR to the executor's account over the Hedera JSON-RPC relay (chain id 296, `https://testnet.hashio.io/api`). `GET /executor` publishes the account id and its EVM address; `GET /funding/:signer` publishes deposits, spend and what is left.
- **The per-signer funding ledger** is `server/src/buyer/funding.ts`. Deposits are read from the sender's own transaction history on the mirror node; spend is summed from anchored `DECISION` messages, which carry the `signer`. No deposit means no payment, and the refusal names the account to deposit into.
- **The audit trail** is `server/src/hedera.ts`: `POLICY_ACTIVATED`, `DECISION` (approved and rejected) and `RECEIPT` on one HCS topic. `RECEIPT` and `DECISION` join on the transaction id, so a payment can be traced back to the exact policy hash that authorized it. The reliability index is computed from those receipts and nothing else.
- **Discovery** reads the ENSv2 subregistry's `LabelRegistered` events and resolves through the universal resolver. When the RPC returns no logs — free public Sepolia RPCs prune receipts and cap log ranges — the directory verifies configured labels directly against the subregistry's `getResolver` and lists only names that exist on chain. The response says which path produced it in `source`.
- Agent identity here is the ENS name, not HCS-14. Saying that plainly so nobody reads more into it.

Proof:

- A settled x402 payment through Blocky402 testnet (fee payer `0.0.7162784`, buyer `0.0.10454835`): https://hashscan.io/testnet/transaction/0.0.7162784-1789025192-909232105 — its `DECISION` and `RECEIPT` are topic messages 7 and 8, joined by that transaction id.
- First paid call against the public URL, with live Aave data in the response: https://hashscan.io/testnet/transaction/0.0.7162784-1789194411-135984699
- First procurement executed by the deployed executor, policy anchored: https://hashscan.io/testnet/transaction/0.0.7162784-1789194436-844603129
- The topic itself: https://hashscan.io/testnet/topic/0.0.10454931 (messages 1 and 2 were emitted by the test suite before tests were isolated from `.env`; they carry no decisions).

### ENS — ENSv2 as the supplier registry

`server/src/ens.ts` talks to the live ENSv2 Sepolia beta contracts with viem: a `UserRegistry` subregistry for `mandi.eth` deployed through the `VerifiableFactory`, a `PermissionedResolver`, and parent registration through the v2 `ETHRegistrar` commit/register flow paid in the beta's MockUSDC.

- **Sellers mint their own names from a browser.** `server/src/sellers.ts` verifies an EIP-191 registration signature recovers the connected wallet, then the server — which holds the registrar role — mints `<label>.mandi.eth` **to the seller's wallet** with a minimal role bitmap. The seller spends no ETH and never hands over a key. `web/src/Seller.tsx` is the page.
- **Records in one multicall:** the two ENSIP-26 keys `agent-context` and `agent-endpoint[x402]` (x402 is a custom protocol tag the draft permits), plus clearly named custom keys `mandi:capability`, `mandi:price`, `mandi:chain`, `mandi:verified`, and `mandi:upstream` for a seller's own API URL. The `mandi:*` keys are my own, never described as ENSIP-26 fields.
- **The chain is the authority on ownership.** When no local row claims a label, the server reads the subregistry's `ownerOf` before minting and refuses a label owned by someone else. A new row is rolled back if the mint reverts. Registrations are rate limited — 20 an hour process-wide, 3 an hour per owner, HTTP 429 — so the registrar key cannot be drained by a script.
- **Ownership authorizes the sensitive routes.** Selfie Check for a name is refused unless the caller's wallet is the one on record as its owner.
- **Nothing is hard-coded.** Prices, endpoints and capabilities are read back from the records at decision time, and the executor resolves the name itself rather than trusting the agent.
- Not done: Enhanced Access Control per-seller roles on the shared resolver. The contracts support `authorizeNameRoles`; it is on the roadmap.

Proof:

- `mandi.eth` with its subregistry and resolver: https://explorer.ens.dev/name/mandi.eth · subregistry `0x1C1137d4Cf35c988461d708067d0b1663631B435` · resolver `0xb6F5434b108cdD21Dcd9Bf52D0557cA3929ca013`
- The three seed suppliers, records and all: https://explorer.ens.dev/name/risk-basic.mandi.eth · `risk-pro.mandi.eth` · `risk-pro-2.mandi.eth`
- A browser registration signed by a wallet that had never touched the app — `acme-risk.mandi.eth` minted to `0xAa11d2A8e49B41e2FDCc1130d1E243a730685261`: mint https://sepolia.etherscan.io/tx/0xa8cf557a378328fd11c5ca46bf058c15d50cf6522800a2cf1491cb40832e9799 · records https://sepolia.etherscan.io/tx/0x2eeed81b6d44e5a2f9abc45cac4df45ff6e9d7b7d10573b1dfe5c67f40e14fcb

### World — Selfie Check as an eligibility signal

`server/src/world.ts` runs Selfie Check against production World App (`environment: "production"`, `selfieCheckLegacy({ signal: sellerWallet })`) from `/seller`. Scan the QR from a laptop, or open the page inside World App where IDKit uses the native handoff. The server signs the request context with the RP signing key, forwards the proof to the v4 verify endpoint, checks the signal hash against the seller wallet, enforces one accreditation per human via a hashed nullifier, and issues a verifier-signed attestation bound to the ENS name and wallet with a 90-day expiry.

- **The signal is bound to the name's owner, and the owner has to prove it.** `POST /world/rp-signature` and `POST /world/verify` both take `{label, wallet, signature}` — an EIP-191 signature over the `Mandi Selfie Check` message (`selfieCheckMessage` in `server/src/sellers.ts`) — and reject anything that does not recover the wallet recorded as the name's owner. Knowing someone else's label and address is not enough to start or finish a check for their listing.
- **The executor enforces `requireVerifiedFor` against the attestation only.** Flipping `mandi:verified` on ENS by hand changes nothing, and the decision says so in its reason.
- **It has run for real.** A phone completed Selfie Check against production World App on Sept 13, 2026 at 08:25 IST for `risk-pro.mandi.eth`. The attestation on the live volume names wallet `0x0E5B063e058BB5dD45f3EE7ea34f2C87F7B15B6c`, issuer `0x9ae6D857C8d6165F592660E106C1a4d32B65A4C5`, expiry `1797044115`. So `requireVerifiedFor` passes for that name on evidence, not on a switch.
- Selfie Check is a medium-assurance credential. The attestation says a live human completed the check for this wallet. It is not Orb-grade uniqueness.

My build notes for the World team: [docs/WORLD_FEEDBACK.md](docs/WORLD_FEEDBACK.md).

### The Graph — live data behind the suppliers

`server/src/market/graph.ts` queries Messari standardized subgraphs on the decentralized network through Subgraph Studio: `aave-v3-ethereum`, `compound-v3-ethereum`, `morpho-aave-v3-ethereum` (lending schema) and `lido-ethereum` (generic schema).

`risk-basic` runs one query (protocol TVL, deposits, borrows). `risk-pro` runs three, adding daily financial snapshots and usage. The score in `server/src/market/assess.ts` is a deterministic function of utilization, TVL, TVL trend, liquidations and active users, and the raw numbers come back in `notes`. The claim is never that pro is more correct — only that it does more work per call and has a longer paid history.

Confirmed through paid calls on Sept 10: `Assess risk of Aave` returned TVL, utilization, available liquidity, an 8-day TVL trend, liquidations and active users from `messari/aave-v3-ethereum` (risk 10, low). `Assess risk of Morpho` scored the dormant `morpho-aave-v3-ethereum` market at risk 60, high, on $25k of TVL and a 100% drawdown.

## What actually works today

Verified live on Sept 10, 2026 from a laptop, again on Sept 12 from the public deployment, and again on Sept 13 for both wallet journeys with fresh throwaway wallets.

- **Real paid x402 calls on Hedera testnet**, settled through Blocky402, with the transaction ids linked above.
- **Three end-to-end runs**: a normal procurement (`risk-pro` chosen on its 100% record, paid, fulfilled); a forced failure (`risk-pro` timed out, payment cancelled, `risk-basic` rejected on a 50% success rate, `risk-pro-2` paid instead, 0.04 HBAR total); and a refusal (`maxPerCall` 0.01 HBAR, all three rejected with reasons, nothing paid).
- **Sellers minting their own ENSv2 names from MetaMask**, records written, name owned by their wallet — see the `acme-risk` transactions above.
- **A buyer funding the agent from MetaMask**: wallet `0xb956BBc2165AAaDD0808F76e3C79d55A8f0799AC` deposited 0.5 HBAR through the relay (https://hashscan.io/testnet/transaction/0.0.7314364-1789272651-049802745), signed the mandate, and the executor approved with the funding check passing and paid — topic `0.0.10454931` messages 57 to 59, payment https://hashscan.io/testnet/transaction/0.0.7162784-1789272694-931655682.
- **Selfie Check on a real phone** against production World App, attestation issued, `requireVerifiedFor` satisfied by it.
- **Failure semantics follow x402 v2.** In the `authorization` flow the facilitator settles only after a successful response, so a failed supplier call is cancelled rather than paid. The receipt records `settled:false, fulfilled:false`, the buyer loses nothing, and reliability still records the miss.
- **98 tests** (`pnpm test`): policy hashing, mandate freshness and replay, run tokens, registration signatures and rate limits, Selfie Check ownership proofs, executor decisions including the funding check and serialized runs, the funding ledger over mirror transfers and HCS decisions, the agent loop with fallback and refusal, reliability aggregation, subgraph scoring, supplier fail modes, attestations. Pure functions and injected dependencies only — no network in the suite.

## What does not work yet

Read this part before judging anything above.

- **The upstream API URL is informational.** A seller can give their own API URL and it is written to ENS as `mandi:upstream`, but in this build the Mandi-hosted x402 endpoint in `agent-endpoint[x402]` serves every call and my demo scorer answers it. Proxying a seller's real API is not wired up.
- **The run token is a session secret, not a signed intent.** One wallet signature activates the policy; the token that activation returns is what `/run` and `/intent` check afterwards, so whoever holds the token can spend inside the mandate until it expires. It lives only in the page and is never anchored. A wallet signature per run is the fix.
- **Reliability is not accuracy.** Receipts prove calls, failures, latency and cost. Nothing in Mandi measures whether a risk score was *right*. Outcome oracles are future work, and I never call this reputation.
- **Single process, reference executor.** Buyer and market code run in one Hono process. The executor's guarantee is a module boundary, not process isolation or custody infrastructure.
- **The funding ledger is derived, not held.** Deposits come from the mirror node; spend comes from anchored decisions; both are cached for 10 seconds with an in-process floor covering the gap between a payment and its appearance on the mirror node. It is an accounting view over chain data, not segregated custody — the deposits sit in the executor's own account.
- **The signature-gated Selfie Check has not been re-run on a phone.** The Sept 13 phone run predates the change that made `/world/rp-signature` and `/world/verify` demand an EIP-191 proof of the owner wallet. The new contract is unit-tested and exercised from the seller page, but no phone has walked the whole flow since.
- **No LLM in the loop.** Task planning is a keyword map and every decision is deterministic. An LLM "why this supplier" paragraph is a roadmap item and would never sit on the payment path.
- **Placeholder scores** come back only when `GRAPH_API_KEY` is missing, and they say so in `notes`.
- Nothing on chain is verified until `.env` holds funded Hedera testnet accounts and a funded Sepolia key. With an empty `.env` the server starts and the tests pass, and that proves nothing about the chain.

## Quick start

Node 22 and pnpm 11. The full environment reference is in [docs/SETUP.md](docs/SETUP.md) — this is the short path.

```bash
pnpm install
cp .env.example .env    # see docs/SETUP.md for every variable
cd server
pnpm exec tsx scripts/keygen.ts VERIFIER_KEY          # attestation signer, needs no funds
pnpm exec tsx scripts/hedera-account.ts BUYER         # funded buyer account from the operator
pnpm exec tsx scripts/hedera-init.ts                  # creates the HCS topic, checks the facilitator
pnpm exec tsx scripts/ens-setup.ts                    # resolver, subregistry, mandi.eth on ENSv2 Sepolia
```

Then the four scripts that make something happen:

```bash
pnpm exec tsx scripts/register-service.ts risk-basic  # mints <label>.mandi.eth and writes the records
pnpm dev                                              # server on :3000
pnpm exec tsx scripts/pay-once.ts risk-basic aave     # one real paid x402 call
pnpm exec tsx scripts/traffic.ts 5                    # real paid traffic, to build reliability history
```

And the console:

```bash
cd ../web && pnpm dev    # :5173, proxies /api to :3000
```

Two scripts drive the wallet journeys from a terminal with throwaway keys, so you can rehearse without MetaMask:

```bash
cd server
pnpm exec tsx scripts/seller-demo.ts acme-risk 0.0.1234 0.03    # signs the registration, mints the name
pnpm exec tsx scripts/buyer-demo.ts "Assess risk of Aave" 0.5   # seeds a wallet, deposits, signs, runs the task
```

Other commands: `pnpm test` (vitest), `pnpm typecheck` (both packages), `pnpm build` (web only).

### Using the live deployment

Both journeys work in a browser at https://mandiserver-production.up.railway.app. You need MetaMask; signatures are `personal_sign`, so **no Sepolia ETH is required** — the server pays gas for the mint and the records. To buy, you need test HBAR in that same account, and `cd server && pnpm exec tsx scripts/fund-evm.ts 0xYourAddress 5` seeds it from the operator. Selfie Check needs World App on a phone, and asks the same wallet for a second signature, so keep it connected.

On the console: activate the policy and sign the mandate, deposit from MetaMask, then type a task like `Assess risk of Aave` and watch discovery, eligibility, authorization, payment and receipts stream in. Read the refusals — a rejected decision lists every reason, and if `funding` is the one that failed, deposit more. A run that stops before its first event means the run token was refused; activate again.

## Roadmap

- A wallet signature per run, instead of a session run token.
- Production custody for the executor key, so deposits are not held in its own account.
- Proxying a seller's own upstream API behind the x402 gate, so `mandi:upstream` stops being informational.
- Enhanced Access Control per-seller record roles on the shared ENSv2 resolver.
- Outcome oracles, so reliability can one day include correctness — and A2A price negotiation between agents on top of it.
