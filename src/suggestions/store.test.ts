import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every Supabase client this file could build goes through this spy.
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ from: vi.fn(), rpc: vi.fn() })) }));

import { createClient } from "@supabase/supabase-js";
import type { SuggestionRecord } from "./rules.js";
import {
  FileSuggestionStore,
  MemorySuggestionStore,
  SupabaseSuggestionStore,
  createSuggestionStore,
  type SuggestionStore,
} from "./store.js";

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "suggestions-"));
  dirs.push(dir);
  return join(dir, "data", "suggestions.json");
};
afterEach(() => {
  vi.mocked(createClient).mockClear();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ALICE = "bc1qalice0000000000000000000000000000000";
const BOB = "bc1qbob00000000000000000000000000000000000";
let n = 0;
const sug = (at: number, address: string | null = null, extra: Partial<SuggestionRecord> = {}): SuggestionRecord => ({
  id: `s${++n}`, at, title: `Idea ${n}`, notes: "Some notes", address, status: "new", ...extra,
});

describe("createSuggestionStore — only the deployed site touches the live database", () => {
  it("uses a local file when not on Vercel, even with Supabase configured", () => {
    const makeSupabase = vi.fn();
    const store = createSuggestionStore({ SUGGESTIONS_FILE: tempFile() }, { hasSupabase: () => true, makeSupabase });
    expect(store.kind).toBe("file");
    expect(makeSupabase).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("uses Supabase on Vercel when it's configured", () => {
    const db = { from: vi.fn() } as unknown as SupabaseClient;
    const store = createSuggestionStore({ VERCEL: "1" }, { hasSupabase: () => true, makeSupabase: () => db });
    expect(store.kind).toBe("supabase");
  });

  it("falls back to memory on Vercel with no database (and says so)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createSuggestionStore({ VERCEL: "1" }, { hasSupabase: () => false });
    expect(store.kind).toBe("memory");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

function storeContract(name: string, make: () => SuggestionStore) {
  describe(name, () => {
    it("lists newest first, up to the limit", async () => {
      const s = make();
      const a = sug(1_000), b = sug(3_000), c = sug(2_000);
      for (const x of [a, b, c]) await s.add(x);
      expect((await s.list(10)).map((x) => x.id)).toEqual([b.id, c.id, a.id]);
      expect((await s.list(2)).map((x) => x.id)).toEqual([b.id, c.id]);
    });

    it("counts new ones and an address's sends since a time", async () => {
      const s = make();
      await s.add(sug(1_000, ALICE));
      await s.add(sug(5_000, ALICE));
      await s.add(sug(6_000, BOB, { status: "read" }));
      await s.add(sug(7_000, null));
      expect(await s.countNew()).toBe(3);
      expect(await s.countFromSince(ALICE, 2_000)).toBe(1);
      expect(await s.countFromSince(ALICE, 0)).toBe(2);
      expect(await s.countFromSince(BOB, 0)).toBe(1);
    });

    it("marks and removes, and says when there's nothing there", async () => {
      const s = make();
      const a = sug(1_000);
      await s.add(a);
      expect(await s.setStatus(a.id, "done")).toBe(true);
      expect((await s.list(1))[0]!.status).toBe("done");
      expect(await s.countNew()).toBe(0);
      expect(await s.setStatus("nope", "read")).toBe(false);
      expect(await s.remove(a.id)).toBe(true);
      expect(await s.remove(a.id)).toBe(false);
      expect(await s.list(10)).toEqual([]);
    });

    it("hands out copies, so callers can't edit the store by accident", async () => {
      const s = make();
      const a = sug(1_000);
      await s.add(a);
      (await s.list(1))[0]!.status = "done";
      a.title = "changed";
      expect((await s.list(1))[0]).toMatchObject({ status: "new", title: expect.not.stringMatching("changed") });
    });
  });
}

storeContract("MemorySuggestionStore", () => new MemorySuggestionStore());
storeContract("FileSuggestionStore", () => new FileSuggestionStore(tempFile()));

describe("FileSuggestionStore", () => {
  it("survives a restart", async () => {
    const path = tempFile();
    const first = new FileSuggestionStore(path);
    const a = sug(1_000, ALICE);
    await first.add(a);
    await first.setStatus(a.id, "read");
    const again = new FileSuggestionStore(path);
    expect(await again.list(10)).toEqual([{ ...a, status: "read" }]);
    expect(JSON.parse(readFileSync(path, "utf8")).suggestions).toHaveLength(1);
  });

  it("keeps only the newest when it outgrows its cap", async () => {
    const s = new FileSuggestionStore(tempFile(), 3);
    for (let i = 1; i <= 5; i++) await s.add(sug(i * 1_000));
    expect((await s.list(10)).map((x) => x.at)).toEqual([5_000, 4_000, 3_000]);
  });

  it("starts empty on a missing or broken file, and skips bad rows", async () => {
    expect(await new FileSuggestionStore(join(tmpdir(), "definitely-missing", "x.json")).list(10)).toEqual([]);
    const path = tempFile();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");
    expect(await new FileSuggestionStore(path).list(10)).toEqual([]);
    const good = sug(1_000);
    writeFileSync(path, JSON.stringify({ suggestions: [good, { id: 5 }, { ...sug(2_000), status: "archived" }, null] }));
    expect(await new FileSuggestionStore(path).list(10)).toEqual([good]);
  });
});

describe("SupabaseSuggestionStore", () => {
  /** A PostgREST-ish query builder that records the calls and resolves to `reply`. */
  const builder = (reply: unknown) => {
    const calls: Array<[string, unknown[]]> = [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "insert", "update", "delete", "eq", "gte", "order", "limit"]) {
      q[m] = (...args: unknown[]) => { calls.push([m, args]); return q; };
    }
    q.then = (resolve: (v: unknown) => unknown) => resolve(reply);
    return { q, calls };
  };
  const dbWith = (reply: unknown) => {
    const b = builder(reply);
    const from = vi.fn(() => b.q);
    return { db: { from } as unknown as SupabaseClient, from, calls: b.calls };
  };

  it("inserts with the server's own time and the session's address", async () => {
    const { db, from, calls } = dbWith({ error: null });
    await new SupabaseSuggestionStore(db).add(sug(Date.UTC(2026, 10, 6), ALICE, { id: "x1", title: "T", notes: "N" }));
    expect(from).toHaveBeenCalledWith("suggestions");
    expect(calls[0]).toEqual(["insert", [{
      id: "x1", created_at: "2026-11-06T00:00:00.000Z", title: "T", notes: "N", address: ALICE, status: "new",
    }]]);
  });

  it("reads rows back as records, newest first", async () => {
    const { db, calls } = dbWith({
      data: [{ id: "a", created_at: "2026-11-06T10:00:00Z", title: "T", notes: "N", address: null, status: "done" }],
      error: null,
    });
    expect(await new SupabaseSuggestionStore(db).list(50)).toEqual([
      { id: "a", at: Date.parse("2026-11-06T10:00:00Z"), title: "T", notes: "N", address: null, status: "done" },
    ]);
    expect(calls).toContainEqual(["order", ["created_at", { ascending: false }]]);
    expect(calls).toContainEqual(["limit", [50]]);
  });

  it("counts with head-only queries", async () => {
    const { db, calls } = dbWith({ count: 4, error: null });
    expect(await new SupabaseSuggestionStore(db).countFromSince(ALICE, 0)).toBe(4);
    expect(calls).toContainEqual(["eq", ["address", ALICE]]);
    expect(calls).toContainEqual(["gte", ["created_at", "1970-01-01T00:00:00.000Z"]]);
  });

  it("reports a missing row as false, and surfaces database errors", async () => {
    expect(await new SupabaseSuggestionStore(dbWith({ data: [], error: null }).db).setStatus("a", "read")).toBe(false);
    expect(await new SupabaseSuggestionStore(dbWith({ data: [{ id: "a" }], error: null }).db).remove("a")).toBe(true);
    await expect(new SupabaseSuggestionStore(dbWith({ error: { message: "boom", code: "42P01" } }).db).countNew())
      .rejects.toThrow(/boom/);
  });
});
