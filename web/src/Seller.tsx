import { IDKitRequestWidget, selfieCheckLegacy, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { useEffect, useState } from "react";
import { API, ensExplorer, sepoliaTx } from "./api";
import { IconAlert, IconArrow, IconCheck, IconExternal, IconShieldCheck, Spinner } from "./icons";
import { Topbar } from "./Shell";

type AttestationRecord = { name: string; wallet: string; hashedNullifier: string; expiry: number; issuer: string; sig: string };

type WorldConfig = { action: string; wallet: string; labels: string[] };
type SignedWorldRequest = { action: string; wallet: string; rp_context: RpContext };
type RegisterResult = { name: string; owner: string; minted: boolean; mintTx: string | null; recordsTx: string; records: Record<string, string> };

const PRICE_KEY = "mandi:price";

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

function syncUrl(name: string, wallet: string) {
  const next = new URL(location.href);
  if (name) next.searchParams.set("name", name);
  if (wallet) next.searchParams.set("wallet", wallet);
  history.replaceState(null, "", `${next.pathname}${next.search}`);
}

export function Seller() {
  const appId = (import.meta.env.VITE_WORLD_APP_ID as string | undefined) ?? "";
  const [label, setLabel] = useState(() => new URLSearchParams(location.search).get("name") ?? "");
  const [labels, setLabels] = useState<string[]>([]);
  const [wallet, setWallet] = useState(() => new URLSearchParams(location.search).get("wallet") ?? "");
  const [listed, setListed] = useState(false);
  const [listing, setListing] = useState<RegisterResult | null>(null);
  const [rp, setRp] = useState<RpContext | null>(null);
  const [action, setAction] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"register" | "enroll" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ attestation: AttestationRecord; ensTx: string | null; ensError: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API}/world/config`)
      .then(async (res) => {
        const body = (await res.json()) as Partial<WorldConfig> & { error?: string };
        if (!alive) return;
        if (!res.ok) throw new Error(body.error ?? `${res.status}`);
        if (body.labels?.length) setLabels(body.labels);
        if (body.action) setAction(body.action);
        const configured = body.wallet;
        if (configured) setWallet((prev) => prev || configured);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    syncUrl(label, wallet);
  }, [label, wallet]);

  useEffect(() => {
    let alive = true;
    setListed(false);
    setListing(null);
    setResult(null);
    setRp(null);
    setOpen(false);
    if (!label) return;
    fetch(`${API}/resolve/${label}.mandi.eth`)
      .then((res) => alive && setListed(res.ok))
      .catch(() => alive && setListed(false));
    return () => {
      alive = false;
    };
  }, [label]);

  const mint = async (): Promise<RegisterResult> => {
    const res = await fetch(`${API}/sellers/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const body = (await res.json()) as RegisterResult & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status}`);
    setListing(body);
    setListed(true);
    setLabels((prev) => (prev.includes(label) ? prev : [...prev, label]));
    return body;
  };

  const selfie = async () => {
    const res = await fetch(`${API}/world/rp-signature`, { method: "POST" });
    const body = (await res.json()) as Partial<SignedWorldRequest> & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status}`);
    if (!body.rp_context) throw new Error("rp-signature response missing rp_context");
    const nextWallet = wallet || body.wallet || "";
    if (!nextWallet) throw new Error("no seller wallet configured");
    setWallet(nextWallet);
    if (body.action) setAction(body.action);
    setRp(body.rp_context);
    setOpen(true);
  };

  const register = async () => {
    setError(null);
    setBusy("register");
    try {
      await mint();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const enroll = async () => {
    setError(null);
    setBusy("enroll");
    try {
      if (!listed) await mint();
      await selfie();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
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

  const onChain = listed || !!listing;
  const step = result ? 3 : onChain || rp || open ? 2 : 1;
  const name = label ? `${label}.mandi.eth` : "your-name.mandi.eth";
  const ready = Boolean(label && appId && wallet);
  const price = listing?.records[PRICE_KEY];

  return (
    <>
      <Topbar />
      <main className="seller-wrap">
        <div className="hero">
          <div>
            <h1>Become a seller</h1>
            <p>
              Pick a new name, mint it on ENS, then Selfie Check. The buyer agent will discover you from <span className="mono">mandi.eth</span> and only pay you if
              policy allows an attested supplier.
            </p>
          </div>
        </div>
        <section className="card">
          <div className="card-h">
            <h2>
              <IconShieldCheck size={16} /> {name}
            </h2>
            {label && (
              <a className="navlink" href={ensExplorer(name)} target="_blank" rel="noreferrer">
                ENS explorer <IconExternal size={14} />
              </a>
            )}
          </div>
          <div className="card-b stack-sm">
            <label className="field">
              supplier name
              <input
                className="text"
                value={label}
                maxLength={16}
                placeholder="acme-risk"
                spellCheck={false}
                disabled={!!busy || !!result}
                onChange={(e) => setLabel(e.target.value.trim().toLowerCase())}
              />
            </label>
            {labels.length > 0 && (
              <div className="chips" role="group" aria-label="names already in the directory">
                {labels.map((item) => (
                  <button key={item} type="button" className={`chip ${item === label ? "on" : ""}`} onClick={() => setLabel(item)} disabled={!!busy || !!result}>
                    {item}
                  </button>
                ))}
              </div>
            )}
            <dl className="kv">
              <dt>seller wallet</dt>
              <dd className="mono truncate">{wallet || <span className="pill">resolving seller wallet…</span>}</dd>
              <dt>listing</dt>
              <dd>{onChain ? <span className="pill ok">on ENS</span> : <span className="pill">not minted yet</span>}</dd>
              {price && (
                <>
                  <dt>price</dt>
                  <dd className="num">{price} / call</dd>
                </>
              )}
            </dl>
            <div className="steps">
              <div className={`stepcard ${onChain ? "done" : "active"}`}>
                <span className="n">{onChain ? <IconCheck size={13} /> : "1"}</span>
                <div>
                  <b>Register on ENS</b>
                  <div className="muted">Mints {name} live on Sepolia and publishes the x402 endpoint.</div>
                </div>
              </div>
              <div className={`stepcard ${step > 2 ? "done" : step === 2 ? "active" : ""}`}>
                <span className="n">{step > 2 ? <IconCheck size={13} /> : "2"}</span>
                <div>
                  <b>Selfie Check in World App</b>
                  <div className="muted">Opens immediately after the mint. Scan the QR, or stay in World App.</div>
                </div>
              </div>
              <div className={`stepcard ${step === 3 ? "done" : ""}`}>
                <span className="n">{step === 3 ? <IconCheck size={13} /> : "3"}</span>
                <div>
                  <b>Live on the marketplace</b>
                  <div className="muted">Attested for 90 days. Refresh the console — the new name is in the directory.</div>
                </div>
              </div>
            </div>
            <div className="row">
              <button className="btn primary" onClick={enroll} disabled={!ready || open || !!busy || !!result}>
                {busy === "enroll" ? <Spinner size={14} /> : <IconArrow size={15} />} {onChain ? "Start Selfie Check" : "Register & Selfie Check"}
              </button>
              {onChain && (
                <button className="btn ghost" onClick={register} disabled={!ready || !!busy || !!result}>
                  {busy === "register" ? <Spinner size={14} /> : <IconArrow size={15} />} Refresh ENS records
                </button>
              )}
              {!appId && <span className="pill bad">VITE_WORLD_APP_ID is not set</span>}
            </div>
            {busy === "enroll" && !listing && <div className="muted">minting on Sepolia, then opening World ID…</div>}
            {listing && (
              <div className="notice ok">
                <IconCheck size={16} />
                <span>
                  {listing.minted ? "minted" : "already listed"} {listing.name}
                  {" · "}
                  <a href={sepoliaTx(listing.recordsTx)} target="_blank" rel="noreferrer">
                    records tx <IconExternal size={14} />
                  </a>
                  {listing.mintTx && (
                    <>
                      {" · "}
                      <a href={sepoliaTx(listing.mintTx)} target="_blank" rel="noreferrer">
                        mint tx <IconExternal size={14} />
                      </a>
                    </>
                  )}
                </span>
              </div>
            )}
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
                action_description={`Accredit ${name} on Mandi`}
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
                  {result.ensTx ? (
                    <span className="mono">{result.ensTx.slice(0, 18)}…</span>
                  ) : (
                    <span className="pill warn">{result.ensError ?? "record not written"}</span>
                  )}{" "}
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
