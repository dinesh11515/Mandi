import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sellerRegistrationMessage } from "../src/sellers";
import { CAPABILITY, config } from "../src/config";

const api = process.env.MANDI_API || config.publicUrl;
const [label, payTo, priceArg, upstream = ""] = process.argv.slice(2);
const usage = "usage: pnpm tsx scripts/seller-demo.ts <label> <hedera payTo 0.0.x> <priceHbar> [upstream url]";

async function main() {
  if (!label || !payTo || !priceArg) throw new Error(usage);
  const priceHbar = Number(priceArg);
  if (!Number.isFinite(priceHbar) || priceHbar <= 0) throw new Error(usage);
  const key = (process.env.DEMO_SELLER_KEY as Hex | undefined) ?? generatePrivateKey();
  const account = privateKeyToAccount(key);
  console.log(`seller wallet ${account.address}${process.env.DEMO_SELLER_KEY ? "" : ` (new key, reuse with DEMO_SELLER_KEY=${key})`}`);
  const capability = CAPABILITY;
  const message = sellerRegistrationMessage({ label, owner: account.address, payTo, priceHbar, capability });
  const signature = await account.signMessage({ message });
  const res = await fetch(`${api}/sellers/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      label,
      owner: account.address.toLowerCase(),
      signature,
      payTo,
      priceHbar,
      capability,
      depth: "pro",
      upstream,
      context: `Protocol risk assessment operated by ${label}. Registered from the terminal demo.`,
    }),
  });
  const body = (await res.json()) as { error?: string; name: string; minted: boolean; mintTx: string | null; recordsTx: string; records: Record<string, string> };
  if (!res.ok) throw new Error(body.error ?? `${res.status}`);
  console.log(`${body.minted ? "minted" : "refreshed"} ${body.name} for ${account.address}`);
  if (body.mintTx) console.log(`mint https://sepolia.etherscan.io/tx/${body.mintTx}`);
  console.log(`records https://sepolia.etherscan.io/tx/${body.recordsTx}`);
  for (const [k, v] of Object.entries(body.records)) console.log(`  ${k} = ${v || "(empty)"}`);
  console.log(`${config.ens.explorer}${body.name}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
