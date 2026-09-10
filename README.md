# Mandi

The procurement layer for autonomous agents. Humans set the rules. Agents spend the money.

A human gives an agent a task, a budget, and a procurement policy. The agent discovers competing suppliers by resolving `*.mandi.eth` names on ENSv2, ranks them on accreditation, reliability and price, and asks a deterministic **policy executor** to authorize each purchase. Only the executor holds the payment key. It re-resolves the supplier, re-checks price, budget, reliability and human verification, and pays per call over **x402 on Hedera** through the Blocky402 facilitator. Every payment, every refusal, and the hash of the policy that authorized it lands on an **HCS topic**, so the spending and the mandate are auditable. When a supplier fails, the agent falls back to the next eligible one. When nothing satisfies the policy, the executor refuses to sign.

> The agent can recommend a supplier. Only deterministic policy code can authorize the payment.

Built solo for ETHOnline 2026 (Sept 4 to 16). All code written during the event.

## Architecture

```
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
│  policy.ts  hash + human signature  │ RECEIPT            │ Messari    │
│  world.ts   Selfie Check → attestation                    │ subgraphs  │
└─────────────────────────────────────┼─────────────────────┼───────────┘
                                      ▼                     ▼
                     Hedera testnet (HBAR settlement,    The Graph
                     HCS audit trail)                    (live TVL, utilization,
                                                          liquidations)
   ENSv2 Sepolia beta: <label>.mandi.eth subregistry, PermissionedResolver,
   ENSIP-26 agent-context / agent-endpoint[x402] + custom mandi:* records
   World ID Sandbox: Selfie Check → verifier-signed attestation bound to name + wallet
```

The boxes are modules, not processes. Three suppliers are three rows in `server/src/config.ts` served by one handler behind one x402 middleware with per-route prices. The executor is a module boundary: `server/src/buyer/executor.ts` is the only file that reads `BUYER_KEY`.

## Payment flow

1. The human edits the policy JSON and clicks **Activate**. The server canonicalizes it, hashes it, signs the mandate (EIP-191) and anchors `POLICY_ACTIVATED {policyHash, expiry, signer, signature}` on HCS.
2. The agent plans the task (`Assess risk of Aave` → capability `financial-risk`, protocol `aave`), asks `/directory` for names, and resolves each name's ENSIP-26 and `mandi:*` text records from ENSv2 Sepolia.
3. The agent ranks candidates: verifier-attested first, then success rate from receipts, then price. It submits a `PurchaseIntent {supplier, route, protocol, policyHash}` for the first candidate.
4. The executor independently resolves the name again, then runs the checks: identity and chain, `maxPerCall`, remaining budget, `minSuccessRate` against the reliability index, and `requireVerifiedFor` against a signed attestation. Every check is recorded in a `Decision`.
5. On approval the executor calls the supplier endpoint. The supplier's `@x402/hono` gate returns 402 with HBAR requirements on `hedera:testnet`; `@x402/fetch` signs a Hedera transfer with the buyer key, but only if the amount is within the cap; Blocky402 verifies and settles; the handler runs; the response carries `PAYMENT-RESPONSE` with the transaction id.
6. The gate writes `RECEIPT {supplier, route, amountHbar, txId, settled, fulfilled, latencyMs, policyHash}` to HCS. The executor writes `DECISION {policyHash, supplier, status, reasons, txId}`. The two join on `txId`.
7. If the supplier fails after authorization, the payment is cancelled (x402 authorization flow settles only after a successful response), the receipt records `fulfilled:false`, the reliability index absorbs the miss, and the agent moves to the next eligible supplier. If no supplier passes, the run ends in `NO_ELIGIBLE_SUPPLIER` with every reason listed and no payment made.

## Quick start

Prerequisites: Node 22, pnpm 11, a funded Hedera testnet account (portal.hedera.com), a funded Sepolia key, a Subgraph Studio API key, and for the World track an app in the World Developer Portal with World ID 4.0 enabled.

```bash
pnpm install
cp .env.example .env            # fill in the values below
cd server
pnpm exec tsx scripts/keygen.ts                      # HUMAN_KEY and VERIFIER_KEY
pnpm exec tsx scripts/hedera-account.ts BUYER        # funded buyer account from the operator
pnpm exec tsx scripts/hedera-init.ts                 # creates the HCS topic, checks the facilitator
pnpm exec tsx scripts/ens-setup.ts                   # resolver, subregistry, mandi.eth on ENSv2 Sepolia
pnpm exec tsx scripts/register-service.ts risk-basic # mints <label>.mandi.eth and sets the records
pnpm exec tsx scripts/register-service.ts risk-pro
pnpm exec tsx scripts/register-service.ts risk-pro-2
pnpm dev                                             # server on :3000
pnpm exec tsx scripts/pay-once.ts risk-basic aave    # one real paid x402 call
pnpm exec tsx scripts/traffic.ts 5                   # real paid traffic to build reliability history
cd ../web && pnpm dev                                # console on :5173, proxies /api to :3000
```

Run the tests with `pnpm test` (37 cases: policy hashing and activation, executor decisions, agent loop with fallback and refusal, reliability aggregation, subgraph scoring, supplier fail modes, World attestations).

### Environment

`.env.example` lists only what you must fill. Everything else has a default.

**Required for the core demo (Hedera payment + ENS identity)**

| Variable | What it is | How to get it |
|---|---|---|
| `PUBLIC_URL` | The URL agents pay. Written into every supplier's `agent-endpoint[x402]` record and used by `pay-once` and `traffic` | `http://localhost:3000` locally. After deploying, set it to the server URL and re-run `register-service` for each supplier |
| `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY` | Account that pays HCS fees and creates the topic | portal.hedera.com → create a testnet account → copy the account id and the ECDSA private key (hex or DER both work) |
| `SELLER_ACCOUNT_ID` | Where supplier payments land (`payTo`) | Use the operator id, or create a separate account with `scripts/hedera-account.ts SELLER` |
| `BUYER_ACCOUNT_ID`, `BUYER_KEY` | The executor's payment signer. Must differ from the seller | `pnpm exec tsx scripts/hedera-account.ts BUYER` creates and funds it from the operator and prints both lines |
| `HCS_TOPIC_ID` | Topic that holds receipts and decisions | Printed by `scripts/hedera-init.ts` |
| `SEPOLIA_RPC_URL` | Sepolia JSON-RPC. The public default rate-limits log scans | Free app on Alchemy or Infura → Sepolia HTTPS URL |
| `SEPOLIA_PRIVATE_KEY` | Deploys the resolver and subregistry, registers `mandi.eth`, mints subnames, writes records | Export from a throwaway MetaMask account or `scripts/keygen.ts SEPOLIA_PRIVATE_KEY`, then fund it with about 0.05 Sepolia ETH from the Google Cloud or Alchemy faucet |
| `ENS_SUBREGISTRY`, `ENS_RESOLVER`, `ENS_FROM_BLOCK` | Your subregistry, your resolver, and the block to scan registrations from | Printed by `scripts/ens-setup.ts` |
| `HUMAN_KEY` | Signs the policy mandate on activation. Needs no funds | `pnpm exec tsx scripts/keygen.ts` |
| `VERIFIER_KEY` | Signs supplier attestations after Selfie Check. Needs no funds. Without it every `requireVerifiedFor` check fails | Same `keygen` run |

**Required per sponsor track**

| Variable | Track | How to get it |
|---|---|---|
| `GRAPH_API_KEY` | The Graph, and the video. Without it suppliers return placeholder scores that say so in `notes` | thegraph.com/studio → API Keys → Create. The free allowance covers the demo |
| `WORLD_RP_ID`, `WORLD_SIGNING_KEY` | World. Signs each Selfie Check request and names the app to the verify endpoint | developer.world.org → your app → Enable World ID 4.0 → copy `rp_id` and the one-time signing key |
| `VITE_WORLD_APP_ID` (in `web/.env`) | World. The widget's app id | Same app page → App ID |

**Optional, with defaults**

| Variable | Default | When to set |
|---|---|---|
| `PORT` | `3000` | Hosts usually inject it |
| `WEB_DIST` | unset | `../web/dist` to serve the console from the server (the Dockerfile sets it) |
| `VITE_API_URL` (web) | `/api` | Empty for same-origin serving, or the server URL for a Vercel deploy |
| `X402_FACILITATOR_URL` | `https://api.testnet.blocky402.com` | Only to point at another facilitator |
| `HEDERA_NETWORK`, `HEDERA_MIRROR_URL` | `testnet`, `https://testnet.mirrornode.hedera.com` | Mainnet only |
| `ENS_PARENT_LABEL` | `mandi` | If `mandi` is taken on the beta |
| `SELLER_EVM_ADDRESS` | the Sepolia deployer | To mint subnames to a different seller wallet |
| `PAYTO_RISK_BASIC`, `PAYTO_RISK_PRO`, `PAYTO_RISK_PRO_2` | `SELLER_ACCOUNT_ID` | One Hedera account per supplier |
| `WORLD_ACTION` | `mandi-supplier-accreditation` | Keep stable; nullifiers are per action |
| `ATTESTATION_FILE` | `server/data/attestations.json` | A mounted volume path on the host |
| `UPSTREAM_TIMEOUT_MS` | `8000` | Client-side timeout for supplier calls |
| `MANDI_FAIL` | unset | Demo switch, e.g. `risk-pro:timeout` or `risk-basic:error`, makes a supplier fail after authorization |

Deploy with the root `Dockerfile` (Railway, Render, Fly) for a single URL, or deploy `web/` to Vercel with `VITE_API_URL` pointing at the server.

## Sponsor tracks

### Hedera: AI and agentic payments over x402

- Live x402-gated services on Hedera testnet, settled through the **Blocky402** facilitator (`api.testnet.blocky402.com`, scheme `exact`, asset HBAR `0.0.0`).
- The buyer agent completes real paid requests end to end with `@x402/fetch` and `@x402/hedera`.
- **Metering**: each supplier quotes a different price per route (`/assess` vs `/assess/deep`), computed from config at request time.
- **Discovery**: a capability directory built from the ENSv2 subregistry's `LabelRegistered` events, resolved through the universal resolver.
- **Audit trail on HCS**: `POLICY_ACTIVATED`, `DECISION` (approved and rejected) and `RECEIPT` messages on one topic. The reliability index is computed only from those receipts.
- Agent identity is the ENS name, not HCS-14. Said plainly here so nobody reads more into it.

### ENS: best use of ENSv2

- Built on the ENSv2 Sepolia beta with viem against the live contracts: a `UserRegistry` subregistry for `mandi.eth` deployed through the `VerifiableFactory`, a `PermissionedResolver`, and parent registration through the v2 `ETHRegistrar` commit/register flow paid in the beta's MockUSDC.
- **Agents as namespaces**: each supplier is `<label>.mandi.eth`, minted to the seller's wallet with a minimal role bitmap.
- Records: the two **ENSIP-26** keys `agent-context` and `agent-endpoint[x402]` (x402 is a custom protocol tag permitted by the draft), plus clearly named custom keys `mandi:capability`, `mandi:price`, `mandi:chain`, `mandi:verified`. The custom keys are never described as ENSIP-26 fields.
- Nothing is hard-coded: prices, endpoints and capabilities are read back from the records at decision time, and the executor resolves the name itself rather than trusting the agent.
- Not done: Enhanced Access Control per-seller roles on the shared resolver (the contracts support `authorizeNameRoles`; it is on the roadmap).

### World: Selfie Check as an eligibility signal

- A seller runs Selfie Check (World ID Sandbox, `environment: "sandbox"`, `selfieCheckLegacy({ signal: sellerWallet })`) from `/seller`. The server signs the request context with the RP signing key, forwards the proof to the v4 verify endpoint, checks the signal hash against the seller wallet, enforces one accreditation per human via a hashed nullifier, and issues a verifier-signed attestation bound to the ENS name and wallet with a 90-day expiry.
- The executor enforces `requireVerifiedFor` against that attestation only. Flipping `mandi:verified` on ENS by hand changes nothing; the decision says so in its reason.
- Feedback document: [docs/WORLD_FEEDBACK.md](docs/WORLD_FEEDBACK.md).

### The Graph: live data behind the suppliers

- Both supplier tiers query Messari standardized subgraphs on the decentralized network through Subgraph Studio: `aave-v3-ethereum`, `compound-v3-ethereum`, `morpho-aave-v3-ethereum` (lending schema) and `lido-ethereum` (generic schema).
- `risk-basic` runs one query (protocol TVL, deposits, borrows). `risk-pro` runs three (plus daily financial snapshots and usage). The score is a deterministic function of utilization, TVL, TVL trend, liquidations and active users, and the raw numbers appear in `notes`.
- The claim is never that pro is more correct, only that it does more work per call and has a longer paid history.

## Honesty notes

- **Single process, reference executor.** Buyer and market code run in one Hono process for the demo. The executor's guarantee is a module boundary, not process isolation or custody infrastructure.
- **Reliability is not accuracy.** Receipts prove calls, failures, latency and cost. Nothing measures whether a risk score was right. Outcome oracles are future work.
- **Failure semantics follow x402 v2.** In the `authorization` flow the facilitator settles after a successful response, so a failed supplier call is cancelled rather than paid. Receipts record `settled:false, fulfilled:false`. The buyer loses nothing on a failed call; reliability still records the miss.
- **Selfie Check is a low-assurance credential.** The attestation says a live human completed the check for this wallet. It is not a one-person-one-account guarantee.
- **Placeholder scores** are returned only when `GRAPH_API_KEY` is missing, and they say so in `notes`. Set the key before recording or judging.
- **No LLM in the loop.** Task planning is a keyword map and every decision is deterministic. An LLM explanation paragraph is a roadmap item and would never sit on the payment path.

## Status

| Verified locally (no keys) | Needs a funded `.env` |
|---|---|
| 402 challenges quote per-route HBAR prices with Blocky402 testnet's fee payer merged in | First settled paid call (`pay-once`), HashScan transfer |
| ENSv2 Sepolia reads: registrar availability and price for `mandi.eth`, universal-resolver resolution, `LabelRegistered` decoding | Resolver and subregistry deploys, parent registration, three subname mints, record writes |
| Policy hashing, mandate signing, expired and forged mandates rejected | `POLICY_ACTIVATED` anchored on HCS |
| Executor decisions (cap, budget, reliability, verification, identity) and the accept filter | `DECISION` and `RECEIPT` on HCS for a live run |
| Agent loop: cheapest eligible, verified-first, fallback, refusal, no-fallback stop | Reliability index from the mirror node after real traffic |
| Supplier fail modes, subgraph scoring, attestation issue and verify | Selfie Check on the Sandbox app; live subgraph numbers |
| Web console and `/seller` build; served from the server at one URL | Public deployment URLs |

## Roadmap

A2A price negotiation between agents · production custody for the executor key · EAC per-seller record roles on the shared resolver · browser-wallet signing of the mandate · an LLM "why this supplier" paragraph off the payment path · outcome oracles so reliability can one day include correctness.
