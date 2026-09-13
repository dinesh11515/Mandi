import { useEffect, useMemo, useRef, useState } from "react";
import {
  activate,
  ensExplorer,
  loadActivation,
  loadSuppliers,
  sellerHref,
  stream,
  type Activation,
  type AgentEvent,
  type Decision,
  type Policy,
  type Ranking,
  type SupplierRow,
} from "./api";
import { IconAlert, IconArrow, IconBolt, IconCheck, IconCopy, IconExternal, IconRefresh, IconShield, IconShieldCheck, IconX, Spinner } from "./icons";
import { Topbar } from "./Shell";

const PRESETS: Record<string, Policy> = {
  "Verified only": { budgetTotal: "1 HBAR", maxPerCall: "0.05 HBAR", requireVerifiedFor: ["financial"], minSuccessRate: 0.95, fallbackOnFailure: true },
  Open: { budgetTotal: "1 HBAR", maxPerCall: "0.05 HBAR", requireVerifiedFor: [], minSuccessRate: 0.7, fallbackOnFailure: true },
  "Cheap only": { budgetTotal: "0.1 HBAR", maxPerCall: "0.03 HBAR", requireVerifiedFor: [], minSuccessRate: 0.7, fallbackOnFailure: true },
  "Impossible": { budgetTotal: "1 HBAR", maxPerCall: "0.01 HBAR", requireVerifiedFor: [], minSuccessRate: 0.99, fallbackOnFailure: true },
};

const TASKS = ["Assess risk of Aave", "Assess risk of Compound", "Assess risk of Morpho", "Assess risk of Lido"];
const STAGES = ["discovery", "resolution", "preference", "authorization", "payment", "receipt"] as const;

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`);
const clock = (ts: number | null | undefined) => (ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : "never");
const short = (s: string, n = 10) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-6)}` : s);
const hbar = (v: string | number) => (typeof v === "number" ? `${v} HBAR` : v);
const hashscanTx = (id: string) => `https://hashscan.io/testnet/transaction/${id.replace("@", "-").replace(/\.(\d+)$/, "-$1")}`;

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
                <td colSpan={9} className="empty">
                  {loading ? "resolving suppliers from the ENS directory…" : "no suppliers found in the directory"}
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
                    <div className="row">
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
            {Array.isArray(ev.rejections) && (
              <ul>
                {(ev.rejections as { supplier: string; reasons: string[] }[]).map((r) => (
                  <li key={r.supplier}>
                    <b>{r.supplier}</b>: {r.reasons.join(" · ")}
                  </li>
                ))}
              </ul>
            )}
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
      {STAGES.map((s) => {
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
  const ranking = useMemo(() => (events.find((e) => e.stage === "preference")?.ranking as Ranking[] | undefined) ?? [], [events]);

  const refresh = async () => {
    setRowsLoading(true);
    setRowsError(null);
    try {
      setRows(await loadSuppliers());
    } catch (err) {
      setRowsError(err instanceof Error ? err.message : String(err));
    } finally {
      setRowsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  const applyPreset = (name: string) => {
    setPreset(name);
    setPolicyText(JSON.stringify(PRESETS[name], null, 2));
  };

  const onActivate = async () => {
    setActivationError(null);
    setActivating(true);
    try {
      setActivation(await activate(JSON.parse(policyText)));
    } catch (err) {
      setActivationError(err instanceof Error ? err.message : String(err));
    } finally {
      setActivating(false);
    }
  };

  const onRun = () => {
    if (!activation) return;
    setEvents([]);
    setRunning(true);
    stream(
      task,
      activation.policyHash,
      (ev) => setEvents((prev) => [...prev, ev]),
      () => {
        setRunning(false);
        void loadActivation(activation.policyHash).then(setActivation).catch(() => undefined);
        void refresh();
      },
    );
  };

  const topicUrl = rows[0]?.reliability.source?.hashscan ?? null;
  const receipts = rows.reduce((n, r) => n + r.reliability.calls, 0);
  const budget = activation ? parseFloat(activation.policy.budgetTotal) : null;
  const remaining = activation && budget !== null ? Math.round((budget - activation.ledger.spentHbar) * 1e8) / 1e8 : null;

  return (
    <>
      <Topbar topicUrl={topicUrl} />
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
          <div className="stack sticky">
            <section className="card">
              <div className="card-h">
                <h2>
                  Policy <span className="sub">signed by the human, enforced by the executor</span>
                </h2>
                <span className={`pill ${activation ? "ok" : ""}`}>{activation ? "active" : "not active"}</span>
              </div>
              <div className="card-b stack-sm">
                <div className="chips" role="group" aria-label="policy presets">
                  {Object.keys(PRESETS).map((name) => (
                    <button key={name} type="button" className={`chip ${preset === name ? "on" : ""}`} onClick={() => applyPreset(name)}>
                      {name}
                    </button>
                  ))}
                </div>
                <textarea className="code" value={policyText} onChange={(e) => setPolicyText(e.target.value)} spellCheck={false} aria-label="policy json" />
                <div className="row between">
                  <button className="btn primary" onClick={onActivate} disabled={activating}>
                    {activating ? <Spinner size={14} /> : <IconShieldCheck size={15} />} Activate policy
                  </button>
                  {activation && (
                    <span className="row" style={{ gap: 4 }}>
                      <span className="mono dim">{short(activation.policyHash, 8)}</span>
                      <Copy text={activation.policyHash} />
                    </span>
                  )}
                </div>
                {activationError && (
                  <div className="notice bad">
                    <IconAlert size={16} /> <span style={{ whiteSpace: "pre-wrap" }}>{activationError}</span>
                  </div>
                )}
                {activation && (
                  <dl className="kv">
                    <dt>mandate</dt>
                    <dd>
                      {activation.anchored ? (
                        <a href={activation.hashscan ?? "#"} target="_blank" rel="noreferrer">
                          anchored on HCS <IconExternal size={12} />
                        </a>
                      ) : (
                        <span className="pill warn">
                          <IconAlert size={12} /> not anchored: {activation.anchorError}
                        </span>
                      )}
                    </dd>
                    <dt>signer</dt>
                    <dd className="mono truncate">{activation.signer}</dd>
                    <dt>expires</dt>
                    <dd>{new Date(activation.expiry * 1000).toLocaleString()}</dd>
                  </dl>
                )}
                <div className="ledger">
                  <div>
                    <div className="label">budget</div>
                    <div className="value">{activation ? hbar(activation.policy.budgetTotal) : "–"}</div>
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

            <section className="card">
              <div className="card-h">
                <h2>
                  Task <span className="sub">the agent plans, the executor authorizes</span>
                </h2>
              </div>
              <div className="card-b stack-sm">
                <div className="chips" role="group" aria-label="example tasks">
                  {TASKS.map((t) => (
                    <button key={t} type="button" className={`chip ${task === t ? "on" : ""}`} onClick={() => setTask(t)}>
                      {t.replace("Assess risk of ", "")}
                    </button>
                  ))}
                </div>
                <label className="field">
                  task
                  <input className="text" type="text" value={task} onChange={(e) => setTask(e.target.value)} />
                </label>
                <div className="row between">
                  <button className="btn primary" onClick={onRun} disabled={!activation || running}>
                    {running ? <Spinner size={14} /> : <IconBolt size={15} />} {running ? "running" : "Run agent"}
                  </button>
                  {!activation && <span className="dim">activate a policy first</span>}
                </div>
              </div>
            </section>
          </div>

          <section className="card">
            <div className="card-h">
              <h2>
                Pipeline <span className="sub">every stage streamed live from the agent</span>
              </h2>
              {running ? (
                <span className="pill accent">
                  <Spinner size={12} /> running
                </span>
              ) : events.length > 0 ? (
                <button className="btn ghost sm" onClick={() => setEvents([])}>
                  clear
                </button>
              ) : null}
            </div>
            <Stepper events={events} running={running} />
            <div className="log" ref={logRef}>
              {events.length === 0 && <div className="empty">Activate a policy and run a task. Discovery, eligibility, preference, authorization, payment and receipt will appear here with links to HashScan.</div>}
              {events.map((ev, i) => (
                <Event key={i} ev={ev} ranking={ranking} />
              ))}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
