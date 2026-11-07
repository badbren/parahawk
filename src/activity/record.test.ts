import { afterEach, describe, expect, it, vi } from "vitest";
import { recordActivity } from "./record.js";
import { MemoryActivityStore, useActivityStore, type ActivityStore } from "./store.js";

const A = "bc1qalice0000000000000000000000000000000";
const MINER = "bc1qminer000000000000000000000000000000";
const OTHER = "bc1qother000000000000000000000000000000";

afterEach(() => useActivityStore(null));

describe("recordActivity", () => {
  it("counts events on the shared store", async () => {
    const s = new MemoryActivityStore();
    useActivityStore(s);
    await recordActivity(A, "chat_message");
    await recordActivity(A, "suggestion");
    await recordActivity(A, "self_search", A);
    expect(await s.get(A)).toMatchObject({ chatMessages: 1, suggestions: 1, selfSearches: 1 });
  });

  it("a search of the address you said you mine to counts as looking yourself up", async () => {
    const s = new MemoryActivityStore();
    useActivityStore(s);
    await s.setPoolAddress(A, MINER, Date.now());
    await recordActivity(A, "wallet_search", MINER.toUpperCase());
    await recordActivity(A, "wallet_search", OTHER);
    await recordActivity(A, "wallet_search");
    expect(await s.get(A)).toMatchObject({ selfSearches: 1, walletSearches: 2 });
  });

  it("never throws", async () => {
    useActivityStore({ get: async () => null, bump: async () => { throw new Error("db down"); } } as unknown as ActivityStore);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordActivity(A, "chat_message")).resolves.toBeUndefined();
    err.mockRestore();
  });
});
