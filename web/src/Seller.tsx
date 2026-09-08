import { IDKitRequestWidget, selfieCheckLegacy, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { useState } from "react";
import { API, ensExplorer } from "./api";

type Attestation = { name: string; wallet: string; hashedNullifier: string; expiry: number; issuer: string; sig: string };

export function Seller() {
  const params = new URLSearchParams(location.search);
  const label = params.get("name") ?? "risk-pro";
  const wallet = params.get("wallet") ?? "";
  const appId = (import.meta.env.VITE_WORLD_APP_ID as string | undefined) ?? "";
  const [rp, setRp] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ attestation: Attestation; ensTx: string | null; ensError: string | null } | null>(null);

  const start = async () => {
    setError(null);
    try {
      const res = await fetch(`${API}/world/rp-signature`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      setRp(body as RpContext);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleVerify = async (idkitResponse: IDKitResult) => {
    const res = await fetch(`${API}/world/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, wallet, idkitResponse }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `${res.status}`);
    setResult(body);
  };

  return (
    <>
      <header>
        <h1>Mandi · seller accreditation</h1>
        <p>Selfie Check (World ID Sandbox) binds a verified human to a supplier name. The executor requires this attestation for verified-only policies.</p>
      </header>
      <main>
        <section className="wide">
          <h2>{label}.mandi.eth</h2>
          <p>
            seller wallet (signal): <span className="mono">{wallet || "missing ?wallet= in the URL"}</span>
          </p>
          <div className="row">
            <button onClick={start} disabled={!wallet || !appId || open}>
              Start Selfie Check
            </button>
            {!appId && <span className="error">VITE_WORLD_APP_ID is not set</span>}
            <a href="/">back to the console</a>
          </div>
          {error && <p className="error">{error}</p>}
          {rp && (
            <IDKitRequestWidget
              open={open}
              onOpenChange={setOpen}
              app_id={appId as `app_${string}`}
              action="mandi-supplier-accreditation"
              action_description={`Accredit ${label}.mandi.eth on Mandi`}
              rp_context={rp}
              allow_legacy_proofs={true}
              environment="sandbox"
              preset={selfieCheckLegacy({ signal: wallet })}
              handleVerify={handleVerify}
              onSuccess={() => setOpen(false)}
              onError={(code, report) => setError(`${code} ${report ? JSON.stringify(report) : ""}`)}
            />
          )}
          {result && (
            <div className="card approved">
              <b>accredited</b> · attestation issued by {result.attestation.issuer} until {new Date(result.attestation.expiry * 1000).toLocaleDateString()}
              <div className="muted">
                ENS mandi:verified flag: {result.ensTx ? <span className="mono">{result.ensTx}</span> : <span className="error">{result.ensError}</span>} (display hint only)
              </div>
              <div>
                <a href={ensExplorer(result.attestation.name)} target="_blank" rel="noreferrer">
                  {result.attestation.name} on ENS
                </a>
              </div>
              <pre className="mono">{JSON.stringify(result.attestation, null, 2)}</pre>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
