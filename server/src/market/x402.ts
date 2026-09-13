import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Price } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { config, supplierByLabel, type Supplier } from "../config";
import { toTinybar } from "../hbar";

export const facilitator = new HTTPFacilitatorClient({ url: config.x402.facilitatorUrl });

export const resourceServer = new x402ResourceServer(facilitator).register(
  "hedera:*",
  new ExactHederaScheme(),
);

export type RouteInfo = { supplier: Supplier; deep: boolean; route: string };

export function routeInfo(path: string): RouteInfo | undefined {
  const match = /^\/s\/([^/]+)\/(assess(?:\/deep)?)$/.exec(path);
  if (!match) return undefined;
  const supplier = supplierByLabel(match[1]!);
  if (!supplier) return undefined;
  return { supplier, deep: match[2] === "assess/deep", route: `/${match[2]}` };
}

export function priceHbar(info: RouteInfo): number {
  return info.deep ? info.supplier.deepPriceHbar : info.supplier.priceHbar;
}

const price = (ctx: { path: string }): Price => {
  const info = routeInfo(ctx.path);
  if (!info) throw new Error(`no price for ${ctx.path}`);
  return { asset: config.x402.asset, amount: toTinybar(priceHbar(info)).toString() };
};

const payTo = (ctx: { path: string }): string => {
  const info = routeInfo(ctx.path);
  if (!info) throw new Error(`no payTo for ${ctx.path}`);
  return info.supplier.payTo;
};

export const x402Gate = paymentMiddleware(
  {
    "GET /s/*": {
      accepts: {
        scheme: "exact",
        network: config.x402.network,
        payTo,
        price,
        maxTimeoutSeconds: 60,
      },
      description: "Mandi supplier call, metered per route, settled in HBAR on Hedera testnet",
      mimeType: "application/json",
    },
  },
  resourceServer,
);
