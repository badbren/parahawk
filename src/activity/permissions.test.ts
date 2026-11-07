import { afterEach, describe, expect, it, vi } from "vitest";
import { TRUSTED_MIN_DAYS, TRUSTED_MIN_SECONDS } from "./badges.js";
import { permissionsFor, usePermissionStore } from "./permissions.js";
import { blankRecord, type ActivityRecord } from "./rules.js";
import { MemoryActivityStore, type ActivityStore } from "./store.js";

/** A memory store we can fill directly. */
class SeededStore extends MemoryActivityStore {
  put(rec: ActivityRecord): void { this.records.set(rec.address, rec); }
}

const T0 = Date.UTC(2026, 10, 6);
const TRUSTED = "bc1qtrusted00000000000000000000000000000";
const NEWBIE = "bc1qnewbie000000000000000000000000000000";
const FARMER = "bc1qfarmer000000000000000000000000000000";

const seeded = () => {
  const s = new SeededStore();
  s.put({ ...blankRecord(TRUSTED, T0), secondsOnSite: TRUSTED_MIN_SECONDS, activeDays: TRUSTED_MIN_DAYS });
  s.put({ ...blankRecord(NEWBIE, T0), secondsOnSite: 600, activeDays: 1 });
  // A tab left open on a second screen: loads of hours, few days.
  s.put({ ...blankRecord(FARMER, T0), secondsOnSite: 200 * 3_600, activeDays: 3 });
  return s;
};

afterEach(() => usePermissionStore(null));

describe("permissionsFor", () => {
  it("the owner can always edit prices, whatever their activity", async () => {
    usePermissionStore(new SeededStore());
    expect([...(await permissionsFor(NEWBIE, { admin: true }))]).toEqual(["edit_prices"]);
  });

  it("Trusted wallets can edit prices; everyone else can't", async () => {
    usePermissionStore(seeded());
    expect((await permissionsFor(TRUSTED)).has("edit_prices")).toBe(true);
    expect((await permissionsFor(NEWBIE)).size).toBe(0);
    expect((await permissionsFor(FARMER)).size).toBe(0);
    expect((await permissionsFor("bc1qnobody00000000000000000000000000000")).size).toBe(0);
    expect((await permissionsFor("")).size).toBe(0);
  });

  it("never throws: a broken store means no extra permissions", async () => {
    const broken = { get: async () => { throw new Error("db down"); } } as unknown as ActivityStore;
    usePermissionStore(broken);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(permissionsFor(TRUSTED)).resolves.toEqual(new Set());
    warn.mockRestore();
  });

  it("caches briefly, so a price save doesn't hit the database every time", async () => {
    const s = seeded();
    const get = vi.spyOn(s, "get");
    usePermissionStore(s);
    await permissionsFor(TRUSTED);
    await permissionsFor(TRUSTED);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
