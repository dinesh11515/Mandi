import { accountOfEvm } from "../src/buyer/funding";
import { fundEvmAddress, hashscanTx, operatorClient } from "../src/hedera";

const address = process.argv[2] ?? "";
const hbar = Number(process.argv[3] ?? "");
const usage = "usage: pnpm tsx scripts/fund-evm.ts <0xaddress> <hbar>";

async function main() {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(usage);
  if (!Number.isFinite(hbar) || hbar <= 0) throw new Error(usage);
  const txId = await fundEvmAddress(address, hbar);
  console.log(`sent ${hbar} HBAR from ${operatorClient().operatorAccountId!.toString()} to ${address}`);
  console.log(hashscanTx(txId));
  const account = await accountOfEvm(address).catch(() => null);
  console.log(account ? `hedera account ${account}` : "the hedera account id appears on the mirror node a few seconds from now");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
