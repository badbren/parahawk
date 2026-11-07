/**
 * Site activity — what one signed-in wallet has done on Parahawk, and the rules
 * for counting it. Pure: the stores (store.ts) apply these, and the Postgres
 * functions in supabase/migrations/20261106000100_activity.sql mirror them.
 *
 * Time on site is measured by the SERVER, never claimed by the client. The
 * desktop pings every minute while it is visible; each ping credits the time
 * since the previous one, capped at MAX_CREDIT_S, and a ping more than
 * MAX_GAP_S after the last one starts a fresh streak and credits nothing. So a
 * script pinging faster gains nothing, two tabs don't double-count, and a
 * laptop that slept for an hour isn't an hour on Parahawk.
 */
import type { ActivityKind } from "./record.js";

/** How often the desktop pings while it's visible (src/shell/session/activity.ts). */
export const PING_EVERY_MS = 60_000;
/** The most one ping can add. */
export const MAX_CREDIT_S = 90;
/** A ping later than this after the previous one credits nothing — it starts a new streak. */
export const MAX_GAP_S = 180;

export interface ActivityRecord {
  /** The signed-in (server session) address. */
  address: string;
  /** First and latest activity of any kind, ms. */
  firstSeen: number;
  lastSeen: number;
  /** The last accepted heartbeat, ms; null before the first. */
  lastPing: number | null;
  secondsOnSite: number;
  /** Distinct UTC days with any activity, and the latest of them ("YYYY-MM-DD"). */
  activeDays: number;
  lastDay: string | null;
  selfSearches: number;
  walletSearches: number;
  chatMessages: number;
  suggestions: number;
  /** The address they mine to, when they told us (it can differ from the one they sign in with). */
  poolAddress: string | null;
  /**
   * When each Parahawk badge was first earned, ms, by badge id (src/activity/earned.ts).
   * 0 = earned before tracking began (time unknown). Absent or null = a record
   * from before tracking: the first stamp backfills it.
   */
  earnedAt?: Record<string, number> | null;
}

/** The counters the API shows (the record minus its bookkeeping). */
export type ActivityCounters = Pick<
  ActivityRecord,
  "firstSeen" | "lastSeen" | "secondsOnSite" | "activeDays" | "selfSearches" | "walletSearches" | "chatMessages" | "suggestions"
>;

const COUNTER_OF: Record<ActivityKind, "selfSearches" | "walletSearches" | "chatMessages" | "suggestions"> = {
  self_search: "selfSearches",
  wallet_search: "walletSearches",
  chat_message: "chatMessages",
  suggestion: "suggestions",
};

export const ACTIVITY_KINDS = Object.keys(COUNTER_OF) as ActivityKind[];

export function isActivityKind(v: unknown): v is ActivityKind {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(COUNTER_OF, v);
}

/** "2026-11-06" — the UTC calendar day of a moment. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function blankRecord(address: string, now: number): ActivityRecord {
  return {
    address, firstSeen: now, lastSeen: now, lastPing: null, secondsOnSite: 0, activeDays: 0, lastDay: null,
    selfSearches: 0, walletSearches: 0, chatMessages: 0, suggestions: 0, poolAddress: null,
    // Tracked from the start: anything this wallet earns from here on gets its real time.
    earnedAt: {},
  };
}

/** Any activity: bump lastSeen, and count a new active day when the UTC day has moved on. */
function touch(rec: ActivityRecord, now: number): ActivityRecord {
  const day = utcDay(now);
  const newDay = rec.lastDay === null || day > rec.lastDay;
  return {
    ...rec,
    lastSeen: Math.max(rec.lastSeen, now),
    activeDays: rec.activeDays + (newDay ? 1 : 0),
    lastDay: newDay ? day : rec.lastDay,
  };
}

/** Whole seconds a ping at `now` earns after one at `lastPing`. */
export function creditFor(lastPing: number | null, now: number): number {
  if (lastPing === null || now <= lastPing) return 0;
  const gapS = (now - lastPing) / 1000;
  if (gapS > MAX_GAP_S) return 0;
  return Math.min(Math.floor(gapS), MAX_CREDIT_S);
}

/** A heartbeat. `credited` is the seconds it added. */
export function applyPing(prev: ActivityRecord | null, address: string, now: number): { record: ActivityRecord; credited: number } {
  const base = prev ?? blankRecord(address, now);
  const credited = creditFor(base.lastPing, now);
  const record = touch({
    ...base,
    secondsOnSite: base.secondsOnSite + credited,
    lastPing: Math.max(base.lastPing ?? now, now),
  }, now);
  return { record, credited };
}

/** One event of this kind (a search, a chat message, a suggestion). */
export function applyEvent(prev: ActivityRecord | null, address: string, kind: ActivityKind, now: number): ActivityRecord {
  const base = prev ?? blankRecord(address, now);
  const field = COUNTER_OF[kind];
  return touch({ ...base, [field]: base[field] + 1 }, now);
}

/** Remember (or forget, with null) the address they mine to. Not activity: no day is counted. */
export function applyPoolAddress(prev: ActivityRecord | null, address: string, poolAddress: string | null, now: number): ActivityRecord {
  return { ...(prev ?? blankRecord(address, now)), poolAddress };
}

// ── Pool addresses ───────────────────────────────────────────────────────────
// What the wallet page accepts (src/web/pages/address.ts) is any bc1 address;
// here it must also be a REAL one — a correct bech32/bech32m checksum (BIP-173,
// BIP-350) — so a typo is refused with a message instead of saving an address
// that shows a page of zeros.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk >>> 0;
}

/** 5-bit groups → bytes; null when the padding isn't clean. */
function fromWords(words: number[]): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const w of words) {
    acc = ((acc << 5) | w) & 0x1fff;
    bits += 5;
    while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff) !== 0) return null;
  return out;
}

/** A mainnet segwit address (bc1q… / bc1p…) with a valid checksum. */
export function isMainnetSegwit(addr: string): boolean {
  if (addr.length < 14 || addr.length > 90) return false;
  if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) return false;
  const a = addr.toLowerCase();
  if (!a.startsWith("bc1")) return false;
  const data: number[] = [];
  for (const c of a.slice(3)) {
    const d = CHARSET.indexOf(c);
    if (d < 0) return false;
    data.push(d);
  }
  if (data.length < 7) return false;
  const version = data[0]!;
  if (version > 16) return false;
  // hrp "bc" expanded: high bits, 0, low bits.
  const check = polymod([3, 3, 0, 2, 3, ...data]);
  if (check !== (version === 0 ? BECH32_CONST : BECH32M_CONST)) return false;
  const program = fromWords(data.slice(1, -6));
  if (!program || program.length < 2 || program.length > 40) return false;
  return version !== 0 || program.length === 20 || program.length === 32;
}

/** An address the Profile can show pool numbers for. */
export function isPoolAddress(v: unknown): v is string {
  return typeof v === "string" && isMainnetSegwit(v);
}

export function countersOf(rec: ActivityRecord | null): ActivityCounters {
  return {
    firstSeen: rec?.firstSeen ?? 0,
    lastSeen: rec?.lastSeen ?? 0,
    secondsOnSite: rec?.secondsOnSite ?? 0,
    activeDays: rec?.activeDays ?? 0,
    selfSearches: rec?.selfSearches ?? 0,
    walletSearches: rec?.walletSearches ?? 0,
    chatMessages: rec?.chatMessages ?? 0,
    suggestions: rec?.suggestions ?? 0,
  };
}
