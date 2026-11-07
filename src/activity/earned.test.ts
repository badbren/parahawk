import { describe, expect, it } from "vitest";
import { EARLY_HAWK_BEFORE, TRUSTED_MIN_DAYS, TRUSTED_MIN_SECONDS } from "./badges.js";
import { ORDER_BADGES, earnedFromActivity, stampAfterActivity, stampsFor } from "./earned.js";
import { blankRecord, type ActivityRecord } from "./rules.js";
import { MemoryActivityStore, mergeStamps } from "./store.js";

const NOW = Date.UTC(2026, 10, 6, 12);
const ALICE = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const OWNER = "bc1qowner000000000000000000000000000000000";

const rec = (over: Partial<ActivityRecord> = {}): ActivityRecord => ({ ...blankRecord(ALICE, NOW - 86_400_000), ...over });

describe("earnedFromActivity", () => {
  it("lists what the counters have earned, and never the order-log badges", () => {
    const ids = earnedFromActivity(rec({ selfSearches: 1, chatMessages: 1 }), NOW);
    expect(ids).toContain("looked-yourself-up");
    expect(ids).toContain("first-words");
    for (const id of ORDER_BADGES) expect(ids).not.toContain(id);
  });

  it("Trusted needs both its parts", () => {
    expect(earnedFromActivity(rec({ secondsOnSite: TRUSTED_MIN_SECONDS, activeDays: TRUSTED_MIN_DAYS }), NOW)).toContain("trusted");
    expect(earnedFromActivity(rec({ secondsOnSite: TRUSTED_MIN_SECONDS, activeDays: 1 }), NOW)).not.toContain("trusted");
  });
});

describe("stampsFor", () => {
  it("stamps a newly earned badge with the time it happened", () => {
    expect(stampsFor(rec({ earnedAt: {} }), ["first-words"], NOW)).toEqual({ "first-words": NOW });
  });

  it("keeps the first time: badges already stamped aren't stamped again", () => {
    const r = rec({ earnedAt: { "first-words": NOW - 5_000 } });
    expect(stampsFor(r, ["first-words"], NOW)).toBeNull();
    expect(stampsFor(r, ["first-words", "looked-yourself-up"], NOW)).toEqual({ "looked-yourself-up": NOW });
  });

  it("backfills a record from before tracking: what it holds gets 0 ('before tracking')", () => {
    expect(stampsFor(rec({ earnedAt: undefined }), ["first-words", "early-hawk"], NOW)).toEqual({ "first-words": 0, "early-hawk": 0 });
    expect(stampsFor(rec({ earnedAt: null }), ["first-words"], NOW)).toEqual({ "first-words": 0 });
  });

  it("starts tracking an old record even when it holds nothing yet", () => {
    expect(stampsFor(rec({ earnedAt: null }), [], NOW)).toEqual({});
  });
});

describe("mergeStamps", () => {
  it("the first stamp wins", () => {
    expect(mergeStamps({ a: 1 }, { a: 2, b: 3 })).toEqual({ a: 1, b: 3 });
    expect(mergeStamps(null, { a: 2 })).toEqual({ a: 2 });
  });
});

describe("stampAfterActivity", () => {
  it("writes the new stamps to the store", async () => {
    const store = new MemoryActivityStore();
    const r = await store.bump(ALICE, "chat_message", NOW);
    await stampAfterActivity(store, r, NOW, () => false);
    expect((await store.get(ALICE))?.earnedAt?.["first-words"]).toBe(NOW);
    // Early Hawk too: a new wallet signing in before the cutoff.
    expect(NOW < EARLY_HAWK_BEFORE).toBe(true);
    expect((await store.get(ALICE))?.earnedAt?.["early-hawk"]).toBe(NOW);
  });

  it("does nothing more once everything held is stamped", async () => {
    const store = new MemoryActivityStore();
    const r1 = await store.bump(ALICE, "chat_message", NOW);
    await stampAfterActivity(store, r1, NOW, () => false);
    const r2 = await store.bump(ALICE, "chat_message", NOW + 60_000);
    await stampAfterActivity(store, r2, NOW + 60_000, () => false);
    expect((await store.get(ALICE))?.earnedAt?.["first-words"]).toBe(NOW);
  });

  it("never stamps the owner — holding every badge isn't earning one", async () => {
    const store = new MemoryActivityStore();
    const r = await store.bump(OWNER, "chat_message", NOW);
    await stampAfterActivity(store, r, NOW, (a) => a === OWNER);
    expect((await store.get(OWNER))?.earnedAt).toEqual({});
  });

  it("never throws, whatever the store does", async () => {
    const broken = { stampEarned: async () => { throw new Error("db down"); } } as unknown as MemoryActivityStore;
    await expect(stampAfterActivity(broken, rec({ chatMessages: 1 }), NOW, () => false)).resolves.toBeUndefined();
  });
});

describe("store: stampEarned + all", () => {
  it("merges stamps (first wins) and lists everyone, most recently seen first", async () => {
    const store = new MemoryActivityStore();
    await store.bump(ALICE, "chat_message", NOW);
    await store.bump(OWNER, "self_search", NOW + 1_000);
    expect(await store.stampEarned("bc1qnobody", { x: 1 })).toBeNull();
    await store.stampEarned(ALICE, { "first-words": 5 });
    await store.stampEarned(ALICE, { "first-words": 9, "looked-yourself-up": 7 });
    expect((await store.get(ALICE))?.earnedAt).toEqual({ "first-words": 5, "looked-yourself-up": 7 });
    expect((await store.all(10)).map((r) => r.address)).toEqual([OWNER, ALICE]);
    expect(await store.all(1)).toHaveLength(1);
  });
});
