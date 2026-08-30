/**
 * Wallet sign-in — identity only.
 *
 * Connecting proves who you are so the desktop can hang per-wallet state off it
 * (icon layout, hidden apps, and later game runs / ore / holdings). It reads an
 * address and nothing else: no signing, no transactions, no balances. Anything
 * that moves funds is a separate, explicit flow that does not live here.
 *
 * No new dependencies and no network calls — wallets inject a provider object
 * and talk over extension messaging, so this works under the site's strict
 * `connect-src 'self'` CSP (same reasoning as docs/specs/inscribe.md).
 *
 * The chain for the NFT collection is NOT settled. Phantom and MetaMask are
 * supported here because they are what people already have; treat the result as
 * "an address that identifies this person", not "the chain we will mint on".
 */
import type { KeyValueStore } from "./store";

export type WalletChain = "solana" | "evm";
export type WalletId = "phantom" | "metamask";

export interface WalletAccount {
  id: WalletId;
  chain: WalletChain;
  /** Native-format address: base58 for Solana, 0x-hex for EVM. */
  address: string;
}

export interface WalletProviderInfo {
  id: WalletId;
  label: string;
  chain: WalletChain;
  /** Where to get it, shown when the extension is not installed. */
  site: string;
  /** True when the extension is injected into this page right now. */
  installed: boolean;
}

export interface WalletSession {
  account(): WalletAccount | null;
  /** Providers we know about, each flagged installed or not. */
  providers(): WalletProviderInfo[];
  /** Prompts the wallet. Rejects with a human-readable message on failure. */
  connect(id: WalletId): Promise<WalletAccount>;
  disconnect(): void;
  /** Fires on every connect, disconnect and account switch. Replays current state immediately. */
  subscribe(fn: (account: WalletAccount | null) => void): () => void;
  destroy(): void;
}

const STORE_KEY = "wallet";

/** "7Xk4…9fPq" — enough to recognise, short enough for a taskbar button. */
export function shortAddress(address: string, head = 4, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

// ── Injected provider shapes (minimal, structural) ───────────────────────────

interface EvmProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
  removeListener?(event: string, fn: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
  providers?: EvmProvider[];
}

interface SolanaProvider {
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect?(): Promise<void>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
  removeListener?(event: string, fn: (...args: unknown[]) => void): void;
  isPhantom?: boolean;
}

interface InjectedWindow {
  ethereum?: EvmProvider;
  solana?: SolanaProvider;
  phantom?: { solana?: SolanaProvider };
}

const win = (): InjectedWindow => window as unknown as InjectedWindow;

/** Phantom injects at window.phantom.solana; older builds only at window.solana. */
function solanaProvider(): SolanaProvider | null {
  const w = win();
  const p = w.phantom?.solana ?? w.solana;
  return p && p.isPhantom ? p : null;
}

/**
 * Several extensions fight over window.ethereum. When they cooperate they expose
 * a `providers` array, so prefer the MetaMask entry from it before falling back
 * to whoever won the global.
 */
function evmProvider(): EvmProvider | null {
  const eth = win().ethereum;
  if (!eth) return null;
  if (Array.isArray(eth.providers)) return eth.providers.find((p) => p.isMetaMask) ?? eth.providers[0] ?? eth;
  return eth;
}

const PROVIDERS: ReadonlyArray<{ id: WalletId; label: string; chain: WalletChain; site: string; detect: () => boolean }> = [
  { id: "phantom", label: "Phantom", chain: "solana", site: "https://phantom.app", detect: () => solanaProvider() != null },
  { id: "metamask", label: "MetaMask", chain: "evm", site: "https://metamask.io", detect: () => evmProvider() != null },
];

/** Wallet errors are wildly inconsistent; turn them into something a person can read. */
function readableError(err: unknown, label: string): Error {
  const e = err as { code?: number | string; message?: string } | null;
  // 4001 (EIP-1193) and Phantom's message both mean "the user said no".
  if (e?.code === 4001 || /user rejected|user denied|request rejected/i.test(e?.message ?? "")) {
    return new Error("Connection cancelled.");
  }
  if (e?.code === -32002 || /already pending/i.test(e?.message ?? "")) {
    return new Error(`${label} is already asking — check the extension popup.`);
  }
  return new Error(e?.message ? `${label}: ${e.message}` : `${label} could not connect.`);
}

export function createWalletSession(store: KeyValueStore): WalletSession {
  let account: WalletAccount | null = null;
  const listeners = new Set<(a: WalletAccount | null) => void>();
  /** Undo functions for provider event listeners, cleared on disconnect/destroy. */
  let unhooks: Array<() => void> = [];

  const emit = () => { for (const fn of [...listeners]) fn(account); };

  const setAccount = (next: WalletAccount | null) => {
    const same = next?.address === account?.address && next?.id === account?.id;
    account = next;
    if (next) store.set(STORE_KEY, next); else store.remove(STORE_KEY);
    if (!same) emit();
  };

  const unhookAll = () => { for (const off of unhooks) off(); unhooks = []; };

  /** Follow the extension: switching accounts re-identifies, locking signs out. */
  const hookEvm = (p: EvmProvider) => {
    if (!p.on || !p.removeListener) return;
    const onAccounts = (...args: unknown[]) => {
      const list = args[0];
      const next = Array.isArray(list) ? (list[0] as string | undefined) : undefined;
      if (next) setAccount({ id: "metamask", chain: "evm", address: next });
      else { unhookAll(); setAccount(null); }
    };
    p.on("accountsChanged", onAccounts);
    unhooks.push(() => p.removeListener?.("accountsChanged", onAccounts));
  };

  const hookSolana = (p: SolanaProvider) => {
    if (!p.on || !p.removeListener) return;
    const onDisconnect = () => { unhookAll(); setAccount(null); };
    const onAccountChanged = (...args: unknown[]) => {
      const key = args[0] as { toString(): string } | null | undefined;
      const address = key?.toString();
      if (address) setAccount({ id: "phantom", chain: "solana", address });
      else onDisconnect();
    };
    p.on("disconnect", onDisconnect);
    p.on("accountChanged", onAccountChanged);
    unhooks.push(() => { p.removeListener?.("disconnect", onDisconnect); p.removeListener?.("accountChanged", onAccountChanged); });
  };

  const connect = async (id: WalletId): Promise<WalletAccount> => {
    const spec = PROVIDERS.find((p) => p.id === id);
    if (!spec) throw new Error("Unknown wallet.");
    unhookAll();

    if (id === "phantom") {
      const p = solanaProvider();
      if (!p) throw new Error("Phantom is not installed.");
      try {
        const res = await p.connect();
        const address = res.publicKey.toString();
        hookSolana(p);
        const next: WalletAccount = { id, chain: "solana", address };
        setAccount(next);
        return next;
      } catch (err) {
        throw readableError(err, "Phantom");
      }
    }

    const p = evmProvider();
    if (!p) throw new Error("MetaMask is not installed.");
    try {
      const res = await p.request({ method: "eth_requestAccounts" });
      const address = Array.isArray(res) ? (res[0] as string | undefined) : undefined;
      if (!address) throw new Error("No account was shared.");
      hookEvm(p);
      const next: WalletAccount = { id, chain: "evm", address };
      setAccount(next);
      return next;
    } catch (err) {
      throw readableError(err, "MetaMask");
    }
  };

  /**
   * Restore a previous session without prompting. Both paths are silent: EVM's
   * eth_accounts returns [] rather than asking, and Phantom's onlyIfTrusted
   * rejects rather than popping up. A failure just means "not signed in".
   */
  const resume = async (): Promise<void> => {
    const saved = store.get<WalletAccount>(STORE_KEY);
    if (!saved || (saved.id !== "phantom" && saved.id !== "metamask")) { store.remove(STORE_KEY); return; }
    try {
      if (saved.id === "phantom") {
        const p = solanaProvider();
        if (!p) return;
        const res = await p.connect({ onlyIfTrusted: true });
        hookSolana(p);
        setAccount({ id: "phantom", chain: "solana", address: res.publicKey.toString() });
      } else {
        const p = evmProvider();
        if (!p) return;
        const res = await p.request({ method: "eth_accounts" });
        const address = Array.isArray(res) ? (res[0] as string | undefined) : undefined;
        if (!address) { store.remove(STORE_KEY); return; }
        hookEvm(p);
        setAccount({ id: "metamask", chain: "evm", address });
      }
    } catch {
      // Not trusted any more, or the extension is gone. Forget it quietly.
      store.remove(STORE_KEY);
    }
  };
  void resume();

  return {
    account: () => account,
    providers: () => PROVIDERS.map(({ id, label, chain, site, detect }) => ({ id, label, chain, site, installed: detect() })),
    connect,
    disconnect() {
      // Phantom can be told; MetaMask has no revoke API, so we just forget it.
      if (account?.id === "phantom") void solanaProvider()?.disconnect?.().catch(() => undefined);
      unhookAll();
      setAccount(null);
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(account);
      return () => listeners.delete(fn);
    },
    destroy() {
      unhookAll();
      listeners.clear();
    },
  };
}
