import { IDKitRequestWidget, selfieCheckLegacy, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { useState } from "react";
import { API, ensExplorer } from "./api";
import { IconAlert, IconArrow, IconCheck, IconExternal, IconShieldCheck, Spinner } from "./icons";
import { Topbar } from "./Shell";

type Attestation = { name: string; wallet: string; hashedNullifier: string; expiry: number; issuer: string; sig: string };

export function Seller() {
  const params = new URLSearchParams(location.search);
  const label = params.get("name") ?? "risk-pro";
  const wallet = params.get("wallet") ?? "";
  const appId = (import.meta.env.VITE_WORLD_APP_ID as string | undefined) ?? "";
  const [rp, setRp] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ attestation: Attestation; ensTx: string | null; ensError: string | null } | null>(null);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${API}/world/rp-signature`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      setRp(body as RpContext);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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

  const step = result ? 3 : open || rp ? 2 : 1;

  return (
    <>
      <Topbar />
      <main className="seller-wrap">
        <div className="hero">
          <div>
            <h1>Seller accreditation</h1>
            <p>Selfie Check binds a verified human to a supplier name. Buyers whose policy says <span className="mono">requireVerifiedFor</span> will only pay accredited suppliers. The attestation is signed by Mandi's verifier; the ENS flag is a display hint only.</p>
          </div>
        </div>
        <section className="card">
          <div className="card-h">
            <h2>
              <IconShieldCheck size={16} /> {label}.mandi.eth
            </h2>
            <a className="navlink" href={ensExplorer(`${label}.mandi.eth`)} target="_blank" rel="noreferrer">
              ENS explorer <IconExternal size={14} />
            </a>
          </div>
          <div className="card-b stack-sm">
            <dl className="kv">
              <dt>seller wallet</dt>
              <dd className="mono truncate">{wallet || <span className="pill bad">missing ?wallet= in the URL</span>}</dd>
              <dt>signal</dt>
              <dd className="muted">the wallet address, so the proof cannot be replayed for another seller</dd>
              <dt>environment</dt>
              <dd>
                <span className="pill info">World ID Sandbox</span>
              </dd>
            </dl>
            <div className="steps">
              <div className={`stepcard ${step > 1 ? "done" : "active"}`}>
                <span className="n">{step > 1 ? <IconCheck size={13} /> : "1"}</span>
                <div>
                  <b>Start Selfie Check</b>
                  <div className="muted">Mandi signs the request with its relying-party key.</div>
                </div>
              </div>
              <div className={`stepcard ${step > 2 ? "done" : step === 2 ? "active" : ""}`}>
                <span className="n">{step > 2 ? <IconCheck size={13} /> : "2"}</span>
                <div>
                  <b>Scan with the Sandbox app</b>
                  <div className="muted">Complete the selfie flow. The proof is verified against World's v4 endpoint and the signal is checked against the wallet.</div>
                </div>
              </div>
              <div className={`stepcard ${step === 3 ? "done" : ""}`}>
                <span className="n">{step === 3 ? <IconCheck size={13} /> : "3"}</span>
                <div>
                  <b>Attestation issued</b>
                  <div className="muted">Valid for 90 days, one accreditation per human, enforced by the executor.</div>
                </div>
              </div>
            </div>
            <div className="row">
              <button className="btn primary" onClick={start} disabled={!wallet || !appId || open || busy || !!result}>
                {busy ? <Spinner size={14} /> : <IconArrow size={15} />} Start Selfie Check
              </button>
              {!appId && <span className="pill bad">VITE_WORLD_APP_ID is not set</span>}
            </div>
            {error && (
              <div className="notice bad">
                <IconAlert size={16} /> {error}
              </div>
            )}
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
              <div className="outcome ok">
                <div className="row between">
                  <b>accredited</b>
                  <span className="muted">until {new Date(result.attestation.expiry * 1000).toLocaleDateString()}</span>
                </div>
                <div className="muted">
                  ENS <span className="mono">mandi:verified</span>:{" "}
                  {result.ensTx ? <span className="mono">{result.ensTx.slice(0, 18)}…</span> : <span className="pill warn">{result.ensError}</span>} <span className="dim">(display hint only)</span>
                </div>
                <pre className="json">{JSON.stringify(result.attestation, null, 2)}</pre>
                <a href="/">
                  back to the console <IconArrow size={12} />
                </a>
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
