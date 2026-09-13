# Mandi — environment reference

Everything a builder needs that would have bloated the README: the full environment table, the scripts, the routes, the signed message formats, and the deploy steps. Start with the [README](../README.md) for what Mandi is.

Nothing here is verified on chain until `.env` has a funded Hedera testnet account and a funded Sepolia key. With an empty `.env` the server starts, the tests pass, and no payment or mint can happen.

## Prerequisites

- Node 22, pnpm 11.
- A funded Hedera testnet account from [portal.hedera.com](https://portal.hedera.com) (account id + ECDSA private key).
- A funded Sepolia key, about 0.05 Sepolia ETH, from the Google Cloud or Alchemy faucet.
- A Subgraph Studio API key from [thegraph.com/studio](https://thegraph.com/studio).
- For the World track, an app in the World Developer Portal with World ID 4.0 enabled.
- MetaMask in the browser for either wallet journey. A phone with World App only for Selfie Check.

## Scripts

All of them run from `server/` with `pnpm exec tsx scripts/<name>.ts`.

| Script | Usage | What it does |
|---|---|---|
| `keygen` | `keygen.ts VERIFIER_KEY` | Prints a fresh private key as an `.env` line. Used for `VERIFIER_KEY` (needs no funds) and for a throwaway `SEPOLIA_PRIVATE_KEY` |
| `hedera-account` | `hedera-account.ts BUYER` | Creates a Hedera account funded from the operator and prints `BUYER_ACCOUNT_ID` and `BUYER_KEY`. Also used for `SELLER` |
| `hedera-init` | `hedera-init.ts` | Creates the HCS topic, prints `HCS_TOPIC_ID`, and checks the x402 facilitator is reachable |
| `ens-setup` | `ens-setup.ts` | Deploys the `UserRegistry` subregistry through the `VerifiableFactory` and a `PermissionedResolver`, registers `mandi.eth` through the v2 `ETHRegistrar` commit/register flow, and prints `ENS_SUBREGISTRY`, `ENS_RESOLVER`, `ENS_FROM_BLOCK` |
| `register-service` | `register-service.ts risk-basic` | Mints `<label>.mandi.eth` for a config supplier and writes its records in one multicall. Re-run it after `PUBLIC_URL` changes |
| `pay-once` | `pay-once.ts risk-basic aave` | One real paid x402 call against `PUBLIC_URL`. Prints the 402 requirements, the settled transaction id, and the response |
| `traffic` | `traffic.ts 5` | Five real paid calls spread over the suppliers, to build reliability history from receipts |
| `fund-evm` | `fund-evm.ts 0xYourAddress 5` | Sends test HBAR from the operator to an EVM address and prints the Hedera account id the mirror node assigns it |
| `seller-demo` | `seller-demo.ts <label> <payTo> <priceHbar> [upstream]` | Signs the registration message with a throwaway wallet and mints the name, no MetaMask |
| `buyer-demo` | `buyer-demo.ts [task] [depositHbar] [seedHbar]` | Seeds a throwaway wallet, deposits through the JSON-RPC relay, waits for the mirror node, signs the mandate, streams `/run`, and prints funding before and after |

`seller-demo` and `buyer-demo` both print the throwaway key, so `DEMO_SELLER_KEY` or `DEMO_BUYER_KEY` reuses the same wallet — and its deposits — across runs. Both target `MANDI_API` if set, otherwise `PUBLIC_URL`.

## Environment

`.env.example` lists what you must fill, plus `SELLER_EVM_ADDRESS` and the two demo switches. Everything else has a default.

### Required for the core demo (Hedera payment + ENS identity)

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
| `VERIFIER_KEY` | Signs supplier attestations after Selfie Check. Needs no funds. Without it every `requireVerifiedFor` check fails | `pnpm exec tsx scripts/keygen.ts VERIFIER_KEY` |

### Required per sponsor track

| Variable | Track | How to get it |
|---|---|---|
| `GRAPH_API_KEY` | The Graph, and the video. Without it suppliers return placeholder scores that say so in `notes` | thegraph.com/studio → API Keys → Create. The free allowance covers the demo |
| `WORLD_RP_ID`, `WORLD_SIGNING_KEY` | World. Signs each Selfie Check request and names the app to the verify endpoint | developer.world.org → your app → Enable World ID 4.0 → copy `rp_id` and the one-time signing key |
| `VITE_WORLD_APP_ID` | World. The widget's app id. Vite loads it from the repo-root `.env`; the Docker image bakes it in at build time via `ARG VITE_WORLD_APP_ID` | Same app page → App ID |

### Optional, with defaults

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

### Only for the terminal drivers

| Variable | Default | What it does |
|---|---|---|
| `MANDI_API` | `PUBLIC_URL` | Base URL `seller-demo` and `buyer-demo` post to |
| `DEMO_SELLER_KEY` | a fresh key per run | Reuse the same throwaway seller wallet across runs |
| `DEMO_BUYER_KEY` | a fresh key per run | Reuse the same throwaway buyer wallet, and its deposits, across runs |

## Routes

One Hono process serves all of them. The x402 gate sits under `/s/*`; everything else is open unless noted.

| Route | What it does |
|---|---|
| `GET /health` | Liveness |
| `GET /s/:label/assess` | Paid. 402 with HBAR requirements on `hedera:testnet`, then the risk score |
| `GET /s/:label/assess/deep` | Paid, higher price, three subgraph queries |
| `GET /directory` | Capability directory built from the subregistry, with `source` naming which path produced it |
| `GET /resolve/:name` | The ENSIP-26 and `mandi:*` records for one name, read from ENSv2 Sepolia |
| `GET /sellers` | Every known seller, each row carrying `listed` and `attested` |
| `GET /sellers/by-owner/:address` | The names one wallet owns |
| `POST /sellers/register` | Signed mint. `{label, owner, payTo, priceHbar, capability, upstream?, description?, signature}` |
| `POST /policy/activate` | Requires `signature` and `signer`. Anchors `POLICY_ACTIVATED` and returns the policy hash and a run token |
| `GET /policy/:hash` | The active policy and its ledger. Never returns the run token or the mandate signature |
| `POST /intent` | One `PurchaseIntent` plus `token`. Returns a `Decision` |
| `GET /run` | SSE stream of a whole run. Needs `&token=` |
| `GET /executor` | The executor's Hedera account id and EVM address, for deposits |
| `GET /funding/:signer` | Deposited, spent and available for one mandate signer |
| `GET /reliability`, `GET /reliability/:name` | The reliability index, computed only from anchored receipts |
| `GET /world/config` | Whether the World track is configured, and the action |
| `POST /world/rp-signature` | `{label, wallet, signature}`. Signs the Selfie Check request context with the RP key |
| `POST /world/verify` | `{label, wallet, signature, proof}`. Verifies with World, then issues the attestation |
| `GET /attestation/:name` | The attestation for a name, or 200 with none on file |

`/intent` and `/run` answer 403 `run token required` without the token. `/world/rp-signature` and `/world/verify` refuse anyone who is not the recorded owner of the name.

## Signed messages

Three EIP-191 (`personal_sign`) messages. Nothing is broadcast on Sepolia from a user wallet, so no Sepolia ETH is needed on either side.

Seller registration — `sellerRegistrationMessage` in `server/src/sellers.ts`:

```
Mandi seller registration
name: <label>.mandi.eth
owner: <lowercased address>
payTo: <0.0.x>
price: <n> HBAR
capability: <capability>
```

Selfie Check — `selfieCheckMessage` in `server/src/sellers.ts`:

```
Mandi Selfie Check
name: <label>.mandi.eth
owner: <lowercased address>
```

Policy mandate — `mandateMessage` in `server/src/buyer/policy.ts`:

```
Mandi policy <sha256 of the canonical policy> valid until <unix expiry>
```

The mandate must expire 24 hours from signing, accepted from 15 minutes stale to 2 minutes ahead. A signature that has already been used is refused, so an old mandate cannot be replayed. Re-activating the same policy from the same signer returns the existing activation with its ledger intact.

## Deploy

The root `Dockerfile` builds one image that serves the console and the API from a single origin — Railway, Render or Fly. Or deploy `web/` to Vercel with `VITE_API_URL` pointing at the server. The image was built and smoke-tested locally with Docker: it serves the console, the 402 gate, the directory and reliability, and contains no `.env`.

Use a dedicated Sepolia RPC (Alchemy or Infura) in production. Public endpoints were seen returning no receipts or logs for blocks that state queries confirm.

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

Any redeploy resets in-memory state — active policies, per-run ledgers, the directory cache — so activate the policy again after a push. Deposits survive, because they are read back from the mirror node. Attestations and browser registrations persist on the mounted volume. Everything judged lives on chain.

## Sponsor feedback

My notes on building against World ID 4.0 and Selfie Check: [WORLD_FEEDBACK.md](WORLD_FEEDBACK.md).
