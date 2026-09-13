import { createWalletClient, http, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hederaTestnet } from "viem/chains";
import { accountOfEvm } from "../src/buyer/funding";
import { mandateMessage, policyHash } from "../src/buyer/policy";
import { config } from "../src/config";
import { fundEvmAddress, hashscanTx } from "../src/hedera";
import { SAMPLE_POLICY, type Policy } from "../src/types";

const api = process.env.MANDI_API || config.publicUrl;
const task = process.argv[2] ?? "Assess risk of Aave";
const depositHbar = Number(process.argv[3] ?? "0.5");
const seedHbar = Number(process.argv[4] ?? "2");
const policy: Policy = { ...SAMPLE_POLICY, requireVerifiedFor: [], minSuccessRate: 0.7 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${api}${path}`, init);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path}: ${body.error ?? res.status}`);
  return body;
}

type Funding = { depositedHbar: number; spentHbar: number; availableHbar: number; account: string | null };

async function waitFor<T>(label: string, read: () => Promise<T>, ok: (v: T) => boolean, attempts = 30): Promise<T> {
  for (let i = 0; i < attempts; i += 1) {
    const value = await read().catch(() => null as T | null);
    if (value !== null && ok(value)) return value;
    await sleep(3000);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function main() {
  const key = (process.env.DEMO_BUYER_KEY as Hex | undefined) ?? generatePrivateKey();
  const account = privateKeyToAccount(key);
  console.log(`buyer wallet ${account.address}${process.env.DEMO_BUYER_KEY ? "" : ` (new key, reuse with DEMO_BUYER_KEY=${key})`}`);

  const existing = await accountOfEvm(account.address);
  if (!existing) {
    console.log(`seeding ${seedHbar} HBAR from the operator so the wallet exists on Hedera testnet`);
    console.log(hashscanTx(await fundEvmAddress(account.address, seedHbar)));
    await waitFor("the wallet on the mirror node", () => accountOfEvm(account.address), (a) => a !== null);
  }

  const executor = await json<{ accountId: string; evmAddress: `0x${string}` }>("/executor");
  const before = await json<Funding>(`/funding/${account.address}`);
  console.log(`executor ${executor.accountId} (${executor.evmAddress}); deposited so far ${before.depositedHbar} HBAR, available ${before.availableHbar} HBAR`);

  const wallet = createWalletClient({ account, chain: hederaTestnet, transport: http() });
  const hash = await wallet.sendTransaction({ to: executor.evmAddress, value: parseEther(String(depositHbar)) });
  console.log(`deposit ${depositHbar} HBAR through the JSON-RPC relay: https://hashscan.io/testnet/transaction/${hash}`);
  const funded = await waitFor(
    "the deposit on the mirror node",
    () => json<Funding>(`/funding/${account.address}`),
    (f) => f.depositedHbar > before.depositedHbar,
  );
  console.log(`funding now: deposited ${funded.depositedHbar} HBAR, spent ${funded.spentHbar} HBAR, available ${funded.availableHbar} HBAR`);

  const hash256 = policyHash(policy);
  const expiry = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const signature = await account.signMessage({ message: mandateMessage(hash256, expiry) });
  const activation = await json<{ policyHash: string; hashscan: string | null; signer: string }>("/policy/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ policy, expiry, signature, signer: account.address }),
  });
  console.log(`policy ${activation.policyHash} signed by ${activation.signer}; anchored ${activation.hashscan ?? "no"}`);

  const res = await fetch(`${api}/run?task=${encodeURIComponent(task)}&policyHash=${activation.policyHash}`);
  if (!res.ok || !res.body) throw new Error(`/run ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = frame.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim();
      if (!data) continue;
      const ev = JSON.parse(data) as Record<string, unknown> & { stage: string };
      if (ev.stage === "authorization") {
        const decision = ev.decision as { status: string; checks: { name: string; passed: boolean; detail: string }[] };
        console.log(`authorization ${ev.supplier}: ${decision.status}`);
        for (const c of decision.checks) console.log(`  ${c.passed ? "pass" : "FAIL"} ${c.name}: ${c.detail}`);
      } else if (ev.stage === "payment") {
        const p = ev.payment as { settled: boolean; hashscan: string | null };
        console.log(`payment ${ev.supplier}: settled=${p.settled} ${p.hashscan ?? ""}`);
      } else if (ev.stage === "done") {
        console.log(`done: ${ev.outcome}${ev.supplier ? ` by ${ev.supplier}` : ""}`);
      } else {
        console.log(ev.stage);
      }
    }
  }
  const after = await json<Funding>(`/funding/${account.address}`);
  console.log(`funding after: deposited ${after.depositedHbar} HBAR, spent ${after.spentHbar} HBAR, available ${after.availableHbar} HBAR`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
