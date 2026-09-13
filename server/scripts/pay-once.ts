import { decodePaymentResponseHeader } from "@x402/fetch";
import { paidFetch } from "../src/buyer/executor";
import { allSuppliers, config } from "../src/config";
import { hashscanTx } from "../src/hedera";


const label = process.argv[2] ?? allSuppliers()[0]!.label;
const protocol = process.argv[3] ?? "aave";
const route = process.argv[4] === "deep" ? "assess/deep" : "assess";

async function main() {
  const url = `${config.publicUrl}/s/${label}/${route}?protocol=${encodeURIComponent(protocol)}`;
  console.log(`GET ${url}`);
  const started = Date.now();
  const res = await paidFetch()(url);
  console.log(`status ${res.status} in ${Date.now() - started}ms`);
  console.log(JSON.stringify(await res.json(), null, 2));
  const header = res.headers.get("PAYMENT-RESPONSE");
  if (!header) throw new Error("no PAYMENT-RESPONSE header: payment did not settle");
  const settlement = decodePaymentResponseHeader(header);
  console.log(`settled ${settlement.success} tx ${settlement.transaction} payer ${settlement.payer ?? "?"}`);
  console.log(hashscanTx(settlement.transaction));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
