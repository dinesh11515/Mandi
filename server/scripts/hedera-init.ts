import { config } from "../src/config";
import { createTopic, hashscanTopic, operatorBalanceHbar, operatorClient } from "../src/hedera";

type Supported = { kinds: { scheme: string; network: string; extra?: Record<string, unknown> }[] };

async function checkFacilitator() {
  const url = `${config.x402.facilitatorUrl}/supported`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`facilitator ${res.status} at ${url}`);
  const body = (await res.json()) as Supported;
  const kind = body.kinds.find((k) => k.network === config.x402.network && k.scheme === "exact");
  if (!kind) throw new Error(`facilitator at ${url} does not list ${config.x402.network}`);
  console.log(`facilitator ok: ${url} supports ${kind.network} (feePayer ${String(kind.extra?.feePayer ?? "n/a")})`);
}

async function main() {
  await checkFacilitator();
  const client = operatorClient();
  console.log(`operator ${client.operatorAccountId!.toString()} on ${config.hedera.network}`);
  console.log(`balance ${await operatorBalanceHbar()} HBAR`);
  if (config.hedera.topicId) {
    console.log(`HCS_TOPIC_ID already set: ${config.hedera.topicId} ${hashscanTopic(config.hedera.topicId)}`);
  } else {
    const topicId = await createTopic("mandi receipts + decisions");
    console.log(`created topic ${topicId} ${hashscanTopic(topicId)}`);
    console.log(`add to .env: HCS_TOPIC_ID=${topicId}`);
  }
  client.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
