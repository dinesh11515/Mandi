import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, parseUnits, type Address, type Chain, type EIP1193Provider, type Hex } from "viem";
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
  clearError: () => void;
  signMessage: (message: string) => Promise<Hex>;
  ensureChain: (chain: Chain) => Promise<void>;
  sendHbar: (to: Address, hbar: number) => Promise<Hex>;
};

const provider = () => window.ethereum;

const client = (chain: Chain, account: Address) => createWalletClient({ account, chain, transport: custom(provider()!) });

const NO_WALLET = "no browser wallet was found in this browser; install one, then reload this page";

const describe = (err: unknown) => {
  const e = err as { shortMessage?: string; message?: string; code?: number };
  if (e?.code === 4001) return "the request was rejected in your wallet";
  if (e?.code === -32002) return "your wallet already has a pending request; open it and finish that one first";
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
    if (!eth) {
      setError(NO_WALLET);
      throw new Error(NO_WALLET);
    }
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
    setError(null);
    setStatus(provider() ? "disconnected" : "absent");
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const ensureChain = useCallback(
    async (chain: Chain) => {
      const eth = provider();
      if (!eth) throw new Error(NO_WALLET);
      if (!address) throw new Error("connect a wallet first");
      const wallet = client(chain, address);
      const chainNow = async () => Number(await eth.request({ method: "eth_chainId" }));
      if ((await chainNow()) !== chain.id) {
        try {
          await wallet.switchChain({ id: chain.id });
        } catch (err) {
          if ((err as { code?: number }).code !== 4902 && !/unrecognized|not added|4902/i.test(describe(err))) throw new Error(describe(err));
          await wallet.addChain({ chain });
          if ((await chainNow()) !== chain.id) {
            try {
              await wallet.switchChain({ id: chain.id });
            } catch (again) {
              throw new Error(describe(again));
            }
          }
        }
      }
      const settled = await chainNow();
      if (settled !== chain.id) throw new Error(`the wallet is on chain ${settled}; switch it to ${chain.name} (chain ${chain.id}) and try again`);
      setChainId(settled);
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
        return await client(hederaTestnet, address).sendTransaction({ to, value: parseUnits(hbar.toFixed(8), 18) });
      } catch (err) {
        throw new Error(describe(err));
      }
    },
    [address, ensureChain],
  );

  return { status, address, chainId, error, connect, disconnect, clearError, signMessage, ensureChain, sendHbar };
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const chainLabel = (id: number | null): string | null =>
  id === null ? null : id === hederaTestnet.id ? "Hedera testnet" : id === sepolia.id ? "Sepolia" : `chain ${id}`;

export const WALLET_GUIDE = "https://ethereum.org/en/wallets/find-wallet/";
