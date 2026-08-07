import { esc } from "./format.js";
import type { AddressResolver } from "../services/winners.js";

/**
 * Render a wallet address as a link to its stats page when we can. Full bc1
 * addresses link directly; masked leaderboard addresses (bc1q…last4) link when
 * the resolver can match them to a full address via the order book. Links get
 * the normal anchor styling (green + underline + hand cursor), so anything
 * clickable clearly looks clickable; unresolvable masked ones stay dim.
 */
export function walletCell(address: string, resolve?: AddressResolver): string {
  const masked = address.includes("...") || address.includes("…");
  const full = masked ? (resolve ? resolve(address) : null) : address;
  const label = masked ? address : `${address.slice(0, 12)}…${address.slice(-4)}`;
  return full
    ? `<a href="/address/${esc(full)}">${esc(label)}</a>`
    : `<span class="dim">${esc(label)}</span>`;
}
