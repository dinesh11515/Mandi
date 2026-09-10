import { AccountCreateTransaction, Hbar, PrivateKey } from "@hiero-ledger/sdk";
import { operatorClient } from "../src/hedera";

const label = (process.argv[2] ?? "BUYER").toUpperCase();
const initialHbar = Number(process.argv[3] ?? 30);

async function main() {
  const client = operatorClient();
  const key = PrivateKey.generateECDSA();
  const response = await new AccountCreateTransaction()
    .setECDSAKeyWithAlias(key)
    .setInitialBalance(new Hbar(initialHbar))
    .execute(client);
  const receipt = await response.getReceipt(client);
  const accountId = receipt.accountId!.toString();
  console.log(`created ${accountId} with ${initialHbar} HBAR from operator ${client.operatorAccountId!.toString()}`);
  console.log(`https://hashscan.io/testnet/account/${accountId}`);
  console.log(`add to .env:`);
  console.log(`${label}_ACCOUNT_ID=${accountId}`);
  console.log(`${label}_KEY=0x${key.toStringRaw()}`);
  client.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
