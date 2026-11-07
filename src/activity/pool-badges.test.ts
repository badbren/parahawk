import { afterEach, describe, expect, it } from "vitest";
import { nameBadgesFor, poolBadgesFor, usePoolBadgeSource } from "./pool-badges.js";
import { usePublicBadgeDeps } from "./public.js";
import { blankRecord } from "./rules.js";
import { MemoryActivityStore } from "./store.js";

const NOW = Date.UTC(2026, 10, 6, 12);
const MINER = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const OTHER = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";

const pool = (entries: Array<[string, Record<string, number>]>) => async () => new Map(entries);

class Seeded extends MemoryActivityStore {
  constructor(addresses: string[]) {
    super();
    for (const a of addresses) this.records.set(a, { ...blankRecord(a, NOW - 86_400_000), chatMessages: 3 });
  }
}

afterEach(() => { usePoolBadgeSource(null); usePublicBadgeDeps(null); });

describe("poolBadgesFor", () => {
  it("lists a wallet's Parasite badges in the pool's own order, marked as pool badges", async () => {
    usePoolBadgeSource(pool([[MINER, { refinery: 2, block_winner: 1, block: 4 }]]));
    const chips = (await poolBadgesFor([MINER, OTHER], NOW)).get(MINER)!;
    expect(chips.map((c) => c.id)).toEqual(["pool:block_winner", "pool:block", "pool:refinery"]);
    expect(chips.every((c) => c.kind === "pool")).toBe(true);
    expect((await poolBadgesFor([OTHER], NOW)).has(OTHER)).toBe(false);
  });

  it("never throws: a failing source just means no pool badges", async () => {
    usePoolBadgeSource(async () => { throw new Error("db down"); });
    expect((await poolBadgesFor([MINER], NOW)).size).toBe(0);
  });
});

describe("nameBadgesFor", () => {
  it("puts the Parasite Pool's badges before Parahawk's", async () => {
    usePoolBadgeSource(pool([[MINER, { block: 1 }]]));
    usePublicBadgeDeps({ store: new Seeded([MINER]), rentals: async () => 0, owner: () => false, now: () => NOW });
    const chips = (await nameBadgesFor([MINER])).get(MINER)!;
    expect(chips[0]).toMatchObject({ id: "pool:block", kind: "pool" });
    expect(chips.slice(1).every((c) => c.kind === "parahawk")).toBe(true);
    expect(chips.some((c) => c.id === "first-words")).toBe(true);
  });

  it("leaves pool badges off someone private — they'd tie the name to the wallet", async () => {
    usePoolBadgeSource(pool([[MINER, { block: 1 }]]));
    usePublicBadgeDeps({ store: new Seeded([MINER]), rentals: async () => 0, owner: () => false, now: () => NOW });
    const chips = (await nameBadgesFor([MINER], () => false)).get(MINER)!;
    expect(chips.every((c) => c.kind === "parahawk")).toBe(true);
  });
});
