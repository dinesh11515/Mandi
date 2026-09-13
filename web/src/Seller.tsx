import { IDKitRequestWidget, selfieCheckLegacy, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { useState } from "react";
import { API, ensExplorer } from "./api";
import { IconAlert, IconArrow, IconCheck, IconExternal, IconShieldCheck, Spinner } from "./icons";
import { Topbar } from "./Shell";

type Attestation = { name: string; wallet: string; hashedNullifier: string; expiry: number; issuer: string; sig: string };

type SignedWorldRequest = { rp_context: RpContext; action: string; wallet: string };

const IDKIT_ERRORS: Record<string, string> = {
  user_rejected: "Selfie Check was cancelled in World App. Start again when you are ready.",
  verification_rejected: "Selfie Check was cancelled in World App. Start again when you are ready.",
  cancelled: "Selfie Check was cancelled. Start again when you are ready.",
  credential_unavailable: "Selfie Check is not available for this World App account. Confirm the feature is enabled on the Mandi app in the Developer Portal.",
  feature_unavailable: "Selfie Check is not enabled for this app. Enable it on the World Developer Portal, then retry.",
  invalid_network: "World App is production; Mandi must request environment=production. Redeploy if this persists.",
  invalid_rp_signature: "Relying-party signature was rejected. Check WORLD_SIGNING_KEY and WORLD_RP_ID.",
  unknown_rp: "This rp_id is not registered. Enable World ID 4.0 on the app and wait until production registration is complete.",
  inactive_rp: "The relying party is registered but inactive.",
  malformed_request: "IDKit request was malformed. Check VITE_WORLD_APP_ID, action, and rp_context.",
  connection_failed: "Could not reach World App. Open this page on your phone in World App, or scan the QR from a laptop.",
  timeout: "World App did not return a proof in time. Start Selfie Check again.",
};

export function Seller() {
  const params = new URLSearchParams(location.search);
  const label = params.get("name") ?? "risk-pro";
  const appId = (import.meta.env.VITE_WORLD_APP_ID as string | undefined) ?? "";
  const [wallet, setWallet] = useState(params.get("wallet") ?? "");
  const [rp, setRp] = useState<RpContext | null>(null);
  const [action, setAction] = useState("mandi-supplier-accreditation");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ attestation: Attestation; ensTx: string | null; ensError: string | null } | null>(null);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${API}/world/rp-signature`, { method: "POST" });
      const body = (await res.json()) as SignedWorldRequest & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      const nextWallet = wallet || body.wallet;
      if (!nextWallet) throw new Error("no seller wallet in the URL or on the server");
      setWallet(nextWallet);
      setAction(body.action);
      setRp(body.rp_context);
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
    if (!res.ok) {
      const message = (body as { error?: string }).error ?? `${res.status}`;
      setError(message);
      throw new Error(message);
    }
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
            <p>
              Selfie Check binds a verified human to a supplier name. Buyers whose policy says <span className="mono">requireVerifiedFor</span> will only pay accredited
              suppliers. The attestation is signed by Mandi's verifier; the ENS flag is a display hint only.
            </p>
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
              <dd className="mono truncate">{wallet || <span className="pill">filled when Selfie Check starts</span>}</dd>
              <dt>signal</dt>
              <dd className="muted">the wallet address, so the proof cannot be replayed for another seller</dd>
              <dt>environment</dt>
              <dd>
                <span className="pill info">World App · production</span>
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
                  <b>Complete in World App</b>
                  <div className="muted">Scan the QR from a laptop, or open this page inside World App — IDKit uses the native handoff there. No sandbox build.</div>
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
              <button className="btn primary" onClick={start} disabled={!appId || open || busy || !!result}>
                {busy ? <Spinner size={14} /> : <IconArrow size={15} />} Start Selfie Check
              </button>
              {!appId && <span className="pill bad">VITE_WORLD_APP_ID is not set</span>}
            </div>
            {error && (
              <div className="notice bad">
                <IconAlert size={16} /> {error}
              </div>
            )}
            {rp && wallet && (
              <IDKitRequestWidget
                open={open}
                onOpenChange={setOpen}
                app_id={appId as `app_${string}`}
                action={action}
                action_description={`Accredit ${label}.mandi.eth on Mandi`}
                rp_context={rp}
                allow_legacy_proofs={true}
                environment="production"
                preset={selfieCheckLegacy({ signal: wallet })}
                handleVerify={handleVerify}
                onSuccess={() => setOpen(false)}
                onError={(code) => {
                  if (code === "failed_by_host_app") return;
                  setError(IDKIT_ERRORS[code] ?? code);
                }}
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
                  {result.ensTx ? <span className="mono">{result.ensTx.slice(0, 18)}…</span> : <span className="pill warn">{result.ensError}</span>}{" "}
                  <span className="dim">(display hint only)</span>
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
