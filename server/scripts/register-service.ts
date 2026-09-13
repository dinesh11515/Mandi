import { registerService, serviceName } from "../src/ens";
import { assertSellerLabel } from "../src/config";

async function main() {
  const label = process.argv[2];
  if (!label) throw new Error("usage: register-service <label>");
  assertSellerLabel(label);
  const result = await registerService(label);
  if (result.minted) console.log(`minted ${result.name} to ${result.owner} tx ${result.mintTx}`);
  else console.log(`${result.name} already registered`);
  console.log(`records set on ${result.name} tx ${result.recordsTx}`);
  for (const [key, value] of Object.entries(result.records)) console.log(`  ${key} = ${value || "(empty)"}`);
  console.log(`https://explorer.ens.dev/name/${serviceName(label)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
