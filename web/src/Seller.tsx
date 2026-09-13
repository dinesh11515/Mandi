import { IDKitRequestWidget, selfieCheckLegacy, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { useCallback, useEffect, useRef, useState } from "react";
import { ensExplorer, sepoliaTx } from "./api";
import { IconAlert, IconArrow, IconCheck, IconExternal, IconShieldCheck, IconWallet, Spinner } from "./icons";
import { Topbar } from "./Shell";
import "./seller.css";
import {
  loadListings,
  loadWorldConfig,
  message,
  registerSeller,
  rpSignature,
  selfieCheckMessage,
  SELLER_LABEL_PATTERN,
  sellerRegistrationMessage,
  verifySelfie,
  type SellerRow,
  type RegisterResult,
  type Tier,
  type VerifyResult,
  type WorldConfig,
} from "./sellerApi";
import { shortAddress, useWallet } from "./wallet";

const DEFAULT_PRICE = "0.03";
const DEFAULT_CAPABILITY = "financial-risk";
const ACCOUNT_PATTERN = /^0\.0\.\d+$/;
const PHASES = ["waiting for signature", "minting on Sepolia", "writing records"];

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

function syncUrl(label: string) {
  const next = new URL(location.href);
  if (label) next.searchParams.set("name", label);
  else next.searchParams.delete("name");
  history.replaceState(null, "", `${next.pathname}${next.search}`);
}

export function Seller() {
  const wallet = useWallet();
  const address = wallet.address ? wallet.address.toLowerCase() : null;
  const appId = (import.meta.env.VITE_WORLD_APP_ID as string | undefined) ?? "";

  const [config, setConfig] = useState<WorldConfig | null>(null);
  const [listings, setListings] = useState<SellerRow[]>([]);
  const [listingsError, setListingsError] = useState<string | null>(null);

  const [label, setLabel] = useState(() => new URLSearchParams(location.search).get("name") ?? "");
  const [tier, setTier] = useState<Tier>("basic");
  const [price, setPrice] = useState(DEFAULT_PRICE);
  const [payTo, setPayTo] = useState("");
  const [upstream, setUpstream] = useState("");
  const [capability, setCapability] = useState(DEFAULT_CAPABILITY);
  const [context, setContext] = useState("");

  const [busy, setBusy] = useState<"register" | "selfie" | null>(null);
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<RegisterResult | null>(null);
  const [ready, setReady] = useState<string | null>(null);

  const [proof, setProof] = useState<{ label: string; owner: string; signature: string } | null>(null);
  const [rp, setRp] = useState<RpContext | null>(null);
  const [action, setAction] = useState("");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const selfieRef = useRef<HTMLElement | null>(null);
  const preselected = useRef(false);
  const live = useRef(wallet);

  useEffect(() => {
    live.current = wallet;
  });

  const ownerNow = () => live.current.address?.toLowerCase() ?? null;

  useEffect(() => {
    let alive = true;
    loadWorldConfig()
      .then((body) => {
        if (!alive) return;
        setConfig(body);
        if (body.action) setAction(body.action);
      })
      .catch((err) => alive && setError(message(err)));
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async (owner: string) => {
    try {
      setListings(await loadListings(owner));
      setListingsError(null);
    } catch (err) {
      setListingsError(message(err));
    }
  }, []);

  useEffect(() => {
    if (!address) {
      setListings([]);
      setListingsError(null);
      return;
    }
    void refresh(address);
  }, [address, refresh, registered, result]);

  useEffect(() => {
    syncUrl(label);
  }, [label]);

  const select = useCallback((row: SellerRow) => {
    setLabel(row.label);
    setTier(row.depth);
    setPrice(String(row.priceHbar));
    setPayTo(row.payTo);
    setUpstream(row.upstream ?? "");
    setCapability(row.capability);
    setContext(row.context);
    setRegistered(null);
    setResult(null);
    setProof(null);
    setRp(null);
    setOpen(false);
    setError(null);
    setReady(row.listed ? row.label : null);
    if (row.listed) requestAnimationFrame(() => selfieRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  useEffect(() => {
    if (preselected.current || !label || listings.length === 0) return;
    const row = listings.find((item) => item.label === label);
    if (!row) return;
    preselected.current = true;
    select(row);
  }, [label, listings, select]);

  const parent = config?.parent ?? "";
  const name = label && parent ? `${label}.${parent}` : "";
  const priceHbar = Number(price);
  const problem = !SELLER_LABEL_PATTERN.test(label)
    ? "name is 1–16 characters: lowercase letters, digits and inner hyphens, no leading or trailing hyphen"
    : !Number.isFinite(priceHbar) || priceHbar <= 0
      ? "price per call must be a positive number of HBAR"
      : !ACCOUNT_PATTERN.test(payTo.trim())
        ? "payTo must be a Hedera account id such as 0.0.1234"
        : !capability.trim()
          ? "capability is required"
          : !context.trim()
            ? "description is required"
            : !parent
              ? "waiting for the registry parent name"
              : null;

  const register = async () => {
    const owner = ownerNow();
    if (!owner || problem) return;
    setError(null);
    setRegistered(null);
    setResult(null);
    setProof(null);
    setRp(null);
    setOpen(false);
    setBusy("register");
    setPhase(0);
    const account = payTo.trim();
    const cap = capability.trim();
    try {
      const signature = await live.current.signMessage(sellerRegistrationMessage({ name, owner, payTo: account, priceHbar, capability: cap }));
      const stillOwner = ownerNow();
      if (stillOwner !== owner) {
        setError(`the connected wallet changed from ${owner} to ${stillOwner ?? "none"} after you signed; connect that wallet again and sign a fresh registration`);
        return;
      }
      setPhase(1);
      const body = await registerSeller({
        label,
        owner,
        signature,
        payTo: account,
        priceHbar,
        capability: cap,
        depth: tier,
        upstream: upstream.trim(),
        context: context.trim(),
      });
      setRegistered(body);
      setReady(label);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  const startSelfie = async () => {
    const owner = ownerNow();
    if (!owner || !ready || !parent) return;
    setError(null);
    setBusy("selfie");
    try {
      const signature = await live.current.signMessage(selfieCheckMessage({ label: ready, parent, owner }));
      const stillOwner = ownerNow();
      if (stillOwner !== owner) {
        setError(`the connected wallet changed from ${owner} to ${stillOwner ?? "none"} after you signed; connect that wallet again and start Selfie Check afresh`);
        return;
      }
      const signed = await rpSignature(ready, owner, signature);
      if (!signed.rp_context) throw new Error("rp-signature response is missing rp_context");
      if (signed.action) setAction(signed.action);
      setProof({ label: ready, owner, signature });
      setRp(signed.rp_context);
      setOpen(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  const handleVerify = async (idkitResponse: IDKitResult) => {
    const owner = ownerNow();
    if (!owner || !ready) throw new Error("connect a wallet and pick a listed name first");
    if (!proof || proof.owner !== owner || proof.label !== ready) throw new Error("the connected wallet or the name changed; start Selfie Check again from this wallet");
    try {
      setResult(await verifySelfie(ready, owner, proof.signature, idkitResponse));
    } catch (err) {
      setError(message(err));
      throw err instanceof Error ? err : new Error(message(err));
    }
  };

  const connected = wallet.status === "connected" && !!address;
  const readyRow = listings.find((row) => row.label === ready) ?? null;
  const readyName = registered?.name ?? readyRow?.name ?? (ready && parent ? `${ready}.${parent}` : "");

  return (
    <>
      <Topbar wallet={wallet} />
      <main className="seller-wrap">
        <div className="hero">
          <div>
            <h1>List your service on Mandi</h1>
            <p>
              Connect the wallet that will own the name, register it under <span className="mono">{parent || "the Mandi registry"}</span>, then prove a human is behind
              it with Selfie Check. Buyer agents discover you from ENS and pay per call over x402.
            </p>
          </div>
        </div>

        <section className="card">
          <div className="card-h">
            <h2>
              <IconWallet size={16} /> Step 0 · Connect your wallet
            </h2>
            {connected ? <span className="pill ok">connected</span> : <span className="pill warn">not connected</span>}
          </div>
          <div className="card-b stack-sm">
            <p className="muted seller-note">
              This wallet becomes the owner of the ENS name on Sepolia and the signal for Selfie Check. Everything below stays disabled until it is connected, and the
              server only accepts a registration signed by it.
            </p>
            {connected ? (
              <dl className="kv">
                <dt>wallet</dt>
                <dd className="mono truncate" title={address ?? ""}>
                  {address}
                </dd>
              </dl>
            ) : (
              <div className="row">
                <button type="button" className="btn primary" onClick={() => void wallet.connect().catch(() => undefined)} disabled={wallet.status === "connecting" || wallet.status === "absent"}>
                  {wallet.status === "connecting" ? <Spinner size={14} /> : <IconWallet size={15} />}
                  {wallet.status === "absent" ? "no browser wallet found" : "Connect wallet"}
                </button>
                {wallet.status === "absent" && <span className="muted">install MetaMask, then reload this page.</span>}
              </div>
            )}
            {wallet.error && (
              <div className="notice bad">
                <IconAlert size={16} /> {wallet.error}
              </div>
            )}
          </div>
        </section>

        {connected && (
          <section className="card">
            <div className="card-h">
              <h2>My listings</h2>
              <span className="muted">{shortAddress(address!)}</span>
            </div>
            <div className="card-b stack-sm">
              {listingsError && (
                <div className="notice bad">
                  <IconAlert size={16} /> {listingsError}
                </div>
              )}
              {listings.length === 0 && !listingsError && <div className="muted">No names owned by this wallet yet. Register one below.</div>}
              {listings.length > 0 && (
                <div className="listings">
                  {listings.map((row) => (
                    <div
                      key={row.label}
                      className={`listing ${row.label === label ? "on" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => select(row)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          select(row);
                        }
                      }}
                    >
                      <div className="who">
                        <b>{row.name}</b>
                        <span className="pill">{row.depth}</span>
                      </div>
                      <div className="badges">
                        {row.listed ? <span className="pill ok">listed on ENS</span> : <span className="pill warn">not minted</span>}
                        {row.attested ? <span className="pill ok">attested</span> : <span className="pill">not attested</span>}
                      </div>
                      <div className="meta">
                        <span>{row.capability}</span>
                        <span className="num">{row.priceHbar} HBAR / call</span>
                        <span className="mono">pays {row.payTo}</span>
                        {row.upstream && <span className="mono truncate">{row.upstream}</span>}
                      </div>
                      <a className="navlink" href={ensExplorer(row.name)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        ENS explorer <IconExternal size={14} />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        <section className="card">
          <div className="card-h">
            <h2>Step 1 · Name, price and payout</h2>
            {name && (
              <a className="navlink" href={ensExplorer(name)} target="_blank" rel="noreferrer">
                ENS explorer <IconExternal size={14} />
              </a>
            )}
          </div>
          <div className="card-b stack-sm">
            <fieldset className="formset stack-sm" disabled={!connected || !!busy}>
              <div className="formgrid">
                <label className="field">
                  name
                  <input
                    className="text"
                    value={label}
                    maxLength={16}
                    placeholder="acme-risk"
                    spellCheck={false}
                    onChange={(e) => setLabel(e.target.value.trim().toLowerCase())}
                  />
                </label>
                <label className="field">
                  tier
                  <select className="text" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
                    <option value="basic">basic</option>
                    <option value="pro">pro</option>
                  </select>
                </label>
                <label className="field">
                  price per call (HBAR)
                  <input className="text num" value={price} inputMode="decimal" spellCheck={false} onChange={(e) => setPrice(e.target.value.trim())} />
                </label>
                <label className="field">
                  Hedera payTo account
                  <input className="text mono" value={payTo} placeholder="0.0.1234" spellCheck={false} onChange={(e) => setPayTo(e.target.value.trim())} />
                </label>
                <label className="field">
                  capability
                  <input className="text" value={capability} spellCheck={false} onChange={(e) => setCapability(e.target.value)} />
                </label>
                <label className="field">
                  upstream API URL <span className="hint">optional</span>
                  <input className="text mono" value={upstream} placeholder="https://api.example.com/score" spellCheck={false} onChange={(e) => setUpstream(e.target.value.trim())} />
                </label>
                <label className="field wide">
                  description <span className="hint">agent-context: one line telling a buyer agent what you sell</span>
                  <textarea className="text" value={context} rows={2} onChange={(e) => setContext(e.target.value)} />
                </label>
              </div>
              <div className="namepreview">
                {label && parent ? (
                  <>
                    will be minted as <b>{name}</b> to {address}
                  </>
                ) : (
                  <>your name will be minted under {parent || "the Mandi registry"}</>
                )}
              </div>
              <p className="muted seller-note">Mandi will list the upstream endpoint on ENS as <span className="mono">mandi:upstream</span>; the demo scorer serves calls.</p>
              <div className="row">
                <button type="button" className="btn primary" onClick={() => void register()} disabled={!connected || !!problem || !!busy}>
                  {busy === "register" ? <Spinner size={14} /> : <IconArrow size={15} />} Sign &amp; register
                </button>
                {connected && problem && <span className="muted">{problem}</span>}
                {!connected && <span className="muted">connect a wallet to register</span>}
              </div>
            </fieldset>
            {busy === "register" && (
              <div className="progress">
                {PHASES.map((text, i) => (
                  <div key={text} className={`stepcard ${i < phase ? "done" : phase === 1 || i === phase ? "active" : ""}`}>
                    <span className="n">{i < phase ? <IconCheck size={13} /> : i + 1}</span>
                    <div>
                      <b>{text}</b>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {error && (
              <div className="notice bad">
                <IconAlert size={16} /> {error}
              </div>
            )}
            {registered && (
              <div className="outcome ok">
                <div className="row between">
                  <b>
                    {registered.minted ? "minted" : "records refreshed"} {registered.name}
                  </b>
                  <a className="navlink" href={ensExplorer(registered.name)} target="_blank" rel="noreferrer">
                    ENS explorer <IconExternal size={14} />
                  </a>
                </div>
                <div className="row">
                  {registered.mintTx && (
                    <a href={sepoliaTx(registered.mintTx)} target="_blank" rel="noreferrer">
                      mint tx <IconExternal size={14} />
                    </a>
                  )}
                  <a href={sepoliaTx(registered.recordsTx)} target="_blank" rel="noreferrer">
                    records tx <IconExternal size={14} />
                  </a>
                </div>
                <div className="recordlist mono">
                  {Object.entries(registered.records).map(([key, value]) => (
                    <div key={key}>
                      <span className="muted">{key}</span>
                      <span>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="card" ref={selfieRef}>
          <div className="card-h">
            <h2>
              <IconShieldCheck size={16} /> Step 2 · Selfie Check
            </h2>
            {result ? <span className="pill ok">attested</span> : ready ? <span className="pill warn">pending</span> : <span className="pill">register first</span>}
          </div>
          <div className="card-b stack-sm">
            <p className="muted seller-note">
              World App proves a unique human stands behind {readyName || "the name"}, signalled with your connected wallet. Policies that require a verified supplier
              only pay attested sellers.
            </p>
            <div className="steps">
              <div className={`stepcard ${ready ? "done" : "active"}`}>
                <span className="n">{ready ? <IconCheck size={13} /> : "1"}</span>
                <div>
                  <b>Name is live on ENS</b>
                  <div className="muted">{ready ? readyName : "register above, or pick a listed name from My listings."}</div>
                </div>
              </div>
              <div className={`stepcard ${result ? "done" : ready ? "active" : ""}`}>
                <span className="n">{result ? <IconCheck size={13} /> : "2"}</span>
                <div>
                  <b>Selfie Check in World App</b>
                  <div className="muted">Scan the QR from a laptop, or open this page inside World App on your phone.</div>
                </div>
              </div>
              <div className={`stepcard ${result ? "done" : ""}`}>
                <span className="n">{result ? <IconCheck size={13} /> : "3"}</span>
                <div>
                  <b>Live on the marketplace</b>
                  <div className="muted">Attested for 90 days and discoverable from the buyer console.</div>
                </div>
              </div>
            </div>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => void startSelfie()} disabled={!connected || !ready || !appId || open || !!busy || !!result}>
                {busy === "selfie" ? <Spinner size={14} /> : <IconShieldCheck size={15} />} Start Selfie Check
              </button>
              {!appId && <span className="pill bad">VITE_WORLD_APP_ID is not set</span>}
            </div>
            {rp && address && ready && (
              <IDKitRequestWidget
                open={open}
                onOpenChange={setOpen}
                app_id={appId as `app_${string}`}
                action={action}
                action_description={`Accredit ${readyName} on Mandi`}
                rp_context={rp}
                allow_legacy_proofs={true}
                environment="production"
                preset={selfieCheckLegacy({ signal: address })}
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
                  {result.ensTx ? <span className="mono">{result.ensTx.slice(0, 18)}…</span> : <span className="pill warn">{result.ensError ?? "record not written"}</span>}{" "}
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
