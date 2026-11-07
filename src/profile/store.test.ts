import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  createProfileStore,
  FileProfileStore,
  MemoryProfileStore,
  NameTakenError,
  SupabaseProfileStore,
  TooManyRenamesError,
  utcDay,
} from "./store.js";

const ALICE = "bc1qalice0000000000000000000000000000000";
const BOB = "bc1qbob00000000000000000000000000000000000";
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 6, 12);
const opts = (now = T0, dailyLimit = 10) => ({ now, dailyLimit });

describe("memory store", () => {
  it("sets, reads and clears a name", async () => {
    const s = new MemoryProfileStore();
    expect(await s.get(ALICE)).toBeNull();
    const rec = await s.setName(ALICE, "Alice", opts());
    expect(rec).toMatchObject({ address: ALICE, displayName: "Alice", changesDay: utcDay(T0), changesToday: 1 });
    expect((await s.get(ALICE))?.displayName).toBe("Alice");
    await s.setName(ALICE, null, opts());
    expect((await s.get(ALICE))?.displayName).toBeNull();
  });

  it("keys bech32 addresses case-insensitively", async () => {
    const s = new MemoryProfileStore();
    await s.setName(ALICE.toUpperCase(), "Alice", opts());
    expect((await s.get(ALICE))?.displayName).toBe("Alice");
    const names = await s.namesFor([ALICE.toUpperCase(), ALICE]);
    // Keyed by the spelling the caller used.
    expect(names.get(ALICE.toUpperCase())).toBe("Alice");
    expect(names.get(ALICE)).toBe("Alice");
  });

  it("gives a name to one address only — ignoring case and separators", async () => {
    const s = new MemoryProfileStore();
    await s.setName(ALICE, "Bad Bren", opts());
    await expect(s.setName(BOB, "badbren", opts())).rejects.toBeInstanceOf(NameTakenError);
    await expect(s.setName(BOB, "BAD.BREN", opts())).rejects.toBeInstanceOf(NameTakenError);
    // The holder can restyle their own name.
    expect((await s.setName(ALICE, "BadBren", opts())).displayName).toBe("BadBren");
    // Once it's let go, someone else can have it.
    await s.setName(ALICE, null, opts());
    expect((await s.setName(BOB, "bad_bren", opts())).displayName).toBe("bad_bren");
  });

  it("counts renames per UTC day, and the same name again is free", async () => {
    const s = new MemoryProfileStore();
    for (let i = 0; i < 3; i++) await s.setName(ALICE, `Alice ${i}`, opts(T0, 3));
    await expect(s.setName(ALICE, "Alice 9", opts(T0, 3))).rejects.toBeInstanceOf(TooManyRenamesError);
    // No change, no count — and no error even at the limit.
    expect((await s.setName(ALICE, "Alice 2", opts(T0, 3))).changesToday).toBe(3);
    // A new day starts over.
    expect((await s.setName(ALICE, "Alice 9", opts(T0 + DAY, 3))).changesToday).toBe(1);
    // Infinity is the owner's limit.
    const owner = new MemoryProfileStore();
    for (let i = 0; i < 25; i++) await owner.setName(ALICE, `Owner ${i}`, opts(T0, Infinity));
    expect((await owner.get(ALICE))?.changesToday).toBe(25);
  });

  it("looks up only the addresses that have names", async () => {
    const s = new MemoryProfileStore();
    await s.setName(ALICE, "Alice", opts());
    await s.setName(BOB, "Bob", opts());
    await s.setName(BOB, null, opts());
    const names = await s.namesFor([ALICE, BOB, "bc1qnobody"]);
    expect([...names]).toEqual([[ALICE, "Alice"]]);
  });
});

describe("file store", () => {
  const dir = mkdtempSync(join(tmpdir(), "ph-profiles-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("survives a restart", async () => {
    const path = join(dir, "sub", "profiles.json");
    const a = new FileProfileStore(path);
    expect(a.kind).toBe("file");
    await a.setName(ALICE, "Alice", opts());
    expect(JSON.parse(readFileSync(path, "utf8")).profiles).toHaveLength(1);
    const b = new FileProfileStore(path);
    expect((await b.get(ALICE))?.displayName).toBe("Alice");
    await expect(b.setName(BOB, "alice", opts())).rejects.toBeInstanceOf(NameTakenError);
  });

  it("starts empty from a missing or broken file", async () => {
    expect(await new FileProfileStore(join(dir, "nope.json")).get(ALICE)).toBeNull();
  });
});

describe("choosing a store (THE RULE)", () => {
  it("never reaches for Supabase off Vercel", () => {
    const make = vi.fn();
    const s = createProfileStore({ PROFILES_FILE: join(tmpdir(), "ph-unused.json") }, { hasSupabase: () => true, makeSupabase: make });
    expect(s.kind).toBe("file");
    expect(make).not.toHaveBeenCalled();
  });

  it("uses Supabase on Vercel, memory when none is configured", () => {
    expect(createProfileStore({ VERCEL: "1" }, { hasSupabase: () => true, makeSupabase: () => ({}) as SupabaseClient }).kind).toBe("supabase");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(createProfileStore({ VERCEL: "1" }, { hasSupabase: () => false }).kind).toBe("memory");
    warn.mockRestore();
  });
});

describe("supabase store", () => {
  /** Just enough of the query builder for these calls. */
  const fakeDb = (reply: { select?: unknown; upsert?: { error: { code?: string; message: string } | null } }) => {
    const upserts: unknown[] = [];
    const chain = {
      select: () => chain, eq: () => chain, in: () => chain, not: () => chain,
      maybeSingle: async () => ({ data: reply.select ?? null, error: null }),
      then: (ok: (v: unknown) => void) => ok({ data: reply.select ?? [], error: null }),
      upsert: async (row: unknown) => { upserts.push(row); return { error: reply.upsert?.error ?? null }; },
    };
    return { db: { from: () => chain } as unknown as SupabaseClient, upserts };
  };

  it("turns a unique violation into 'taken'", async () => {
    const { db } = fakeDb({ upsert: { error: { code: "23505", message: "duplicate key" } } });
    await expect(new SupabaseProfileStore(db).setName(ALICE, "Alice", opts())).rejects.toBeInstanceOf(NameTakenError);
  });

  it("writes the canonical address and the name key", async () => {
    const { db, upserts } = fakeDb({});
    await new SupabaseProfileStore(db).setName(ALICE.toUpperCase(), "Bad Bren", opts());
    expect(upserts[0]).toMatchObject({ address: ALICE, display_name: "Bad Bren", name_key: "badbren", changes_today: 1 });
  });
});

// ── Round 2: uids, privacy, pictures ─────────────────────────────────────────

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));

describe("uids", () => {
  it("gives every profile a permanent random uid, found by byUid", async () => {
    const s = new MemoryProfileStore();
    const first = await s.setName(ALICE, "Alice", opts());
    expect(first.uid).toMatch(/^[0-9a-f]{12}$/);
    expect((await s.setName(ALICE, "Alice Two", opts())).uid).toBe(first.uid);
    expect((await s.setPrivate(ALICE, true, T0)).uid).toBe(first.uid);
    expect((await s.byUid(first.uid))?.address).toBe(ALICE);
    expect(await s.byUid("000000000000")).toBeNull();
    const bob = await s.setPrivate(BOB, true, T0);
    expect(bob.uid).not.toBe(first.uid);
  });
});

describe("privacy", () => {
  it("toggles without touching the name or the rename count", async () => {
    const s = new MemoryProfileStore();
    await s.setName(ALICE, "Alice", opts());
    const p = await s.setPrivate(ALICE, true, T0);
    expect(p).toMatchObject({ displayName: "Alice", isPrivate: true, changesToday: 1 });
    expect((await s.setPrivate(ALICE, false, T0)).isPrivate).toBe(false);
  });

  it("can be the first thing someone sets", async () => {
    const s = new MemoryProfileStore();
    expect(await s.setPrivate(ALICE, true, T0)).toMatchObject({ address: ALICE, displayName: null, isPrivate: true });
  });

  it("is reported by refsFor, keyed by the spelling passed in", async () => {
    const s = new MemoryProfileStore();
    await s.setName(ALICE, "Alice", opts());
    await s.setPrivate(ALICE, true, T0);
    const refs = await s.refsFor([ALICE.toUpperCase(), BOB]);
    expect(refs.get(ALICE.toUpperCase())).toMatchObject({ displayName: "Alice", isPrivate: true });
    expect(refs.has(BOB)).toBe(false);
  });
});

describe("pictures", () => {
  it("stores one per profile, versioned by its content", async () => {
    const s = new MemoryProfileStore();
    const rec = await s.setAvatar(ALICE, { type: "image/png", bytes: PNG }, T0);
    expect(rec.avatarType).toBe("image/png");
    expect(rec.avatarVersion).toMatch(/^[0-9a-f]{12}$/);
    const blob = await s.getAvatar(rec.uid);
    expect(blob).toMatchObject({ type: "image/png", version: rec.avatarVersion });
    expect(blob?.bytes).toEqual(PNG);
    // The same picture again keeps its URL.
    expect((await s.setAvatar(ALICE, { type: "image/png", bytes: PNG }, T0)).avatarVersion).toBe(rec.avatarVersion);
    const cleared = await s.setAvatar(ALICE, null, T0);
    expect(cleared).toMatchObject({ avatarType: null, avatarVersion: null });
    expect(await s.getAvatar(rec.uid)).toBeNull();
  });
});

describe("file store, round 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "ph-profiles2-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps uids, privacy and pictures across a restart", async () => {
    const path = join(dir, "profiles.json");
    const a = new FileProfileStore(path);
    const rec = await a.setAvatar(ALICE, { type: "image/png", bytes: PNG }, T0);
    await a.setPrivate(ALICE, true, T0);
    const b = new FileProfileStore(path);
    expect(await b.get(ALICE)).toMatchObject({ uid: rec.uid, isPrivate: true, avatarType: "image/png", avatarVersion: rec.avatarVersion });
    expect((await b.getAvatar(rec.uid))?.bytes).toEqual(PNG);
  });

  it("gives profiles saved before uids existed one, and writes it so it sticks", async () => {
    const path = join(dir, "old.json");
    writeFileSync(path, JSON.stringify({ profiles: [{ address: ALICE, displayName: "Alice", updatedAt: T0, changesDay: null, changesToday: 1 }] }));
    const uid = (await new FileProfileStore(path).get(ALICE))?.uid;
    expect(uid).toMatch(/^[0-9a-f]{12}$/);
    expect((await new FileProfileStore(path).get(ALICE))?.uid).toBe(uid);
  });
});

describe("supabase store, round 2", () => {
  const fake = () => {
    const upserts: Array<Record<string, unknown>> = [];
    const chain = {
      select: () => chain, eq: () => chain, in: () => chain, not: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async (row: Record<string, unknown>) => { upserts.push(row); return { error: null }; },
    };
    return { db: { from: () => chain } as unknown as SupabaseClient, upserts };
  };

  it("writes only the columns that changed, and a uid for a new row", async () => {
    const { db, upserts } = fake();
    const s = new SupabaseProfileStore(db);
    const rec = await s.setPrivate(ALICE, true, T0);
    expect(upserts[0]).toEqual({ address: ALICE, uid: rec.uid, is_private: true, updated_at: new Date(T0).toISOString() });
    await s.setAvatar(ALICE, { type: "image/png", bytes: PNG }, T0);
    expect(upserts[1]).toMatchObject({ avatar_type: "image/png", avatar_b64: Buffer.from(PNG).toString("base64") });
    expect(upserts[1]).not.toHaveProperty("display_name");
  });
});
