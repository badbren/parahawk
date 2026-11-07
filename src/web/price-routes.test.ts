import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Permission } from "../activity/permissions.js";
import {
  MemoryManualPriceStore,
  changeManualPrice,
  getManualPrice,
  getPriceChanges,
  isPriceEditorBanned,
  useManualPriceStore,
} from "../services/manual-prices.js";
import { UPDATE_COOLDOWN_MS } from "../services/price-updates.js";
import { priceRouter, type PriceRouterOptions } from "./price-routes.js";

const OWNER = "bc1qowner000000000000000000000000000000";
const ALICE = "bc1qalice0000000000000000000000000000000"; // trusted
const BOB = "bc1qbob00000000000000000000000000000000000"; // signed in, no badge
const BTC = 100_000; // $1 = 1,000 sats → $50 for 1 PH/24h = 50,000 sats/PHd

let clock = Date.UTC(2026, 10, 6, 12);
let router: express.Router;
let server: Server;
let base = "";
let marketSats: number | null = 50_000;

const session = (r: express.Request) => {
  const a = r.get("x-test-address");
  return a ? { address: a, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER } : null;
};
const mount = (opts: PriceRouterOptions = {}) => {
  router = priceRouter({
    session,
    isAdmin: (s) => s?.address === OWNER,
    permissions: async (address) => new Set<Permission>(address === ALICE ? ["edit_prices"] : []),
    btcPriceUsd: async () => BTC,
    marketSats: async () => marketSats,
    checkCsrf: (_a, t) => t === "ok",
    now: () => clock,
    ...opts,
  });
};

beforeAll(async () => {
  const app = express();
  app.use("/api/prices", (req, res, next) => router(req, res, next));
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/prices`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  clock = Date.UTC(2026, 10, 6, 12);
  marketSats = 50_000;
  useManualPriceStore(new MemoryManualPriceStore());
  mount();
});
afterEach(() => useManualPriceStore(null));

const post = (path: string, who: string | null, body: Record<string, unknown>, form = false) =>
  fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json",
      ...(who ? { "x-test-address": who } : {}),
    },
    body: form
      ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString()
      : JSON.stringify(body),
  });

describe("POST /api/prices/:venue", () => {
  it("lets a Trusted visitor update Kiss My Hash, logged under their address", async () => {
    const res = await post("/kissmyhash", ALICE, { usd: 50, csrf: "ok" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, venue: "kissmyhash", satsPerPhd: 50_000, usd: 50 });
    expect(await getManualPrice("kissmyhash")).toMatchObject({ satsPerPhd: 50_000, updatedBy: ALICE });
    expect(await getPriceChanges()).toMatchObject([{ by: ALICE, newSats: 50_000, usd: 50 }]);
  });

  it("needs a session, Parahawk's token and the badge", async () => {
    expect((await post("/kissmyhash", null, { usd: 50, csrf: "ok" })).status).toBe(401);
    expect((await post("/kissmyhash", ALICE, { usd: 50, csrf: "nope" })).status).toBe(403);
    const res = await post("/kissmyhash", BOB, { usd: 50, csrf: "ok" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Trusted/);
    expect(await getManualPrice("kissmyhash")).toBeNull();
  });

  it("refuses a blocked wallet even with the badge", async () => {
    await post("/bans", OWNER, { address: ALICE, csrf: "ok" });
    expect(await isPriceEditorBanned(ALICE)).toBe(true);
    expect((await post("/kissmyhash", ALICE, { usd: 50, csrf: "ok" })).status).toBe(403);
  });

  it("only offers visitors the venues whose row reads the hand-typed price", async () => {
    expect((await post("/braiins", ALICE, { usd: 50, csrf: "ok" })).status).toBe(404);
    expect((await post("/nicehash", ALICE, { usd: 50, csrf: "ok" })).status).toBe(404);
    expect((await post("/braiins", OWNER, { usd: 50, csrf: "ok" })).status).toBe(200);
  });

  it("refuses a bad USD figure", async () => {
    for (const usd of [0, -5, "abc", 999_999]) {
      expect((await post("/kissmyhash", ALICE, { usd, csrf: "ok" })).status).toBe(400);
    }
  });

  it("refuses a price far from the current one or the live venues", async () => {
    await changeManualPrice({ venue: "kissmyhash", satsPerPhd: 50_000, by: OWNER, now: clock - 60 * 60_000 });
    const far = await post("/kissmyhash", ALICE, { usd: 160, csrf: "ok" }); // 160k = 3.2× current
    expect(far.status).toBe(400);
    expect((await far.json()).error).toMatch(/3×/);
    useManualPriceStore(new MemoryManualPriceStore());
    marketSats = 30_000;
    expect((await post("/kissmyhash", ALICE, { usd: 130, csrf: "ok" })).status).toBe(400); // 130k > 4× 30k
    expect((await post("/kissmyhash", ALICE, { usd: 110, csrf: "ok" })).status).toBe(200);
  });

  it("holds a visitor to one update per venue per 10 minutes", async () => {
    expect((await post("/kissmyhash", ALICE, { usd: 50, csrf: "ok" })).status).toBe(200);
    clock += 60_000;
    const again = await post("/kissmyhash", ALICE, { usd: 51, csrf: "ok" });
    expect(again.status).toBe(429);
    expect(Number(again.headers.get("retry-after"))).toBe((UPDATE_COOLDOWN_MS - 60_000) / 1000);
    clock += UPDATE_COOLDOWN_MS;
    expect((await post("/kissmyhash", ALICE, { usd: 51, csrf: "ok" })).status).toBe(200);
  });

  it("lets the owner skip the bounds and the pace", async () => {
    await changeManualPrice({ venue: "kissmyhash", satsPerPhd: 50_000, by: OWNER, now: clock - 1000 });
    expect((await post("/kissmyhash", OWNER, { usd: 400, csrf: "ok" })).status).toBe(200);
    expect((await post("/kissmyhash", OWNER, { usd: 45, csrf: "ok" })).status).toBe(200);
  });

  it("says so when there's no BTC price to convert at", async () => {
    mount({ btcPriceUsd: async () => 0 });
    expect((await post("/kissmyhash", ALICE, { usd: 50, csrf: "ok" })).status).toBe(503);
  });

  it("doesn't save a visitor's edit that can't be logged", async () => {
    const store = new MemoryManualPriceStore();
    store.addChange = async () => { throw new Error("history table missing"); };
    useManualPriceStore(store);
    const err = console.error;
    console.error = () => {};
    try {
      expect((await post("/kissmyhash", ALICE, { usd: 50, csrf: "ok" })).status).toBe(503);
    } finally {
      console.error = err;
    }
    expect(await getManualPrice("kissmyhash")).toBeNull();
  });
});

describe("owner moderation", () => {
  it("reverts a change from the /admin form and goes back to /admin", async () => {
    await changeManualPrice({ venue: "kissmyhash", satsPerPhd: 50_000, by: OWNER, now: clock - 2000 });
    await post("/kissmyhash", ALICE, { usd: 60, csrf: "ok" });
    const vandal = (await getPriceChanges({ by: ALICE }))[0]!;
    const res = await post(`/history/${vandal.id}/revert`, OWNER, { csrf: "ok" }, true);
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toMatch(/^\/admin\?msg=Put back: Kiss My Hash is 50,000/);
    expect(await getManualPrice("kissmyhash")).toMatchObject({ satsPerPhd: 50_000, updatedBy: OWNER });
  });

  it("blocks and unblocks", async () => {
    expect((await post("/bans", OWNER, { address: BOB, csrf: "ok" })).status).toBe(200);
    expect(await isPriceEditorBanned(BOB)).toBe(true);
    expect((await post("/bans/remove", OWNER, { address: BOB, csrf: "ok" })).status).toBe(200);
    expect(await isPriceEditorBanned(BOB)).toBe(false);
  });

  it("won't block the owner, or junk", async () => {
    expect((await post("/bans", OWNER, { address: OWNER, csrf: "ok" })).status).toBe(400);
    expect((await post("/bans", OWNER, { address: "<script>", csrf: "ok" })).status).toBe(400);
  });

  it("is the owner's alone", async () => {
    expect((await post("/bans", ALICE, { address: BOB, csrf: "ok" })).status).toBe(403);
    expect((await post("/history/x/revert", ALICE, { csrf: "ok" })).status).toBe(403);
    expect((await post("/bans", OWNER, { address: BOB, csrf: "bad" })).status).toBe(403);
    expect((await fetch(`${base}/history`, { headers: { "x-test-address": ALICE } })).status).toBe(403);
    const ok = await fetch(`${base}/history`, { headers: { "x-test-address": OWNER } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ changes: [], bans: [] });
  });
});
