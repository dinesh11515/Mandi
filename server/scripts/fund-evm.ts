import { AccountId, Hbar, TransferTransaction } from "@hiero-ledger/sdk";
import { accountOfEvm } from "../src/buyer/funding";
import { hashscanTx, operatorClient } from "../src/hedera";

const address = process.argv[2] ?? "";
const hbar = Number(process.argv[3] ?? "");
const usage = "usage: pnpm tsx scripts/fund-evm.ts <0xaddress> <hbar>";

async function main() {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(usage);
  if (!Number.isFinite(hbar) || hbar <= 0) throw new Error(usage);
  const client = operatorClient();
  const amount = new Hbar(hbar);
  const response = await new TransferTransaction()
    .addHbarTransfer(client.operatorAccountId!, amount.negated())
    .addHbarTransfer(AccountId.fromEvmAddress(0, 0, address), amount)
    .setMaxTransactionFee(new Hbar(2))
    .setTransactionMemo("mandi fund-evm")
    .execute(client);
  const receipt = await response.getReceipt(client);
  const txId = response.transactionId.toString();
  console.log(`${receipt.status.toString()}: sent ${hbar} HBAR from ${client.operatorAccountId!.toString()} to ${address}`);
  console.log(hashscanTx(txId));
  const account = await accountOfEvm(address).catch(() => null);
  console.log(account ? `hedera account ${account}` : "the hedera account id appears on the mirror node a few seconds from now");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
