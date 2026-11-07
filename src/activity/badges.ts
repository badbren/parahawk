/**
 * Parahawk's own badges — for using the site, earned by a signed-in wallet.
 * Separate from the Parasite pool badges (src/data/badges.ts, the /badges tab),
 * which come from mining.
 *
 * One table, so names, icons and thresholds can be changed in one place. The
 * names are placeholders until the owner picks their own.
 */
import type { ActivityCounters } from "./rules.js";

/**
 * Signed in to Parahawk before this moment = Early Hawk. PLACEHOLDER — the
 * owner sets the real cutoff.
 */
export const EARLY_HAWK_BEFORE = Date.UTC(2027, 0, 1);

export type BadgeMetric =
  | "selfSearches"
  | "walletSearches"
  | "secondsOnSite"
  | "activeDays"
  | "chatMessages"
  | "suggestions"
  | "rentals"
  | "earlyHawk"
  /** Time on site AND separate days — see TRUSTED_MIN_SECONDS / TRUSTED_MIN_DAYS. */
  | "trusted";

export interface ParahawkBadgeDef {
  id: string;
  emoji: string;
  name: string;
  /** How to earn it — or, for a badge that unlocks something, what it unlocks. */
  howto: string;
  metric: BadgeMetric;
  /** How much of the metric earns it (earlyHawk, trusted: 1). */
  need: number;
  /** What holding it lets you do, said to someone who has it. */
  perk?: string;
}

const HOUR = 3_600;

/**
 * Trusted = both of these. Visible-tab time builds slowly for a normal visitor
 * but fast in a tab left open on a second screen; needing that many separate
 * days stops it being farmed in a weekend. Holding it grants `edit_prices`
 * (src/activity/permissions.ts).
 */
export const TRUSTED_MIN_SECONDS = 10 * HOUR;
export const TRUSTED_MIN_DAYS = 14;

export function isTrusted(c: Pick<ActivityCounters, "secondsOnSite" | "activeDays">): boolean {
  return c.secondsOnSite >= TRUSTED_MIN_SECONDS && c.activeDays >= TRUSTED_MIN_DAYS;
}

/** Display order: the quick ones first, the long hauls last. */
// Parahawk's own badges — just for fun. Wherever badges sit next to a name, the
// Parasite Pool's badges come first and these follow (owner, 2026-11-06).
export const PARAHAWK_BADGES: ParahawkBadgeDef[] = [
  { id: "looked-yourself-up", emoji: "🔍", name: "Looked Yourself Up", howto: "Search your own wallet on Parahawk.", metric: "selfSearches", need: 1 },
  { id: "early-hawk", emoji: "🐣", name: "Early Hawk", howto: "Sign in to Parahawk before the cutoff.", metric: "earlyHawk", need: 1 },
  { id: "first-words", emoji: "💬", name: "First Words", howto: "Say something in Chat.", metric: "chatMessages", need: 1 },
  { id: "suggestion-box", emoji: "📮", name: "Suggestion Box", howto: "Send a suggestion.", metric: "suggestions", need: 1 },
  { id: "renter", emoji: "🏭", name: "Renter", howto: "Place a real rental through the Marketplace.", metric: "rentals", need: 1 },
  { id: "wallet-watcher", emoji: "👀", name: "Wallet Watcher", howto: "Look up 10 other wallets.", metric: "walletSearches", need: 10 },
  { id: "hours-1", emoji: "⏱️", name: "Lurker", howto: "Spend 1 hour on Parahawk.", metric: "secondsOnSite", need: 1 * HOUR },
  { id: "hours-10", emoji: "🕰️", name: "Regular", howto: "Spend 10 hours on Parahawk.", metric: "secondsOnSite", need: 10 * HOUR },
  { id: "hours-50", emoji: "🦅", name: "Hawk Eye", howto: "Spend 50 hours on Parahawk.", metric: "secondsOnSite", need: 50 * HOUR },
  { id: "days-3", emoji: "📅", name: "Back Again", howto: "Visit on 3 different days.", metric: "activeDays", need: 3 },
  { id: "days-7", emoji: "🗓️", name: "Week In", howto: "Visit on 7 different days.", metric: "activeDays", need: 7 },
  { id: "days-30", emoji: "🏠", name: "Local", howto: "Visit on 30 different days.", metric: "activeDays", need: 30 },
  { id: "chatterbox", emoji: "🗣️", name: "Chatterbox", howto: "Send 100 messages in Chat.", metric: "chatMessages", need: 100 },
  {
    id: "trusted", emoji: "🛡️", name: "Trusted",
    howto: "Lets you update Kiss My Hash's price on the Marketplace when it's out of date.",
    metric: "trusted", need: 1, perk: "You can update hand-typed prices",
  },
];

export interface BadgeProgress {
  have: number;
  need: number;
  /** Ready to show: "23 / 60 min", "2 / 3 days", "earned". */
  label: string;
}

export interface BadgeView {
  id: string;
  emoji: string;
  name: string;
  desc: string;
  earned: boolean;
  /** Overall progress; for a two-part badge, its furthest-behind part. */
  progress: BadgeProgress;
  /** A badge with two requirements (Trusted): each one's progress. */
  parts?: BadgeProgress[];
  /** What holding it lets you do (shown once earned). */
  perk?: string;
}

export interface BadgeInput {
  counters: ActivityCounters;
  /**
   * This is the owner's wallet (config.adminAddress — see owner.ts). The owner
   * holds ALL Parahawk badges (owner's call, 2026-11-06), whatever the counters say.
   */
  owner?: boolean;
  /** Real Marketplace rentals placed through Parahawk (not dry runs). */
  rentals: number;
  /** When the wallet was first seen on Parahawk, or null if it never has been. */
  firstSeen: number | null;
  now: number;
}

const UNIT: Partial<Record<BadgeMetric, [string, string]>> = {
  walletSearches: ["wallet", "wallets"],
  activeDays: ["day", "days"],
  chatMessages: ["message", "messages"],
};

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "23 / 60 min" for the one-hour badge; "12 min / 10 h", then "3.2 / 10 h", for the longer ones. */
function timeLabel(haveS: number, needS: number): string {
  if (needS <= HOUR) return `${Math.floor(haveS / 60)} / ${Math.round(needS / 60)} min`;
  if (haveS < HOUR) return `${Math.floor(haveS / 60)} min / ${Math.round(needS / HOUR)} h`;
  const h = haveS / HOUR;
  const shown = h < 10 ? (Math.floor(h * 10) / 10).toFixed(1) : String(Math.floor(h));
  return `${shown} / ${Math.round(needS / HOUR)} h`;
}

function metricValue(def: ParahawkBadgeDef, i: BadgeInput): number {
  switch (def.metric) {
    case "rentals": return i.rentals;
    case "earlyHawk": return i.firstSeen !== null && i.firstSeen > 0 && i.firstSeen < EARLY_HAWK_BEFORE ? 1 : 0;
    case "trusted": return isTrusted(i.counters) ? 1 : 0;
    default: return i.counters[def.metric];
  }
}

const part = (have: number, need: number, label: string): BadgeProgress => ({ have: Math.min(Math.max(0, have), need), need, label });

/** Trusted: hours AND days, each with its own bar. */
function evaluateTrusted(def: ParahawkBadgeDef, i: BadgeInput): BadgeView {
  const s = Math.max(0, i.counters.secondsOnSite);
  const d = Math.max(0, i.counters.activeDays);
  const hours = part(s, TRUSTED_MIN_SECONDS, s >= TRUSTED_MIN_SECONDS ? `${Math.round(TRUSTED_MIN_SECONDS / HOUR)} h ✓` : timeLabel(s, TRUSTED_MIN_SECONDS));
  const days = part(d, TRUSTED_MIN_DAYS, d >= TRUSTED_MIN_DAYS ? `${TRUSTED_MIN_DAYS} days ✓` : `${d} / ${TRUSTED_MIN_DAYS} days`);
  const earned = isTrusted(i.counters);
  const behind = hours.have / hours.need <= days.have / days.need ? hours : days;
  return {
    id: def.id, emoji: def.emoji, name: def.name, desc: def.howto, earned,
    progress: earned ? { have: 1, need: 1, label: "earned" } : { ...behind, label: `${hours.label} · ${days.label}` },
    parts: [hours, days],
    ...(def.perk ? { perk: def.perk } : {}),
  };
}

export function evaluateBadge(def: ParahawkBadgeDef, i: BadgeInput): BadgeView {
  if (def.metric === "trusted") return evaluateTrusted(def, i);
  const have = Math.max(0, metricValue(def, i));
  const earned = have >= def.need;
  let label: string;
  if (earned) label = "earned";
  else if (def.metric === "earlyHawk") label = i.now < EARLY_HAWK_BEFORE ? `before ${fmtDate(EARLY_HAWK_BEFORE)}` : "closed";
  else if (def.metric === "secondsOnSite") label = timeLabel(have, def.need);
  else if (def.need === 1) label = "not yet";
  else {
    const unit = UNIT[def.metric];
    label = `${have} / ${def.need}${unit ? ` ${unit[def.need === 1 ? 0 : 1]}` : ""}`;
  }
  const howto = def.metric === "earlyHawk" ? `Signed in to Parahawk before ${fmtDate(EARLY_HAWK_BEFORE)}.` : def.howto;
  return {
    id: def.id,
    emoji: def.emoji,
    name: def.name,
    desc: howto,
    earned,
    progress: { have: Math.min(have, def.need), need: def.need, label },
    ...(def.perk ? { perk: def.perk } : {}),
  };
}

/** A badge as held outright — how every badge looks on the owner. */
function heldOutright(def: ParahawkBadgeDef): BadgeView {
  return {
    id: def.id, emoji: def.emoji, name: def.name,
    desc: def.metric === "earlyHawk" ? `Signed in to Parahawk before ${fmtDate(EARLY_HAWK_BEFORE)}.` : def.howto,
    earned: true,
    progress: { have: def.need, need: def.need, label: "earned" },
    ...(def.perk ? { perk: def.perk } : {}),
  };
}

export function evaluateBadges(i: BadgeInput): BadgeView[] {
  // The owner holds all of them.
  if (i.owner) return PARAHAWK_BADGES.map(heldOutright);
  return PARAHAWK_BADGES.map((def) => evaluateBadge(def, i));
}

// ── Chips: the badges shown next to a name (Chat, profiles) ─────────────────

/**
 * Most impressive first: the perk badge, then the long hauls, then the quick
 * ones. Every badge id appears exactly once (badges.test.ts holds this).
 */
export const CHIP_ORDER: readonly string[] = [
  "trusted", "hours-50", "days-30", "chatterbox", "renter", "hours-10", "days-7",
  "wallet-watcher", "early-hawk", "hours-1", "days-3", "suggestion-box", "first-words", "looked-yourself-up",
];

/**
 * The earned badges worth showing next to a name, most impressive first. Tiers
 * of one ladder (same metric — hours, days, chat messages) show only the
 * highest: "Hawk Eye" says everything "Lurker" and "Regular" would.
 */
export function chipBadges(views: readonly BadgeView[]): BadgeView[] {
  const metricOf = new Map(PARAHAWK_BADGES.map((d) => [d.id, d] as const));
  const top = new Map<string, BadgeView>(); // metric → highest earned tier
  for (const v of views) {
    if (!v.earned) continue;
    const def = metricOf.get(v.id);
    if (!def) continue;
    const held = top.get(def.metric);
    if (!held || (metricOf.get(held.id)?.need ?? 0) < def.need) top.set(def.metric, v);
  }
  const rank = (id: string) => { const k = CHIP_ORDER.indexOf(id); return k < 0 ? CHIP_ORDER.length : k; };
  return [...top.values()].sort((a, b) => rank(a.id) - rank(b.id));
}
