import { describe, expect, it } from "vitest";
import { ORE_PER_BLACK } from "../../econ/tokenomics.js";
import { createMemoryStore, type KeyValueStore } from "./store.js";
import { createPracticeLedger } from "./ledger.js";
import type { WalletAccount } from "./wallet.js";

const ALICE: WalletAccount = { id: "phantom", chain: "solana", address: "7XkC4vQmR2nL8sPd" };
const BOB: WalletAccount = { id: "metamask", chain: "evm", address: "0xAbC123" };

/** Bank enough runs to afford one claim. */
const fill = (l: ReturnType<typeof createPracticeLedger>, per = 130) => {
  while (!l.canClaim()) l.addRun(per);
};

describe("banking runs", () => {
  it("starts empty", () => {
    const l = createPracticeLedger(createMemoryStore());
    expect(l.state()).toEqual({ runs: 0, ore: 0, lifetimeOre: 0, blacks: [], bestRun: 0 });
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
    l.addRun(ORE_PER_BLACK - 1);
    expect(l.canClaim()).toBe(false);
    expect(l.claim()).toBeNull();
    l.addRun(1);
    expect(l.canClaim()).toBe(true);
  });

  it("spends exactly one Black's worth and keeps the change", () => {
    const l = createPracticeLedger(createMemoryStore());
    l.addRun(ORE_PER_BLACK + 250);
    const black = l.claim();
    expect(black).not.toBeNull();
    expect(black!.ore).toBe(ORE_PER_BLACK);
    expect(l.state().ore).toBe(250);
    expect(l.state().blacks).toHaveLength(1);
    // Lifetime ore is a record of what was mined, so a claim must not reduce it.
    expect(l.state().lifetimeOre).toBe(ORE_PER_BLACK + 250);
  });

  it("gives each claim its own serial", () => {
    const l = createPracticeLedger(createMemoryStore());
    l.addRun(ORE_PER_BLACK * 3);
    const ids = [l.claim(), l.claim(), l.claim()].map((b) => b!.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^#[0-9a-f]{8}$/);
  });

  it("cannot claim more Blacks than the ore paid for", () => {
    const l = createPracticeLedger(createMemoryStore());
    fill(l);
    expect(l.claim()).not.toBeNull();
    expect(l.claim()).toBeNull();
    expect(l.state().blacks).toHaveLength(1);
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
    first.addRun(ORE_PER_BLACK + 40);
    first.claim();

    const reopened = createPracticeLedger(store, ALICE);
    expect(reopened.state().ore).toBe(40);
    expect(reopened.state().blacks).toHaveLength(1);
    // A stored serial must not be renumbered on re-read.
    expect(reopened.state().blacks[0]!.id).toBe(first.state().blacks[0]!.id);
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
      expect(l.state().blacks).toEqual([]);
    }
  });

  it("drops malformed claims but keeps the good ones", () => {
    const l = createPracticeLedger(withRaw({ ore: 10, blacks: [{ id: "#abc12345", at: 1, ore: 1000 }, { nope: true }, null] }));
    expect(l.state().blacks).toHaveLength(1);
    expect(l.state().blacks[0]!.id).toBe("#abc12345");
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
    l.addRun(ORE_PER_BLACK);
    l.claim();
    l.reset();
    expect(l.state()).toEqual({ runs: 0, ore: 0, lifetimeOre: 0, blacks: [], bestRun: 0 });
  });
});
