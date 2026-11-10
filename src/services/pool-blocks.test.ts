import { describe, expect, it, vi } from "vitest";
import { countBlocksFound, createBlocksFound, createLifetimeWork, lifetimeWorkFrom } from "./pool-blocks.js";

const round = (height: number) => ({ height, totalWorkDiff: 1, winner: null });
const FIVE = [938713, 945601, 954873, 958212, 958527].map(round);

describe("countBlocksFound", () => {
  it("is the number of completed rounds", () => {
    expect(countBlocksFound(FIVE.map((r) => r.height), 958527)).toBe(5);
  });
  it("counts a block pool-stats has seen before /api/rounds has", () => {
    expect(countBlocksFound(FIVE.map((r) => r.height), 975000)).toBe(6);
  });
  it("ignores a missing or older last-found height", () => {
    expect(countBlocksFound(FIVE.map((r) => r.height), null)).toBe(5);
    expect(countBlocksFound(FIVE.map((r) => r.height), 945601)).toBe(5);
  });
});

describe("createBlocksFound", () => {
  it("fetches once per TTL", async () => {
    const fetchRounds = vi.fn(async () => FIVE);
    const found = createBlocksFound(fetchRounds, 1000);
    expect(await found(958527, 0)).toBe(5);
    expect(await found(958527, 999)).toBe(5);
    expect(fetchRounds).toHaveBeenCalledTimes(1);
    expect(await found(958527, 1000)).toBe(5);
    expect(fetchRounds).toHaveBeenCalledTimes(2);
  });
  it("shares one fetch between concurrent callers", async () => {
    const fetchRounds = vi.fn(async () => FIVE);
    const found = createBlocksFound(fetchRounds, 1000);
    expect(await Promise.all([found(null, 0), found(null, 0), found(null, 0)])).toEqual([5, 5, 5]);
    expect(fetchRounds).toHaveBeenCalledTimes(1);
  });
  it("is unknown (null) when the first fetch fails or comes back empty", async () => {
    expect(await createBlocksFound(async () => { throw new Error("down"); })(null, 0)).toBeNull();
    expect(await createBlocksFound(async () => [])(null, 0)).toBeNull();
  });
  it("keeps the last good list when a refresh fails", async () => {
    let fail = false;
    const found = createBlocksFound(async () => { if (fail) throw new Error("down"); return FIVE; }, 1000);
    expect(await found(null, 0)).toBe(5);
    fail = true;
    expect(await found(975000, 5000)).toBe(6);
  });
});

// Parasite's real rounds as of 2026-11-09 (T = 1e12 difficulty units).
const T = 1e12;
const REAL = [
  { height: 938713, totalWorkDiff: 77.74 * T, winner: null },
  { height: 945601, totalWorkDiff: 69.57 * T, winner: null },
  { height: 954873, totalWorkDiff: 205.11 * T, winner: null },
  { height: 958212, totalWorkDiff: 78.4 * T, winner: null },
  { height: 958527, totalWorkDiff: 35.11 * T, winner: null },
];

describe("lifetimeWorkFrom", () => {
  const heights = REAL.map((r) => r.height);
  const done = REAL.reduce((s, r) => s + r.totalWorkDiff, 0);
  it("is every completed round plus the live round", () => {
    const lw = lifetimeWorkFrom(heights, done, 346.55 * T, 958527);
    expect(lw?.rounds).toBe(5);
    expect(lw!.workDiff / T).toBeCloseTo(812.48, 2);
  });
  it("is unknown while pool-stats and the rounds list disagree on the last block", () => {
    // A block the list hasn't caught up with: its round would be missing.
    expect(lifetimeWorkFrom(heights, done, 0.2 * T, 975000)).toBeNull();
    // The list is ahead of pool-stats: the live work hasn't reset yet, so that round would count twice.
    expect(lifetimeWorkFrom(heights, done, 346.55 * T, 958212)).toBeNull();
  });
  it("ignores a missing last-found height and a bad live value", () => {
    expect(lifetimeWorkFrom(heights, done, 10 * T, null)!.workDiff / T).toBeCloseTo(475.93, 2);
    expect(lifetimeWorkFrom(heights, done, Number.NaN, 958527)!.workDiff / T).toBeCloseTo(465.93, 2);
  });
});

describe("createLifetimeWork", () => {
  it("sums the cached rounds with the live work", async () => {
    const fetchRounds = vi.fn(async () => REAL);
    const lifetime = createLifetimeWork(fetchRounds, 1000);
    expect((await lifetime(346.55 * T, 958527, 0))!.workDiff / T).toBeCloseTo(812.48, 2);
    expect((await lifetime(347 * T, 958527, 500))!.workDiff / T).toBeCloseTo(812.93, 2);
    expect(fetchRounds).toHaveBeenCalledTimes(1);
  });
  it("looks again soon after a new block instead of waiting out the TTL", async () => {
    let rounds = REAL;
    const fetchRounds = vi.fn(async () => rounds);
    const lifetime = createLifetimeWork(fetchRounds, 10 * 60_000);
    expect(await lifetime(346.55 * T, 958527, 0)).not.toBeNull();
    // Block 975000 lands; the list hasn't caught up yet.
    expect(await lifetime(0.1 * T, 975000, 1_000)).toBeNull();
    expect(fetchRounds).toHaveBeenCalledTimes(1);
    rounds = [...REAL, { height: 975000, totalWorkDiff: 350 * T, winner: null }];
    const after = await lifetime(0.1 * T, 975000, 61_000);
    expect(fetchRounds).toHaveBeenCalledTimes(2);
    expect(after?.rounds).toBe(6);
    expect(after!.workDiff / T).toBeCloseTo(815.93 + 0.1, 2);
  });
  it("is unknown (null) when nothing has been fetched", async () => {
    expect(await createLifetimeWork(async () => { throw new Error("down"); })(1 * T, 958527, 0)).toBeNull();
  });
});
