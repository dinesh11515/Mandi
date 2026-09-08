import { useEffect, useMemo, useState } from "react";
import {
  activate,
  ensExplorer,
  loadActivation,
  loadSuppliers,
  stream,
  type Activation,
  type AgentEvent,
  type Decision,
  type Ranking,
  type SupplierRow,
} from "./api";

const SAMPLE = {
  budgetTotal: "1 HBAR",
  maxPerCall: "0.05 HBAR",
  requireVerifiedFor: ["financial"],
  minSuccessRate: 0.95,
  fallbackOnFailure: true,
};

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const when = (ts: number | null) => (ts ? new Date(ts).toLocaleTimeString() : "never");

function Suppliers() {
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await loadSuppliers());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="wide">
      <h2>
        <span>Suppliers · identity from ENSv2 Sepolia, reliability from HCS receipts</span>
        <button className="ghost" onClick={refresh} disabled={loading}>
          {loading ? "loading" : "refresh"}
        </button>
      </h2>
      {error && <p className="error">{error}</p>}
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>name</th>
              <th>capability</th>
              <th>price</th>
              <th>accreditation</th>
              <th>success rate</th>
              <th>sample</th>
              <th>avg cost</th>
              <th>avg latency</th>
              <th>last active</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="muted">
                  no suppliers found in the directory
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.name}>
                <td>
                  <a href={ensExplorer(r.name)} target="_blank" rel="noreferrer">
                    {r.name}
                  </a>
                  <div className="muted mono">{r.card.endpoint}</div>
                </td>
                <td>{r.card.capability}</td>
                <td>{r.card.price}</td>
                <td>
                  {r.attestation?.valid ? (
                    <span className="badge ok">verified · attested</span>
                  ) : r.card.verified ? (
                    <span className="badge warn">ENS flag only</span>
                  ) : (
                    <span className="badge">unverified</span>
                  )}
                </td>
                <td>{pct(r.reliability.successRate)}</td>
                <td>{r.reliability.sampleSize}</td>
                <td>{r.reliability.avgCostHbar === null ? "n/a" : `${r.reliability.avgCostHbar} HBAR`}</td>
                <td>{r.reliability.avgLatencyMs === null ? "n/a" : `${r.reliability.avgLatencyMs} ms`}</td>
                <td>{when(r.reliability.lastActive)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows[0]?.reliability.source?.hashscan && (
        <p className="muted">
          receipts topic:{" "}
          <a href={rows[0].reliability.source.hashscan} target="_blank" rel="noreferrer">
            {rows[0].reliability.source.topicId}
          </a>
        </p>
      )}
    </section>
  );
}

function DecisionCard({ decision, ranking }: { decision: Decision; ranking: Ranking[] }) {
  const failed = decision.checks.filter((c) => !c.passed);
  const position = ranking.find((r) => r.name === decision.supplier)?.rank;
  return (
    <div className={`card ${decision.status}`}>
      <div>
        <b>{decision.supplier}</b> <span className={`badge ${decision.status === "approved" ? "ok" : "bad"}`}>{decision.status}</span>{" "}
        <span className="muted">
          {decision.priceHbar} HBAR · preference #{position ?? "?"} of {ranking.length}
        </span>
      </div>
      <table className="checks">
        <tbody>
          {decision.checks.map((c) => (
            <tr key={c.name}>
              <td>
                <span className={`badge ${c.passed ? "ok" : "bad"}`}>{c.passed ? "pass" : "fail"}</span> {c.name}
              </td>
              <td>{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {failed.length > 0 && <div className="muted">eligibility failed on {failed.map((c) => c.name).join(", ")}; no payment signed</div>}
    </div>
  );
}

function Event({ ev, ranking }: { ev: AgentEvent; ranking: Ranking[] }) {
  const link = (href: unknown, label: string) =>
    typeof href === "string" ? (
      <a href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
    ) : null;
  return (
    <div className="event">
      <div className="head">
        <span className="stage">{ev.stage}</span>
        <span className="muted">{new Date(ev.ts).toLocaleTimeString()}</span>
        {typeof ev.supplier === "string" && <b>{ev.supplier}</b>}
      </div>
      {ev.stage === "discovery" && (
        <div>
          capability <b>{String(ev.capability)}</b> · protocol <b>{String(ev.protocol)}</b> · route <b>{String(ev.route)}</b> ·{" "}
          {(ev.names as string[]).length} names from the directory
        </div>
      )}
      {ev.stage === "resolution" && (typeof ev.error === "string" ? <span className="error">{ev.error}</span> : <span className="muted">resolved {String(ev.name)} via ENS</span>)}
      {ev.stage === "preference" && (
        <ol>
          {(ev.ranking as Ranking[]).map((r) => (
            <li key={r.name}>
              {r.name} · {r.price} · {r.attested ? "attested" : "not attested"} · {pct(r.successRate)} over {r.sampleSize}
            </li>
          ))}
        </ol>
      )}
      {ev.stage === "authorization" && <DecisionCard decision={ev.decision as Decision} ranking={ranking} />}
      {ev.stage === "payment" && (
        <div>
          {(ev.payment as { settled: boolean }).settled ? <span className="badge ok">settled</span> : <span className="badge bad">not settled</span>}{" "}
          {link((ev.payment as { hashscan: string | null }).hashscan, "HashScan")}{" "}
          <span className="muted">ledger: {(ev.ledger as { spentHbar: number }).spentHbar} HBAR spent</span>
        </div>
      )}
      {ev.stage === "receipt" && (
        <div>
          {ev.fulfilled ? <span className="badge ok">fulfilled</span> : <span className="badge bad">not fulfilled</span>} {link(ev.hashscan, "tx")}{" "}
          <span className="muted">{String(ev.latencyMs)} ms</span>
          {typeof ev.error === "string" && <div className="error">{ev.error}</div>}
          {ev.body !== null && ev.body !== undefined && <pre className="mono">{JSON.stringify(ev.body, null, 2)}</pre>}
        </div>
      )}
      {ev.stage === "done" && (
        <div>
          <b>{String(ev.outcome)}</b>
          {Array.isArray(ev.rejections) && (
            <ul>
              {(ev.rejections as { supplier: string; reasons: string[] }[]).map((r) => (
                <li key={r.supplier}>
                  {r.supplier}: {r.reasons.join(" · ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function App() {
  const [policyText, setPolicyText] = useState(JSON.stringify(SAMPLE, null, 2));
  const [activation, setActivation] = useState<Activation | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [task, setTask] = useState("Assess risk of Aave");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const ranking = useMemo(() => (events.find((e) => e.stage === "preference")?.ranking as Ranking[] | undefined) ?? [], [events]);

  const onActivate = async () => {
    setActivationError(null);
    try {
      setActivation(await activate(JSON.parse(policyText)));
    } catch (err) {
      setActivationError(err instanceof Error ? err.message : String(err));
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
      },
    );
  };

  return (
    <>
      <header>
        <h1>Mandi</h1>
        <p>Humans set the rules. Agents spend the money. Identity on ENS · trust from World · authorization by deterministic policy · payment on Hedera · proof on HCS.</p>
      </header>
      <main>
        <Suppliers />
        <section>
          <h2>Policy · signed by the human, enforced by the executor</h2>
          <textarea value={policyText} onChange={(e) => setPolicyText(e.target.value)} spellCheck={false} />
          <div className="row">
            <button onClick={onActivate}>Activate policy</button>
            {activation && (
              <span className="mono">
                {activation.policyHash.slice(0, 16)}… signed by {activation.signer.slice(0, 8)}…{" "}
                {activation.anchored ? (
                  <a href={activation.hashscan ?? "#"} target="_blank" rel="noreferrer">
                    anchored on HCS
                  </a>
                ) : (
                  <span className="badge warn">not anchored: {activation.anchorError}</span>
                )}
              </span>
            )}
          </div>
          {activationError && <p className="error">{activationError}</p>}
          <div className="ledger">
            <div>
              <span className="muted">budget</span>
              <b>{activation?.policy.budgetTotal ?? "–"}</b>
            </div>
            <div>
              <span className="muted">spent</span>
              <b>{activation ? `${activation.ledger.spentHbar} HBAR` : "–"}</b>
            </div>
            <div>
              <span className="muted">paid calls</span>
              <b>{activation?.ledger.calls ?? "–"}</b>
            </div>
          </div>
          <h2 style={{ marginTop: 18 }}>Task</h2>
          <input type="text" value={task} onChange={(e) => setTask(e.target.value)} />
          <div className="row">
            <button onClick={onRun} disabled={!activation || running}>
              {running ? "running" : "Run agent"}
            </button>
            {!activation && <span className="muted">activate a policy first</span>}
          </div>
        </section>
        <section>
          <h2>Pipeline · discovery → eligibility → preference → authorization → payment → receipt</h2>
          <div className="log">
            {events.length === 0 && <p className="muted">events from the agent will stream here</p>}
            {events.map((ev, i) => (
              <Event key={i} ev={ev} ranking={ranking} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
