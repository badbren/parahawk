import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { FEES_STALE_MAX_MS, FEES_TTL_MS, inscribeRouter, type InscribeRouterOptions } from "./inscribe-routes.js";

const MEMPOOL = { fastestFee: 12, halfHourFee: 8, hourFee: 5, economyFee: 3, minimumFee: 1 };

let clock = Date.UTC(2026, 10, 6, 12);
let router: express.Router;
let server: Server;
let base = "";
let upstream: Mock<() => Promise<unknown>>;

const mount = (opts: InscribeRouterOptions = {}) => {
  router = inscribeRouter({ fetchRecommended: upstream, now: () => clock, ...opts });
};

beforeAll(async () => {
  const app = express();
  app.use("/api/inscribe", (req, res, next) => router(req, res, next));
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/inscribe`;
  // The route logs upstream failures on purpose; keep the test output clean.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  upstream = vi.fn<() => Promise<unknown>>(async () => MEMPOOL);
  mount();
});

const fees = (query = "") => fetch(`${base}/fees${query}`);

describe("GET /api/inscribe/fees", () => {
  it("passes mempool.space's recommended rates through, checked and cacheable", async () => {
    const res = await fees();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=30");
    const body = await res.json();
    expect(body).toMatchObject({ network: "mainnet", source: "mempool.space", stale: false, ...MEMPOOL });
    expect(body.fetchedAt).toBe(new Date(clock).toISOString());
  });

  it("asks upstream once per 30 s, however often it is asked", async () => {
    await fees();
    await fees();
    clock += FEES_TTL_MS - 1;
    await fees();
    expect(upstream).toHaveBeenCalledTimes(1);
    clock += 1;
    await fees();
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("shares one upstream request between requests that arrive together", async () => {
    let release: (v: unknown) => void = () => undefined;
    upstream.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const both = Promise.all([fees(), fees()]);
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
    release(MEMPOOL);
    const [a, b] = await both;
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("serves the last good rates, marked stale and uncached, while upstream is down", async () => {
    await fees();
    upstream.mockRejectedValue(new Error("https://mempool.space/api/v1/fees/recommended → HTTP 502"));
    clock += FEES_TTL_MS;
    const res = await fees();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ stale: true, halfHourFee: 8 });
  });

  it("gives up on old rates and says so plainly, without upstream detail", async () => {
    await fees();
    upstream.mockRejectedValue(new Error("https://mempool.space/api/v1/fees/recommended → HTTP 502"));
    clock += FEES_STALE_MAX_MS + 1;
    const res = await fees();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain("set one by hand");
    expect(text).not.toContain("mempool.space/api");
  });

  it("refuses a feed that isn't believable", async () => {
    upstream.mockResolvedValue({ fastestFee: "12", halfHourFee: 8, hourFee: 5 });
    expect((await fees()).status).toBe(503);
    upstream.mockResolvedValue({ fastestFee: 1e9, halfHourFee: 8, hourFee: 5 });
    expect((await fees()).status).toBe(503);
  });

  it("is mainnet only, like Xverse's inscription flow", async () => {
    expect((await fees("?network=mainnet")).status).toBe(200);
    const res = await fees("?network=testnet4");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/mainnet only/);
  });
});
