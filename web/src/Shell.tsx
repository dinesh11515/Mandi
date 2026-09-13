import { useEffect, useState, type ReactNode } from "react";
import { API, ensExplorer, sellerHref } from "./api";
import { IconExternal, IconShield, Logo } from "./icons";

export type Health = "checking" | "ok" | "down";

export function useHealth(): Health {
  const [health, setHealth] = useState<Health>("checking");
  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch(`${API}/health`)
        .then((r) => alive && setHealth(r.ok ? "ok" : "down"))
        .catch(() => alive && setHealth("down"));
    void check();
    const id = setInterval(check, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return health;
}

export function Topbar({ topicUrl, right }: { topicUrl?: string | null; right?: ReactNode }) {
  const health = useHealth();
  return (
    <header className="topbar">
      <a href="/" className="brand" style={{ color: "inherit", textDecoration: "none" }}>
        <Logo />
        Mandi <small>procurement for agents</small>
      </a>
      <span className={`pill ${health === "ok" ? "ok" : health === "down" ? "bad" : ""}`}>
        <span className="dot" />
        {health === "ok" ? "executor online" : health === "down" ? "executor unreachable" : "checking"}
      </span>
      <nav>
        {right}
        {topicUrl && (
          <a className="navlink" href={topicUrl} target="_blank" rel="noreferrer">
            HCS topic <IconExternal size={14} />
          </a>
        )}
        <a className="navlink" href={ensExplorer("mandi.eth")} target="_blank" rel="noreferrer">
          mandi.eth <IconExternal size={14} />
        </a>
        <a className="navlink" href={sellerHref()}>
          <IconShield size={14} /> Seller accreditation
        </a>
        <a className="navlink" href="https://github.com/dinesh11515/Mandi" target="_blank" rel="noreferrer">
          GitHub <IconExternal size={14} />
        </a>
      </nav>
    </header>
  );
}
