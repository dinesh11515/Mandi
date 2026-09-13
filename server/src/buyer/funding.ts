import { config } from "../config";
import { fromTinybar } from "../hbar";
import { hashscanAccount, hashscanTx, mirrorMessages, type HcsMessage } from "../hedera";
import { executorAccountId } from "./executor";

export type Deposit = {
  txId: string;
  hashscan: string;
  amountHbar: number;
  consensusTimestamp: string;
};

export type ExecutorAccount = {
  accountId: string;
  evmAddress: string;
  balanceHbar: number;
  hashscan: string;
};

export type Funding = {
  signer: string;
  account: string | null;
  depositedHbar: number;
  spentHbar: number;
  availableHbar: number;
  deposits: Deposit[];
};

export type MirrorTransfer = { account: string; amount: number };

export type MirrorTransaction = {
  consensus_timestamp: string;
  name?: string;
  result?: string;
  transaction_id: string;
  transfers?: MirrorTransfer[];
};

type TransactionPage = { transactions?: MirrorTransaction[]; links?: { next?: string | null } };

type MirrorAccount = { account?: string | null; evm_address?: string | null; balance?: { balance?: number } | null };

const CACHE_MS = 10_000;
const PAGE_CAP = 10;

function round(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

async function mirrorJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${config.hedera.mirrorUrl}${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`mirror node ${res.status} for ${path}`);
  return (await res.json()) as T;
}

let accountCache: { at: number; value: ExecutorAccount } | undefined;

export async function executorAccount(): Promise<ExecutorAccount> {
  if (accountCache && Date.now() - accountCache.at < CACHE_MS) return accountCache.value;
  const id = executorAccountId();
  const row = await mirrorJson<MirrorAccount>(`/api/v1/accounts/${id}`);
  if (!row) throw new Error(`executor account ${id} is not on the ${config.hedera.network} mirror node yet`);
  const accountId = row.account ?? id;
  const value: ExecutorAccount = {
    accountId,
    evmAddress: row.evm_address ?? "",
    balanceHbar: round(fromTinybar(row.balance?.balance ?? 0)),
    hashscan: hashscanAccount(accountId),
  };
  accountCache = { at: Date.now(), value };
  return value;
}

export async function accountOfEvm(address: string): Promise<string | null> {
  const row = await mirrorJson<MirrorAccount>(`/api/v1/accounts/${address}`);
  return row?.account ?? null;
}

export function depositsIn(transactions: MirrorTransaction[], executor: string, sender: string): Deposit[] {
  const deposits: Deposit[] = [];
  if (executor === sender) return deposits;
  for (const tx of transactions) {
    if (tx.result !== "SUCCESS" || !tx.transfers) continue;
    const credited = tx.transfers
      .filter((t) => t.account === executor && t.amount > 0)
      .reduce((total, t) => total + t.amount, 0);
    if (credited <= 0) continue;
    const debited = tx.transfers
      .filter((t) => t.account === sender && t.amount < 0)
      .reduce((total, t) => total - t.amount, 0);
    if (debited < credited) continue;
    deposits.push({
      txId: tx.transaction_id,
      hashscan: hashscanTx(tx.transaction_id),
      amountHbar: round(fromTinybar(credited)),
      consensusTimestamp: tx.consensus_timestamp,
    });
  }
  return deposits;
}

export async function depositsFrom(sender: string): Promise<Deposit[]> {
  const executor = executorAccountId();
  const deposits: Deposit[] = [];
  let path: string | null = `/api/v1/transactions?account.id=${sender}&limit=100&order=desc`;
  for (let page = 0; page < PAGE_CAP && path; page += 1) {
    const body: TransactionPage | null = await mirrorJson<TransactionPage>(path);
    if (!body) break;
    deposits.push(...depositsIn(body.transactions ?? [], executor, sender));
    path = body.links?.next ?? null;
  }
  return deposits;
}

export function spentIn(messages: HcsMessage[], signer: string): number {
  const wanted = signer.toLowerCase();
  let total = 0;
  for (const m of messages) {
    if (m.type !== "DECISION" || m.status !== "approved") continue;
    if (typeof m.txId !== "string" || m.txId.length === 0) continue;
    if (typeof m.signer !== "string" || m.signer.toLowerCase() !== wanted) continue;
    if (typeof m.priceHbar === "number") total += m.priceHbar;
  }
  return round(total);
}

export async function spentBy(signer: string): Promise<number> {
  return spentIn(await mirrorMessages(), signer);
}

const cache = new Map<string, { at: number; value: Funding }>();
const floors = new Map<string, number>();

export function recordSpend(signer: string, hbar: number): void {
  const key = signer.toLowerCase();
  const entry = cache.get(key);
  const next = round(Math.max(entry?.value.spentHbar ?? 0, floors.get(key) ?? 0) + hbar);
  floors.set(key, next);
  if (entry) {
    entry.value.spentHbar = next;
    entry.value.availableHbar = round(entry.value.depositedHbar - next);
  }
}

export function forgetFunding(signer?: string): void {
  if (signer === undefined) {
    cache.clear();
    floors.clear();
    return;
  }
  cache.delete(signer.toLowerCase());
}

export async function fundingFor(signer: string): Promise<Funding> {
  const key = signer.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const account = await accountOfEvm(key);
  const deposits = account ? await depositsFrom(account) : [];
  const depositedHbar = round(deposits.reduce((total, d) => total + d.amountHbar, 0));
  const spentHbar = round(Math.max(await spentBy(key), floors.get(key) ?? 0));
  const value: Funding = {
    signer: key,
    account,
    depositedHbar,
    spentHbar,
    availableHbar: round(depositedHbar - spentHbar),
    deposits,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}
