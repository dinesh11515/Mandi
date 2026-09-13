# Mandi

**Humans set the rules. Agents spend the money.**

Procurement for autonomous agents. Suppliers are ENSv2 names. Payments are x402 on Hedera. A deterministic executor — the only thing holding the payment key — decides. Every approval and every refusal lands on HCS.

- **Live:** https://mandi.up.railway.app/
- **Seller:** https://mandi.up.railway.app/seller
- **Audit trail:** https://hashscan.io/testnet/topic/0.0.10454931
- **Names:** https://app.ens.dev/mandi.eth
- **Code:** https://github.com/dinesh11515/Mandi

Solo build for [ETHOnline 2026](https://ethglobal.com/events/ethonline2026). Hedera testnet + ENSv2 Sepolia beta. Nothing on mainnet.

## Why this exists

An agent with a key will spend. A prompt is not a cap. Mandi splits recommendation from authorization: the agent can shop and argue, the executor re-derives every fact from chain state against a wallet-signed policy, then pays or refuses with reasons.

## Payment flow

1. A seller connects MetaMask on `/seller`, signs a registration, and gets `<label>.mandi.eth` minted **to their wallet**. Price, capability and x402 endpoint go on the resolver. Optional: Selfie Check in World App, bound to that wallet.
2. A buyer signs a policy (`maxPerCall`, `budgetTotal`, `minSuccessRate`, `requireVerifiedFor`) and deposits HBAR from the same wallet over the Hedera JSON-RPC relay (chain 296).
3. The agent resolves `*.mandi.eth`, ranks on accreditation then reliability then price, and submits an intent.
4. The executor resolves the name again, re-reads price, funding, reliability and attestation, and only then signs an x402 payment through Blocky402.
5. `RECEIPT` and `DECISION` are anchored on one HCS topic and join on the Hedera transaction id. Failures cancel (x402 v2 `authorization` flow) and the agent falls back. Nothing eligible → refuse, nothing paid.

`server/src/buyer/executor.ts` is the only file that reads `BUYER_KEY`.

```
MetaMask (seller) ── EIP-191 ──► mint *.mandi.eth on ENSv2 Sepolia
MetaMask (buyer)  ── mandate + HBAR deposit ──► executor account
agent ── intent ──► executor ── @x402/fetch ──► Blocky402 / Hedera
                         │
                         └── HCS  DECISION + RECEIPT
supplier data ◄── Messari subgraphs (The Graph)
accreditation ◄── World Selfie Check attestation
```

## Hedera — agentic payments over x402

Live x402-gated service on Hedera testnet, settled through Blocky402 (`exact`, HBAR `0.0.0`). One `@x402/hono` gate, per-route prices. The buyer funds the executor from MetaMask; the executor spends that deposit and not a tinybar more. Reliability is computed only from anchored receipts.

- Gate: `server/src/market/x402.ts` · payer: `server/src/buyer/executor.ts` · ledger: `server/src/buyer/funding.ts` · HCS: `server/src/hedera.ts`
- Topic: https://hashscan.io/testnet/topic/0.0.10454931
- Settled payment (DECISION + RECEIPT join on this id): https://hashscan.io/testnet/transaction/0.0.7162784-1789025192-909232105
- Buyer-funded run: deposit https://hashscan.io/testnet/transaction/0.0.7314364-1789272651-049802745 · payment https://hashscan.io/testnet/transaction/0.0.7162784-1789272694-931655682

Identity here is the ENS name, not HCS-14.

## ENS — ENSv2 as the supplier registry

`server/src/ens.ts` talks to the live ENSv2 Sepolia contracts with viem: a `UserRegistry` subregistry under `mandi.eth`, a `PermissionedResolver`, sellers minted as owners of their own names. Records are the ENSIP-26 keys `agent-context` and `agent-endpoint[x402]`, plus custom `mandi:capability`, `mandi:price`, `mandi:chain`, `mandi:verified`, `mandi:upstream`. The executor re-resolves at decision time. Nothing priced in code.

The ENS Explorer name URL (`explorer.ens.dev/name/…`) currently errors — ENSv2 is still in beta. The names themselves are on Sepolia and show in the ENS App:

- https://app.ens.dev/mandi.eth · https://app.ens.dev/risk-basic.mandi.eth · https://app.ens.dev/risk-pro.mandi.eth · https://app.ens.dev/risk-pro-2.mandi.eth
- Subregistry: [`0x1C1137d4Cf35c988461d708067d0b1663631B435`](https://sepolia.etherscan.io/address/0x1C1137d4Cf35c988461d708067d0b1663631B435) · resolver: [`0xb6F5434b108cdD21Dcd9Bf52D0557cA3929ca013`](https://sepolia.etherscan.io/address/0xb6F5434b108cdD21Dcd9Bf52D0557cA3929ca013)
- Wallet mint of `acme-risk.mandi.eth`: https://sepolia.etherscan.io/tx/0xa8cf557a378328fd11c5ca46bf058c15d50cf6522800a2cf1491cb40832e9799

## World — Selfie Check as eligibility

Production World App, `selfieCheckLegacy`, signal bound to the seller wallet. The executor enforces `requireVerifiedFor` against a verifier-signed attestation, not the ENS `mandi:verified` flag. Ownership of the name is proven with a second EIP-191 signature before the check can start.

Live: https://mandi.up.railway.app/seller — phone completed Selfie Check for `risk-pro.mandi.eth` on Sept 13.

## The Graph — live data behind the suppliers

Messari subgraphs on the decentralized network: `aave-v3-ethereum`, `compound-v3-ethereum`, `morpho-aave-v3-ethereum`, `lido-ethereum`. `risk-basic` is one query. `risk-pro` is three. The score is a function of utilization, TVL, trend, liquidations and active users — more work per call, not a claim of being more correct.

## Limits

- `mandi:upstream` is written to ENS but calls still hit the Mandi-hosted x402 endpoint.
- One wallet signature activates the policy; the run token after that is a session secret.
- Reliability is fulfillment, not correctness.
- Deposits sit in the executor's own Hedera account. Single process, module-boundary guarantee.
- Placeholder Graph scores only if `GRAPH_API_KEY` is missing, and they say so.

## Run locally

Node 22, pnpm 11. Copy `.env.example` → `.env` and fill funded Hedera testnet accounts plus a Sepolia key. Empty `.env` starts the server and passes tests; that proves nothing on chain.

```bash
pnpm install
cd server
pnpm exec tsx scripts/keygen.ts VERIFIER_KEY
pnpm exec tsx scripts/hedera-account.ts BUYER
pnpm exec tsx scripts/hedera-init.ts
pnpm exec tsx scripts/ens-setup.ts
pnpm exec tsx scripts/register-service.ts risk-basic
pnpm dev                                          # :3000
pnpm exec tsx scripts/pay-once.ts risk-basic aave # one real paid x402 call
```

```bash
cd web && pnpm dev    # :5173, proxies /api
```

`pnpm test` · `pnpm typecheck` · `pnpm build` (web only).
