/**
 * Wallet sign-in.
 *
 * Connecting proves who you are so the desktop can hang per-wallet state off it
 * (icon layout, hidden apps, game runs, ore, holdings). Nothing here moves
 * funds: no transactions, no balances, no spending. Anything that moves funds
 * is a separate, explicit flow that does not live here.
 *
 * The wallets, in the order the picker shows them:
 *
 *   Xverse         Bitcoin. Connecting also signs one message (BIP-322) that the
 *                  server checks, the same proof the Account page uses — so an
 *                  Xverse sign-in IS a server session, and the owner's address
 *                  gets the owner's tools. Signing spends nothing.
 *   WalletConnect  Listed, not wired yet: it needs a project ID from Reown and a
 *                  separately loaded bundle. The picker says "coming soon".
 *
 * MetaMask was dropped on 2026-11-06 (owner: Xverse and WalletConnect only). A
 * browser that saved a MetaMask sign-in simply comes back signed out.
 *
 * No new dependencies and no network calls to wallets: Xverse injects a
 * provider object and talks over extension messaging, so this works under the
 * site's strict `connect-src 'self'` CSP. Xverse injects into the top page only
 * (not iframes), which is fine — this runs in the desktop shell.
 */
import type { KeyValueStore } from "./store";
import type { ServerSession } from "./me";

/** "evm" stays for WalletConnect (listed, not wired yet) and the apps that check for it. */
export type WalletChain = "bitcoin" | "evm";
export type WalletId = "xverse" | "walletconnect";

export interface WalletAccount {
  id: WalletId;
  chain: WalletChain;
  /** Native-format address: the payment address (bc1q…/3…) for Bitcoin. */
  address: string;
  /** Bitcoin only: the wallet's ordinals (taproot) address, where inscriptions live. */
  ordinals?: string;
}

export interface WalletProviderInfo {
  id: WalletId;
  label: string;
  chain: WalletChain;
  /** Where to get it, shown when the extension is not installed. */
  site: string;
  /** True when the extension is injected into this page right now. */
  installed: boolean;
  /** False when the option exists but is not set up yet (WalletConnect). */
  ready: boolean;
  /** The wallet's own icon, when it announces one. */
  icon?: string;
}

export interface WalletSession {
  account(): WalletAccount | null;
  /** Providers we know about, in picker order, each flagged installed / ready. */
  providers(): WalletProviderInfo[];
  /** Prompts the wallet. Rejects with a human-readable message on failure. */
  connect(id: WalletId): Promise<WalletAccount>;
  disconnect(): void;
  /** Fires on every connect, disconnect and account switch. Replays current state immediately. */
  subscribe(fn: (account: WalletAccount | null) => void): () => void;
  destroy(): void;
}

export interface WalletSessionOptions {
  /**
   * The server session. A Bitcoin sign-in lives in its cookie, so a reload is
   * resumed from the server without asking the wallet again, and signing out
   * ends it there too.
   */
  server?: ServerSession;
}

const STORE_KEY = "wallet";

/** "bc1q…9fPq" — enough to recognise, short enough for a taskbar button. */
export function shortAddress(address: string, head = 4, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

// ── Injected provider shapes (minimal, structural) ───────────────────────────

/** Xverse answers every request with a JSON-RPC envelope; a refusal is an `error`, never a rejection. */
interface XverseResponse { result?: unknown; error?: { code?: number; message?: string } }
interface XverseProvider { request(method: string, params: unknown): Promise<XverseResponse> }
interface XverseAddress { address?: string; purpose?: string; addressType?: string }

interface InjectedWindow {
  XverseProviders?: { BitcoinProvider?: XverseProvider };
  /** WBIP-004 registry; Xverse lists itself here with an icon. */
  btc_providers?: Array<{ id?: string; icon?: string }>;
}

const win = (): InjectedWindow => window as unknown as InjectedWindow;

/**
 * Xverse's own namespace. It also sets window.BitcoinProvider, but any Bitcoin
 * wallet can claim that name, so it is not trusted to be Xverse.
 */
const xverseProvider = (): XverseProvider | null => win().XverseProviders?.BitcoinProvider ?? null;
const xverseIcon = (): string | undefined =>
  win().btc_providers?.find((p) => p.id === "XverseProviders.BitcoinProvider")?.icon;

// ── Errors ───────────────────────────────────────────────────────────────────

/** Wallet errors are wildly inconsistent; turn them into something a person can read. */
function readableError(err: unknown, label: string): Error {
  const e = err as { code?: number | string; message?: string } | null;
  // 4001 and Xverse's -32000 both mean "the user said no".
  if (e?.code === 4001 || e?.code === -32000 || /user rejected|user denied|request rejected|cancel/i.test(e?.message ?? "")) {
    return new Error("Connection cancelled.");
  }
  if (e?.code === -32002) return new Error(`${label} refused — unlock it and approve the pop-up.`);
  return new Error(e?.message ? `${label}: ${e.message}` : `${label} could not connect.`);
}

// ── Xverse: connect, then prove the address to the server ────────────────────

/** Pull the address list out of whichever response shape this Xverse version uses. */
function addressesFrom(result: unknown): XverseAddress[] {
  if (Array.isArray(result)) return result as XverseAddress[];
  const r = result as { addresses?: unknown } | null;
  return r && Array.isArray(r.addresses) ? (r.addresses as XverseAddress[]) : [];
}

/** The payment address signs; it is also the identity the Account page has always used. */
function pickPayment(list: XverseAddress[]): XverseAddress | undefined {
  return list.find((a) => a.purpose === "payment")
    ?? list.find((a) => /p2wpkh|p2sh/i.test(a.addressType ?? ""))
    ?? list.find((a) => /^(bc1q|3)/.test(a.address ?? ""))
    ?? list[0];
}

async function xverseAddresses(p: XverseProvider): Promise<XverseAddress[]> {
  const res = await p.request("wallet_connect", {
    addresses: ["payment", "ordinals"],
    message: "Sign in to Parahawk",
    network: "Mainnet",
  });
  // An older extension without wallet_connect still has the legacy method.
  if (res.error?.code === -32601) {
    const legacy = await p.request("getAccounts", { purposes: ["payment", "ordinals"], message: "Sign in to Parahawk" });
    if (legacy.error) throw readableError(legacy.error, "Xverse");
    return addressesFrom(legacy.result);
  }
  if (res.error) throw readableError(res.error, "Xverse");
  return addressesFrom(res.result);
}

/**
 * The server's sign-in: fetch a one-time challenge for this address, have the
 * wallet sign it (BIP-322 — explicit, or Xverse falls back to an older format
 * for payment addresses), and post it back. On success the server sets its
 * session cookie. No funds move.
 */
async function proveToServer(p: XverseProvider, address: string): Promise<void> {
  const chal = (await fetch(`/account/nonce?address=${encodeURIComponent(address)}`, { credentials: "same-origin" })
    .then((r) => r.json())) as { token?: string; message?: string; error?: string };
  if (!chal.token || !chal.message) throw new Error(chal.error ? `Sign-in: ${chal.error}` : "Sign-in is unavailable right now.");

  const sg = await p.request("signMessage", { address, message: chal.message, protocol: "BIP322" });
  if (sg.error) {
    const e = readableError(sg.error, "Xverse");
    throw e.message === "Connection cancelled."
      ? new Error("Signature cancelled. Xverse asks you to sign a message to prove the address is yours — nothing is spent.")
      : e;
  }
  const result = sg.result as { signature?: unknown } | string | undefined;
  const signature = typeof result === "string" ? result : result?.signature;
  if (typeof signature !== "string") throw new Error("Xverse did not return a signature.");

  const body = new URLSearchParams({ address, token: chal.token, signature });
  const res = (await fetch("/account/connect", { method: "POST", body, credentials: "same-origin" })
    .then((r) => r.json())) as { ok?: boolean; error?: string };
  if (!res.ok) throw new Error(res.error ? `Sign-in: ${res.error}` : "Sign-in failed.");
}

// ── The session ──────────────────────────────────────────────────────────────

export function createWalletSession(store: KeyValueStore, opts: WalletSessionOptions = {}): WalletSession {
  const server = opts.server;
  let account: WalletAccount | null = null;
  const listeners = new Set<(a: WalletAccount | null) => void>();

  const emit = () => { for (const fn of [...listeners]) fn(account); };

  const setAccount = (next: WalletAccount | null) => {
    const same = next?.address === account?.address && next?.id === account?.id;
    account = next;
    if (next) store.set(STORE_KEY, next); else store.remove(STORE_KEY);
    if (!same) emit();
  };

  /** Tell the server to drop its session, then let everyone re-read it. */
  const endServerSession = async () => {
    try {
      await fetch("/account/disconnect", { method: "POST", credentials: "same-origin", redirect: "manual" });
    } catch { /* offline: the cookie expires on its own */ }
    await server?.refresh();
  };

  const PROVIDERS: ReadonlyArray<Omit<WalletProviderInfo, "installed" | "ready" | "icon"> & {
    detect: () => boolean; ready: boolean; icon: () => string | undefined;
  }> = [
    { id: "xverse", label: "Xverse", chain: "bitcoin", site: "https://www.xverse.app/download", detect: () => xverseProvider() != null, ready: true, icon: xverseIcon },
    { id: "walletconnect", label: "WalletConnect", chain: "evm", site: "https://walletconnect.network", detect: () => false, ready: false, icon: () => undefined },
  ];

  const connect = async (id: WalletId): Promise<WalletAccount> => {
    const spec = PROVIDERS.find((p) => p.id === id);
    if (!spec) throw new Error("Unknown wallet.");
    if (!spec.ready) throw new Error(`${spec.label} is coming soon.`);

    if (id === "xverse") {
      const p = xverseProvider();
      if (!p) throw new Error("Xverse is not installed.");
      try {
        const list = await xverseAddresses(p);
        const payment = pickPayment(list)?.address;
        if (!payment) throw new Error("Xverse did not share an address.");
        await proveToServer(p, payment);
        const ordinals = list.find((a) => a.purpose === "ordinals")?.address;
        const next: WalletAccount = { id, chain: "bitcoin", address: payment, ...(ordinals ? { ordinals } : {}) };
        setAccount(next);
        await server?.refresh();
        return next;
      } catch (err) {
        throw err instanceof Error ? err : readableError(err, "Xverse");
      }
    }
    throw new Error("Unknown wallet.");
  };

  /**
   * Restore a previous session without prompting. An Xverse sign-in is the
   * server's cookie, so the server is asked rather than the wallet. Anything
   * else saved (an old MetaMask sign-in) is forgotten: signed out, no error.
   */
  const resume = async (): Promise<void> => {
    const saved = store.get<WalletAccount>(STORE_KEY);
    if (!saved || saved.id !== "xverse") { store.remove(STORE_KEY); return; }
    try {
      const me = server ? await server.refresh() : null;
      if (me?.address && me.address === saved.address) setAccount(saved);
      else store.remove(STORE_KEY);
    } catch {
      // Not trusted any more. Forget it quietly.
      store.remove(STORE_KEY);
    }
  };
  void resume();

  return {
    account: () => account,
    providers: () => PROVIDERS.map(({ id, label, chain, site, detect, ready, icon }) => {
      const i = icon();
      return { id, label, chain, site, installed: detect(), ready, ...(i ? { icon: i } : {}) };
    }),
    connect,
    disconnect() {
      const wasBitcoin = account?.chain === "bitcoin";
      setAccount(null);
      // A Bitcoin sign-in is the server's session, so that has to end too.
      if (wasBitcoin) void endServerSession();
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(account);
      return () => listeners.delete(fn);
    },
    destroy() {
      listeners.clear();
    },
  };
}
