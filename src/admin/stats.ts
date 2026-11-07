/**
 * The owner's dashboard numbers (the Admin window): who uses the site, traffic,
 * Parahawk badges earned, Chat, Suggestions, Block Hunt.
 *
 * Owner-only: src/web/admin-routes.ts checks the session; this file only adds
 * things up, from sources passed in (so tests can hand it fixed data).
 *
 * Read-only, with one exception: a wallet's badge-earned times are backfilled
 * here (src/activity/earned.ts) if it hasn't been stamped yet — the same stamp
 * its next heartbeat would make.
 *
 * Each source has its own time limit and fails on its own: a slow traffic table
 * blanks the traffic numbers and adds a line to `errors`, not the whole dashboard.
 *
 * Days are UTC days, the same as the traffic counter's.
 */
import { PARAHAWK_BADGES, evaluateBadges } from "../activity/badges.js";
import { ORDER_BADGES, earnedFromActivity, stampsFor } from "../activity/earned.js";
import { countersOf, type ActivityRecord } from "../activity/rules.js";
import { mergeStamps } from "../activity/store.js";
import type { TrafficSummary } from "../services/traffic.js";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** What a profile lookup gives back (src/profile/names.ts ProfileRef). */
export interface AdminProfile {
  name: string | null;
  isPrivate: boolean;
  avatarUrl: string | null;
}

/** A Marketplace order placed through Parahawk (src/services/wizard-orders.ts). */
export interface AdminOrder {
  status: string;
  placedAt: number;
}

export interface AdminSources {
  /** Every known signed-in wallet's activity record. */
  activity(): Promise<ActivityRecord[]>;
  /** Save backfilled badge times (store.stampEarned). */
  stampEarned(address: string, stamps: Record<string, number>): Promise<unknown>;
  /** Profiles (name, privacy, picture) for these wallets; absent = no profile. */
  profiles(addresses: readonly string[]): Promise<Map<string, AdminProfile>>;
  /** Marketplace orders by this wallet. */
  orders(address: string): Promise<AdminOrder[]>;
  /** Recent live chat messages (enough to cover today). */
  chatRecent(): Promise<Array<{ address: string; at: number }>>;
  /** Messages ever sent (the highest id). */
  chatTotal(): Promise<number>;
  /** Recent suggestions, newest first. */
  suggestions(): Promise<Array<{ at: number; status: string }>>;
  /** Block Hunt runs and players since `since` (ms). */
  runs(since: number): Promise<{ totalRuns: number; players: number }>;
  traffic(): Promise<TrafficSummary>;
  isOwner(address: string): boolean;
  now(): number;
}

export interface AdminBadgeChip {
  id: string;
  emoji: string;
  name: string;
}

export interface AdminUser {
  address: string;
  name: string | null;
  isPrivate: boolean;
  avatarUrl: string | null;
  /** The site owner (you). Not counted in the totals. */
  owner: boolean;
  firstSeen: number | null;
  lastSeen: number | null;
  secondsOnSite: number;
  activeDays: number;
  chatMessages: number;
  /** Wallet lookups, their own and others'. */
  searches: number;
  suggestions: number;
  /** Real Marketplace rentals; null when the order log couldn't be read. */
  rentals: number | null;
  badges: AdminBadgeChip[];
}

export interface BadgeEarner {
  address: string;
  name: string | null;
  isPrivate: boolean;
  badgeId: string;
  emoji: string;
  badgeName: string;
  /** When, ms. 0 = before tracking began (time unknown). */
  at: number;
}

export interface AdminBadgeRow {
  id: string;
  emoji: string;
  name: string;
  desc: string;
  /** Wallets holding it, not counting the owner (who holds all of them). */
  holders: number;
}

export interface AdminOverview {
  /** Traffic counter (every visitor, signed in or not); null when it couldn't be read. */
  visitorsToday: number | null;
  viewsToday: number | null;
  visitors7d: number | null;
  /** Signed-in wallets ever seen, not counting the owner. */
  wallets: number;
  activeToday: number;
  newThisWeek: number;
  /** Wallets with a display name. */
  named: number;
  chatToday: number | null;
  chattersToday: number | null;
  chatTotal: number | null;
  suggestionsNew: number | null;
  suggestionsWeek: number | null;
  runsToday: number | null;
  playersToday: number | null;
  badgesThisWeek: number;
}

export interface AdminStats {
  generatedAt: number;
  overview: AdminOverview;
  /** Most recently seen first. */
  users: AdminUser[];
  badges: { table: AdminBadgeRow[]; recent: BadgeEarner[] };
  traffic: TrafficSummary | null;
  /** Short notes for anything that couldn't be loaded. */
  errors: string[];
}

/** Midnight UTC of the day `now` is in. */
export function startOfUtcDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
  });
}

/** One source, its own time limit; on failure a note goes in `errors` and the value is null. */
async function settle<T>(what: string, p: () => Promise<T>, errors: string[], ms: number): Promise<T | null> {
  try {
    return await within(p(), ms);
  } catch (err) {
    errors.push(`${what}: ${(err as Error).message || "failed"}`);
    return null;
  }
}

/** Run `fn` over `items`, at most `limit` at a time. */
async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface BuildOptions {
  /** Per-source time limit. */
  timeoutMs?: number;
  /** Per-wallet order-log time limit (one slow lookup costs that wallet its Renter badge, not the page). */
  ordersTimeoutMs?: number;
  /** How many recent badge earners to list. */
  recentLimit?: number;
}

export async function buildAdminStats(src: AdminSources, opts: BuildOptions = {}): Promise<AdminStats> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const ordersTimeoutMs = opts.ordersTimeoutMs ?? 2_500;
  const recentLimit = opts.recentLimit ?? 60;
  const now = src.now();
  const today = startOfUtcDay(now);
  const weekAgo = now - WEEK_MS;
  const errors: string[] = [];

  // Everything that doesn't need the wallet list, in parallel with it.
  const [records, chatRecent, chatTotal, suggestions, runs, traffic] = await Promise.all([
    settle("Users", () => src.activity(), errors, timeoutMs),
    settle("Chat", () => src.chatRecent(), errors, timeoutMs),
    settle("Chat total", () => src.chatTotal(), errors, timeoutMs),
    settle("Suggestions", () => src.suggestions(), errors, timeoutMs),
    settle("Block Hunt", () => src.runs(today), errors, timeoutMs),
    settle("Traffic", () => src.traffic(), errors, timeoutMs),
  ]);
  const recs = records ?? [];

  // Backfill badge times for anyone not stamped yet (never the owner — see earned.ts).
  for (const rec of recs) {
    if (src.isOwner(rec.address)) continue;
    const stamps = stampsFor(rec, earnedFromActivity(rec, now), now);
    if (!stamps) continue;
    rec.earnedAt = mergeStamps(rec.earnedAt, stamps);
    await src.stampEarned(rec.address, stamps).catch((err: Error) => {
      if (!errors.includes("Badge times")) errors.push("Badge times");
      console.warn("[admin] badge stamp failed:", err.message);
    });
  }

  const addresses = recs.map((r) => r.address);
  const [profiles, orders] = await Promise.all([
    settle("Names", () => src.profiles(addresses), errors, timeoutMs),
    pool(recs, 4, (r) =>
      src.isOwner(r.address)
        ? Promise.resolve(null)
        : within(src.orders(r.address), ordersTimeoutMs).catch(() => null)),
  ]);

  const badgeDef = new Map(PARAHAWK_BADGES.map((d) => [d.id, d] as const));
  const users: AdminUser[] = [];
  const earners: BadgeEarner[] = [];
  const holders = new Map<string, number>();

  recs.forEach((rec, i) => {
    const owner = src.isOwner(rec.address);
    const prof = profiles?.get(rec.address) ?? null;
    const real = orders[i]?.filter((o) => o.status !== "dryrun") ?? null;
    const counters = countersOf(rec);
    const views = evaluateBadges({
      counters,
      rentals: real?.length ?? 0,
      firstSeen: rec.firstSeen > 0 ? rec.firstSeen : null,
      now,
      owner,
    });
    const held = views.filter((v) => v.earned);
    users.push({
      address: rec.address,
      name: prof?.name ?? null,
      isPrivate: prof?.isPrivate === true,
      avatarUrl: prof?.avatarUrl ?? null,
      owner,
      firstSeen: rec.firstSeen > 0 ? rec.firstSeen : null,
      lastSeen: rec.lastSeen > 0 ? rec.lastSeen : null,
      secondsOnSite: counters.secondsOnSite,
      activeDays: counters.activeDays,
      chatMessages: counters.chatMessages,
      searches: counters.selfSearches + counters.walletSearches,
      suggestions: counters.suggestions,
      rentals: owner ? null : real?.length ?? null,
      badges: held.map(({ id, emoji, name }) => ({ id, emoji, name })),
    });
    if (owner) return;

    for (const v of held) holders.set(v.id, (holders.get(v.id) ?? 0) + 1);

    const who = { address: rec.address, name: prof?.name ?? null, isPrivate: prof?.isPrivate === true };
    // Activity badges: their stamped times. Only badges that still exist.
    for (const [id, at] of Object.entries(rec.earnedAt ?? {})) {
      const def = badgeDef.get(id);
      if (!def || ORDER_BADGES.has(id)) continue;
      earners.push({ ...who, badgeId: id, emoji: def.emoji, badgeName: def.name, at });
    }
    // Order badges (Renter): the first real order is when it was earned.
    if (real && real.length > 0) {
      const first = Math.min(...real.map((o) => o.placedAt).filter((t) => t > 0));
      for (const id of ORDER_BADGES) {
        const def = badgeDef.get(id);
        if (def && Number.isFinite(first)) earners.push({ ...who, badgeId: id, emoji: def.emoji, badgeName: def.name, at: first });
      }
    }
  });

  // Newest first; "before tracking" (0) at the end.
  earners.sort((a, b) => (b.at || -1) - (a.at || -1));

  const others = users.filter((u) => !u.owner);
  const chatToday = chatRecent ? chatRecent.filter((m) => m.at >= today) : null;

  return {
    generatedAt: now,
    overview: {
      visitorsToday: traffic?.today.visitors ?? null,
      viewsToday: traffic?.today.views ?? null,
      visitors7d: traffic?.last7.visitors ?? null,
      wallets: others.length,
      activeToday: others.filter((u) => (u.lastSeen ?? 0) >= today).length,
      newThisWeek: others.filter((u) => (u.firstSeen ?? 0) >= weekAgo).length,
      named: others.filter((u) => u.name).length,
      chatToday: chatToday ? chatToday.length : null,
      chattersToday: chatToday ? new Set(chatToday.map((m) => m.address)).size : null,
      chatTotal,
      suggestionsNew: suggestions ? suggestions.filter((s) => s.status === "new").length : null,
      suggestionsWeek: suggestions ? suggestions.filter((s) => s.at >= weekAgo).length : null,
      runsToday: runs?.totalRuns ?? null,
      playersToday: runs?.players ?? null,
      badgesThisWeek: earners.filter((e) => e.at >= weekAgo).length,
    },
    users,
    badges: {
      table: PARAHAWK_BADGES.map((d) => {
        const v = evaluateBadges({ counters: countersOf(null), rentals: 0, firstSeen: null, now }).find((b) => b.id === d.id);
        return { id: d.id, emoji: d.emoji, name: d.name, desc: v?.desc ?? d.howto, holders: holders.get(d.id) ?? 0 };
      }),
      recent: earners.slice(0, recentLimit),
    },
    traffic,
    errors,
  };
}
