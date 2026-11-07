/**
 * Shared pieces of the Parahawk stats look — the tiles, badge cards and number
 * formats — used by your own Profile → Parahawk section (profile-parahawk.ts)
 * and by someone else's public profile (public-stats.ts), so both read the same.
 * Styles: profile-parahawk.css (.ph-phk-*).
 */
import "./profile-parahawk.css";
import { fmtDifficulty } from "../data/tick";
import { h } from "../util/dom";

// ── The API's shapes (src/web/activity-routes.ts), as read here ─────────────

export interface Progress { have: number; need: number; label: string }

export interface BadgeView {
  id: string; emoji: string; name: string; desc: string; earned: boolean;
  progress: Progress; parts?: Progress[]; perk?: string;
}

export interface PoolHeadline {
  address: string;
  hashratePhs: number;
  bestDifficulty: number;
  bestDiffBlockPercent: number;
  refineryOrders: number;
  activeOrders: number;
  stake: { sats: number; usd: number; pct: number; assumedFull: boolean };
  rentalStake: { sats: number; usd: number } | null;
  parasiteBadges: Array<{ key: string; emoji: string; name: string; count: number }>;
}

// ── Formatting ───────────────────────────────────────────────────────────────

export const int = (n: number) => Math.round(n).toLocaleString("en-US");

export function usd(n: number): string {
  if (!(n > 0)) return "";
  if (n < 0.01) return "<$0.01";
  return n >= 100 ? `$${int(n)}` : `$${n.toFixed(2)}`;
}

export function hashrate(phs: number): string {
  if (!(phs > 0)) return "idle";
  if (phs >= 1) return `${phs.toFixed(phs >= 100 ? 0 : phs >= 10 ? 1 : 2)} PH/s`;
  const ths = phs * 1000;
  if (ths >= 1) return `${ths.toFixed(ths >= 100 ? 0 : ths >= 10 ? 1 : 2)} TH/s`;
  return `${(ths * 1000).toFixed(0)} GH/s`;
}

export function pct(p: number): string {
  if (!(p > 0)) return "0%";
  if (p < 0.001) return "<0.001%";
  return `${p.toFixed(p < 0.1 ? 3 : p < 10 ? 2 : 1)}%`;
}

/** "45 min" · "2.5 h" · "12 h". */
export function duration(seconds: number): string {
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min} min`;
  const hrs = seconds / 3600;
  return hrs < 10 ? `${(Math.floor(hrs * 10) / 10).toFixed(1)} h` : `${Math.floor(hrs)} h`;
}

export const date = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

// ── Pieces ───────────────────────────────────────────────────────────────────

export function tile(label: string, value: string, note: string, title?: string): HTMLElement {
  return h("div", { class: "ph-phk-tile", ...(title ? { title } : {}) },
    h("span", { class: "ph-phk-tile-v" }, value),
    h("span", { class: "ph-phk-tile-l" }, label),
    note ? h("span", { class: "ph-phk-tile-n" }, note) : null);
}

export function bar(p: Progress): HTMLElement {
  const frac = p.need > 0 ? Math.max(0, Math.min(1, p.have / p.need)) : 0;
  return h("span", { class: "ph-phk-prog" },
    h("span", { class: "ph-phk-bar", "aria-hidden": "true" }, h("i", { style: `width:${(frac * 100).toFixed(1)}%` })),
    h("span", { class: "ph-phk-prog-l" }, p.label));
}

export function badgeCard(b: BadgeView): HTMLElement {
  const status: Array<HTMLElement> = [];
  if (b.earned) {
    status.push(h("span", { class: "ph-phk-b-ok" }, "✓ earned"));
    if (b.perk) status.push(h("span", { class: "ph-phk-b-perk" }, b.perk));
  } else if (b.parts && b.parts.length > 0) {
    for (const p of b.parts) status.push(bar(p));
  } else if (b.progress.need > 1) {
    status.push(bar(b.progress));
  } else {
    status.push(h("span", { class: "ph-phk-b-todo" }, b.progress.label));
  }
  return h("li", { class: `ph-phk-b ${b.earned ? "is-earned" : "is-locked"}${b.perk ? " has-perk" : ""}`, title: `${b.name} — ${b.desc}` },
    h("span", { class: "ph-phk-b-ic", "aria-hidden": "true" }, b.emoji),
    h("span", { class: "ph-phk-b-body" },
      h("span", { class: "ph-phk-b-nm" }, b.name, b.perk ? h("span", { class: "ph-phk-b-tag" }, "perk") : null),
      h("span", { class: "ph-phk-b-ds" }, b.desc),
      ...status));
}

/**
 * The wallet page's headline numbers as four tiles, then the wallet's Parasite
 * badges. `whose` words the first tile ("your" / "their"); `rentalsNote` says
 * where the rentals count comes from.
 */
export function poolTiles(p: PoolHeadline, whose: "your" | "their", rentalsNote: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  const stakeNote = [usd(p.stake.usd) && `≈ ${usd(p.stake.usd)}`, `${pct(p.stake.pct)} of this round's work`].filter(Boolean).join(" · ");
  out.push(h("div", { class: "ph-phk-tiles" },
    tile("If the pot cracked now", `~${int(p.stake.sats)} sats`, stakeNote,
      p.stake.assumedFull
        ? `Counts ${whose} all-time work as this round's — spot on if mining started at or after the last block, high if it also ran in earlier rounds.`
        : `Measured from the growth in ${whose} work since the last block.`),
    tile("Hashrate", hashrate(p.hashratePhs), p.activeOrders > 0 ? `${p.activeOrders} rental${p.activeOrders === 1 ? "" : "s"} running` : p.hashratePhs > 0 ? "live" : "not mining right now"),
    tile("Best share", fmtDifficulty(p.bestDifficulty), p.bestDifficulty > 0 ? `${pct(p.bestDiffBlockPercent)} of a block` : "no shares yet"),
    tile("Rentals", int(p.refineryOrders), rentalsNote)));
  if (p.rentalStake) {
    out.push(h("p", { class: "ph-phk-sub" },
      `From ${whose} active rentals alone: ~${int(p.rentalStake.sats)} sats${usd(p.rentalStake.usd) ? ` (≈ ${usd(p.rentalStake.usd)})` : ""}.`));
  }
  if (p.parasiteBadges.length > 0) {
    out.push(h("p", { class: "ph-phk-pbadges" },
      h("span", { class: "ph-phk-dim" }, "Parasite badges "),
      ...p.parasiteBadges.map((b) => h("span", { class: "ph-phk-pb", title: b.name }, `${b.emoji} ${b.count > 1 ? `×${int(b.count)}` : "✓"}`))));
  }
  return out;
}
