import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  FileActivityStore,
  MemoryActivityStore,
  SupabaseActivityStore,
  createActivityStore,
} from "./store.js";

const A = "bc1qalice0000000000000000000000000000000";
const T0 = Date.UTC(2026, 10, 6, 12);
const dir = mkdtempSync(join(tmpdir(), "ph-activity-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("MemoryActivityStore", () => {
  it("pings, bumps, remembers a pool address, and hands out copies", async () => {
    const s = new MemoryActivityStore();
    expect(await s.get(A)).toBeNull();
    await s.ping(A, T0);
    const { credited, record } = await s.ping(A, T0 + 60_000);
    expect(credited).toBe(60);
    expect(record.secondsOnSite).toBe(60);
    await s.bump(A, "self_search", T0 + 61_000);
    await s.setPoolAddress(A, "bc1qminer000000000000000000000000000000", T0);
    const got = await s.get(A);
    expect(got).toMatchObject({ secondsOnSite: 60, selfSearches: 1, activeDays: 1, poolAddress: "bc1qminer000000000000000000000000000000" });
    got!.secondsOnSite = 9_999;
    expect((await s.get(A))!.secondsOnSite).toBe(60);
  });
});

describe("FileActivityStore", () => {
  it("survives a restart", async () => {
    const path = join(dir, "a", "site-activity.json");
    const s1 = new FileActivityStore(path);
    await s1.ping(A, T0);
    await s1.ping(A, T0 + 45_000);
    await s1.bump(A, "chat_message", T0 + 50_000);
    const s2 = new FileActivityStore(path);
    expect(await s2.get(A)).toMatchObject({ secondsOnSite: 45, chatMessages: 1, lastPing: T0 + 45_000 });
  });

  it("starts empty on a missing or broken file, and zeroes junk fields", async () => {
    expect(await new FileActivityStore(join(dir, "nope.json")).get(A)).toBeNull();
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{not json");
    expect(await new FileActivityStore(broken).get(A)).toBeNull();
    const junk = join(dir, "junk.json");
    writeFileSync(junk, JSON.stringify({ records: { [A]: { secondsOnSite: "lots", activeDays: -4, chatMessages: 3, poolAddress: 7 } } }));
    expect(await new FileActivityStore(junk).get(A)).toMatchObject({ secondsOnSite: 0, activeDays: 0, chatMessages: 3, poolAddress: null });
  });

  it("writes plain JSON keyed by address", async () => {
    const path = join(dir, "plain.json");
    await new FileActivityStore(path).bump(A, "suggestion", T0);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(raw.records[A].suggestions).toBe(1);
  });
});

describe("SupabaseActivityStore", () => {
  const row = {
    address: A, first_seen: "2026-11-06T12:00:00+00:00", last_seen: "2026-11-06T12:01:00+00:00",
    last_ping: "2026-11-06T12:01:00+00:00", seconds_on_site: 60, active_days: 1, last_day: "2026-11-06",
    self_searches: 0, wallet_searches: 2, chat_messages: 0, suggestions: 0, pool_address: null,
  };

  it("calls the SQL functions with the rules' constants and reads the row back", async () => {
    const rpc = vi.fn(async () => ({ data: { ...row, credited: 60 }, error: null }));
    const s = new SupabaseActivityStore({ rpc } as unknown as SupabaseClient);
    const out = await s.ping(A, T0 + 60_000);
    expect(rpc).toHaveBeenCalledWith("parahawk_activity_ping", { p_address: A, p_now: new Date(T0 + 60_000).toISOString(), p_max_credit_s: 90, p_max_gap_s: 180 });
    expect(out.credited).toBe(60);
    expect(out.record).toMatchObject({ secondsOnSite: 60, walletSearches: 2, lastPing: T0 + 60_000, lastDay: "2026-11-06", firstSeen: T0 });
  });

  it("surfaces database errors instead of pretending", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom", code: "XX000" } }));
    const s = new SupabaseActivityStore({ rpc } as unknown as SupabaseClient);
    await expect(s.bump(A, "chat_message", T0)).rejects.toThrow(/parahawk_activity_bump: boom/);
    rpc.mockResolvedValueOnce({ data: "nonsense", error: null } as never);
    await expect(s.setPoolAddress(A, null, T0)).rejects.toThrow(/unexpected reply/);
  });
});

describe("createActivityStore", () => {
  it("uses a local file everywhere but Vercel", () => {
    expect(createActivityStore({ ACTIVITY_FILE: join(dir, "x.json") }).kind).toBe("file");
  });
  it("uses Supabase on Vercel, memory when Vercel has no database", () => {
    const fake = {} as SupabaseClient;
    expect(createActivityStore({ VERCEL: "1" }, { hasSupabase: () => true, makeSupabase: () => fake }).kind).toBe("supabase");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(createActivityStore({ VERCEL: "1" }, { hasSupabase: () => false }).kind).toBe("memory");
    warn.mockRestore();
  });
});

describe("getMany (Chat's badge chips)", () => {
  const B = "bc1qbob000000000000000000000000000000000";

  it("memory and file stores answer for the addresses they know, in one call", async () => {
    for (const s of [new MemoryActivityStore(), new FileActivityStore(join(dir, "many.json"))]) {
      await s.bump(A, "chat_message", T0);
      await s.bump(B, "self_search", T0);
      const got = await s.getMany([A, B, "bc1qnobody", A]);
      expect([...got.keys()].sort()).toEqual([A, B].sort());
      expect(got.get(A)!.chatMessages).toBe(1);
      got.get(A)!.chatMessages = 99;
      expect((await s.get(A))!.chatMessages).toBe(1);
    }
  });

  it("Supabase reads them with one IN query, and surfaces errors", async () => {
    const row = {
      address: A, first_seen: "2026-11-06T12:00:00+00:00", last_seen: "2026-11-06T12:00:00+00:00", last_ping: null,
      seconds_on_site: 0, active_days: 1, last_day: "2026-11-06", self_searches: 0, wallet_searches: 0,
      chat_messages: 4, suggestions: 0, pool_address: null,
    };
    const inFn = vi.fn(async () => ({ data: [row], error: null }));
    const from = vi.fn(() => ({ select: () => ({ in: inFn }) }));
    const s = new SupabaseActivityStore({ from } as unknown as SupabaseClient);
    const got = await s.getMany([A, B, A]);
    expect(from).toHaveBeenCalledWith("site_activity");
    expect(inFn).toHaveBeenCalledTimes(1);
    expect(inFn).toHaveBeenCalledWith("address", [A, B]);
    expect(got.get(A)!.chatMessages).toBe(4);
    expect(got.has(B)).toBe(false);

    inFn.mockResolvedValueOnce({ data: null, error: { message: "boom" } } as never);
    await expect(s.getMany([A])).rejects.toThrow(/site_activity select many: boom/);
  });
});
