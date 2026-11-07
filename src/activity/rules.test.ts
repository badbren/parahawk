import { describe, expect, it } from "vitest";
import {
  MAX_CREDIT_S,
  MAX_GAP_S,
  applyEvent,
  applyPing,
  applyPoolAddress,
  blankRecord,
  countersOf,
  creditFor,
  isActivityKind,
  isPoolAddress,
  utcDay,
  type ActivityRecord,
} from "./rules.js";

const A = "bc1qalice0000000000000000000000000000000";
const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);
const s = (n: number) => n * 1000;

/** Ping at each offset (seconds from T0), returning the final record. */
function pings(offsets: number[], start: ActivityRecord | null = null): ActivityRecord {
  let rec = start;
  for (const o of offsets) rec = applyPing(rec, A, T0 + s(o)).record;
  return rec!;
}

describe("time on site", () => {
  it("credits nothing for the first ping — it only starts a streak", () => {
    const { record, credited } = applyPing(null, A, T0);
    expect(credited).toBe(0);
    expect(record.secondsOnSite).toBe(0);
    expect(record.lastPing).toBe(T0);
  });

  it("credits the time since the previous ping, in whole seconds", () => {
    expect(pings([0, 60, 120, 180]).secondsOnSite).toBe(180);
    expect(creditFor(T0, T0 + 59_999)).toBe(59);
  });

  it("caps one ping at MAX_CREDIT_S", () => {
    expect(creditFor(T0, T0 + s(MAX_GAP_S))).toBe(MAX_CREDIT_S);
    expect(pings([0, 150]).secondsOnSite).toBe(MAX_CREDIT_S);
  });

  it("credits nothing after a gap longer than MAX_GAP_S (a new streak)", () => {
    expect(creditFor(T0, T0 + s(MAX_GAP_S) + 1)).toBe(0);
    expect(pings([0, 60, 60 + 3_600, 60 + 3_660]).secondsOnSite).toBe(120);
  });

  it("can't be farmed by pinging faster: credit is elapsed time", () => {
    const fast = pings(Array.from({ length: 61 }, (_, i) => i)); // every second for a minute
    expect(fast.secondsOnSite).toBe(60);
  });

  it("two tabs pinging out of step don't double-count", () => {
    const offsets = [];
    for (let m = 0; m < 10; m++) offsets.push(m * 60, m * 60 + 25); // tab A on the minute, tab B 25 s later
    const rec = pings(offsets);
    expect(rec.secondsOnSite).toBe(9 * 60 + 25);
  });

  it("ignores a ping that arrives out of order (clock skew between instances)", () => {
    const rec = pings([0, 60]);
    const late = applyPing(rec, A, T0 + s(30));
    expect(late.credited).toBe(0);
    expect(late.record.lastPing).toBe(T0 + s(60));
  });
});

describe("days and events", () => {
  it("counts each UTC day with activity once", () => {
    let rec = pings([0, 60]);
    expect(rec.activeDays).toBe(1);
    expect(rec.lastDay).toBe("2026-11-06");
    rec = applyEvent(rec, A, "wallet_search", T0 + s(3_600));
    expect(rec.activeDays).toBe(1);
    rec = applyPing(rec, A, Date.UTC(2026, 10, 7, 0, 0, 5)).record;
    expect(rec.activeDays).toBe(2);
    rec = applyEvent(rec, A, "chat_message", Date.UTC(2026, 10, 9, 8));
    expect(rec.activeDays).toBe(3);
    expect(rec.lastDay).toBe("2026-11-09");
  });

  it("counts events on their own counters and keeps firstSeen", () => {
    let rec = applyEvent(null, A, "self_search", T0);
    rec = applyEvent(rec, A, "wallet_search", T0 + 1);
    rec = applyEvent(rec, A, "wallet_search", T0 + 2);
    rec = applyEvent(rec, A, "chat_message", T0 + 3);
    rec = applyEvent(rec, A, "suggestion", T0 + 4);
    expect(countersOf(rec)).toMatchObject({ selfSearches: 1, walletSearches: 2, chatMessages: 1, suggestions: 1, firstSeen: T0, lastSeen: T0 + 4 });
  });

  it("setting a pool address is not activity", () => {
    const rec = applyPoolAddress(blankRecord(A, T0), A, "bc1qminer000000000000000000000000000000", T0 + 5);
    expect(rec.poolAddress).toBe("bc1qminer000000000000000000000000000000");
    expect(rec.activeDays).toBe(0);
    expect(applyPoolAddress(rec, A, null, T0).poolAddress).toBeNull();
  });

  it("zeroes counters for someone never seen", () => {
    expect(countersOf(null)).toEqual({
      firstSeen: 0, lastSeen: 0, secondsOnSite: 0, activeDays: 0, selfSearches: 0, walletSearches: 0, chatMessages: 0, suggestions: 0,
    });
  });
});

describe("helpers", () => {
  it("utcDay is the UTC calendar day", () => {
    expect(utcDay(Date.UTC(2026, 10, 6, 23, 59, 59))).toBe("2026-11-06");
    expect(utcDay(Date.UTC(2026, 10, 7, 0, 0, 0))).toBe("2026-11-07");
  });
  it("knows the activity kinds", () => {
    expect(isActivityKind("chat_message")).toBe(true);
    expect(isActivityKind("hours")).toBe(false);
    expect(isActivityKind("toString")).toBe(false);
  });
  it("accepts real bc1 pool addresses only — the checksum has to be right", () => {
    // BIP-173 / BIP-350 / BIP-86 examples: P2WPKH, P2WSH, and two taproot.
    for (const ok of [
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4",
      "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
      "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
    ]) expect(isPoolAddress(ok)).toBe(true);
    for (const bad of [
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5", // one character off
      "bc1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4", // mixed case
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd", // taproot with the old checksum
      "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", // testnet
      "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // not segwit
      "bc1qnotreal",
      "bc1q<script>",
    ]) expect(isPoolAddress(bad)).toBe(false);
    expect(isPoolAddress(42)).toBe(false);
  });
});
