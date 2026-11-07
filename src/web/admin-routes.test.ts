import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminSources } from "../admin/stats.js";
import { adminRouter } from "./admin-routes.js";

const OWNER = "bc1qowner000000000000000000000000000000000";
const ALICE = "bc1qalice00000000000000000000000000000000";
const NOW = Date.UTC(2026, 10, 6, 15);

const sources = (): AdminSources => ({
  activity: async () => [],
  stampEarned: async () => null,
  profiles: async () => new Map(),
  orders: async () => [],
  chatRecent: async () => [],
  chatTotal: async () => 0,
  suggestions: async () => [],
  runs: async () => ({ totalRuns: 0, players: 0 }),
  traffic: async () => ({
    days: [], today: { day: "2026-11-06", visitors: 3, views: 5 }, last7: { visitors: 3, views: 5 }, last30: { visitors: 3, views: 5 }, backend: "memory",
  }),
  isOwner: (a) => a === OWNER,
  now: () => NOW,
});

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use("/api/admin", adminRouter({
    session: (r) => {
      const a = r.get("x-test-address");
      return a ? { address: a, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER } : null;
    },
    isAdmin: (s) => s?.address === OWNER,
    sources,
  }));
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const get = (path: string, who: string | null) => fetch(`${base}${path}`, { headers: who ? { "x-test-address": who } : {} });

describe("/api/admin", () => {
  it("is refused without a session (401) and for anyone but the owner (403)", async () => {
    const anon = await get("/stats", null);
    expect(anon.status).toBe(401);
    expect(anon.headers.get("cache-control")).toBe("private, no-store");
    const alice = await get("/stats", ALICE);
    expect(alice.status).toBe(403);
    expect(await alice.json()).toEqual({ error: "owner only" });
  });

  it("gives the owner the numbers, never cached", async () => {
    const res = await get("/stats", OWNER);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.overview.visitorsToday).toBe(3);
    expect(body.users).toEqual([]);
    expect(Array.isArray(body.badges.table)).toBe(true);
  });

  it("answers unknown paths with JSON 404, still owner-only", async () => {
    expect((await get("/nope", ALICE)).status).toBe(403);
    expect((await get("/nope", OWNER)).status).toBe(404);
  });
});
