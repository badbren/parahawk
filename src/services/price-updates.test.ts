import { describe, expect, it } from "vitest";
import type { PriceChange } from "./manual-prices.js";
import {
  COMMUNITY_VENUES,
  MAX_USD_PER_PHD,
  UPDATES_PER_DAY,
  UPDATE_COOLDOWN_MS,
  checkBounds,
  checkPace,
  checkUsd,
  isOwnerAddress,
  median,
} from "./price-updates.js";
import { config } from "../config.js";

const NOW = Date.UTC(2026, 10, 6, 12);
const ALICE = "bc1qalice0000000000000000000000000000000";

const change = (over: Partial<PriceChange> = {}): PriceChange => ({
  id: Math.random().toString(36).slice(2),
  venue: "kissmyhash",
  oldSats: 50_000,
  newSats: 51_000,
  usd: 38,
  by: ALICE,
  at: NOW - 60 * 60_000,
  kind: "update",
  ...over,
});

describe("median", () => {
  it("ignores junk and handles odd/even counts", () => {
    expect(median([])).toBeNull();
    expect(median([0, -3, Number.NaN])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("checkUsd", () => {
  it("wants a real positive number, not thousands", () => {
    expect(checkUsd(38.04).ok).toBe(true);
    expect(checkUsd("38.04").ok).toBe(true);
    for (const bad of [0, -1, "", "abc", null, undefined, Number.NaN]) expect(checkUsd(bad).ok).toBe(false);
    expect(checkUsd(MAX_USD_PER_PHD + 1)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("checkBounds", () => {
  const base = { venueName: "Kiss My Hash" };
  it("passes a sensible update", () => {
    expect(checkBounds({ ...base, newSats: 52_000, currentSats: 50_000, marketSats: 48_000 }).ok).toBe(true);
  });
  it("passes with nothing to compare against", () => {
    expect(checkBounds({ ...base, newSats: 52_000, currentSats: null, marketSats: null }).ok).toBe(true);
  });
  it("refuses more than 3× either way from the current price", () => {
    expect(checkBounds({ ...base, newSats: 150_001, currentSats: 50_000, marketSats: null })).toMatchObject({ ok: false, status: 400 });
    expect(checkBounds({ ...base, newSats: 16_000, currentSats: 50_000, marketSats: null }).ok).toBe(false);
    expect(checkBounds({ ...base, newSats: 150_000, currentSats: 50_000, marketSats: null }).ok).toBe(true);
  });
  it("refuses more than 4× either way from the live venues", () => {
    expect(checkBounds({ ...base, newSats: 200_001, currentSats: null, marketSats: 50_000 }).ok).toBe(false);
    expect(checkBounds({ ...base, newSats: 12_000, currentSats: null, marketSats: 50_000 }).ok).toBe(false);
    expect(checkBounds({ ...base, newSats: 13_000, currentSats: null, marketSats: 50_000 }).ok).toBe(true);
  });
  it("refuses nothing", () => {
    expect(checkBounds({ ...base, newSats: 0, currentSats: null, marketSats: null }).ok).toBe(false);
  });
  it("says what's wrong in plain words", () => {
    const v = checkBounds({ ...base, newSats: 500_000, currentSats: 50_000, marketSats: null });
    expect(!v.ok && v.error).toMatch(/Kiss My Hash/);
  });
});

describe("checkPace", () => {
  const base = { venue: "kissmyhash", venueName: "Kiss My Hash", now: NOW };
  it("allows a first update", () => {
    expect(checkPace({ ...base, recent: [] }).ok).toBe(true);
  });
  it("holds one update per venue for 10 minutes", () => {
    const v = checkPace({ ...base, recent: [change({ at: NOW - 3 * 60_000 })] });
    expect(v).toMatchObject({ ok: false, status: 429 });
    expect(!v.ok && v.retryAfterMs).toBe(UPDATE_COOLDOWN_MS - 3 * 60_000);
    expect(checkPace({ ...base, recent: [change({ at: NOW - UPDATE_COOLDOWN_MS })] }).ok).toBe(true);
  });
  it("doesn't hold another venue", () => {
    expect(checkPace({ ...base, venue: "braiins", recent: [change({ at: NOW - 60_000 })] }).ok).toBe(true);
  });
  it("caps updates per day, counting only the last 24 hours", () => {
    const full = Array.from({ length: UPDATES_PER_DAY }, (_, i) => change({ venue: `v${i}`, at: NOW - (i + 1) * 60 * 60_000 }));
    expect(checkPace({ ...base, recent: full })).toMatchObject({ ok: false, status: 429 });
    const stale = full.map((c) => ({ ...c, at: c.at - 24 * 60 * 60_000 }));
    expect(checkPace({ ...base, recent: stale }).ok).toBe(true);
  });
  it("doesn't count the owner putting a price back", () => {
    expect(checkPace({ ...base, recent: [change({ at: NOW - 60_000, kind: "revert" })] }).ok).toBe(true);
  });
});

describe("venues and owner", () => {
  it("only offers Kiss My Hash to visitors (Braiins's row ignores hand-typed prices)", () => {
    expect([...COMMUNITY_VENUES]).toEqual(["kissmyhash"]);
  });
  it("knows the owner's address in any case", () => {
    expect(isOwnerAddress(config.adminAddress)).toBe(true);
    expect(isOwnerAddress(config.adminAddress.toUpperCase())).toBe(true);
    expect(isOwnerAddress(ALICE)).toBe(false);
    expect(isOwnerAddress(null)).toBe(false);
  });
});
