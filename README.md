# Mandi

The procurement layer for autonomous agents. Humans set the rules. Agents spend the money.

A human gives an agent a task, a budget, and a procurement policy. The human connects MetaMask, signs the policy mandate with that wallet, and deposits HBAR from it into the executor's Hedera account, so the agent spends the human's money and nothing else. The agent discovers competing suppliers by resolving `*.mandi.eth` names on ENSv2 — names the sellers mint themselves from the browser by signing a registration message — ranks them on accreditation, reliability and price, and asks a deterministic **policy executor** to authorize each purchase. Only the executor holds the payment key. It re-resolves the supplier, re-checks price, the remaining budget, the funding that signer deposited, reliability and human verification, and pays per call over **x402 on Hedera** through the Blocky402 facilitator. Every payment, every refusal, and the hash of the policy that authorized it lands on an **HCS topic**, so the spending and the mandate are auditable. When a supplier fails, the agent falls back to the next eligible one. When nothing satisfies the policy, the executor refuses to sign.

> The agent can recommend a supplier. Only deterministic policy code can authorize the payment.

Built solo for ETHOnline 2026 (Sept 4 to 16). All code written during the event.

## Architecture

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
   ENSv2 Sepolia beta: <label>.mandi.eth subregistry, PermissionedResolver,
   ENSIP-26 agent-context / agent-endpoint[x402] + custom mandi:* records
   World ID Sandbox: Selfie Check → verifier-signed attestation bound to name + wallet
```

The boxes are modules, not processes. The three seed suppliers are three rows in `server/src/config.ts`; sellers who register from the browser are appended to `server/data/sellers.json`. All of them are served by one handler behind one x402 middleware with per-route prices. The executor is a module boundary: `server/src/buyer/executor.ts` is the only file that reads `BUYER_KEY`.

## Payment flow

1. A seller connects MetaMask on `/seller`, fills the form, and signs the registration message (`Mandi seller registration`, name, owner, payTo, price, capability; exact text in `server/src/sellers.ts`). The server checks that the signature recovers the connected wallet, mints `<label>.mandi.eth` **to that wallet** using its registrar role on the subregistry, and writes the records in one multicall: `agent-context`, `agent-endpoint[x402]`, `mandi:capability`, `mandi:price`, `mandi:chain`, plus `mandi:upstream` when the seller supplied an upstream URL.
2. The human connects MetaMask on the console, edits the policy JSON and clicks **Activate**. The server canonicalizes and hashes the policy; the browser signs `Mandi policy <hash> valid until <expiry>` (EIP-191); the server checks that the signature recovers the given signer and anchors `POLICY_ACTIVATED {policyHash, expiry, signer, signature}` on HCS. `HUMAN_KEY` signs only when no wallet signature is supplied, which is how the scripts work.
3. The human deposits HBAR from the same MetaMask account to the executor's Hedera account, on Hedera testnet (chain id 296, JSON-RPC relay `https://testnet.hashio.io/api`). That transfer, read back from the mirror node, is the only money the executor may spend for that signer.
4. The agent plans the task (`Assess risk of Aave` → capability `financial-risk`, protocol `aave`), asks `/directory` for names, and resolves each name's ENSIP-26 and `mandi:*` text records from ENSv2 Sepolia.
5. The agent ranks candidates: verifier-attested first, then success rate from receipts, then price. It submits a `PurchaseIntent {supplier, route, protocol, policyHash}` for the first candidate.
6. The executor independently resolves the name again, then runs the checks: identity and chain, `maxPerCall`, remaining budget, **funding** (what this signer deposited minus what has already been spent for them), `minSuccessRate` against the reliability index, and `requireVerifiedFor` against a signed attestation. Every check is recorded in a `Decision`.
7. On approval the executor calls the supplier endpoint. The supplier's `@x402/hono` gate returns 402 with HBAR requirements on `hedera:testnet`; `@x402/fetch` signs a Hedera transfer with the buyer key, but only if the amount is within the cap; Blocky402 verifies and settles; the handler runs; the response carries `PAYMENT-RESPONSE` with the transaction id.
8. The gate writes `RECEIPT {supplier, route, amountHbar, txId, settled, fulfilled, latencyMs, policyHash}` to HCS. The executor writes `DECISION {policyHash, supplier, status, reasons, priceHbar, signer, txId}`. The two join on `txId`, and the `signer` field is what the funding ledger sums as spend.
9. If the supplier fails after authorization, the payment is cancelled (x402 authorization flow settles only after a successful response), the receipt records `fulfilled:false`, the reliability index absorbs the miss, and the agent moves to the next eligible supplier. If no supplier passes, the run ends in `NO_ELIGIBLE_SUPPLIER` with every reason listed and no payment made.

## Using it

Both journeys run in a browser against the live deployment. What you need first:

- **MetaMask** in the browser. Signatures are `personal_sign` (EIP-191): nothing is broadcast on Sepolia from your wallet and **no Sepolia ETH is required** — the server pays the gas for the mint and the records.
- **Test HBAR in that same MetaMask account** if you are going to buy. The deposit runs on Hedera testnet (chain id 296); MetaMask is asked to add or switch to it when you click deposit. Seed the account from the operator with `cd server && pnpm exec tsx scripts/fund-evm.ts 0xYourAddress 5`, which also prints the Hedera account id the mirror node assigns to it.
- **World App on a phone** only for the seller's Selfie Check step.

### Seller: list a service under `mandi.eth`

1. Open `/seller` and connect your wallet (Step 0). The connected address is the wallet that will own the name.
2. Fill Step 1: name (1 to 16 chars, lowercase letters, digits, hyphens), tier `basic` or `pro`, price per call in HBAR, the Hedera account payments should land in (`0.0.x`), capability, an optional upstream API URL, and a one-line description that becomes the `agent-context` record.
3. Click **Sign & register** and sign the registration message in MetaMask. The page then links the mint transaction and the records transaction on Sepolia Etherscan, the name on the ENS explorer, and lists every record it wrote.
4. Step 2, Selfie Check: scan the QR with World App, or open the page inside World App. Only the wallet that owns the name can ask for a signed request or submit a proof. On success the server issues a verifier-signed attestation bound to the name and the wallet and sets `mandi:verified` on ENS.
5. Your name now shows up in `/directory` and in the console's supplier list, and a buyer policy that requires accreditation for your capability can pick you.

### Buyer: hire one

1. Open the console at `/` and connect your wallet.
2. Edit the policy JSON (`maxPerCall`, `budgetTotal`, `minSuccessRate`, `requireVerifiedFor`) and click **Activate**, then sign the mandate in MetaMask. The panel shows the policy hash and the HashScan link to the anchored activation.
3. Enter an amount and click **Deposit from MetaMask**. MetaMask switches to Hedera testnet and sends HBAR to the executor's account; the funding panel then shows deposited, spent and available once the mirror node catches up (a few seconds).
4. Type a task (`Assess risk of Aave`) and click **Run**. Discovery, eligibility, preference, authorization, payment and receipt stream in, each authorization listing every check with its detail, each payment and receipt linking to HashScan.
5. Read the refusals. A rejected decision lists the reasons; if the `funding` check is the one that failed, deposit more. `MANDI_UNFUNDED_OK=1` on the server skips that check for a demo without deposits, and the check text says so when it is bypassed.

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

With the server running, three scripts drive the wallet flows from a terminal, using throwaway keys so you can rehearse without MetaMask:

```bash
cd server
pnpm exec tsx scripts/fund-evm.ts 0xYourMetaMask 5              # test HBAR from the operator to an EVM address
pnpm exec tsx scripts/seller-demo.ts acme-risk 0.0.1234 0.03    # signs the registration, mints the name
pnpm exec tsx scripts/buyer-demo.ts "Assess risk of Aave" 0.5   # seeds a wallet, deposits, signs, runs the task
```

`seller-demo` takes `<label> <payTo> <priceHbar> [upstream]`, `buyer-demo` takes `[task] [depositHbar] [seedHbar]`. Both print the throwaway key so you can reuse the same wallet with `DEMO_SELLER_KEY` or `DEMO_BUYER_KEY`, and both target `MANDI_API` if set, otherwise `PUBLIC_URL`. `buyer-demo` deposits through the JSON-RPC relay, waits for the mirror node, signs the mandate, streams `/run`, and prints the funding numbers before and after.

Run the tests with `pnpm test` (74 cases: policy hashing and activation, seller registration signatures, executor decisions including the funding check, the funding ledger over mirror transfers and HCS decisions, agent loop with fallback and refusal, reliability aggregation, subgraph scoring, supplier fail modes, World attestations).

### Environment

`.env.example` lists what you must fill, plus `SELLER_EVM_ADDRESS` and the two demo switches. Everything else has a default.

**Required for the core demo (Hedera payment + ENS identity)**

| Variable | What it is | How to get it |
|---|---|---|
| `PUBLIC_URL` | The URL agents pay. Written into every supplier's `agent-endpoint[x402]` record and used by `pay-once`, `traffic` and the demo drivers | `http://localhost:3000` locally. After deploying, set it to the server URL and re-run `register-service` for each supplier |
| `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY` | Account that pays HCS fees, creates the topic, and seeds wallets in `fund-evm` | portal.hedera.com → create a testnet account → copy the account id and the ECDSA private key (hex or DER both work) |
| `SELLER_ACCOUNT_ID` | Where supplier payments land (`payTo`) when a seller does not name their own account | Use the operator id, or create a separate account with `scripts/hedera-account.ts SELLER` |
| `BUYER_ACCOUNT_ID`, `BUYER_KEY` | The executor's payment signer, and the account buyers deposit into. Must differ from the seller | `pnpm exec tsx scripts/hedera-account.ts BUYER` creates and funds it from the operator and prints both lines |
| `HCS_TOPIC_ID` | Topic that holds activations, receipts and decisions | Printed by `scripts/hedera-init.ts` |
| `SEPOLIA_RPC_URL` | Sepolia JSON-RPC. The public default rate-limits log scans | Free app on Alchemy or Infura → Sepolia HTTPS URL |
| `SEPOLIA_PRIVATE_KEY` | Deploys the resolver and subregistry, registers `mandi.eth`, and holds the registrar role that mints seller subnames and writes records. Pays all Sepolia gas, so sellers need none | Export from a throwaway MetaMask account or `scripts/keygen.ts SEPOLIA_PRIVATE_KEY`, then fund it with about 0.05 Sepolia ETH from the Google Cloud or Alchemy faucet |
| `ENS_SUBREGISTRY`, `ENS_RESOLVER`, `ENS_FROM_BLOCK` | Your subregistry, your resolver, and the block to scan registrations from | Printed by `scripts/ens-setup.ts` |
| `HUMAN_KEY` | Fallback mandate signer for the scripts and for an activation posted without a wallet signature. The console signs with MetaMask instead. Needs no funds | `pnpm exec tsx scripts/keygen.ts` |
| `VERIFIER_KEY` | Signs supplier attestations after Selfie Check. Needs no funds. Without it every `requireVerifiedFor` check fails | Same `keygen` run |

**Required per sponsor track**

| Variable | Track | How to get it |
|---|---|---|
| `GRAPH_API_KEY` | The Graph, and the video. Without it suppliers return placeholder scores that say so in `notes` | thegraph.com/studio → API Keys → Create. The free allowance covers the demo |
| `WORLD_RP_ID`, `WORLD_SIGNING_KEY` | World. Signs each Selfie Check request and names the app to the verify endpoint | developer.world.org → your app → Enable World ID 4.0 → copy `rp_id` and the one-time signing key |
| `VITE_WORLD_APP_ID` | World. The widget's app id. Vite loads it from the repo-root `.env`; the Docker image bakes it in at build time via `ARG VITE_WORLD_APP_ID` | Same app page → App ID |

**Optional, with defaults**

| Variable | Default | When to set |
|---|---|---|
| `PORT` | `3000` | Hosts usually inject it |
| `WEB_DIST` | unset | `../web/dist` to serve the console from the server (the Dockerfile sets it) |
| `VITE_API_URL` (web) | `/api` | Empty for same-origin serving, or the server URL for a Vercel deploy |
| `X402_FACILITATOR_URL` | `https://api.testnet.blocky402.com` | Only to point at another facilitator |
| `HEDERA_NETWORK`, `HEDERA_MIRROR_URL` | `testnet`, `https://testnet.mirrornode.hedera.com` | Mainnet only |
| `ENS_PARENT_LABEL` | `mandi` | If `mandi` is taken on the beta |
| `ENS_EXPLORER_URL` | `https://explorer.ens.dev/name/` | Another ENS front end. The seller page and the scripts link names through it |
| `SELLER_EVM_ADDRESS` | unset | The wallet recorded as owner of the three config suppliers (`risk-basic`, `risk-pro`, `risk-pro-2`), so the only wallet that can run their Selfie Check. Unset, their subnames are still minted to the Sepolia deployer but no owner is on record and Selfie Check for them is refused. Sellers who register from the browser own their names either way |
| `PAYTO_RISK_BASIC`, `PAYTO_RISK_PRO`, `PAYTO_RISK_PRO_2` | `SELLER_ACCOUNT_ID` | One Hedera account per config supplier |
| `SELLERS_FILE` | `server/data/sellers.json`, or `sellers.json` beside `ATTESTATION_FILE` | Sellers registered from the browser. Put it on the mounted volume next to the attestations |
| `WORLD_ACTION` | `mandi-supplier-accreditation` | Keep stable; nullifiers are per action |
| `ATTESTATION_FILE` | `server/data/attestations.json` | A mounted volume path on the host |
| `UPSTREAM_TIMEOUT_MS` | `8000` | Client-side timeout for supplier calls |
| `MANDI_FAIL` | unset | Demo switch, e.g. `risk-pro:timeout` or `risk-basic:error`, makes a supplier fail after authorization |
| `MANDI_UNFUNDED_OK` | unset | `1` makes the executor's funding check pass without any deposit. Demo switch only; the check text says it was bypassed |

**Only for the terminal drivers**

| Variable | Default | What it does |
|---|---|---|
| `MANDI_API` | `PUBLIC_URL` | Base URL `seller-demo` and `buyer-demo` post to |
| `DEMO_SELLER_KEY` | a fresh key per run | Reuse the same throwaway seller wallet across runs |
| `DEMO_BUYER_KEY` | a fresh key per run | Reuse the same throwaway buyer wallet, and its deposits, across runs |

Deploy with the root `Dockerfile` (Railway, Render, Fly) for a single URL, or deploy `web/` to Vercel with `VITE_API_URL` pointing at the server. The image was built and smoke-tested locally with Docker: it serves the console, the 402 gate, the directory and reliability, and contains no `.env`. Use a dedicated Sepolia RPC (Alchemy or Infura) in production; public endpoints were seen returning no receipts or logs for blocks that state queries confirm.

Railway, from a logged-in CLI:

```bash
railway init                                   # new project
railway variables --set "$(cat .env | tr '\n' ' ')"   # or paste .env into the dashboard's raw editor
railway up --detach                            # builds the Dockerfile
railway domain                                 # prints https://<app>.up.railway.app
railway variables --set PUBLIC_URL=https://<app>.up.railway.app
railway volume add --mount-path /data && railway variables --set ATTESTATION_FILE=/data/attestations.json
railway up --detach                            # redeploy with the final variables
cd server && for l in risk-basic risk-pro risk-pro-2; do PUBLIC_URL=https://<app>.up.railway.app pnpm exec tsx scripts/register-service.ts $l; done
PUBLIC_URL=https://<app>.up.railway.app pnpm exec tsx scripts/pay-once.ts risk-basic aave
```

The last two lines rewrite the ENS endpoint records to the public URL and prove a paid call from outside. `ATTESTATION_FILE` on the volume also puts `sellers.json` there, so browser registrations survive a redeploy.

## Sponsor tracks

### Hedera: AI and agentic payments over x402

- Live x402-gated services on Hedera testnet, settled through the **Blocky402** facilitator (`api.testnet.blocky402.com`, scheme `exact`, asset HBAR `0.0.0`).
- The buyer agent completes real paid requests end to end with `@x402/fetch` and `@x402/hedera`.
- **The buyer funds the agent from their own wallet**: MetaMask sends HBAR to the executor's account over the Hedera JSON-RPC relay (chain id 296, `https://testnet.hashio.io/api`). `GET /executor` publishes the account id and its EVM address; `GET /funding/:signer` publishes deposits, spend and what is left.
- **Per-signer funding check**: the executor spends only what the mandate signer deposited, minus what it has already spent for them. Deposits are read from the mirror node's transaction list for the executor account; spend is summed from anchored `DECISION` messages, which now carry the `signer`. No deposit means no payment, and the refusal names the executor account to deposit into.
- **Metering**: each supplier quotes a different price per route (`/assess` vs `/assess/deep`), computed from config at request time.
- **Discovery**: a capability directory built from the ENSv2 subregistry's `LabelRegistered` events, resolved through the universal resolver. If the RPC returns no logs (free public Sepolia RPCs prune receipts and cap log ranges), the directory verifies the configured labels directly against the subregistry's `getResolver` and lists only names that exist on chain; the response says which path produced it in `source`.
- **Audit trail on HCS**: `POLICY_ACTIVATED`, `DECISION` (approved and rejected) and `RECEIPT` messages on one topic. The reliability index is computed only from those receipts.
- Agent identity is the ENS name, not HCS-14. Said plainly here so nobody reads more into it.

### ENS: best use of ENSv2

- Built on the ENSv2 Sepolia beta with viem against the live contracts: a `UserRegistry` subregistry for `mandi.eth` deployed through the `VerifiableFactory`, a `PermissionedResolver`, and parent registration through the v2 `ETHRegistrar` commit/register flow paid in the beta's MockUSDC.
- **Sellers mint their own names from a browser.** They connect MetaMask on `/seller` and sign an EIP-191 registration message; the server, which holds the registrar role on the subregistry, verifies the signature recovers the signer and mints `<label>.mandi.eth` **to the seller's wallet** with a minimal role bitmap. The seller spends no ETH and never hands over a key.
- **Agents as namespaces**: each supplier is `<label>.mandi.eth`, and every record is written in one resolver multicall.
- `GET /sellers` and `GET /sellers/by-owner/:address` list what exists, each row carrying `listed` (the name was found on chain) and `attested` (a valid verifier attestation is on file); `POST /sellers/register` is the signed mint.
- Records: the two **ENSIP-26** keys `agent-context` and `agent-endpoint[x402]` (x402 is a custom protocol tag permitted by the draft), plus clearly named custom keys `mandi:capability`, `mandi:price`, `mandi:chain`, `mandi:verified`, and `mandi:upstream` for a seller's own API URL. The custom keys are never described as ENSIP-26 fields.
- Nothing is hard-coded: prices, endpoints and capabilities are read back from the records at decision time, and the executor resolves the name itself rather than trusting the agent.
- Ownership is what authorizes the sensitive routes: Selfie Check for a name is refused unless the caller's wallet is the one on record as its owner.
- Not done: Enhanced Access Control per-seller roles on the shared resolver (the contracts support `authorizeNameRoles`; it is on the roadmap).

### World: Selfie Check as an eligibility signal

- A seller runs Selfie Check against production World App (`environment: "production"`, `selfieCheckLegacy({ signal: sellerWallet })`) from `/seller`. Scan the QR from a laptop or open the page inside World App — IDKit uses the native handoff there. The server signs the request context with the RP signing key, forwards the proof to the v4 verify endpoint, checks the signal hash against the seller wallet, enforces one accreditation per human via a hashed nullifier, and issues a verifier-signed attestation bound to the ENS name and wallet with a 90-day expiry.
- **The signal is bound to the name's owner.** `POST /world/rp-signature` and `POST /world/verify` both reject any wallet that is not the recorded owner of the name, so one seller cannot accredit another seller's listing.
- The executor enforces `requireVerifiedFor` against that attestation only. Flipping `mandi:verified` on ENS by hand changes nothing; the decision says so in its reason.
- Feedback document: [docs/WORLD_FEEDBACK.md](docs/WORLD_FEEDBACK.md).

### The Graph: live data behind the suppliers

- Both supplier tiers query Messari standardized subgraphs on the decentralized network through Subgraph Studio: `aave-v3-ethereum`, `compound-v3-ethereum`, `morpho-aave-v3-ethereum` (lending schema) and `lido-ethereum` (generic schema).
- `risk-basic` runs one query (protocol TVL, deposits, borrows). `risk-pro` runs three (plus daily financial snapshots and usage). The score is a deterministic function of utilization, TVL, TVL trend, liquidations and active users, and the raw numbers appear in `notes`.
- The claim is never that pro is more correct, only that it does more work per call and has a longer paid history.

## Honesty notes

- **Single process, reference executor.** Buyer and market code run in one Hono process for the demo. The executor's guarantee is a module boundary, not process isolation or custody infrastructure.
- **The funding ledger is derived, not held.** Deposits come from the mirror node's transaction list for the executor account; spend comes from anchored `DECISION` messages with a matching `signer`; both are cached for 10 seconds, with an in-process floor covering the gap between a payment and its appearance on the mirror node. It is an accounting view over chain data, not segregated custody: the deposits sit in the executor's own account, and nothing stops that account from being spent by other means.
- **The upstream URL is informational.** A seller can give an upstream API URL and it is written to ENS as `mandi:upstream`, but in this build the Mandi-hosted x402 endpoint in `agent-endpoint[x402]` serves every call and the demo scorer answers it. Proxying a seller's own API is not wired up.
- **Reliability is not accuracy.** Receipts prove calls, failures, latency and cost. Nothing measures whether a risk score was right. Outcome oracles are future work.
- **Failure semantics follow x402 v2.** In the `authorization` flow the facilitator settles after a successful response, so a failed supplier call is cancelled rather than paid. Receipts record `settled:false, fulfilled:false`. The buyer loses nothing on a failed call; reliability still records the miss.
- **Selfie Check is a medium-assurance credential.** The attestation says a live human completed the check for this wallet. It is not Orb-grade uniqueness.
- **Placeholder scores** are returned only when `GRAPH_API_KEY` is missing, and they say so in `notes`. Set the key before recording or judging.
- **No LLM in the loop.** Task planning is a keyword map and every decision is deterministic. An LLM explanation paragraph is a roadmap item and would never sit on the payment path.

## Live deployment

- Console and API: https://mandiserver-production.up.railway.app (one Railway service built from the root `Dockerfile`; the console is served from the same origin, the x402 gate is under `/s/*`).
- Seller page: https://mandiserver-production.up.railway.app/seller — connect MetaMask there; `?name=risk-pro` prefills the label.
- The three seed ENS names resolve to that host: `agent-endpoint[x402]` on `risk-basic.mandi.eth`, `risk-pro.mandi.eth`, `risk-pro-2.mandi.eth`.
- First paid call against the public URL, settled through Blocky402 with live Aave data in the response: https://hashscan.io/testnet/transaction/0.0.7162784-1789194411-135984699
- First procurement executed by the deployed executor (policy anchored, decision and receipt on the topic): payment https://hashscan.io/testnet/transaction/0.0.7162784-1789194436-844603129

Any redeploy resets in-memory state (active policies, per-run ledgers, directory cache); activate the policy again after a push. Deposits survive, because they are read back from the mirror node. Attestations and browser registrations persist on the mounted volume; everything judged lives on chain.

## Status

Verified live on Sept 10, 2026, from a laptop against Hedera testnet and ENSv2 Sepolia, again on Sept 12 from the public deployment, and again on Sept 13 for the two wallet flows:

| Artifact | Where to look |
|---|---|
| HCS topic with `POLICY_ACTIVATED`, `DECISION`, and `RECEIPT` messages | https://hashscan.io/testnet/topic/0.0.10454931 |
| `mandi.eth` on the ENSv2 Sepolia beta, with its subregistry and resolver | https://explorer.ens.dev/name/mandi.eth · subregistry `0x1C1137d4Cf35c988461d708067d0b1663631B435` · resolver `0xb6F5434b108cdD21Dcd9Bf52D0557cA3929ca013` |
| The three seed suppliers with ENSIP-26 and `mandi:*` records | https://explorer.ens.dev/name/risk-basic.mandi.eth · risk-pro.mandi.eth · risk-pro-2.mandi.eth |
| A settled x402 payment through Blocky402 testnet (fee payer `0.0.7162784`, buyer `0.0.10454835`) | https://hashscan.io/testnet/transaction/0.0.7162784-1789025192-909232105 |
| The `DECISION` and `RECEIPT` for that payment, joined by the same transaction id and policy hash | topic messages 7 and 8 |

Live runs completed end to end: a normal procurement (`risk-pro` chosen on its 100% record, paid, fulfilled), a forced failure (`risk-pro` timed out, payment cancelled, `risk-basic` rejected on a 50% success rate, `risk-pro-2` paid instead, 0.04 HBAR total), and a refusal (`maxPerCall` 0.01 HBAR, all three rejected with reasons, nothing paid). Topic messages 1 and 2 were emitted by the test suite before tests were isolated from `.env`; they carry no decisions.

Verified on Sept 13, 2026, driving both wallet flows with fresh throwaway wallets against the deployment:

| Flow | Artifact |
|---|---|
| Seller registration signed by a wallet that had never touched the app: `acme-risk.mandi.eth` minted to `0xAa11d2A8e49B41e2FDCc1130d1E243a730685261` | mint https://sepolia.etherscan.io/tx/0xa8cf557a378328fd11c5ca46bf058c15d50cf6522800a2cf1491cb40832e9799 · records https://sepolia.etherscan.io/tx/0x2eeed81b6d44e5a2f9abc45cac4df45ff6e9d7b7d10573b1dfe5c67f40e14fcb |
| Buyer wallet `0xb956BBc2165AAaDD0808F76e3C79d55A8f0799AC` deposited 0.5 HBAR to the executor through the JSON-RPC relay | https://hashscan.io/testnet/transaction/0.0.7314364-1789272651-049802745 |
| The same wallet signed the mandate, the executor approved with the funding check passing, and it paid | topic `0.0.10454931` messages 57 to 59 · payment `0.0.7162784@1789272694.931655682` (https://hashscan.io/testnet/transaction/0.0.7162784-1789272694-931655682) |

Live subgraph data confirmed through paid calls on Sept 10: `Assess risk of Aave` returned TVL, utilization, available liquidity, an 8-day TVL trend, liquidations and active users from `messari/aave-v3-ethereum` (risk 10, low), and `Assess risk of Morpho` scored the dormant `morpho-aave-v3-ethereum` market at risk 60, high, on $25k of TVL and a 100% drawdown.

Still pending:

- Selfie Check on production World App (needs the Selfie Check flag on the Developer Portal app, a production action `mandi-supplier-accreditation`, and a phone with World App). Everything up to the proof is wired and the owner-wallet binding is unit-tested, but no proof has been through a phone yet.

## Roadmap

A2A price negotiation between agents · production custody for the executor key, so deposits are not held in its own account · proxying a seller's own upstream API behind the x402 gate · EAC per-seller record roles on the shared resolver · an LLM "why this supplier" paragraph off the payment path · outcome oracles so reliability can one day include correctness.
