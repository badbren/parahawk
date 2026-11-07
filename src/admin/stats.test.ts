import { describe, expect, it } from "vitest";
import { blankRecord, type ActivityRecord } from "../activity/rules.js";
import type { TrafficSummary } from "../services/traffic.js";
import { buildAdminStats, startOfUtcDay, type AdminProfile, type AdminSources } from "./stats.js";

const NOW = Date.UTC(2026, 10, 6, 15);
const DAY = 86_400_000;
const OWNER = "bc1qowner000000000000000000000000000000000";
const ALICE = "bc1qalice00000000000000000000000000000000";
const BOB = "bc1qbob0000000000000000000000000000000000";
const CARL = "bc1qcarl000000000000000000000000000000000";

const rec = (address: string, over: Partial<ActivityRecord> = {}): ActivityRecord => ({ ...blankRecord(address, NOW - 30 * DAY), ...over });

const traffic: TrafficSummary = {
  days: [{ day: "2026-11-05", visitors: 4, views: 9 }, { day: "2026-11-06", visitors: 7, views: 20 }],
  today: { day: "2026-11-06", visitors: 7, views: 20 },
  last7: { visitors: 30, views: 80 },
  last30: { visitors: 90, views: 300 },
  backend: "memory",
};

function sources(over: Partial<AdminSources> = {}, records: ActivityRecord[] = []): AdminSources & { stamped: Array<[string, Record<string, number>]> } {
  const stamped: Array<[string, Record<string, number>]> = [];
  const profiles = new Map<string, AdminProfile>([
    [ALICE, { name: "alice", isPrivate: false, avatarUrl: "/api/profile/avatar/a1?v=1" }],
    [BOB, { name: "bobby", isPrivate: true, avatarUrl: null }],
  ]);
  return {
    stamped,
    activity: async () => records,
    stampEarned: async (address, stamps) => { stamped.push([address, stamps]); return null; },
    profiles: async (addresses) => new Map([...profiles].filter(([a]) => addresses.includes(a))),
    orders: async (address) => (address === CARL ? [{ status: "dryrun", placedAt: NOW - DAY }, { status: "placed", placedAt: NOW - 2 * DAY }] : []),
    chatRecent: async () => [
      { address: ALICE, at: NOW - 3_600_000 },
      { address: ALICE, at: NOW - 1_800_000 },
      { address: BOB, at: NOW - 60_000 },
      { address: BOB, at: NOW - 2 * DAY },
    ],
    chatTotal: async () => 57,
    suggestions: async () => [{ at: NOW - DAY, status: "new" }, { at: NOW - 3 * DAY, status: "read" }, { at: NOW - 20 * DAY, status: "new" }],
    runs: async (since) => (since === startOfUtcDay(NOW) ? { totalRuns: 12, players: 3 } : { totalRuns: 0, players: 0 }),
    traffic: async () => traffic,
    isOwner: (a) => a === OWNER,
    now: () => NOW,
    ...over,
  };
}

describe("buildAdminStats", () => {
  it("counts people by UTC day and week, leaving the owner out of the totals", async () => {
    const records = [
      rec(OWNER, { lastSeen: NOW - 1_000, firstSeen: NOW - DAY }),
      rec(ALICE, { lastSeen: NOW - 3_600_000, firstSeen: NOW - 2 * DAY }), // today, new this week
      rec(BOB, { lastSeen: startOfUtcDay(NOW) - 1, firstSeen: NOW - 40 * DAY }), // yesterday, old
      rec(CARL, { lastSeen: NOW - 9 * DAY, firstSeen: NOW - 8 * DAY }), // a while ago
    ];
    const s = await buildAdminStats(sources({}, records));
    const o = s.overview;
    expect(o.wallets).toBe(3);
    expect(o.activeToday).toBe(1);
    expect(o.newThisWeek).toBe(1);
    expect(o.named).toBe(2);
    expect(o.visitorsToday).toBe(7);
    expect(o.viewsToday).toBe(20);
    expect(o.visitors7d).toBe(30);
    expect(o.chatToday).toBe(3);
    expect(o.chattersToday).toBe(2);
    expect(o.chatTotal).toBe(57);
    expect(o.suggestionsNew).toBe(2);
    expect(o.suggestionsWeek).toBe(2);
    expect(o.runsToday).toBe(12);
    expect(o.playersToday).toBe(3);
    expect(s.errors).toEqual([]);
    expect(s.traffic).toBe(traffic);
  });

  it("shows everyone in Users, the owner marked, private people with their name for the owner", async () => {
    const records = [rec(OWNER), rec(ALICE, { secondsOnSite: 7_200, chatMessages: 2 }), rec(BOB)];
    const s = await buildAdminStats(sources({}, records));
    const byAddr = new Map(s.users.map((u) => [u.address, u]));
    expect(byAddr.get(OWNER)?.owner).toBe(true);
    expect(byAddr.get(ALICE)).toMatchObject({ name: "alice", isPrivate: false, avatarUrl: "/api/profile/avatar/a1?v=1", secondsOnSite: 7_200, chatMessages: 2 });
    expect(byAddr.get(BOB)).toMatchObject({ name: "bobby", isPrivate: true });
    // The owner holds every badge; the others only what they earned.
    expect(byAddr.get(OWNER)!.badges.length).toBeGreaterThan(byAddr.get(ALICE)!.badges.length);
  });

  it("lists who earned which badge and when, newest first, 'before tracking' last, never the owner", async () => {
    const records = [
      rec(OWNER, { chatMessages: 5, earnedAt: {} }),
      rec(ALICE, { chatMessages: 1, earnedAt: { "first-words": NOW - 3_600_000, "early-hawk": NOW - 30 * DAY } }),
      rec(BOB, { selfSearches: 1, earnedAt: { "looked-yourself-up": 0, "early-hawk": 0 } }),
    ];
    const s = await buildAdminStats(sources({}, records));
    const recent = s.badges.recent.map((e) => [e.address, e.badgeId, e.at]);
    expect(recent[0]).toEqual([ALICE, "first-words", NOW - 3_600_000]);
    // Every "before tracking" (0) entry comes after every timed one.
    const firstZero = recent.findIndex(([, , at]) => at === 0);
    expect(firstZero).toBeGreaterThan(0);
    expect(recent.slice(firstZero).every(([, , at]) => at === 0)).toBe(true);
    expect(recent).toContainEqual([BOB, "looked-yourself-up", 0]);
    expect(recent.some(([a]) => a === OWNER)).toBe(false);
    expect(s.overview.badgesThisWeek).toBe(1);
    // Holder counts skip the owner too.
    const holders = Object.fromEntries(s.badges.table.map((b) => [b.id, b.holders]));
    expect(holders["first-words"]).toBe(1);
  });

  it("backfills badge times for records from before tracking (0 = before tracking), and stamps new ones with now", async () => {
    const old = rec(ALICE, { chatMessages: 3, earnedAt: undefined });
    const tracked = rec(BOB, { selfSearches: 1, earnedAt: {} });
    const src = sources({}, [old, tracked]);
    const s = await buildAdminStats(src);
    const stamps = new Map(src.stamped);
    expect(stamps.get(ALICE)?.["first-words"]).toBe(0);
    expect(stamps.get(BOB)?.["looked-yourself-up"]).toBe(NOW);
    const alice = s.badges.recent.find((e) => e.address === ALICE && e.badgeId === "first-words");
    expect(alice?.at).toBe(0);
  });

  it("never stamps the owner", async () => {
    const src = sources({}, [rec(OWNER, { chatMessages: 9, earnedAt: undefined })]);
    await buildAdminStats(src);
    expect(src.stamped).toEqual([]);
  });

  it("dates Renter from the first real order, not dry runs", async () => {
    const s = await buildAdminStats(sources({}, [rec(CARL, { earnedAt: {} })]));
    const renter = s.badges.recent.find((e) => e.badgeId === "renter");
    expect(renter).toMatchObject({ address: CARL, at: NOW - 2 * DAY });
    expect(s.users[0]!.rentals).toBe(1);
  });

  it("a failing source blanks its own numbers and says so, the rest still load", async () => {
    const s = await buildAdminStats(sources({ traffic: async () => { throw new Error("db down"); } }, [rec(ALICE)]));
    expect(s.traffic).toBeNull();
    expect(s.overview.visitorsToday).toBeNull();
    expect(s.errors.some((e) => e.startsWith("Traffic"))).toBe(true);
    expect(s.users).toHaveLength(1);
    expect(s.overview.chatToday).toBe(3);
  });

  it("a slow source times out instead of holding up the page", async () => {
    const s = await buildAdminStats(sources({ chatRecent: () => new Promise(() => {}) }, []), { timeoutMs: 30 });
    expect(s.overview.chatToday).toBeNull();
    expect(s.errors.some((e) => e.startsWith("Chat"))).toBe(true);
  });
});
