import { describe, expect, it } from "vitest";
import { buildLeaderboard, buildStats, isLeaderboardWindow, windowStart } from "./board.js";
import type { BurnRecord, RunRecord } from "./types.js";

const NOW = Date.UTC(2026, 9, 22, 18, 30); // 22 Oct 2026, 18:30 UTC
const HOUR = 3_600_000;
const name = (a: string) => `name:${a}`;

let n = 0;
const run = (address: string, score: number, ago: number, won = true): RunRecord => ({
  id: `r${n++}`, address, at: NOW - ago, seed: n, score, won, nonces: 0, stale: 0, scrapes: 0,
  durationMs: 45_000, whitesAwarded: won ? 2 : 1,
});

describe("windows", () => {
  it("starts today at midnight UTC, the week 7 days back, and all time nowhere", () => {
    expect(windowStart("today", NOW)).toBe(Date.UTC(2026, 9, 22));
    expect(windowStart("week", NOW)).toBe(NOW - 7 * 24 * HOUR);
    expect(windowStart("all", NOW)).toBeNull();
  });

  it("knows its own window names", () => {
    expect(["today", "week", "all"].every(isLeaderboardWindow)).toBe(true);
    expect(isLeaderboardWindow("month")).toBe(false);
    expect(isLeaderboardWindow(undefined)).toBe(false);
  });
});

describe("buildLeaderboard", () => {
  const runs = [
    run("alice", 120, 1 * HOUR),
    run("alice", 180, 2 * HOUR),
    run("bob", 180, 3 * HOUR, false),   // ties alice's best, but earlier
    run("carol", 90, 30 * HOUR),        // yesterday: in the week, not today
    run("dave", 199, 10 * 24 * HOUR),   // older than a week
  ];

  it("ranks best score per player, ties to whoever got there first", () => {
    const b = buildLeaderboard(runs, "today", NOW, 50, name);
    expect(b.rows.map((r) => [r.rank, r.address, r.best])).toEqual([[1, "bob", 180], [2, "alice", 180]]);
    expect(b.rows[1]).toMatchObject({ runs: 2, wins: 2, whitesWon: 4, name: "name:alice" });
    expect(b.rows[0]).toMatchObject({ runs: 1, wins: 0, whitesWon: 1 });
    expect(b.totalRuns).toBe(3);
    expect(b.players).toBe(2);
    expect(b.practice).toBe(true);
  });

  it("widens with the window", () => {
    expect(buildLeaderboard(runs, "week", NOW, 50, name).rows.map((r) => r.address)).toEqual(["bob", "alice", "carol"]);
    expect(buildLeaderboard(runs, "all", NOW, 50, name).rows.map((r) => r.address)).toEqual(["dave", "bob", "alice", "carol"]);
  });

  it("honours the limit but still counts everyone", () => {
    const b = buildLeaderboard(runs, "all", NOW, 1, name);
    expect(b.rows).toHaveLength(1);
    expect(b.players).toBe(4);
  });

  it("is empty, not broken, with no runs", () => {
    expect(buildLeaderboard([], "today", NOW, 50, name)).toMatchObject({ rows: [], totalRuns: 0, players: 0 });
  });
});

describe("buildStats", () => {
  it("adds up one player's record", () => {
    const mine = [run("alice", 120, HOUR), run("alice", 160, 2 * HOUR, false), run("alice", 80, 50 * HOUR)];
    const burns: BurnRecord[] = [
      { id: "b1", address: "alice", at: NOW, fromTier: "white", toTier: "orange" },
      { id: "b2", address: "alice", at: NOW, fromTier: "white", toTier: "orange" },
      { id: "b3", address: "alice", at: NOW, fromTier: "orange", toTier: "green" },
    ];
    const s = buildStats("alice", mine, burns, name);
    expect(s).toMatchObject({ runs: 3, wins: 2, losses: 1, best: 160, whitesWon: 5, name: "name:alice", practice: true });
    expect(s.winRate).toBeCloseTo(2 / 3, 10);
    expect(s.burned).toEqual({ white: 4, orange: 2 });
    expect(s.made).toEqual({ orange: 2, green: 1 });
    expect(s.firstAt).toBe(NOW - 50 * HOUR);
    expect(s.lastAt).toBe(NOW - HOUR);
  });

  it("has no win rate before the first run", () => {
    expect(buildStats("nobody", [], [], name)).toMatchObject({ runs: 0, winRate: null, firstAt: null, lastAt: null, best: 0 });
  });
});
