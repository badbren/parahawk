import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolHeadline } from "../activity/pool.js";
import { MemoryActivityStore } from "../activity/store.js";
import { MIN_PING_GAP_MS, activityRouter, type ActivityRouterOptions } from "./activity-routes.js";

// Real addresses (BIP-173 / BIP-350 examples): pool addresses must pass the checksum.
const ALICE = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const P2SH = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
const ORDINALS = "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0";
const MINER = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";

let clock = Date.UTC(2026, 10, 6, 12);
let router: express.Router;
let store: MemoryActivityStore;
let server: Server;
let base = "";
let poolCalls: string[] = [];

const headline = (address: string): PoolHeadline => ({
  address, hashratePhs: 1.5, bestDifficulty: 5e12, bestDiffBlockPercent: 0.003, lifetimePhd: 20, luckRatio: 1.1,
  cadosWon: 0, blocksFound: 0, blocksParticipated: 2, refineryOrders: 3, activeOrders: 1,
  stake: { sats: 12_345, usd: 9.5, pct: 0.02, assumedFull: true }, rentalStake: null, parasiteBadges: [],
  potAgeHours: 100, generatedAt: clock,
});

const session = (r: express.Request) => {
  const a = r.get("x-test-address");
  return a ? { address: a, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER } : null;
};
const mount = (opts: ActivityRouterOptions = {}) => {
  store = new MemoryActivityStore();
  poolCalls = [];
  router = activityRouter({
    store, session, now: () => clock,
    pool: async (a) => { poolCalls.push(a); return headline(a); },
    rentals: async () => [{ status: "placed", placedAt: clock - 5_000 }, { status: "dryrun", placedAt: clock }],
    linkedVenues: async () => ["nicehash"],
    ...opts,
  });
};

beforeAll(async () => {
  const app = express();
  app.use("/api/activity", (req, res, next) => router(req, res, next));
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/activity`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { clock += 24 * 3_600_000; mount(); });

const ping = (who: string | null = ALICE, headers: Record<string, string> = {}) =>
  fetch(`${base}/ping`, { method: "POST", headers: { "Content-Type": "application/json", ...(who ? { "x-test-address": who } : {}), ...headers }, body: "{}" });
const me = (who: string | null = ALICE, q = "") => fetch(`${base}/me${q}`, { headers: who ? { "x-test-address": who } : {} });
/** A response body, loosely typed — the assertions say what's in it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response | Promise<Response>): Promise<any> => (await res).json();
const setPool = (address: unknown, who: string | null = ALICE) =>
  fetch(`${base}/me/pool-address`, {
    method: "PUT", headers: { "Content-Type": "application/json", ...(who ? { "x-test-address": who } : {}) }, body: JSON.stringify({ address }),
  });

describe("POST /ping", () => {
  it("needs a signed-in, same-origin caller", async () => {
    expect((await ping(null)).status).toBe(401);
    expect((await ping(ALICE, { Origin: "https://evil.example" })).status).toBe(403);
  });

  it("credits the server's own measure of time, never more than real time", async () => {
    expect(await json(ping())).toMatchObject({ ok: true, credited: 0, secondsOnSite: 0 });
    clock += 60_000;
    expect(await json(ping())).toMatchObject({ credited: 60, secondsOnSite: 60 });
    // Hammering inside the gap is acknowledged and dropped.
    clock += 1_000;
    expect(await json(ping())).toMatchObject({ ok: true, skipped: true });
    clock += MIN_PING_GAP_MS;
    expect(await json(ping())).toMatchObject({ credited: 21, secondsOnSite: 81 });
  });
});

describe("GET /me", () => {
  it("needs a sign-in, and is never cached", async () => {
    expect((await me(null)).status).toBe(401);
    const res = await me();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers with counters, badges, rentals (no dry runs), venues and pool numbers", async () => {
    await ping(); clock += 60_000; await ping();
    await store.bump(ALICE, "self_search", clock);
    const body = await json(me());
    expect(body.address).toBe(ALICE);
    expect(body.counters).toMatchObject({ secondsOnSite: 60, selfSearches: 1, activeDays: 1 });
    expect(body.badges.find((b: { id: string }) => b.id === "looked-yourself-up").earned).toBe(true);
    expect(body.badges.find((b: { id: string }) => b.id === "renter").earned).toBe(true);
    expect(body.earned).toBe(body.badges.filter((b: { earned: boolean }) => b.earned).length);
    expect(body.stats.rentals).toEqual({ count: 1, lastAt: clock - 5_000 });
    expect(body.stats.linkedVenues).toEqual(["nicehash"]);
    expect(body.stats).toMatchObject({ poolAddress: ALICE, poolAddressSaved: false, poolError: null });
    expect(body.stats.pool.stake.sats).toBe(12_345);
  });

  it("a non-bc1 sign-in uses the wallet's other address (?pool=) for pool numbers", async () => {
    const body = await json(me(P2SH, `?pool=${ORDINALS}`));
    expect(body.stats.poolAddress).toBe(ORDINALS);
    expect(poolCalls).toEqual([ORDINALS]);
    const none = await json(me(P2SH, "?pool=not-an-address"));
    expect(none.stats).toMatchObject({ poolAddress: null, pool: null, poolError: null });
  });

  it("still answers when the pool numbers are slow or broken", async () => {
    mount({ pool: () => new Promise(() => {}), poolTimeoutMs: 50 });
    const slow = await json(me());
    expect(slow.stats.pool).toBeNull();
    expect(slow.stats.poolError).toMatch(/slow/);
    expect(slow.badges.length).toBeGreaterThan(0);

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mount({ pool: async () => { throw new Error("upstream down"); }, rentals: async () => { throw new Error("db"); } });
    const broken = await json(me());
    err.mockRestore();
    expect(broken.stats).toMatchObject({ pool: null, rentals: null });
    expect(broken.stats.poolError).toMatch(/Couldn't/);
  });
});

describe("PUT /me/pool-address", () => {
  it("saves a bc1 address (lowercased) that then wins over the sign-in address", async () => {
    const res = await setPool(`  ${MINER.toUpperCase()} `);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.stats).toMatchObject({ poolAddress: MINER, poolAddressSaved: true });
    expect((await json(me())).stats.poolAddress).toBe(MINER);
  });

  it("refuses anything that isn't a real bc1 address, and null clears it", async () => {
    expect((await setPool("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).status).toBe(400);
    expect((await setPool("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5")).status).toBe(400); // a typo
    expect((await setPool("bc1qnotreal")).status).toBe(400);
    expect((await setPool("<b>hi</b>")).status).toBe(400);
    expect((await setPool(42)).status).toBe(400);
    await setPool(MINER);
    const cleared = await json(setPool(null));
    expect(cleared.stats).toMatchObject({ poolAddress: ALICE, poolAddressSaved: false });
  });

  it("needs a sign-in and JSON", async () => {
    expect((await setPool(MINER, null)).status).toBe(401);
    const res = await fetch(`${base}/me/pool-address`, { method: "PUT", headers: { "x-test-address": ALICE, "Content-Type": "text/plain" }, body: MINER });
    expect(res.status).toBe(415);
  });
});

it("unknown paths get a JSON 404", async () => {
  const res = await fetch(`${base}/nope`);
  expect(res.status).toBe(404);
  expect(await json(res)).toEqual({ error: "not found" });
});

describe("GET /public/:ref (someone else's card)", () => {
  const OWNER = "bc1qowner000000000000000000000000000000";
  /** ALICE is public; MINER keeps their wallet private (and chats as ~privuid). */
  const resolveRef = async (ref: string) => {
    if (ref === ALICE || ref === "~pubuid") return { address: ALICE, isPrivate: false };
    if (ref === MINER || ref === "~privuid") return { address: MINER, isPrivate: true };
    if (ref === OWNER) return { address: OWNER, isPrivate: false };
    return null;
  };
  const card = (ref: string) => fetch(`${base}/public/${encodeURIComponent(ref)}`);
  beforeEach(async () => {
    // Only ALICE has placed a rental through Parahawk.
    mount({ resolveRef, isOwner: (a) => a === OWNER, rentals: async (a) => (a === ALICE ? [{ status: "placed", placedAt: clock - 5_000 }] : []) });
    await store.bump(ALICE, "self_search", clock);
    await store.bump(MINER, "chat_message", clock);
  });

  it("by wallet, for someone public: pool numbers, earned badges (no progress), time on Parahawk", async () => {
    const res = await card(ALICE);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/^public/);
    const body = await json(res);
    expect(body).toMatchObject({ ref: ALICE, address: ALICE, isPrivate: false, owner: false, poolError: null });
    expect(body.pool.stake.sats).toBe(12_345);
    expect(body.badges.map((b: { id: string }) => b.id)).toContain("looked-yourself-up");
    expect(body.badges.every((b: object) => !("progress" in b) && !("earned" in b))).toBe(true);
    expect(body.activity).toMatchObject({ daysActive: 1, hoursOnSite: 0 });
    expect(body.total).toBeGreaterThan(body.badges.length);
    // Nothing private about the person behind it: no rentals list, no linked venues.
    expect(body.stats).toBeUndefined();
  });

  it("by ~uid, for someone private: badges and time, but never the wallet or its numbers", async () => {
    const body = await json(card("~privuid"));
    expect(body).toMatchObject({ ref: "~privuid", address: null, isPrivate: true, pool: null, poolError: null });
    expect(body.badges.map((b: { id: string }) => b.id)).toContain("first-words");
    expect(body.activity).not.toBeNull();
    expect(poolCalls).not.toContain(MINER);
    expect(JSON.stringify(body)).not.toContain(MINER);
  });

  it("by wallet, for someone private: only the wallet's pool numbers — nothing that ties to their name", async () => {
    const body = await json(card(MINER));
    expect(body).toMatchObject({ address: MINER, isPrivate: false, badges: null, activity: null });
    expect(body.pool.address).toBe(MINER);
  });

  it("a ~uid for someone public may show their wallet too", async () => {
    const body = await json(card("~pubuid"));
    expect(body).toMatchObject({ address: ALICE, isPrivate: false });
    expect(body.pool).not.toBeNull();
  });

  it("a wallet with no Parahawk profile still gets its pool numbers", async () => {
    const body = await json(card(ORDINALS));
    expect(body).toMatchObject({ address: ORDINALS, badges: null, activity: null });
    expect(body.pool.address).toBe(ORDINALS);
  });

  it("a non-bc1 wallet has no pool numbers to show", async () => {
    const body = await json(card(P2SH));
    expect(body).toMatchObject({ address: P2SH, pool: null, poolError: null });
  });

  it("the owner holds every badge", async () => {
    const body = await json(card(OWNER));
    expect(body.owner).toBe(true);
    expect(body.badges.length).toBe(body.total);
  });

  it("refuses junk, and a ~uid that matches nobody is a 404", async () => {
    expect((await card("<script>")).status).toBe(400);
    expect((await card("~x")).status).toBe(400);
    const res = await card("~nobody1");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /me for the owner", () => {
  it("shows every badge earned", async () => {
    mount({ isOwner: (a) => a === ALICE });
    const body = await json(me());
    expect(body.earned).toBe(body.badges.length);
  });
});
