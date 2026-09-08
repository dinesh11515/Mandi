import { decodePaymentResponseHeader } from "@x402/fetch";
import { paidFetch } from "../src/buyer/executor";
import { config, SUPPLIERS } from "../src/config";

const rounds = Number(process.argv[2] ?? 3);
const protocol = process.argv[3] ?? "aave";
const only = process.argv[4]?.split(",").filter(Boolean);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = { supplier: string; calls: number; fulfilled: number; settled: number; totalHbar: number; latencyMs: number[] };

async function main() {
  const targets = SUPPLIERS.filter((s) => !only || only.includes(s.label));
  const rows = new Map<string, Row>(targets.map((s) => [s.label, { supplier: s.label, calls: 0, fulfilled: 0, settled: 0, totalHbar: 0, latencyMs: [] }]));
  const fetchPaid = paidFetch();
  for (let round = 1; round <= rounds; round += 1) {
    for (const supplier of targets) {
      const row = rows.get(supplier.label)!;
      const url = `${config.publicUrl}/s/${supplier.label}/assess?protocol=${encodeURIComponent(protocol)}`;
      const started = Date.now();
      try {
        const res = await fetchPaid(url, { signal: AbortSignal.timeout(config.upstreamTimeoutMs) });
        const header = res.headers.get("PAYMENT-RESPONSE");
        const settlement = header ? decodePaymentResponseHeader(header) : null;
        row.calls += 1;
        if (res.ok) row.fulfilled += 1;
        if (settlement?.success) {
          row.settled += 1;
          row.totalHbar += supplier.priceHbar;
        }
        row.latencyMs.push(Date.now() - started);
        console.log(`round ${round} ${supplier.label} status=${res.status} settled=${settlement?.success ?? false} tx=${settlement?.transaction ?? "-"} ${Date.now() - started}ms`);
      } catch (err) {
        row.calls += 1;
        row.latencyMs.push(Date.now() - started);
        console.log(`round ${round} ${supplier.label} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(750);
    }
  }
  console.log("\nsummary (client side)");
  for (const row of rows.values()) {
    const avg = row.latencyMs.length ? Math.round(row.latencyMs.reduce((a, b) => a + b, 0) / row.latencyMs.length) : 0;
    console.log(`  ${row.supplier}: calls=${row.calls} fulfilled=${row.fulfilled} settled=${row.settled} spent=${row.totalHbar.toFixed(2)} HBAR avg=${avg}ms`);
  }
  const reliability = await fetch(`${config.publicUrl}/reliability`).then((r) => r.json());
  console.log("\nreliability index (from HCS receipts via mirror node)");
  console.log(JSON.stringify(reliability, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
