/** The Leaderboard shows Parahawk display names (src/profile/names.ts) over short addresses. */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryGameStore } from "../game/store.js";
import type { RunRecord } from "../game/types.js";
import { gameRouter } from "./game-routes.js";

const ALICE = "bc1qalice0000000000000000000000000000000";
const BOB = "bc1qbob00000000000000000000000000000000000";
const NOW = Date.UTC(2026, 10, 6, 12);

const run = (address: string, score: number, i: number): RunRecord => ({
  id: `r${i}`, address, at: NOW - 60_000 * (i + 1), seed: 1000 + i, score, won: true,
  nonces: 0, stale: 0, scrapes: 0, durationMs: 45_000, whitesAwarded: 2,
});

let server: Server;
let base = "";
let lookups = 0;

beforeAll(async () => {
  const store = new MemoryGameStore();
  await store.recordRun({ nonce: "n1", address: ALICE, expiresAt: NOW + 1e6 }, run(ALICE, 180, 0), NOW);
  await store.recordRun({ nonce: "n2", address: BOB, expiresAt: NOW + 1e6 }, run(BOB, 120, 1), NOW);
  const app = express();
  app.use("/api/game", gameRouter({
    store, now: () => NOW, simulation: null, refuseDevSecret: false,
    namesFor: async (addresses) => { lookups++; return new Map(addresses.filter((a) => a === ALICE).map((a) => [a, "Alice"])); },
  }));
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/game`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("leaderboard names", () => {
  it("uses display names where people set one, the short address otherwise", async () => {
    const body = await (await fetch(`${base}/leaderboard?window=all`)).json() as { rows: Array<{ address: string; name: string }> };
    expect(body.rows.map((r) => r.name)).toEqual(["Alice", "bc1qbo…0000"]);
    expect(body.rows[0]!.address).toBe(ALICE);
    expect(lookups).toBeGreaterThan(0);
  });

  it("names a player's own stats too", async () => {
    const body = await (await fetch(`${base}/stats/${ALICE}`)).json() as { name: string };
    expect(body.name).toBe("Alice");
  });
});
