import { describe, expect, it } from "vitest";
import { ORE_PER_WHITE } from "../../econ/tokenomics.js";
import { createMemoryStore, type KeyValueStore } from "./store.js";
import { createPracticeLedger } from "./ledger.js";
import type { WalletAccount } from "./wallet.js";

const ALICE: WalletAccount = { id: "xverse", chain: "bitcoin", address: "bc1qalice0000000000000000000000000000000" };
const BOB: WalletAccount = { id: "walletconnect", chain: "evm", address: "0xAbC123" };

/** Bank enough runs to afford one claim. */
const fill = (l: ReturnType<typeof createPracticeLedger>, per = 130) => {
  while (!l.canClaim()) l.addRun(per);
};

describe("banking runs", () => {
  it("starts empty", () => {
    const l = createPracticeLedger(createMemoryStore());
    expect(l.state()).toEqual({ runs: 0, ore: 0, lifetimeOre: 0, claims: [], bestRun: 0 });
    expect(l.canClaim()).toBe(false);
  });

  it("accumulates ore across runs", () => {
    const l = createPracticeLedger(createMemoryStore());
    l.addRun(130);
    const s = l.addRun(90);
    expect(s.runs).toBe(2);
    expect(s.ore).toBe(220);
    expect(s.lifetimeOre).toBe(220);
    expect(s.bestRun).toBe(130);
  });

  it("ignores nonsense scores rather than corrupting the total", () => {
    const l = createPracticeLedger(createMemoryStore());
    l.addRun(Number.NaN);
    l.addRun(-50);
    l.addRun(Infinity);
    const s = l.state();
    expect(s.ore).toBe(0);
    // The runs still happened, they were just worth nothing.
    expect(s.runs).toBe(3);
  });

  it("rounds fractional ore", () => {
    const l = createPracticeLedger(createMemoryStore());
    expect(l.addRun(130.6).ore).toBe(131);
  });
});

describe("claiming", () => {
  it("only allows a claim once there is enough ore", () => {
    const l = createPracticeLedger(createMemoryStore());
    l.addRun(ORE_PER_WHITE - 1);
    expect(l.canClaim()).toBe(false);
    expect(l.claim()).toBeNull();
    l.addRun(1);
    expect(l.canClaim()).toBe(true);
  });

  it("spends exactly one White's worth and keeps the change", () => {
    const l = createPracticeLedger(createMemoryStore());
    l.addRun(ORE_PER_WHITE + 250);
    const claim = l.claim();
    expect(claim).not.toBeNull();
    expect(claim!.ore).toBe(ORE_PER_WHITE);
    expect(l.state().ore).toBe(250);
    expect(l.state().claims).toHaveLength(1);
    // Lifetime ore is a record of what was mined, so a claim must not reduce it.
    expect(l.state().lifetimeOre).toBe(ORE_PER_WHITE + 250);
  });

  it("gives each claim its own serial", () => {
    const l = createPracticeLedger(createMemoryStore());
    l.addRun(ORE_PER_WHITE * 3);
    const ids = [l.claim(), l.claim(), l.claim()].map((b) => b!.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^#[0-9a-f]{8}$/);
  });

  it("cannot claim more Whites than the ore paid for", () => {
    const l = createPracticeLedger(createMemoryStore());
    fill(l);
    expect(l.claim()).not.toBeNull();
    expect(l.claim()).toBeNull();
    expect(l.state().claims).toHaveLength(1);
  });
});

describe("winning and burning", () => {
  it("awards Whites outright for a finished run", () => {
    const l = createPracticeLedger(createMemoryStore());
    const won = l.award(2);
    expect(won).toHaveLength(2);
    expect(won.every((c) => c.tier === "white" && c.ore === 0)).toBe(true);
    expect(new Set(won.map((c) => c.id)).size).toBe(2);
    expect(l.held()).toHaveLength(2);
    expect(l.award(0)).toEqual([]);
    expect(l.award(-3)).toEqual([]);
  });

  it("burns two of a tier into one of the next", () => {
    const l = createPracticeLedger(createMemoryStore());
    const [a, b] = l.award(2);
    const orange = l.burn(a!.id, b!.id);
    expect(orange.tier).toBe("orange");
    expect(orange.from).toEqual([a!.id, b!.id]);
    expect(l.held().map((c) => c.id)).toEqual([orange.id]);
    // The burned pair stays on record, marked, so stats can count what was burned.
    expect(l.state().claims.filter((c) => c.burnedAt !== undefined)).toHaveLength(2);
  });

  it("climbs the whole ladder and stops at Prismatic", () => {
    const l = createPracticeLedger(createMemoryStore());
    let pieces = l.award(10).concat(l.award(10), l.award(10), l.award(2));
    for (const tier of ["orange", "green", "blue", "red", "prismatic"]) {
      const next = [];
      for (let i = 0; i + 1 < pieces.length; i += 2) next.push(l.burn(pieces[i]!.id, pieces[i + 1]!.id));
      pieces = next;
      expect(pieces.every((c) => c.tier === tier)).toBe(true);
    }
    expect(pieces).toHaveLength(1);
    const [top] = pieces;
    const [w1, w2] = l.award(2);
    expect(() => l.burn(top!.id, w1!.id)).toThrow(/same tier/);
    expect(() => l.burn(w1!.id, w1!.id)).toThrow(/two different/);
    l.burn(w1!.id, w2!.id);
    expect(() => l.burn(w1!.id, w2!.id)).toThrow(/already been burned/);
  });

  it("will not burn the top of the ladder", () => {
    const store = createMemoryStore();
    store.set("practice.guest", { claims: [{ id: "#aaaaaaa1", at: 1, ore: 0, tier: "prismatic" }, { id: "#aaaaaaa2", at: 1, ore: 0, tier: "prismatic" }] });
    const l = createPracticeLedger(store);
    expect(() => l.burn("#aaaaaaa1", "#aaaaaaa2")).toThrow(/top of the ladder/);
  });

  it("reads old records without tiers as Whites, and junk tiers too", () => {
    const store = createMemoryStore();
    store.set("practice.guest", { claims: [{ id: "#bbbbbbb1", at: 1, ore: 1000 }, { id: "#bbbbbbb2", at: 2, ore: 0, tier: "gold" }] });
    const l = createPracticeLedger(store);
    expect(l.state().claims.map((c) => c.tier)).toEqual(["white", "white"]);
  });
});

describe("identity", () => {
  it("keeps each wallet's progress apart", () => {
    const store = createMemoryStore();
    const l = createPracticeLedger(store, ALICE);
    l.addRun(500);
    expect(l.state().ore).toBe(500);

    l.setIdentity(BOB);
    expect(l.state().ore).toBe(0);
    l.addRun(200);

    l.setIdentity(ALICE);
    expect(l.state().ore).toBe(500);
    l.setIdentity(BOB);
    expect(l.state().ore).toBe(200);
  });

  it("keeps guest progress separate from a wallet's", () => {
    const store = createMemoryStore();
    const l = createPracticeLedger(store, null);
    l.addRun(300);
    l.setIdentity(ALICE);
    expect(l.state().ore).toBe(0);
    l.setIdentity(null);
    expect(l.state().ore).toBe(300);
  });

  it("treats an address case-insensitively, as wallets render it either way", () => {
    const store = createMemoryStore();
    const l = createPracticeLedger(store, BOB);
    l.addRun(400);
    l.setIdentity({ ...BOB, address: BOB.address.toUpperCase() });
    expect(l.state().ore).toBe(400);
  });

  it("survives a reload", () => {
    const store = createMemoryStore();
    const first = createPracticeLedger(store, ALICE);
    first.addRun(ORE_PER_WHITE + 40);
    first.claim();

    const reopened = createPracticeLedger(store, ALICE);
    expect(reopened.state().ore).toBe(40);
    expect(reopened.state().claims).toHaveLength(1);
    // A stored serial must not be renumbered on re-read.
    expect(reopened.state().claims[0]!.id).toBe(first.state().claims[0]!.id);
  });
});

describe("stored data is untrusted", () => {
  const withRaw = (raw: unknown): KeyValueStore => {
    const store = createMemoryStore();
    store.set("practice.guest", raw);
    return store;
  };

  it("shrugs off a hand-edited record", () => {
    for (const junk of [null, 42, "nope", [], { ore: "lots" }, { blacks: "no" }]) {
      const l = createPracticeLedger(withRaw(junk));
      expect(l.state().ore).toBe(0);
      expect(l.state().claims).toEqual([]);
    }
  });

  it("drops malformed claims but keeps the good ones", () => {
    const l = createPracticeLedger(withRaw({ ore: 10, blacks: [{ id: "#abc12345", at: 1, ore: 1000 }, { nope: true }, null] }));
    expect(l.state().claims).toHaveLength(1);
    expect(l.state().claims[0]!.id).toBe("#abc12345");
  });

  it("refuses negative balances", () => {
    const l = createPracticeLedger(withRaw({ ore: -999, runs: -5, lifetimeOre: -1 }));
    expect(l.state().ore).toBe(0);
    expect(l.state().runs).toBe(0);
  });
});

describe("subscribers", () => {
  it("replays state immediately and fires on every change", () => {
    const l = createPracticeLedger(createMemoryStore());
    const seen: number[] = [];
    const off = l.subscribe((s) => seen.push(s.ore));
    expect(seen).toEqual([0]);
    l.addRun(120);
    l.addRun(80);
    expect(seen).toEqual([0, 120, 200]);
    off();
    l.addRun(50);
    expect(seen).toHaveLength(3);
  });

  it("fires when the identity changes", () => {
    const l = createPracticeLedger(createMemoryStore(), null);
    l.addRun(70);
    let latest = -1;
    l.subscribe((s) => { latest = s.ore; });
    expect(latest).toBe(70);
    l.setIdentity(ALICE);
    expect(latest).toBe(0);
  });

  it("clears everything on reset", () => {
    const l = createPracticeLedger(createMemoryStore());
    l.addRun(ORE_PER_WHITE);
    l.claim();
    l.reset();
    expect(l.state()).toEqual({ runs: 0, ore: 0, lifetimeOre: 0, claims: [], bestRun: 0 });
  });
});
