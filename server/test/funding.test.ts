import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { depositsIn, forgetFunding, fundingFor, recordSpend, spentIn, type MirrorTransaction } from "../src/buyer/funding";
import type { HcsMessage } from "../src/hedera";

const EXECUTOR = "0.0.10454930";
const SENDER = "0.0.10454835";
const OTHER = "0.0.7162784";

const page: { transactions: MirrorTransaction[] } = {
  transactions: [
    {
      consensus_timestamp: "1789267381.494608104",
      name: "CRYPTOTRANSFER",
      result: "SUCCESS",
      transaction_id: "0.0.7162784-1789267372-721165815",
      transfers: [
        { account: "0.0.802", amount: 267574 },
        { account: OTHER, amount: -267574 },
        { account: SENDER, amount: -4000000 },
        { account: EXECUTOR, amount: 4000000 },
      ],
    },
    {
      consensus_timestamp: "1789267400.000000000",
      name: "ETHEREUMTRANSACTION",
      result: "SUCCESS",
      transaction_id: "0.0.7162784-1789267390-000000001",
      transfers: [
        { account: "0.0.802", amount: 1000 },
        { account: OTHER, amount: -1000 },
        { account: SENDER, amount: -50000000 },
        { account: EXECUTOR, amount: 50000000 },
      ],
    },
    {
      consensus_timestamp: "1789267410.000000000",
      name: "CRYPTOTRANSFER",
      result: "INSUFFICIENT_ACCOUNT_BALANCE",
      transaction_id: "0.0.7162784-1789267401-000000002",
      transfers: [
        { account: SENDER, amount: -9900000000 },
        { account: EXECUTOR, amount: 9900000000 },
      ],
    },
    {
      consensus_timestamp: "1789267420.000000000",
      name: "CRYPTOTRANSFER",
      result: "SUCCESS",
      transaction_id: "0.0.7162784-1789267411-000000003",
      transfers: [
        { account: OTHER, amount: -2000000 },
        { account: EXECUTOR, amount: 2000000 },
      ],
    },
    {
      consensus_timestamp: "1789267430.000000000",
      name: "CRYPTOTRANSFER",
      result: "SUCCESS",
      transaction_id: "0.0.7162784-1789267421-000000004",
      transfers: [
        { account: EXECUTOR, amount: -3000000 },
        { account: SENDER, amount: 3000000 },
      ],
    },
  ],
};

describe("depositsIn", () => {
  it("keeps successful transfers that credit the executor and debit the signer's account", () => {
    const deposits = depositsIn(page.transactions, EXECUTOR, SENDER);
    expect(deposits.map((d) => d.amountHbar)).toEqual([0.04, 0.5]);
    expect(deposits[0]).toEqual({
      txId: "0.0.7162784-1789267372-721165815",
      hashscan: "https://hashscan.io/testnet/transaction/0.0.7162784-1789267372-721165815",
      amountHbar: 0.04,
      consensusTimestamp: "1789267381.494608104",
    });
  });

  it("ignores deposits from another account and payouts by the executor", () => {
    expect(depositsIn(page.transactions, EXECUTOR, OTHER)).toHaveLength(1);
    expect(depositsIn(page.transactions, EXECUTOR, "0.0.999")).toEqual([]);
    expect(depositsIn(page.transactions, EXECUTOR, EXECUTOR)).toEqual([]);
  });
});

const SIGNER = "0xAbCdef0000000000000000000000000000000001";
const OTHER_SIGNER = "0x0000000000000000000000000000000000000002";

const decision = (over: Partial<HcsMessage>): HcsMessage => ({
  type: "DECISION",
  status: "approved",
  priceHbar: 0.05,
  signer: SIGNER.toLowerCase(),
  txId: "0.0.1@1",
  ...over,
});

describe("spentIn", () => {
  it("sums approved settled decisions for the signer only", () => {
    const messages = [
      decision({}),
      decision({ priceHbar: 0.04 }),
      decision({ signer: OTHER_SIGNER, priceHbar: 1 }),
      decision({ status: "rejected", priceHbar: 2 }),
      decision({ txId: null, priceHbar: 3 }),
      { type: "RECEIPT", signer: SIGNER, priceHbar: 4 } as HcsMessage,
    ];
    expect(spentIn(messages, SIGNER)).toBe(0.09);
    expect(spentIn(messages, SIGNER.toLowerCase())).toBe(0.09);
    expect(spentIn(messages, OTHER_SIGNER)).toBe(1);
  });

  it("is zero for a signer with no decisions", () => {
    expect(spentIn([decision({})], "0x0000000000000000000000000000000000000003")).toBe(0);
  });
});

const SIGNER_EVM = "0x1111111111111111111111111111111111111111";

const senderPage = (transactions: MirrorTransaction[], next: string | null) => ({ transactions, links: { next } });

const transfer = (id: string, tinybar: number, to = EXECUTOR): MirrorTransaction => ({
  consensus_timestamp: `17892674${id}.000000000`,
  name: "CRYPTOTRANSFER",
  result: "SUCCESS",
  transaction_id: `${SENDER}-17892674${id}-000000000`,
  transfers: [
    { account: SENDER, amount: -tinybar },
    { account: to, amount: tinybar },
  ],
});

describe("depositsIn over the sender's own pages", () => {
  it("keeps the deposits on every page and ignores the sender's other spending", () => {
    const pages = [
      [transfer("01", 4000000), transfer("02", 1000000, OTHER)],
      [transfer("03", 50000000), transfer("04", 2000000, OTHER)],
    ];
    const deposits = pages.flatMap((transactions) => depositsIn(transactions, EXECUTOR, SENDER));
    expect(deposits.map((d) => d.amountHbar)).toEqual([0.04, 0.5]);
  });
});

describe("fundingFor", () => {
  const urls: string[] = [];

  beforeAll(() => {
    process.env.BUYER_ACCOUNT_ID = EXECUTOR;
    vi.stubGlobal("fetch", async (input: string) => {
      const url = String(input);
      urls.push(url);
      if (url.includes(`/accounts/${SIGNER_EVM}`)) return Response.json({ account: SENDER });
      if (url.includes("page=2")) return Response.json(senderPage([transfer("03", 50000000)], null));
      if (url.includes("/transactions")) {
        return Response.json(senderPage([transfer("01", 4000000), transfer("02", 1000000, OTHER)], "/api/v1/transactions?page=2"));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  });

  afterEach(() => {
    forgetFunding();
    urls.length = 0;
  });

  it("pages the sender's transactions, not the executor's history", async () => {
    const funding = await fundingFor(SIGNER_EVM);
    expect(urls.some((u) => u.includes(`/transactions?account.id=${SENDER}`))).toBe(true);
    expect(urls.some((u) => u.includes(`/transactions?account.id=${EXECUTOR}`))).toBe(false);
    expect(funding.account).toBe(SENDER);
    expect(funding.deposits.map((d) => d.amountHbar)).toEqual([0.04, 0.5]);
    expect(funding).toMatchObject({ depositedHbar: 0.54, spentHbar: 0, availableHbar: 0.54 });
  });

  it("never lets recordSpend lower the spent floor", async () => {
    const funding = await fundingFor(SIGNER_EVM);
    recordSpend(SIGNER_EVM, 0.05);
    expect(funding.spentHbar).toBe(0.05);
    expect(funding.availableHbar).toBe(0.49);
    funding.spentHbar = 0;
    recordSpend(SIGNER_EVM, 0.04);
    expect(funding.spentHbar).toBe(0.09);
    expect(funding.availableHbar).toBe(0.45);
  });

  it("carries the floor into a re-read while the mirror node lags", async () => {
    await fundingFor(SIGNER_EVM);
    recordSpend(SIGNER_EVM, 0.05);
    forgetFunding(SIGNER_EVM);
    expect(await fundingFor(SIGNER_EVM)).toMatchObject({ spentHbar: 0.05, availableHbar: 0.49 });
  });
});
