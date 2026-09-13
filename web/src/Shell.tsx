import { useEffect, useRef, useState, type ReactNode } from "react";
import { API } from "./api";
import { IconAlert, IconCheck, IconChevron, IconCopy, IconExternal, IconPower, IconWallet, IconX, Logo, Spinner } from "./icons";
import { chainLabel, shortAddress, WALLET_GUIDE, type Wallet } from "./wallet";

type Health = "checking" | "ok" | "down";

function useHealth(): Health {
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

function WalletMenu({ wallet, address }: { wallet: Wallet; address: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const chain = chainLabel(wallet.chainId);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="wallet" ref={box}>
      <button
        type="button"
        className={`walletchip ${open ? "on" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`wallet ${address}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dot" />
        <span className="mono">{shortAddress(address)}</span>
        {chain && <span className="net">{chain}</span>}
        <IconChevron size={12} />
      </button>
      {open && (
        <div className="walletpop" role="menu">
          <div className="walletpop-h">
            <span className="label">connected wallet</span>
            {chain && <span className="pill ok sm">{chain}</span>}
          </div>
          <div className="walletpop-addr">
            <span className="mono truncate" title={address}>
              {address}
            </span>
            <button
              type="button"
              className="iconbtn"
              aria-label="copy address"
              onClick={() => {
                void navigator.clipboard?.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </button>
          </div>
          <p className="walletpop-note">It signs policies and registrations, and sends your HBAR deposit. Mandi never holds your key.</p>
          <button
            type="button"
            className="btn ghost sm block"
            onClick={() => {
              setOpen(false);
              wallet.disconnect();
            }}
          >
            <IconPower size={14} /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function WalletControl({ wallet }: { wallet: Wallet }) {
  if (wallet.address) return <WalletMenu wallet={wallet} address={wallet.address} />;
  if (wallet.status === "absent")
    return (
      <a className="btn ghost sm" href={WALLET_GUIDE} target="_blank" rel="noreferrer" title="no browser wallet was detected — install one, then reload this page">
        <IconWallet size={14} /> Install a wallet <IconExternal size={12} />
      </a>
    );
  const connecting = wallet.status === "connecting";
  return (
    <button
      type="button"
      className="btn primary sm"
      onClick={() => void wallet.connect().catch(() => undefined)}
      disabled={connecting}
      aria-busy={connecting}
      title="connect a browser wallet to sign policies and send deposits"
    >
      {connecting ? <Spinner size={14} /> : <IconWallet size={14} />}
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

export function Topbar({ topicUrl, right, wallet, narrow }: { topicUrl?: string | null; right?: ReactNode; wallet?: Wallet; narrow?: boolean }) {
  const health = useHealth();
  return (
    <header className={`topbar ${narrow ? "narrow" : ""}`}>
      <div className="topbar-in">
        <a href="/" className="brand">
          <Logo />
          Mandi <small>procurement for agents</small>
        </a>
        <span className={`pill health ${health === "ok" ? "ok" : health === "down" ? "bad" : ""}`} role="status">
          <span className="dot" />
          {health === "ok" ? "executor online" : health === "down" ? "executor unreachable" : "checking"}
        </span>
        <span className="rowbreak" />
        <nav className="topbar-nav">
          {topicUrl && (
            <a className="navlink" href={topicUrl} target="_blank" rel="noreferrer">
              HCS topic <IconExternal size={14} />
            </a>
          )}
          {right}
          <a className="navlink" href="https://github.com/dinesh11515/Mandi" target="_blank" rel="noreferrer">
            GitHub <IconExternal size={14} />
          </a>
        </nav>
        {wallet && (
          <div className="topbar-actions">
            <WalletControl wallet={wallet} />
          </div>
        )}
      </div>
      {wallet?.error && (
        <div className="topbar-alert" role="alert">
          <div className="topbar-in">
            <IconAlert size={15} />
            <span className="grow">{wallet.error}</span>
            {wallet.status === "absent" && (
              <a href={WALLET_GUIDE} target="_blank" rel="noreferrer">
                find a wallet <IconExternal size={12} />
              </a>
            )}
            {wallet.status === "disconnected" && (
              <button type="button" className="btn ghost sm" onClick={() => void wallet.connect().catch(() => undefined)}>
                Try again
              </button>
            )}
            <button type="button" className="iconbtn" aria-label="dismiss" onClick={wallet.clearError}>
              <IconX size={14} />
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
