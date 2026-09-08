import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { config, requireEnv } from "../config";

function buyerKey(): PrivateKey {
  const raw = requireEnv("BUYER_KEY");
  if (raw.startsWith("0x")) return PrivateKey.fromStringECDSA(raw);
  if (raw.startsWith("30")) return PrivateKey.fromStringDer(raw);
  return PrivateKey.fromString(raw);
}

let paid: typeof fetch | undefined;

export function paidFetch(): typeof fetch {
  if (!paid) {
    const signer = createClientHederaSigner(requireEnv("BUYER_ACCOUNT_ID"), buyerKey(), {
      network: config.x402.network,
    });
    const client = x402Client.fromConfig({
      schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }],
      spendControls: false,
    });
    paid = wrapFetchWithPayment(fetch, client);
  }
  return paid;
}
