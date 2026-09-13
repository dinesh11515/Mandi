import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, parseEther, type Address, type Chain, type EIP1193Provider, type Hex } from "viem";
import { hederaTestnet, sepolia } from "viem/chains";

export { hederaTestnet, sepolia };

type Eip1193 = EIP1193Provider & {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export type WalletStatus = "absent" | "disconnected" | "connecting" | "connected";

export type Wallet = {
  status: WalletStatus;
  address: Address | null;
  chainId: number | null;
  error: string | null;
  connect: () => Promise<Address>;
  disconnect: () => void;
  signMessage: (message: string) => Promise<Hex>;
  ensureChain: (chain: Chain) => Promise<void>;
  sendHbar: (to: Address, hbar: number) => Promise<Hex>;
};

const provider = () => window.ethereum;

const client = (chain: Chain, account: Address) => createWalletClient({ account, chain, transport: custom(provider()!) });

const describe = (err: unknown) => {
  const e = err as { shortMessage?: string; message?: string; code?: number };
  if (e?.code === 4001) return "request rejected in the wallet";
  return e?.shortMessage ?? e?.message ?? String(err);
};

export function useWallet(): Wallet {
  const [status, setStatus] = useState<WalletStatus>(() => (provider() ? "disconnected" : "absent"));
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const eth = provider();
    if (!eth) return;
    void eth.request({ method: "eth_accounts" }).then((accounts) => {
      const first = (accounts as Address[])[0];
      if (first) {
        setAddress(first);
        setStatus("connected");
      }
    });
    void eth.request({ method: "eth_chainId" }).then((id) => setChainId(Number(id)));
    const onAccounts = (...args: unknown[]) => {
      const first = (args[0] as Address[])[0] ?? null;
      setAddress(first);
      setStatus(first ? "connected" : "disconnected");
    };
    const onChain = (...args: unknown[]) => setChainId(Number(args[0]));
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = provider();
    if (!eth) throw new Error("no browser wallet found; install MetaMask");
    setError(null);
    setStatus("connecting");
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
      const first = accounts[0];
      if (!first) throw new Error("wallet returned no account");
      setAddress(first);
      setStatus("connected");
      setChainId(Number(await eth.request({ method: "eth_chainId" })));
      return first;
    } catch (err) {
      setStatus("disconnected");
      setError(describe(err));
      throw new Error(describe(err));
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setStatus(provider() ? "disconnected" : "absent");
  }, []);

  const ensureChain = useCallback(
    async (chain: Chain) => {
      if (!address) throw new Error("connect a wallet first");
      const wallet = client(chain, address);
      const current = await wallet.getChainId();
      if (current === chain.id) return;
      try {
        await wallet.switchChain({ id: chain.id });
      } catch (err) {
        if ((err as { code?: number }).code !== 4902 && !/unrecognized|not added|4902/i.test(describe(err))) throw new Error(describe(err));
        await wallet.addChain({ chain });
      }
      setChainId(chain.id);
    },
    [address],
  );

  const signMessage = useCallback(
    async (message: string) => {
      if (!address) throw new Error("connect a wallet first");
      try {
        return await client(sepolia, address).signMessage({ message });
      } catch (err) {
        throw new Error(describe(err));
      }
    },
    [address],
  );

  const sendHbar = useCallback(
    async (to: Address, hbar: number) => {
      if (!address) throw new Error("connect a wallet first");
      await ensureChain(hederaTestnet);
      try {
        return await client(hederaTestnet, address).sendTransaction({ to, value: parseEther(String(hbar)) });
      } catch (err) {
        throw new Error(describe(err));
      }
    },
    [address, ensureChain],
  );

  return { status, address, chainId, error, connect, disconnect, signMessage, ensureChain, sendHbar };
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
