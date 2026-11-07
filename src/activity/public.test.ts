import { afterEach, describe, expect, it } from "vitest";
import { CHIP_ORDER, PARAHAWK_BADGES, TRUSTED_MIN_DAYS, TRUSTED_MIN_SECONDS } from "./badges.js";
import { earnedBadgesFor, usePublicBadgeDeps } from "./public.js";
import { blankRecord, type ActivityRecord } from "./rules.js";
import { MemoryActivityStore, type ActivityStore } from "./store.js";

const NOW = Date.UTC(2026, 10, 6, 12);
const ALICE = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const BOB = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";
const OWNER = "bc1qowner000000000000000000000000000000";

/** A store seeded with records, counting how often it is read. */
class Seeded extends MemoryActivityStore {
  reads = 0;
  constructor(recs: ActivityRecord[]) {
    super();
    for (const r of recs) this.records.set(r.address, r);
  }
  override async getMany(addresses: readonly string[]) {
    this.reads++;
    return super.getMany(addresses);
  }
}

const rec = (address: string, over: Partial<ActivityRecord> = {}): ActivityRecord => ({ ...blankRecord(address, NOW - 86_400_000), ...over });

let clock = NOW;
const use = (store: ActivityStore, rentals: (a: string) => Promise<number> = async () => 0) =>
  usePublicBadgeDeps({ store, rentals, owner: (a) => a === OWNER, now: () => clock });

afterEach(() => { usePublicBadgeDeps(null); clock = NOW; });

describe("earnedBadgesFor", () => {
  it("returns earned chips, top tier of each ladder only, most impressive first", async () => {
    use(new Seeded([rec(ALICE, { secondsOnSite: 11 * 3_600, activeDays: 8, chatMessages: 3, selfSearches: 1 })]));
    const chips = (await earnedBadgesFor([ALICE])).get(ALICE)!.map((c) => c.id);
    // Regular (10 h) supersedes Lurker; Week In supersedes Back Again; First Words is the chat tier held.
    expect(chips).toEqual(["hours-10", "days-7", "early-hawk", "first-words", "looked-yourself-up"]);
    for (const c of (await earnedBadgesFor([ALICE])).get(ALICE)!) {
      expect(c.emoji.length).toBeGreaterThan(0);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it("puts Trusted first once both of its parts are met", async () => {
    use(new Seeded([rec(BOB, { secondsOnSite: TRUSTED_MIN_SECONDS, activeDays: TRUSTED_MIN_DAYS })]));
    expect((await earnedBadgesFor([BOB])).get(BOB)![0]!.id).toBe("trusted");
  });

  it("gives the owner every badge, with no activity at all", async () => {
    use(new Seeded([]));
    const ids = (await earnedBadgesFor([OWNER])).get(OWNER)!.map((c) => c.id);
    // One chip per ladder: Hawk Eye, Local and Chatterbox stand for their lower tiers.
    expect(ids[0]).toBe("trusted");
    expect(ids).toEqual(CHIP_ORDER.filter((id) => !["hours-10", "hours-1", "days-7", "days-3", "first-words"].includes(id)));
  });

  it("leaves out addresses with nothing earned", async () => {
    use(new Seeded([rec(ALICE, { firstSeen: Date.UTC(2027, 5, 1) })]));
    expect((await earnedBadgesFor([ALICE, "bc1qnobody"])).size).toBe(0);
  });

  it("reads the store once per call, then answers from cache", async () => {
    const store = new Seeded([rec(ALICE, { selfSearches: 1 }), rec(BOB, { chatMessages: 1 })]);
    use(store);
    await earnedBadgesFor([ALICE, BOB, ALICE]);
    expect(store.reads).toBe(1);
    await earnedBadgesFor([ALICE, BOB]);
    expect(store.reads).toBe(1);
    clock += 31_000;
    await earnedBadgesFor([ALICE, BOB]);
    expect(store.reads).toBe(2);
  });

  it("counts real rentals for the Renter badge", async () => {
    use(new Seeded([rec(ALICE)]), async (a) => (a === ALICE ? 2 : 0));
    expect((await earnedBadgesFor([ALICE])).get(ALICE)!.map((c) => c.id)).toContain("renter");
  });

  it("never throws: a broken store gives last round's chips, or none", async () => {
    const store = new Seeded([rec(ALICE, { selfSearches: 1 })]);
    use(store);
    expect((await earnedBadgesFor([ALICE])).get(ALICE)).toBeTruthy();
    store.getMany = async () => { throw new Error("db down"); };
    clock += 31_000;
    expect((await earnedBadgesFor([ALICE])).get(ALICE)!.map((c) => c.id)).toEqual(["early-hawk", "looked-yourself-up"]);
    expect((await earnedBadgesFor([BOB])).size).toBe(0);
  });

  it("doesn't let a slow order log hold up a chat poll", async () => {
    use(new Seeded([rec(ALICE, { selfSearches: 1 })]), () => new Promise<number>(() => { /* never answers */ }));
    const t = Date.now();
    const chips = await earnedBadgesFor([ALICE]);
    expect(Date.now() - t).toBeLessThan(3_000);
    expect(chips.get(ALICE)!.map((c) => c.id)).not.toContain("renter");
  });
});

describe("CHIP_ORDER", () => {
  it("ranks every badge exactly once", () => {
    expect([...CHIP_ORDER].sort()).toEqual(PARAHAWK_BADGES.map((b) => b.id).sort());
  });
});
