import { encodeFunctionData, zeroAddress, type Address } from "viem";
import { config, supplierByLabel } from "../src/config";
import {
  RECORD_KEYS,
  ROLE_SET_RESOLVER,
  deployerAccount,
  nodeOf,
  publicClient,
  readRecords,
  registryAbi,
  resolverAbi,
  resolverAddress,
  serviceName,
  serviceRecords,
  subregistryAddress,
  walletClient,
} from "../src/ens";

const ONE_YEAR = 365 * 24 * 60 * 60;

async function main() {
  const label = process.argv[2];
  if (!label || !supplierByLabel(label)) throw new Error("usage: register-service <risk-basic|risk-pro|risk-pro-2>");
  const reader = publicClient();
  const wallet = walletClient();
  const account = deployerAccount();
  const owner = (config.ens.sellerAddress || account.address) as Address;
  const subregistry = subregistryAddress();
  const resolver = resolverAddress();
  const name = serviceName(label);

  const existing = await reader.readContract({ address: subregistry, abi: registryAbi, functionName: "getResolver", args: [label] });
  if (existing === zeroAddress) {
    const expiry = BigInt(Math.floor(Date.now() / 1000) + ONE_YEAR);
    const hash = await wallet.writeContract({
      address: subregistry,
      abi: registryAbi,
      functionName: "register",
      args: [label, owner, zeroAddress, resolver, ROLE_SET_RESOLVER, expiry],
    });
    await reader.waitForTransactionReceipt({ hash });
    console.log(`minted ${name} to ${owner} tx ${hash}`);
  } else {
    console.log(`${name} already registered (resolver ${existing})`);
  }

  const records = serviceRecords(label);
  const node = nodeOf(name);
  const calls = Object.entries(records).map(([key, value]) =>
    encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [node, key, value] }),
  );
  const hash = await wallet.writeContract({ address: resolver, abi: resolverAbi, functionName: "multicall", args: [calls] });
  await reader.waitForTransactionReceipt({ hash });
  console.log(`records set on ${name} tx ${hash}`);

  const back = await readRecords(name, Object.values(RECORD_KEYS));
  for (const [key, value] of Object.entries(back)) console.log(`  ${key} = ${value || "(empty)"}`);
  console.log(`https://explorer.ens.dev/name/${name}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
