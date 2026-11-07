import { esc } from "./format.js";
import type { AddressResolver } from "../services/winners.js";
import { publicNamesFor } from "../profile/names.js";

/**
 * Display names to show next to wallets, keyed by FULL address — the same key
 * walletCell resolves a masked address to. Built once per page by walletNames().
 */
export type WalletNames = ReadonlyMap<string, string>;

/** How long a page waits for names before it renders without them (ms). */
const NAMES_WAIT_MS = 300;

/** Someone's public profile: the desktop opens /u/<address> in its profile window. */
export function profilePath(address: string): string {
  return `/u/${encodeURIComponent(address)}`;
}

/**
 * " (badbren)" after a wallet whose owner made a Parahawk profile and left
 * privacy off; it opens their profile. Inside the desktop the click becomes a
 * { ph: "open" } message to the shell (layout.ts), so the profile opens in its
 * own window instead of replacing this page. "" when there's no public name.
 */
export function nameTag(full: string | null, names?: WalletNames): string {
  if (!full || !names) return "";
  const name = names.get(full);
  if (!name) return "";
  const path = esc(profilePath(full));
  return ` <a class="pname" href="${path}" data-ph-open="${path}" title="${esc(name)}'s profile">(${esc(name)})</a>`;
}

/**
 * Render a wallet address as a link to its stats page when we can. Full bc1
 * addresses link directly; masked leaderboard addresses (bc1q…last4) link when
 * the resolver can match them to a full address via the order book. Links get
 * the normal anchor styling (green + underline + hand cursor), so anything
 * clickable clearly looks clickable; unresolvable masked ones stay dim. When
 * `names` has the wallet, its owner's name follows in parentheses.
 */
export function walletCell(address: string, resolve?: AddressResolver, names?: WalletNames): string {
  const masked = address.includes("...") || address.includes("…");
  const full = masked ? (resolve ? resolve(address) : null) : address;
  const label = masked ? address : `${address.slice(0, 12)}…${address.slice(-4)}`;
  return full
    ? `<a href="/address/${esc(full)}">${esc(label)}</a>${nameTag(full, names)}`
    : `<span class="dim">${esc(label)}</span>`;
}

/**
 * One batched name lookup for every wallet a page is about to show. Masked
 * addresses are resolved first, so the keys match walletCell's. A name is a
 * nicety: this never throws and never holds a page up for more than
 * NAMES_WAIT_MS — a slow or failed lookup just renders the page without names.
 * Private profiles come back without a name (publicNamesFor).
 */
export async function walletNames(
  addresses: Iterable<string | null | undefined>,
  resolve?: AddressResolver,
  waitMs = NAMES_WAIT_MS,
): Promise<WalletNames> {
  const full = new Set<string>();
  for (const a of addresses) {
    if (!a) continue;
    const masked = a.includes("...") || a.includes("…");
    const f = masked ? (resolve ? resolve(a) : null) : a;
    if (f) full.add(f);
  }
  if (full.size === 0) return new Map();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<WalletNames>([
      publicNamesFor([...full]),
      new Promise<WalletNames>((done) => { timer = setTimeout(() => done(new Map()), waitMs); }),
    ]);
  } catch {
    return new Map();
  } finally {
    if (timer) clearTimeout(timer);
  }
}
