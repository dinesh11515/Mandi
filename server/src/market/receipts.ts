import { createHash } from "node:crypto";
import { formatHbar, fromTinybar } from "../hbar";
import { hashscanTx, hcsSubmit } from "../hedera";
import type { Receipt } from "../types";
import { resourceServer, routeInfo } from "./x402";

type Pending = {
  startedAt: number;
  supplier: string;
  route: string;
  amountHbar: number;
  policyHash: string | null;
};

type HookContext = {
  paymentPayload: { payload: unknown };
  requirements: { amount: string };
  transportContext?: unknown;
};

type Transport = {
  request?: { path: string; adapter: { getHeader(name: string): string | undefined } };
  responseHeaders?: Record<string, string>;
};

const pending = new Map<string, Pending>();

function keyOf(ctx: HookContext): string {
  return createHash("sha256").update(JSON.stringify(ctx.paymentPayload.payload)).digest("hex");
}

function transport(ctx: HookContext): Transport {
  return (ctx.transportContext ?? {}) as Transport;
}

function remember(ctx: HookContext): Pending {
  const key = keyOf(ctx);
  const existing = pending.get(key);
  if (existing) return existing;
  const req = transport(ctx).request;
  const info = req ? routeInfo(req.path) : undefined;
  const entry: Pending = {
    startedAt: Date.now(),
    supplier: info?.supplier.label ?? "unknown",
    route: info?.route ?? req?.path ?? "unknown",
    amountHbar: fromTinybar(ctx.requirements.amount),
    policyHash: req?.adapter.getHeader("x-mandi-policy-hash") || null,
  };
  pending.set(key, entry);
  return entry;
}

function take(ctx: HookContext): Pending {
  const key = keyOf(ctx);
  const entry = remember(ctx);
  pending.delete(key);
  return entry;
}

async function emit(receipt: Receipt) {
  const tag = `${receipt.supplier}${receipt.route} settled=${receipt.settled} fulfilled=${receipt.fulfilled}`;
  try {
    const hcsTx = await hcsSubmit({ type: "RECEIPT", ...receipt });
    console.log(`receipt anchored ${tag} ${hashscanTx(hcsTx)}`);
  } catch (err) {
    console.error(`receipt not anchored (${tag}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

function build(entry: Pending, patch: Partial<Receipt> & Pick<Receipt, "settled" | "fulfilled" | "txId">): Receipt {
  return {
    supplier: entry.supplier,
    route: entry.route,
    amountHbar: formatHbar(entry.amountHbar),
    latencyMs: Date.now() - entry.startedAt,
    ts: Date.now(),
    policyHash: entry.policyHash,
    ...patch,
  };
}

export function registerReceiptHooks() {
  resourceServer.onAfterVerify(async (ctx) => {
    remember(ctx as HookContext);
  });
  resourceServer.onAfterSettle(async (ctx) => {
    const entry = take(ctx as HookContext);
    const handlerLatency = Number(transport(ctx as HookContext).responseHeaders?.["x-mandi-latency-ms"]);
    void emit(
      build(entry, {
        settled: ctx.result.success,
        fulfilled: true,
        txId: ctx.result.transaction || null,
        ...(Number.isFinite(handlerLatency) ? { latencyMs: handlerLatency } : {}),
        ...(ctx.result.success ? {} : { error: ctx.result.errorReason ?? "settle_failed" }),
      }),
    );
  });
  resourceServer.onSettleFailure(async (ctx) => {
    const entry = take(ctx as HookContext);
    void emit(build(entry, { settled: false, fulfilled: true, txId: null, error: ctx.error.message }));
  });
  resourceServer.onVerifiedPaymentCanceled(async (ctx) => {
    const entry = take(ctx as HookContext);
    void emit(
      build(entry, {
        settled: ctx.settledPhases.length > 0,
        fulfilled: false,
        txId: null,
        status: ctx.responseStatus,
        error: ctx.reason,
      }),
    );
  });
}
