import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const names = process.argv.slice(2);

for (const name of names.length ? names : ["VERIFIER_KEY"]) {
  const key = generatePrivateKey();
  console.log(`${name}=${key}`);
  console.log(`${name.replace(/_KEY$/, "")}_ADDRESS=${privateKeyToAccount(key).address}`);
}
