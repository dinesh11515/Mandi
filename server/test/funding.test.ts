import { describe, expect, it } from "vitest";
import { depositsIn, spentIn, type MirrorTransaction } from "../src/buyer/funding";
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
