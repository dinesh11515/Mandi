import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import {
  activate,
  ensExplorer,
  hashscanAccount,
  hashscanTx,
  loadActivation,
  loadExecutor,
  loadFunding,
  loadSuppliers,
  mandate,
  parsePolicy,
  sellerHref,
  STAGES,
  stream,
  type Activation,
  type AgentEvent,
  type Decision,
  type Executor,
  type Funding,
  type Policy,
  type Ranking,
  type SupplierRow,
} from "./api";
import { IconAlert, IconArrow, IconBolt, IconCheck, IconCoins, IconCopy, IconExternal, IconRefresh, IconShield, IconShieldCheck, IconWallet, IconX, Spinner } from "./icons";
import { Topbar } from "./Shell";
import { useWallet, type Wallet } from "./wallet";

const PRESETS: Record<string, Policy> = {
  "Verified only": { budgetTotal: "1 HBAR", maxPerCall: "0.05 HBAR", requireVerifiedFor: ["financial"], minSuccessRate: 0.95, fallbackOnFailure: true },
  Open: { budgetTotal: "1 HBAR", maxPerCall: "0.05 HBAR", requireVerifiedFor: [], minSuccessRate: 0.7, fallbackOnFailure: true },
  "Cheap only": { budgetTotal: "0.1 HBAR", maxPerCall: "0.03 HBAR", requireVerifiedFor: [], minSuccessRate: 0.7, fallbackOnFailure: true },
  "Impossible": { budgetTotal: "1 HBAR", maxPerCall: "0.01 HBAR", requireVerifiedFor: [], minSuccessRate: 0.99, fallbackOnFailure: true },
};

const TASKS = ["Assess risk of Aave", "Assess risk of Compound", "Assess risk of Morpho", "Assess risk of Lido"];
const STEPS = STAGES.filter((s) => s !== "done");
const DEPOSIT_POLL_MS = 3_000;
const DEPOSIT_WAIT_MS = 90_000;

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`);
const clock = (ts: number | null | undefined) => (ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : "never");
const short = (s: string, n = 10) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-6)}` : s);
const hbar = (n: number) => `${Math.round(n * 1e8) / 1e8} HBAR`;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const stamp = (ts: string | number) => {
  const seconds = Number(String(ts).split(".")[0]);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toLocaleString() : String(ts);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const depositProblem = (raw: string): string | null => {
  const value = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(value)) return "the deposit amount has to be a number of HBAR";
  if (value < 0.01) return "deposit at least 0.01 HBAR";
  if (Number(value.toFixed(8)) !== value) return "HBAR carries at most 8 decimals, which is what the transfer sends";
  return null;
};

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="iconbtn"
      aria-label="copy"
      title="copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <IconCheck size={14} /> : <IconCopy size={14} />}
    </button>
  );
}

function Accreditation({ row }: { row: SupplierRow }) {
  if (row.attestation?.valid)
    return (
      <span className="pill ok">
        <IconShieldCheck size={13} /> verified · attested
      </span>
    );
  if (row.card.verified)
    return (
      <span className="pill warn">
        <IconShield size={13} /> ENS flag only
      </span>
    );
  return (
    <span className="pill">
      <IconShield size={13} /> unverified
    </span>
  );
}

function Suppliers({ rows, loading, error, onRefresh }: { rows: SupplierRow[]; loading: boolean; error: string | null; onRefresh: () => void }) {
  return (
    <section className="card">
      <div className="card-h">
        <h2>
          Marketplace <span className="sub">identity from ENSv2 Sepolia · reliability from HCS receipts</span>
        </h2>
        <button className="btn ghost sm" onClick={onRefresh} disabled={loading}>
          {loading ? <Spinner size={14} /> : <IconRefresh size={14} />} refresh
        </button>
      </div>
      {error && (
        <div className="card-b">
          <div className="notice bad">
            <IconAlert size={16} /> {error}
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>supplier</th>
              <th>capability</th>
              <th className="right">price / call</th>
              <th>accreditation</th>
              <th>success rate</th>
              <th className="right">sample</th>
              <th className="right">avg cost</th>
              <th className="right">avg latency</th>
              <th className="right">last active</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <div className="empty">
                    {loading ? (
                      <span className="row">
                        <Spinner size={16} /> resolving suppliers from the ENS directory…
                      </span>
                    ) : (
                      <>
                        <b>No suppliers in the directory yet</b>
                        <span>Names registered under the Mandi registry show up here with their price, accreditation and Reliability.</span>
                        <a className="btn ghost sm" href={sellerHref()}>
                          <IconShield size={14} /> Register a service
                        </a>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const rate = r.reliability.successRate;
              const tone = rate === null ? "" : rate >= 0.95 ? "" : rate >= 0.8 ? "warn" : "bad";
              return (
                <tr key={r.name}>
                  <td>
                    <div className="name">
                      <a href={ensExplorer(r.name)} target="_blank" rel="noreferrer">
                        {r.name} <IconExternal size={12} />
                      </a>
                      <span className="endpoint truncate">{r.card.endpoint}</span>
                    </div>
                  </td>
                  <td>
                    <span className="pill info">{r.card.capability}</span>
                  </td>
                  <td className="right num">{r.card.price}</td>
                  <td>
                    <div className="row accred">
                      <Accreditation row={r} />
                      {!r.attestation?.valid && (
                        <a className="navlink" href={sellerHref(r.name.split(".")[0])}>
                          register
                        </a>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="rate">
                      <div className={`bar ${tone}`}>
                        <i style={{ width: `${Math.round((rate ?? 0) * 100)}%` }} />
                      </div>
                      <span className="num">{pct(rate)}</span>
                    </div>
                  </td>
                  <td className="right num">{r.reliability.sampleSize}</td>
                  <td className="right num">{r.reliability.avgCostHbar === null ? "n/a" : `${r.reliability.avgCostHbar} HBAR`}</td>
                  <td className="right num">{r.reliability.avgLatencyMs === null ? "n/a" : `${r.reliability.avgLatencyMs} ms`}</td>
                  <td className="right num dim">{clock(r.reliability.lastActive)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FundingCard({ wallet, refreshToken }: { wallet: Wallet; refreshToken: number }) {
  const address = wallet.address;
  const live = useRef(wallet);
  const [executor, setExecutor] = useState<Executor | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const [funding, setFunding] = useState<Funding | null>(null);
  const [amount, setAmount] = useState("0.5");
  const [depositing, setDepositing] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    live.current = wallet;
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    loadExecutor()
      .then((found) => {
        if (!alive.current) return;
        setExecutor(found);
        setOffline(found ? null : "executor funding unavailable — the executor account is not exposed yet");
      })
      .catch((err) => alive.current && setOffline(`executor funding unavailable — ${message(err)}`));
  }, [refreshToken]);

  const refreshFunding = useCallback(async (): Promise<Funding | null> => {
    const at = live.current.address;
    if (!at) {
      setFunding(null);
      return null;
    }
    try {
      const next = await loadFunding(at);
      if (!alive.current || live.current.address !== at) return null;
      setFunding(next);
      return next;
    } catch (err) {
      if (alive.current && live.current.address === at) setError(message(err));
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshFunding();
  }, [address, refreshFunding, refreshToken]);

  const onDeposit = async () => {
    const at = live.current.address;
    if (!at || !executor) return;
    const invalid = depositProblem(amount);
    if (invalid) {
      setError(invalid);
      return;
    }
    const value = Number(amount.trim());
    setError(null);
    setNote(null);
    setTxHash(null);
    setDepositing(true);
    const before = funding?.depositedHbar ?? 0;
    try {
      const hash = await live.current.sendHbar(executor.evmAddress as Address, value);
      if (!alive.current) return;
      setTxHash(hash);
      setDepositing(false);
      setWaiting(true);
      const deadline = Date.now() + DEPOSIT_WAIT_MS;
      let credited = false;
      let switched = false;
      while (alive.current && Date.now() < deadline && !credited && !switched) {
        await sleep(DEPOSIT_POLL_MS);
        switched = live.current.address !== at;
        if (switched) break;
        const next = await refreshFunding();
        credited = next !== null && next.depositedHbar > before + 1e-9;
      }
      if (!alive.current) return;
      setWaiting(false);
      setNote(
        switched
          ? "the connected wallet changed, so the console stopped watching for this deposit; switch back to the sending wallet to see it credited"
          : credited
            ? `credited ${hbar(value)} to your balance with the executor`
            : "the deposit has not appeared on the mirror node yet; refresh in a moment",
      );
    } catch (err) {
      if (!alive.current) return;
      setDepositing(false);
      setWaiting(false);
      setError(message(err));
    }
  };

  const busy = depositing || waiting;
  const available = funding?.availableHbar ?? 0;
  const amountProblem = depositProblem(amount);

  return (
    <section className="card">
      <div className="card-h">
        <h2>
          Funding <span className="sub">the executor spends your deposit, never its own</span>
        </h2>
        <span className={`pill ${available > 0 ? "ok" : ""}`}>
          <IconCoins size={13} /> {hbar(available)} available
        </span>
      </div>
      <div className="card-b stack-sm">
        {offline && (
          <div className="notice bad">
            <IconAlert size={16} /> {offline}
          </div>
        )}
        {executor && (
          <dl className="kv">
            <dt>executor</dt>
            <dd className="row" style={{ gap: 4 }}>
              <a className="mono" href={hashscanAccount(executor.accountId)} target="_blank" rel="noreferrer">
                {executor.accountId} <IconExternal size={12} />
              </a>
              <Copy text={executor.accountId} />
              <span className="dim num">{hbar(executor.balanceHbar)} on the account</span>
            </dd>
            <dt>evm address</dt>
            <dd className="row" style={{ gap: 4 }}>
              <span className="mono truncate" title={executor.evmAddress}>
                {executor.evmAddress}
              </span>
              <Copy text={executor.evmAddress} />
            </dd>
          </dl>
        )}
        <div className="ledger">
          <div>
            <div className="label">deposited by you</div>
            <div className="value">{funding ? hbar(funding.depositedHbar) : "–"}</div>
          </div>
          <div>
            <div className="label">spent</div>
            <div className="value">{funding ? hbar(funding.spentHbar) : "–"}</div>
          </div>
          <div className="lead">
            <div className="label">available</div>
            <div className="value">{funding ? hbar(funding.availableHbar) : "–"}</div>
          </div>
        </div>
        <div className="depositrow">
          <label className="field grow">
            <span className="labelrow">
              amount to deposit <span className="hint">HBAR</span>
            </span>
            <input
              className="text num"
              type="number"
              min="0.01"
              step="0.1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!address || busy}
              aria-invalid={address !== null && amountProblem !== null}
              aria-label="deposit amount in HBAR"
            />
          </label>
          <button className="btn primary" onClick={() => void onDeposit()} disabled={!address || !executor || busy || amountProblem !== null} aria-busy={busy}>
            {busy ? <Spinner size={14} /> : <IconWallet size={15} />} {depositing ? "confirm in your wallet" : waiting ? "waiting for the mirror node" : "Deposit"}
          </button>
          <button className="btn ghost sm" onClick={() => void refreshFunding()} disabled={!address || busy} title="refresh funding">
            <IconRefresh size={14} /> refresh
          </button>
        </div>
        {!address ? (
          <p className="fieldnote">Connect a wallet to deposit. It signs a single HBAR transfer to the executor and switches to Hedera testnet (chain 296) for it.</p>
        ) : amountProblem ? (
          <p className="fieldnote bad">{amountProblem}</p>
        ) : (
          <p className="fieldnote">Your wallet sends this to the executor account above. The executor may only spend it under a policy you signed.</p>
        )}
        {error && (
          <div className="notice bad">
            <IconAlert size={16} /> {error}
          </div>
        )}
        {txHash && (
          <div className="notice ok">
            <IconCheck size={16} />
            <span>
              deposit sent ·{" "}
              <a href={hashscanTx(txHash)} target="_blank" rel="noreferrer">
                {short(txHash, 10)} <IconExternal size={12} />
              </a>
              {note ? ` · ${note}` : ""}
            </span>
          </div>
        )}
        {funding && funding.deposits.length > 0 && (
          <div className="subsection">
            <div className="subsection-h">
              your deposits <span className="count">{funding.deposits.length}</span>
            </div>
            <ul className="deposits">
              {funding.deposits.map((d) => (
                <li key={d.txId}>
                  <span className="num">{hbar(d.amountHbar)}</span>
                  <span className="dim truncate">{stamp(d.consensusTimestamp)}</span>
                  <a href={d.hashscan} target="_blank" rel="noreferrer">
                    HashScan <IconExternal size={12} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {funding && funding.deposits.length === 0 && address && <p className="fieldnote">No deposits from this wallet yet.</p>}
      </div>
    </section>
  );
}

function DecisionCard({ decision, ranking }: { decision: Decision; ranking: Ranking[] }) {
  const failed = decision.checks.filter((c) => !c.passed);
  const position = ranking.find((r) => r.name === decision.supplier)?.rank;
  return (
    <div className={`decision ${decision.status}`}>
      <div className="dh">
        <div className="row">
          <span className={`pill ${decision.status === "approved" ? "ok" : "bad"}`}>
            {decision.status === "approved" ? <IconCheck size={13} /> : <IconX size={13} />} {decision.status}
          </span>
          <span className="num">{decision.priceHbar} HBAR</span>
          <span className="dim">preference #{position ?? "?"} of {ranking.length}</span>
        </div>
        <span className="dim">{failed.length === 0 ? "every check passed, payment signed" : `${failed.length} check${failed.length > 1 ? "s" : ""} failed, nothing signed`}</span>
      </div>
      <div className="checks">
        {decision.checks.map((c) => (
          <div key={c.name} className={`check ${c.passed ? "pass" : "fail"}`}>
            <span className="icon">{c.passed ? <IconCheck size={12} /> : <IconX size={12} />}</span>
            <span className="k">{c.name}</span>
            <span className="v">{c.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type Body = { riskScore?: number; liquidityRisk?: string; notes?: string[] };

function Event({ ev, ranking }: { ev: AgentEvent; ranking: Ranking[] }) {
  const tone =
    ev.stage === "done"
      ? ev.outcome === "FULFILLED"
        ? "ok"
        : "bad"
      : ev.stage === "authorization"
        ? (ev.decision as Decision).status === "approved"
          ? "ok"
          : "bad"
        : ev.stage === "payment"
          ? (ev.payment as { settled: boolean }).settled
            ? "ok"
            : "bad"
          : ev.stage === "receipt"
            ? ev.fulfilled
              ? "ok"
              : "bad"
            : "accent";
  const link = (href: unknown, label: string) =>
    typeof href === "string" ? (
      <a href={href} target="_blank" rel="noreferrer" className="row" style={{ gap: 4, display: "inline-flex" }}>
        {label} <IconExternal size={12} />
      </a>
    ) : null;
  const body = (ev.body ?? null) as Body | null;
  const rejections = Array.isArray(ev.rejections) ? (ev.rejections as { supplier: string; reasons: string[] }[]) : [];
  const unfunded = rejections.some((r) => r.reasons.some((reason) => /deposit/i.test(reason)));
  return (
    <div className={`ev ${tone}`}>
      <div className="node">{tone === "ok" ? <IconCheck size={11} /> : tone === "bad" ? <IconX size={11} /> : <IconArrow size={11} />}</div>
      <div className="body">
        <div className="head">
          <span className="stage">{ev.stage}</span>
          <span className="time">{clock(ev.ts)}</span>
          {typeof ev.supplier === "string" && <span className="title">{ev.supplier}</span>}
          {typeof ev.name === "string" && ev.stage === "resolution" && <span className="title">{ev.name}</span>}
        </div>
        {ev.stage === "discovery" && (
          <div className="muted">
            capability <b>{String(ev.capability)}</b> · protocol <b>{String(ev.protocol)}</b> · route <b className="mono">{String(ev.route)}</b> · {(ev.names as string[]).length} names from the ENS directory
          </div>
        )}
        {ev.stage === "resolution" &&
          (typeof ev.error === "string" ? (
            <div className="notice bad">
              <IconAlert size={14} /> {ev.error}
            </div>
          ) : (
            <div className="muted">
              resolved via the universal resolver · {(ev.card as { price: string }).price} · {ev.attested ? "attested" : "not attested"} · {pct(((ev.reliability as { successRate: number | null } | null) ?? { successRate: null }).successRate)} over{" "}
              {((ev.reliability as { sampleSize: number } | null) ?? { sampleSize: 0 }).sampleSize}
            </div>
          ))}
        {ev.stage === "preference" && (
          <>
            <div className="muted">{String(ev.rule)}</div>
            <ol className="ranking">
              {(ev.ranking as Ranking[]).map((r) => (
                <li key={r.name}>
                  <span className="n">{r.rank}</span>
                  <span>
                    {r.name} <span className="dim">· {r.price}</span>
                  </span>
                  <span className="dim num">
                    {r.attested ? "attested · " : ""}
                    {pct(r.successRate)} / {r.sampleSize}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
        {ev.stage === "authorization" && (
          <>
            <DecisionCard decision={ev.decision as Decision} ranking={ranking} />
            {typeof ev.hcsTx === "string" && (
              <div className="dim" style={{ marginTop: 6 }}>
                decision anchored on HCS · {link(hashscanTx(ev.hcsTx), "HashScan")}
              </div>
            )}
          </>
        )}
        {ev.stage === "payment" && (
          <div className="row">
            {(ev.payment as { settled: boolean }).settled ? (
              <span className="pill ok">
                <IconCheck size={13} /> settled via Blocky402
              </span>
            ) : (
              <span className="pill bad">
                <IconX size={13} /> not settled
              </span>
            )}
            {link((ev.payment as { hashscan: string | null }).hashscan, "HashScan")}
            <span className="dim num">ledger {(ev.ledger as { spentHbar: number }).spentHbar} HBAR spent</span>
            {typeof (ev.payment as { error: string | null }).error === "string" && <span className="dim">{(ev.payment as { error: string }).error}</span>}
          </div>
        )}
        {ev.stage === "receipt" && (
          <div className="result">
            <div className="row between">
              <div className="row">
                {ev.fulfilled ? (
                  <span className="pill ok">
                    <IconCheck size={13} /> fulfilled
                  </span>
                ) : (
                  <span className="pill bad">
                    <IconX size={13} /> not fulfilled
                  </span>
                )}
                <span className="dim num">{String(ev.latencyMs)} ms</span>
                {link(ev.hashscan, "tx")}
              </div>
              {typeof ev.error === "string" && <span className="dim">{ev.error}</span>}
            </div>
            {body && typeof body.riskScore === "number" && (
              <>
                <div className="score">
                  <b>{body.riskScore}</b>
                  <span className="muted">risk score</span>
                  <span className={`pill ${body.liquidityRisk === "high" ? "bad" : body.liquidityRisk === "medium" ? "warn" : "ok"}`}>{body.liquidityRisk} liquidity risk</span>
                </div>
                {body.notes && (
                  <details>
                    <summary>{body.notes.length} data points from the supplier</summary>
                    <ul>
                      {body.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        )}
        {ev.stage === "done" && (
          <div className={`outcome ${ev.outcome === "FULFILLED" ? "ok" : "bad"}`}>
            <div className="row between">
              <b>{String(ev.outcome).replaceAll("_", " ")}</b>
              {typeof ev.supplier === "string" && <span className="muted">served by {ev.supplier}</span>}
            </div>
            {typeof ev.error === "string" && <div className="muted">{ev.error}</div>}
            {rejections.length > 0 && (
              <ul>
                {rejections.map((r) => (
                  <li key={r.supplier}>
                    <b>{r.supplier}</b>: {r.reasons.join(" · ")}
                  </li>
                ))}
              </ul>
            )}
            {unfunded && <div className="muted">Deposit HBAR to the executor in the funding card, then run the task again.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Stepper({ events, running }: { events: AgentEvent[]; running: boolean }) {
  const seen = new Set(events.map((e) => e.stage));
  const last = events.at(-1)?.stage;
  const done = events.find((e) => e.stage === "done");
  const failed = done && done.outcome !== "FULFILLED";
  return (
    <div className="stepper" aria-label="pipeline stages">
      {STEPS.map((s) => {
        const state = seen.has(s) ? (running && last === s ? "active" : "done") : "";
        return (
          <div key={s} className={`step ${state} ${failed && s === "authorization" && !seen.has("payment") ? "failed" : ""}`}>
            <span>{s}</span>
            <i />
          </div>
        );
      })}
    </div>
  );
}

export function App() {
  const wallet = useWallet();
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [preset, setPreset] = useState<string>("Open");
  const [policyText, setPolicyText] = useState(JSON.stringify(PRESETS.Open, null, 2));
  const logRef = useRef<HTMLDivElement>(null);
  const [activating, setActivating] = useState(false);
  const [activation, setActivation] = useState<Activation | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [task, setTask] = useState(TASKS[0]!);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [fundingToken, setFundingToken] = useState(0);
  const cancelRun = useRef<(() => void) | null>(null);
  const ranking = useMemo(() => (events.find((e) => e.stage === "preference")?.ranking as Ranking[] | undefined) ?? [], [events]);

  const refresh = async () => {
    setRowsLoading(true);
    setRowsError(null);
    try {
      setRows(await loadSuppliers());
    } catch (err) {
      setRowsError(message(err));
    } finally {
      setRowsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    return () => cancelRun.current?.();
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [events.length, runError]);

  const applyPreset = (name: string) => {
    setPreset(name);
    setPolicyText(JSON.stringify(PRESETS[name], null, 2));
  };

  const onActivate = async () => {
    setActivationError(null);
    const signer = wallet.address;
    if (!signer) {
      setActivationError("connect a wallet to sign the mandate");
      return;
    }
    setActivating(true);
    try {
      const signed = mandate(parsePolicy(policyText));
      const signature = await wallet.signMessage(signed.message);
      const result = await activate({ policy: signed.policy, expiry: signed.expiry, signature, signer });
      setActivation(result);
      setFundingToken((n) => n + 1);
      if (result.policyHash !== signed.policyHash)
        setActivationError(`this console signed policy ${short(signed.policyHash, 8)} but the executor stored ${short(result.policyHash, 8)}; the canonical form drifted between the two`);
    } catch (err) {
      setActivationError(message(err));
    } finally {
      setActivating(false);
    }
  };

  const connected = wallet.address !== null;
  const signerMismatch = activation !== null && wallet.address !== null && activation.signer.toLowerCase() !== wallet.address.toLowerCase();
  const runBlock = !activation
    ? "sign and activate a policy first"
    : !connected
      ? "connect the wallet that signed this policy before running the task"
      : signerMismatch
        ? `this policy was signed by ${short(activation.signer, 6)}; switch back to that wallet or sign and activate a new policy`
        : null;

  const onRun = () => {
    if (!activation || runBlock) return;
    cancelRun.current?.();
    setEvents([]);
    setRunError(null);
    setRunning(true);
    cancelRun.current = stream(
      task,
      activation.policyHash,
      activation.runToken,
      (ev) => setEvents((prev) => [...prev, ev]),
      (error) => {
        cancelRun.current = null;
        setRunning(false);
        setRunError(error);
        void loadActivation(activation.policyHash)
          .then((fresh) => setActivation((prev) => (prev && prev.policyHash === fresh.policyHash ? { ...fresh, runToken: prev.runToken } : prev)))
          .catch(() => undefined);
        void refresh();
        setFundingToken((n) => n + 1);
      },
    );
  };

  const topicUrl = rows[0]?.reliability.source?.hashscan ?? null;
  const receipts = rows.reduce((n, r) => n + r.reliability.calls, 0);
  const budget = activation ? Number.parseFloat(activation.policy.budgetTotal) : Number.NaN;
  const remaining = activation && Number.isFinite(budget) ? Math.round((budget - activation.ledger.spentHbar) * 1e8) / 1e8 : null;

  return (
    <>
      <Topbar
        topicUrl={topicUrl}
        wallet={wallet}
        right={
          <a className="navlink" href={sellerHref()}>
            <IconShield size={14} /> Register seller
          </a>
        }
      />
      <main className="page">
        <div className="hero">
          <div>
            <h1>Humans set the rules. Agents spend the money.</h1>
            <p>Suppliers are ENS names. Reliability comes from settled receipts. A deterministic executor holds the only payment key and signs x402 payments on Hedera only when every policy check passes.</p>
          </div>
          <div className="chain">
            <span className="pill">identity · ENSv2 Sepolia</span>
            <span className="pill">trust · World ID</span>
            <span className="pill">payment · x402 on Hedera</span>
            <span className="pill">proof · HCS</span>
          </div>
        </div>

        <ol className="how">
          <li>
            <b>1</b> connect your wallet
          </li>
          <li>
            <b>2</b> sign the policy
          </li>
          <li>
            <b>3</b> deposit HBAR
          </li>
          <li>
            <b>4</b> run the task
          </li>
          <li className="note">the executor spends only your deposit, and only when every check passes</li>
        </ol>

        <div className="kpis">
          <div className="kpi">
            <div className="label">suppliers listed</div>
            <div className="value">{rows.length}</div>
            <div className="sub">resolved from the mandi.eth subregistry</div>
          </div>
          <div className="kpi">
            <div className="label">receipts on topic</div>
            <div className="value">{receipts}</div>
            <div className="sub">settled and cancelled calls, all on HCS</div>
          </div>
          <div className="kpi">
            <div className="label">budget remaining</div>
            <div className="value">{remaining === null ? "–" : `${remaining} HBAR`}</div>
            <div className="sub">{activation ? `of ${activation.policy.budgetTotal}` : "activate a policy"}</div>
          </div>
          <div className="kpi">
            <div className="label">paid calls</div>
            <div className="value">{activation?.ledger.calls ?? "–"}</div>
            <div className="sub">{activation ? `${activation.ledger.spentHbar} HBAR spent under this policy` : "under the active policy"}</div>
          </div>
        </div>

        <Suppliers rows={rows} loading={rowsLoading} error={rowsError} onRefresh={refresh} />

        <div className="grid">
          <div className="stack">
            <section className="card">
              <div className="card-h">
                <h2>
                  Policy <span className="sub">signed by your wallet, enforced by the executor</span>
                </h2>
                <span className={`pill ${activation ? "ok" : ""}`}>{activation ? "active" : "not active"}</span>
              </div>
              <div className="card-b stack-sm">
                <div className="fieldgroup">
                  <span className="grouplabel">presets</span>
                  <div className="chips" role="group" aria-label="policy presets">
                    {Object.keys(PRESETS).map((name) => (
                      <button key={name} type="button" className={`chip ${preset === name ? "on" : ""}`} aria-pressed={preset === name} onClick={() => applyPreset(name)}>
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="field">
                  <span className="labelrow">
                    policy <span className="hint">the executor enforces exactly this</span>
                  </span>
                  <textarea className="code" value={policyText} onChange={(e) => setPolicyText(e.target.value)} spellCheck={false} aria-label="policy json" />
                </label>
                <div className="row between">
                  <button className="btn primary" onClick={() => void onActivate()} disabled={activating || !connected} aria-busy={activating}>
                    {activating ? <Spinner size={14} /> : <IconShieldCheck size={15} />} {activating ? "Signing…" : "Sign & activate"}
                  </button>
                  {activation && (
                    <span className="row hashrow">
                      <span className="dim">policy hash</span>
                      <span className="mono">{short(activation.policyHash, 8)}</span>
                      <Copy text={activation.policyHash} />
                    </span>
                  )}
                </div>
                <p className="fieldnote">
                  {connected
                    ? "Your wallet signs this policy as a mandate. Signing moves no funds; the executor refuses to spend outside it."
                    : "Connect a wallet to sign the mandate. Signing is free and moves no funds."}
                </p>
                {activationError && (
                  <div className="notice bad">
                    <IconAlert size={16} /> <span style={{ whiteSpace: "pre-wrap" }}>{activationError}</span>
                  </div>
                )}
                {activation && (
                  <dl className="kv">
                    <dt>mandate</dt>
                    <dd>
                      {activation.hashscan ? (
                        <a href={activation.hashscan} target="_blank" rel="noreferrer">
                          anchored on HCS <IconExternal size={12} />
                        </a>
                      ) : (
                        <span className="pill warn">
                          <IconAlert size={12} /> not anchored{activation.anchorError ? `: ${activation.anchorError}` : ""}
                        </span>
                      )}
                    </dd>
                    <dt>signer</dt>
                    <dd className="row" style={{ gap: 6 }}>
                      <span className="mono truncate" title={activation.signer}>
                        {activation.signer}
                      </span>
                      {connected && activation.signer.toLowerCase() === wallet.address?.toLowerCase() && <span className="pill ok">this wallet</span>}
                    </dd>
                    <dt>expires</dt>
                    <dd>{new Date(activation.expiry * 1000).toLocaleString()}</dd>
                  </dl>
                )}
                <div className="ledger">
                  <div>
                    <div className="label">budget</div>
                    <div className="value">{activation?.policy.budgetTotal ?? "–"}</div>
                  </div>
                  <div>
                    <div className="label">spent</div>
                    <div className="value">{activation ? `${activation.ledger.spentHbar} HBAR` : "–"}</div>
                  </div>
                  <div>
                    <div className="label">calls</div>
                    <div className="value">{activation?.ledger.calls ?? "–"}</div>
                  </div>
                </div>
              </div>
            </section>

            <FundingCard wallet={wallet} refreshToken={fundingToken} />

            <section className="card">
              <div className="card-h">
                <h2>
                  Task <span className="sub">the agent plans, the executor authorizes</span>
                </h2>
              </div>
              <div className="card-b stack-sm">
                <div className="fieldgroup">
                  <span className="grouplabel">examples</span>
                  <div className="chips" role="group" aria-label="example tasks">
                    {TASKS.map((t) => (
                      <button key={t} type="button" className={`chip ${task === t ? "on" : ""}`} aria-pressed={task === t} onClick={() => setTask(t)}>
                        {t.replace("Assess risk of ", "")}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="field">
                  <span className="labelrow">
                    task <span className="hint">plain language, sent to the buyer agent</span>
                  </span>
                  <input className="text" type="text" value={task} onChange={(e) => setTask(e.target.value)} />
                </label>
                <div className="row between">
                  <button className="btn primary" onClick={onRun} disabled={running || runBlock !== null} aria-busy={running}>
                    {running ? <Spinner size={14} /> : <IconBolt size={15} />} {running ? "Running…" : "Run agent"}
                  </button>
                  {runBlock && !signerMismatch && <span className="fieldnote">{runBlock}</span>}
                </div>
                {signerMismatch && (
                  <div className="notice bad">
                    <IconAlert size={16} /> {runBlock}
                  </div>
                )}
              </div>
            </section>
          </div>

          <section className="card sticky">
            <div className="card-h">
              <h2>
                Pipeline <span className="sub">every stage streamed live from the agent</span>
              </h2>
              {running ? (
                <span className="pill accent">
                  <Spinner size={12} /> running
                </span>
              ) : events.length > 0 || runError ? (
                <button
                  className="btn ghost sm"
                  onClick={() => {
                    setEvents([]);
                    setRunError(null);
                  }}
                >
                  clear
                </button>
              ) : null}
            </div>
            <Stepper events={events} running={running} />
            <div className="log" ref={logRef} role="log" aria-live="polite" aria-label="agent pipeline events" tabIndex={0}>
              {events.length === 0 && !runError && (
                <div className="empty">
                  <b>Nothing has run yet</b>
                  <span>Sign a policy, deposit HBAR, then run a task. Discovery, resolution, preference, authorization, payment and receipt stream in here, each with a link to HashScan.</span>
                </div>
              )}
              {events.map((ev, i) => (
                <Event key={i} ev={ev} ranking={ranking} />
              ))}
              {runError && (
                <div className="notice bad" style={{ marginTop: 8 }}>
                  <IconAlert size={16} /> {runError}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
