import {
  AccountBalanceQuery,
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TopicCreateTransaction,
  TopicId,
  TopicMessageSubmitTransaction,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { config, requireEnv } from "./config";

export function parsePrivateKey(raw: string): PrivateKey {
  if (raw.startsWith("0x")) return PrivateKey.fromStringECDSA(raw);
  if (raw.startsWith("30")) return PrivateKey.fromStringDer(raw);
  return PrivateKey.fromString(raw);
}

let operator: Client | undefined;

export function operatorClient(): Client {
  if (!operator) {
    const client = Client.forName(config.hedera.network);
    client.setOperator(
      AccountId.fromString(requireEnv("HEDERA_OPERATOR_ID")),
      parsePrivateKey(requireEnv("HEDERA_OPERATOR_KEY")),
    );
    operator = client;
  }
  return operator;
}

export async function operatorBalanceHbar(): Promise<number> {
  const client = operatorClient();
  const balance = await new AccountBalanceQuery()
    .setAccountId(client.operatorAccountId!)
    .execute(client);
  return balance.hbars.toBigNumber().toNumber();
}

export async function createTopic(memo: string): Promise<string> {
  const client = operatorClient();
  const response = await new TopicCreateTransaction().setTopicMemo(memo).execute(client);
  const receipt = await response.getReceipt(client);
  return receipt.topicId!.toString();
}

export async function fundEvmAddress(address: string, hbar: number): Promise<string> {
  const client = operatorClient();
  const amount = new Hbar(hbar);
  const response = await new TransferTransaction()
    .addHbarTransfer(client.operatorAccountId!, amount.negated())
    .addHbarTransfer(AccountId.fromEvmAddress(0, 0, address), amount)
    .setMaxTransactionFee(new Hbar(2))
    .setTransactionMemo("mandi fund-evm")
    .execute(client);
  const receipt = await response.getReceipt(client);
  if (receipt.status.toString() !== "SUCCESS") throw new Error(`transfer failed: ${receipt.status.toString()}`);
  return response.transactionId.toString();
}

export type HcsMessage = Record<string, unknown> & { type: string };

export async function hcsSubmit(message: HcsMessage): Promise<string> {
  const client = operatorClient();
  const topicId = TopicId.fromString(requireEnv("HCS_TOPIC_ID"));
  const response = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(JSON.stringify({ ...message, ts: message.ts ?? Date.now() }))
    .execute(client);
  await response.getReceipt(client);
  return response.transactionId.toString();
}

type MirrorMessage = { consensus_timestamp: string; message: string; sequence_number: number };
type MirrorPage = { messages: MirrorMessage[]; links?: { next?: string | null } };

export async function mirrorMessages(topicId = config.hedera.topicId): Promise<HcsMessage[]> {
  if (!topicId) return [];
  const out: HcsMessage[] = [];
  let url: string | null = `${config.hedera.mirrorUrl}/api/v1/topics/${topicId}/messages?limit=100&order=asc`;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mirror node ${res.status} for ${url}`);
    const page = (await res.json()) as MirrorPage;
    for (const m of page.messages) {
      try {
        const parsed = JSON.parse(Buffer.from(m.message, "base64").toString("utf8"));
        if (parsed && typeof parsed.type === "string") {
          out.push({ ...parsed, consensusTimestamp: m.consensus_timestamp, sequence: m.sequence_number });
        }
      } catch {}
    }
    url = page.links?.next ? `${config.hedera.mirrorUrl}${page.links.next}` : null;
  }
  return out;
}

export function hashscanTx(txId: string): string {
  const normalized = txId.replace("@", "-").replace(/\.(\d+)$/, "-$1");
  return `https://hashscan.io/${config.hedera.network}/transaction/${normalized}`;
}

export function hashscanTopic(topicId: string): string {
  return `https://hashscan.io/${config.hedera.network}/topic/${topicId}`;
}

export function hashscanAccount(accountId: string): string {
  return `https://hashscan.io/${config.hedera.network}/account/${accountId}`;
}
