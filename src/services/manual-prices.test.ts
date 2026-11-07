import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FileManualPriceStore,
  MemoryManualPriceStore,
  SupabaseManualPriceStore,
  addressKey,
  banPriceEditor,
  changeManualPrice,
  changeToRow,
  createManualPriceStore,
  getAllManualPrices,
  getManualPrice,
  getPriceChanges,
  isPriceEditorBanned,
  onManualPriceChange,
  revertPriceChange,
  rowToChange,
  setManualPrice,
  unbanPriceEditor,
  useManualPriceStore,
  type ManualPrice,
  type ManualPriceStore,
  type PriceChange,
} from "./manual-prices.js";

const OWNER = "bc1qowner000000000000000000000000000000";
const ALICE = "bc1qalice0000000000000000000000000000000";
const T0 = Date.UTC(2026, 10, 6, 12);

let store: MemoryManualPriceStore;
beforeEach(() => {
  store = new MemoryManualPriceStore();
  useManualPriceStore(store);
});
afterEach(() => useManualPriceStore(null));

describe("changeManualPrice", () => {
  it("sets the price and logs who changed what", async () => {
    const c = await changeManualPrice({ venue: "kissmyhash", satsPerPhd: 50_000, by: ALICE, usd: 38, now: T0 });
    expect(await getManualPrice("kissmyhash")).toMatchObject({ satsPerPhd: 50_000, updatedBy: ALICE, updatedAt: T0 });
    expect(c).toMatchObject({ venue: "kissmyhash", oldSats: null, newSats: 50_000, usd: 38, by: ALICE, kind: "update" });
    const c2 = await changeManualPrice({ venue: "kissmyhash", satsPerPhd: 52_000, by: OWNER, now: T0 + 1000 });
    expect(c2.oldSats).toBe(50_000);
    expect((await getPriceChanges()).map((x) => x.newSats)).toEqual([52_000, 50_000]);
  });

  it("keeps the old setManualPrice signature (the /admin form) and logs it too", async () => {
    await setManualPrice("kissmyhash", 48_000, OWNER, "$36.40/PHd @ BTC 75850");
    expect(await getManualPrice("kissmyhash")).toMatchObject({ satsPerPhd: 48_000, note: "$36.40/PHd @ BTC 75850" });
    expect(await getPriceChanges()).toHaveLength(1);
  });

  it("tells listeners (the board drops its cache)", async () => {
    const seen: string[] = [];
    const off = onManualPriceChange((v) => seen.push(v));
    await changeManualPrice({ venue: "kissmyhash", satsPerPhd: 50_000, by: ALICE });
    off();
    await changeManualPrice({ venue: "kissmyhash", satsPerPhd: 51_000, by: ALICE });
    expect(seen).toEqual(["kissmyhash"]);
  });

  it("puts the old price back when a must-log change can't be logged", async () => {
    await changeManualPrice({ venue: "kissmyhash", satsPerPhd: 50_000, by: OWNER, now: T0 });
    vi.spyOn(store, "addChange").mockRejectedValueOnce(new Error("history table missing"));
    await expect(changeManualPrice({ venue: "kissmyhash", satsPerPhd: 60_000, by: ALICE, now: T0 + 1, mustLog: true }))
      .rejects.toThrow(/history/);
    expect((await getManualPrice("kissmyhash"))?.satsPerPhd).toBe(50_000);
  });

  it("lets the owner's own edit through even if the log is down", async () => {
    vi.spyOn(store, "addChange").mockRejectedValueOnce(new Error("history table missing"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await changeManualPrice({ venue: "kissmyhash", satsPerPhd: 50_000, by: OWNER });
    err.mockRestore();
    expect((await getManualPrice("kissmyhash"))?.satsPerPhd).toBe(50_000);
  });
});

describe("revertPriceChange", () => {
  it("puts back the price a change replaced, and logs the revert", async () => {
    await changeManualPrice({ venue: "kissmyhash", satsPerPhd: 50_000, by: OWNER, now: T0 });
    const bad = await changeManualPrice({ venue: "kissmyhash", satsPerPhd: 140_000, by: ALICE, now: T0 + 1000 });
    const back = await revertPriceChange(bad.id, OWNER, T0 + 2000);
    expect(back).toMatchObject({ kind: "revert", revertOf: bad.id, oldSats: 140_000, newSats: 50_000, by: OWNER });
    expect(await getManualPrice("kissmyhash")).toMatchObject({ satsPerPhd: 50_000, updatedBy: OWNER });
  });

  it("clears the price when there was none before", async () => {
    const first = await changeManualPrice({ venue: "kissmyhash", satsPerPhd: 50_000, by: ALICE, now: T0 });
    await revertPriceChange(first.id, OWNER, T0 + 1);
    expect(await getManualPrice("kissmyhash")).toBeNull();
    expect(await getAllManualPrices()).toEqual([]);
  });

  it("answers null for a change that isn't logged", async () => {
    expect(await revertPriceChange("nope", OWNER)).toBeNull();
  });
});

describe("bans", () => {
  it("blocks and unblocks, ignoring bech32 case", async () => {
    await banPriceEditor(ALICE.toUpperCase(), OWNER, T0);
    expect(await isPriceEditorBanned(ALICE)).toBe(true);
    await unbanPriceEditor(ALICE);
    expect(await isPriceEditorBanned(ALICE)).toBe(false);
  });
  it("keeps base58 addresses case-sensitive", () => {
    expect(addressKey("1BoatSLRHtKNngkdXEeobR76b53LETtpyT")).toBe("1BoatSLRHtKNngkdXEeobR76b53LETtpyT");
    expect(addressKey(" BC1QABC ")).toBe("bc1qabc");
  });
});

describe("history queries", () => {
  it("filters by who, venue and time, newest first", async () => {
    await changeManualPrice({ venue: "kissmyhash", satsPerPhd: 50_000, by: ALICE, now: T0 });
    await changeManualPrice({ venue: "braiins", satsPerPhd: 50_000, by: ALICE, now: T0 + 10 });
    await changeManualPrice({ venue: "kissmyhash", satsPerPhd: 51_000, by: OWNER, now: T0 + 20 });
    expect((await getPriceChanges({ by: ALICE.toUpperCase() })).map((c) => c.venue)).toEqual(["braiins", "kissmyhash"]);
    expect((await getPriceChanges({ venue: "kissmyhash" })).map((c) => c.by)).toEqual([OWNER, ALICE]);
    expect(await getPriceChanges({ since: T0 + 15 })).toHaveLength(1);
    expect(await getPriceChanges({ limit: 1 })).toHaveLength(1);
  });
});

// ── The local overlay: live prices underneath, local edits on top ─────────────

describe("local overlay over the live prices", () => {
  const live: ManualPrice[] = [{ venue: "kissmyhash", satsPerPhd: 50_000, updatedBy: OWNER, updatedAt: T0 }];

  it("shows the live price until a newer local edit, which never leaves the overlay", async () => {
    const reader = vi.fn(async () => live.map((p) => ({ ...p })));
    const s = new MemoryManualPriceStore(reader);
    expect((await s.get("kissmyhash"))?.satsPerPhd).toBe(50_000);
    await s.put({ venue: "kissmyhash", satsPerPhd: 47_000, updatedBy: ALICE, updatedAt: T0 + 1000 });
    expect((await s.get("kissmyhash"))?.satsPerPhd).toBe(47_000);
    expect(live[0]!.satsPerPhd).toBe(50_000); // the live side is only ever read
  });

  it("lets a newer live price win over an old local edit", async () => {
    const s = new MemoryManualPriceStore(async () => [{ ...live[0]!, satsPerPhd: 55_000, updatedAt: T0 + 5000 }]);
    await s.put({ venue: "kissmyhash", satsPerPhd: 47_000, updatedBy: ALICE, updatedAt: T0 + 1000 });
    expect((await s.get("kissmyhash"))?.satsPerPhd).toBe(55_000);
  });

  it("can hide a live price locally (a revert to 'none')", async () => {
    const s = new MemoryManualPriceStore(async () => live.map((p) => ({ ...p })));
    await s.put({ venue: "kissmyhash", satsPerPhd: 0, updatedBy: OWNER, updatedAt: T0 + 1 });
    expect(await s.get("kissmyhash")).toBeNull();
    expect(await s.all()).toEqual([]);
  });

  it("still works when the live read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = new MemoryManualPriceStore(async () => { throw new Error("offline"); });
    await s.put({ venue: "kissmyhash", satsPerPhd: 47_000, updatedAt: T0 });
    expect((await s.get("kissmyhash"))?.satsPerPhd).toBe(47_000);
    warn.mockRestore();
  });
});

describe("FileManualPriceStore", () => {
  let dir = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ph-prices-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps prices, the log and blocks across restarts", async () => {
    const path = join(dir, "data", "manual-prices.json");
    const a = new FileManualPriceStore(path);
    await a.put({ venue: "kissmyhash", satsPerPhd: 47_000, updatedBy: ALICE, updatedAt: T0 });
    const c: PriceChange = { id: "c1", venue: "kissmyhash", oldSats: null, newSats: 47_000, usd: 35, by: ALICE, at: T0, kind: "update" };
    await a.addChange(c);
    await a.ban({ address: ALICE, by: OWNER, at: T0 });
    expect(JSON.parse(readFileSync(path, "utf8")).changes).toHaveLength(1);

    const b = new FileManualPriceStore(path);
    expect((await b.get("kissmyhash"))?.satsPerPhd).toBe(47_000);
    expect(await b.change("c1")).toEqual(c);
    expect(await b.isBanned(ALICE)).toBe(true);
  });

  it("starts empty on a missing or broken file", async () => {
    const s = new FileManualPriceStore(join(dir, "nope.json"));
    expect(await s.all()).toEqual([]);
  });
});

// ── Where it lives ────────────────────────────────────────────────────────────

/** Just enough of the Supabase client to see which table is touched how. */
function fakeSupabase() {
  const calls: Array<{ table: string; op: string; arg?: unknown }> = [];
  const builder = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = (op: string) => (arg?: unknown) => { calls.push({ table, op, arg }); return q; };
    for (const op of ["select", "eq", "gte", "order", "limit", "delete"]) q[op] = chain(op);
    q.insert = (arg: unknown) => { calls.push({ table, op: "insert", arg }); return Promise.resolve({ error: null }); };
    q.upsert = (arg: unknown) => { calls.push({ table, op: "upsert", arg }); return Promise.resolve({ error: null }); };
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return q;
  };
  return { client: { from: builder } as unknown as SupabaseClient, calls };
}

describe("createManualPriceStore", () => {
  it("writes to Supabase only on Vercel", () => {
    const { client } = fakeSupabase();
    const s = createManualPriceStore({ VERCEL: "1" }, { hasSupabase: () => true, makeSupabase: () => client });
    expect(s.kind).toBe("supabase");
  });

  it("is a local file everywhere else, even with Supabase configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ph-prices-"));
    try {
      const { client, calls } = fakeSupabase();
      const s: ManualPriceStore = createManualPriceStore(
        { MANUAL_PRICES_FILE: join(dir, "p.json") },
        { hasSupabase: () => true, makeSupabase: () => client },
      );
      expect(s.kind).toBe("file");
      await s.put({ venue: "kissmyhash", satsPerPhd: 47_000, updatedBy: ALICE, updatedAt: T0 });
      await s.addChange({ id: "x", venue: "kissmyhash", oldSats: null, newSats: 47_000, usd: null, by: ALICE, at: T0, kind: "update" });
      await s.ban({ address: ALICE, by: OWNER, at: T0 });
      await s.get("kissmyhash");
      // The live database was only ever read.
      expect(calls.filter((c) => ["insert", "upsert", "delete"].includes(c.op))).toEqual([]);
      expect(calls.some((c) => c.table === "manual_prices" && c.op === "select")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is in memory on Vercel without a database", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(createManualPriceStore({ VERCEL: "1" }, { hasSupabase: () => false }).kind).toBe("memory");
    warn.mockRestore();
  });
});

describe("Supabase rows", () => {
  it("round-trips a change", () => {
    const c: PriceChange = { id: "c1", venue: "kissmyhash", oldSats: 50_000, newSats: 0, usd: null, by: ALICE, at: T0, kind: "revert", revertOf: "c0" };
    expect(rowToChange(changeToRow(c))).toEqual(c);
    const d: PriceChange = { ...c, oldSats: null, newSats: 1, usd: 38.5, kind: "update" };
    delete d.revertOf;
    expect(rowToChange(changeToRow(d))).toEqual(d);
  });

  it("clears a price by deleting its row, and keys bans like the app", async () => {
    const { client, calls } = fakeSupabase();
    const s = new SupabaseManualPriceStore(client);
    await s.put({ venue: "kissmyhash", satsPerPhd: 0, updatedAt: T0 });
    expect(calls.some((c) => c.table === "manual_prices" && c.op === "delete")).toBe(true);
    await s.ban({ address: ALICE.toUpperCase(), by: OWNER, at: T0 });
    expect(calls.find((c) => c.op === "upsert" && c.table === "price_editor_bans")?.arg).toMatchObject({ address: ALICE });
  });
});
