import { useEffect, useState, type ReactNode } from "react";
import { API, ensExplorer, sellerHref } from "./api";
import { IconExternal, IconShield, IconWallet, Logo, Spinner } from "./icons";
import { hederaTestnet, sepolia, shortAddress, type Wallet } from "./wallet";

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

const chainName = (id: number | null) =>
  id === null ? null : id === hederaTestnet.id ? "Hedera testnet" : id === sepolia.id ? "Sepolia" : `chain ${id}`;

function WalletControl({ wallet }: { wallet: Wallet }) {
  const chain = chainName(wallet.chainId);
  if (wallet.address)
    return (
      <span className="walletbox">
        {chain && <span className="pill info">{chain}</span>}
        <button type="button" className="btn ghost sm mono" onClick={wallet.disconnect} title={`${wallet.address} · click to disconnect`}>
          <IconWallet size={14} /> {shortAddress(wallet.address)}
        </button>
      </span>
    );
  return (
    <button
      type="button"
      className="btn primary sm"
      onClick={() => void wallet.connect().catch(() => undefined)}
      disabled={wallet.status === "connecting" || wallet.status === "absent"}
      title={wallet.status === "absent" ? "install MetaMask to connect a wallet" : "connect a browser wallet"}
    >
      {wallet.status === "connecting" ? <Spinner size={14} /> : <IconWallet size={14} />}
      {wallet.status === "absent" ? "no wallet found" : wallet.status === "connecting" ? "connecting…" : "Connect wallet"}
    </button>
  );
}

export function Topbar({ topicUrl, right, wallet }: { topicUrl?: string | null; right?: ReactNode; wallet?: Wallet }) {
  const health = useHealth();
  return (
    <header className="topbar">
      <a href="/" className="brand">
        <Logo />
        Mandi <small>procurement for agents</small>
      </a>
      <span className={`pill ${health === "ok" ? "ok" : health === "down" ? "bad" : ""}`} role="status">
        <span className="dot" />
        {health === "ok" ? "executor online" : health === "down" ? "executor unreachable" : "checking"}
      </span>
      <nav>
        {wallet && <WalletControl wallet={wallet} />}
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
          <IconShield size={14} /> Register seller
        </a>
        <a className="navlink" href="https://github.com/dinesh11515/Mandi" target="_blank" rel="noreferrer">
          GitHub <IconExternal size={14} />
        </a>
      </nav>
    </header>
  );
}
