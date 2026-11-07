import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every Supabase client this file could build goes through this spy.
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ from: vi.fn(), rpc: vi.fn() })) }));

import { createClient } from "@supabase/supabase-js";
import { ChatStoreError, createChatStore, FileChatStore, MemoryChatStore, SupabaseChatStore } from "./store.js";

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-"));
  dirs.push(dir);
  return join(dir, "data", "chat.json");
};
afterEach(() => {
  vi.mocked(createClient).mockClear();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("THE RULE: local never writes to the live database", () => {
  it("uses a local file off Vercel, even when Supabase credentials are present", () => {
    const makeSupabase = vi.fn();
    const store = createChatStore({ CHAT_FILE: tempFile() }, { hasSupabase: () => true, makeSupabase });
    expect(store.kind).toBe("file");
    expect(makeSupabase).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("does the same with the real credential check (the local .env has live credentials)", () => {
    expect(createChatStore({ CHAT_FILE: tempFile() }).kind).toBe("file");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("uses Supabase only on Vercel", () => {
    expect(createChatStore({ VERCEL: "1" }, { hasSupabase: () => true }).kind).toBe("supabase");
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("falls back to memory on Vercel with no database configured, and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(createChatStore({ VERCEL: "1" }, { hasSupabase: () => false }).kind).toBe("memory");
    expect(createClient).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("MemoryChatStore", () => {
  const seeded = async () => {
    const s = new MemoryChatStore();
    for (let i = 1; i <= 5; i++) await s.add(i % 2 ? "alice" : "bob", `m${i}`, i * 1000);
    return s;
  };

  it("hands out increasing ids and lists the latest page oldest-first", async () => {
    const s = await seeded();
    expect((await s.list(null, 3)).map((m) => m.body)).toEqual(["m3", "m4", "m5"]);
    expect((await s.list(null, 50)).map((m) => m.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("lists what came after an id, the first `limit` of them", async () => {
    const s = await seeded();
    expect((await s.list(2, 50)).map((m) => m.id)).toEqual([3, 4, 5]);
    expect((await s.list(2, 2)).map((m) => m.id)).toEqual([3, 4]);
    expect(await s.list(5, 50)).toEqual([]);
  });

  it("deletes by marking: gone from lists, still counted in latestId, reported by removedAfter", async () => {
    const s = await seeded();
    expect(await s.remove(5, "alice", 9000)).toBe(true);
    expect(await s.remove(5, "alice", 9000)).toBe(false);
    expect(await s.remove(99, "alice", 9000)).toBe(false);
    expect((await s.list(null, 50)).map((m) => m.id)).toEqual([1, 2, 3, 4]);
    expect(await s.latestId()).toBe(5);
    expect(await s.removedAfter(0)).toEqual([5]);
    expect(await s.removedAfter(5)).toEqual([]);
    expect((await s.get(5))?.deleted).toBe(true);
  });

  it("counts others' live messages after an id", async () => {
    const s = await seeded();
    expect(await s.countAfter(0, null)).toBe(5);
    expect(await s.countAfter(0, "alice")).toBe(2);
    expect(await s.countAfter(3, "bob")).toBe(1);
    await s.remove(5, "alice", 9000);
    expect(await s.countAfter(3, "bob")).toBe(0);
  });

  it("returns an address's post times since a moment, newest first", async () => {
    const s = await seeded();
    expect(await s.postTimes("alice", 2000, 10)).toEqual([5000, 3000]);
    expect(await s.postTimes("alice", 0, 1)).toEqual([5000]);
    expect(await s.postTimes("carol", 0, 10)).toEqual([]);
  });

  it("never hands out its own objects", async () => {
    const s = await seeded();
    const [m] = await s.list(null, 1);
    m!.body = "tampered";
    expect((await s.list(null, 1))[0]!.body).toBe("m5");
  });
});

describe("FileChatStore", () => {
  it("survives a restart and keeps counting ids", async () => {
    const path = tempFile();
    const a = new FileChatStore(path);
    await a.add("alice", "hello", 1000);
    await a.add("bob", "hi", 2000);
    await a.remove(2, "bob", 3000);
    const b = new FileChatStore(path);
    expect((await b.list(null, 50)).map((m) => m.body)).toEqual(["hello"]);
    expect((await b.add("alice", "again", 4000)).id).toBe(3);
    expect(JSON.parse(readFileSync(path, "utf8")).nextId).toBe(4);
  });

  it("stays bounded, dropping the oldest — ids never go backwards", async () => {
    const path = tempFile();
    const s = new FileChatStore(path, 3);
    for (let i = 1; i <= 5; i++) await s.add("alice", `m${i}`, i);
    expect((await s.list(null, 50)).map((m) => m.body)).toEqual(["m3", "m4", "m5"]);
    const again = new FileChatStore(path, 3);
    expect((await again.add("alice", "m6", 6)).id).toBe(6);
  });

  it("starts empty on a missing or broken file", async () => {
    expect(await new FileChatStore(tempFile()).list(null, 50)).toEqual([]);
  });
});

// ── Supabase: a stand-in PostgREST builder that records the chain it was given ──
type Reply = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };
function fakeDb(reply: Reply) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "eq", "neq", "gt", "gte", "order", "limit", "single"]) {
    builder[m] = (...args: unknown[]) => { calls.push([m, args]); return builder; };
  }
  builder.then = (ok: (v: Reply) => unknown) => Promise.resolve({ data: null, error: null, count: null, ...reply }).then(ok);
  const db = { from: (table: string) => { calls.push(["from", [table]]); return builder; } } as unknown as SupabaseClient;
  return { db, calls };
}

describe("SupabaseChatStore", () => {
  it("maps rows to messages", async () => {
    const { db, calls } = fakeDb({ data: { id: "7", address: "alice", body: "hi", created_at: "2026-11-06T12:00:00.000Z", deleted: false } });
    const m = await new SupabaseChatStore(db).add("alice", "hi", Date.UTC(2026, 10, 6, 12));
    expect(m).toEqual({ id: 7, address: "alice", body: "hi", at: Date.UTC(2026, 10, 6, 12), deleted: false });
    expect(calls[0]).toEqual(["from", ["chat_messages"]]);
  });

  it("reads the latest page newest-first and hands it back oldest-first", async () => {
    const rows = [3, 2, 1].map((id) => ({ id, address: "a", body: `m${id}`, created_at: "2026-11-06T12:00:00Z", deleted: false }));
    const { db, calls } = fakeDb({ data: rows });
    expect((await new SupabaseChatStore(db).list(null, 3)).map((m) => m.id)).toEqual([1, 2, 3]);
    expect(calls).toContainEqual(["order", ["id", { ascending: false }]]);
    expect(calls).toContainEqual(["eq", ["deleted", false]]);
  });

  it("reads after an id oldest-first", async () => {
    const { db, calls } = fakeDb({ data: [] });
    await new SupabaseChatStore(db).list(10, 50);
    expect(calls).toContainEqual(["gt", ["id", 10]]);
    expect(calls).toContainEqual(["order", ["id", { ascending: true }]]);
  });

  it("surfaces database errors instead of returning an empty room", async () => {
    const { db } = fakeDb({ error: { message: "boom", code: "XX000" } });
    await expect(new SupabaseChatStore(db).list(null, 50)).rejects.toBeInstanceOf(ChatStoreError);
    await expect(new SupabaseChatStore(db).add("a", "b", 1)).rejects.toThrow(/boom/);
  });

  it("counts with a head-only query, leaving out the viewer's own", async () => {
    const { db, calls } = fakeDb({ count: 4 });
    expect(await new SupabaseChatStore(db).countAfter(3, "alice")).toBe(4);
    expect(calls).toContainEqual(["select", ["id", { count: "exact", head: true }]]);
    expect(calls).toContainEqual(["neq", ["address", "alice"]]);
  });
});
