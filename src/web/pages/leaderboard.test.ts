import { beforeEach, describe, expect, it, vi } from "vitest";

const { publicNamesFor } = vi.hoisted(() => ({
  publicNamesFor: vi.fn<(addresses: readonly string[]) => Promise<Map<string, string>>>(),
}));
vi.mock("../../profile/names.js", () => ({ publicNamesFor }));

import { MemoryGameStore, type GameStore } from "../../game/store.js";
import type { RunRecord } from "../../game/types.js";
import { leaderboardBody, parseBoardWindow, renderLeaderboard } from "./leaderboard.js";

const NOW = Date.UTC(2026, 10, 6, 18, 0, 0);
const A = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const B = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const P2SH = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";

let n = 0;
const run = (address: string, score: number, at: number, won = true): RunRecord => ({
  id: `r${++n}`, address, at, seed: 1, score, won, nonces: 0, stale: 0, scrapes: 0, durationMs: 45_000, whitesAwarded: won ? 2 : 1,
});

async function storeWith(runs: RunRecord[]): Promise<GameStore> {
  const s = new MemoryGameStore();
  for (const r of runs) await s.recordRun({ nonce: r.id, address: r.address, expiresAt: NOW + 60_000 }, r, NOW);
  return s;
}

describe("parseBoardWindow", () => {
  it("reads today / week / all and defaults to this week", () => {
    expect(parseBoardWindow("today")).toBe("today");
    expect(parseBoardWindow("all")).toBe("all");
    expect(parseBoardWindow("week")).toBe("week");
    expect(parseBoardWindow(undefined)).toBe("week");
    expect(parseBoardWindow(["all"])).toBe("week");
    expect(parseBoardWindow("<script>")).toBe("week");
  });
});

describe("leaderboardBody", () => {
  const board = (rows: Array<{ address: string; best: number }>) => ({
    window: "week" as const, since: NOW - 7 * 86_400_000, totalRuns: rows.length, players: rows.length, practice: true as const, generatedAt: NOW,
    rows: rows.map((r, i) => ({ rank: i + 1, address: r.address, name: r.address, best: r.best, runs: 1, wins: 1, whitesWon: 2, bestAt: NOW - 60_000 })),
  });

  it("shows wallet (name), the name opening their profile", () => {
    const html = leaderboardBody(board([{ address: A, best: 198 }]), new Map([[A, "badbren"]]));
    expect(html).toContain(`<a href="/address/${A}">`);
    expect(html).toContain(`data-ph-open="/u/${A}"`);
    expect(html).toContain("(badbren)</a>");
    expect(html).toContain("198");
  });

  it("doesn't link a non-bc1 wallet to the wallet page, but still names it", () => {
    const html = leaderboardBody(board([{ address: P2SH, best: 97 }]), new Map([[P2SH, "satoshi"]]));
    expect(html).not.toContain(`/address/${P2SH}`);
    expect(html).toContain("(satoshi)</a>");
  });

  it("marks the current window and links the others", () => {
    const html = leaderboardBody(board([]), new Map());
    expect(html).toContain(`<span class="lbw on" aria-current="page">This week</span>`);
    expect(html).toContain(`href="/leaderboard?window=today"`);
    expect(html).toContain(`href="/leaderboard?window=all"`);
    expect(html).toContain("No runs this week yet");
    expect(html).toContain("PRACTICE");
  });
});

describe("renderLeaderboard", () => {
  beforeEach(() => { publicNamesFor.mockReset(); });

  it("ranks best run per wallet from the store and names the wallets", async () => {
    publicNamesFor.mockImplementation(async () => new Map([[B, "badbren"]]));
    const store = await storeWith([run(A, 120, NOW - 3_600_000), run(B, 150, NOW - 7_200_000), run(A, 90, NOW - 60_000, false)]);
    const html = await renderLeaderboard("week", { store, now: () => NOW });
    expect(html.indexOf(B)).toBeLessThan(html.indexOf(A));
    expect(html).toContain("(badbren)</a>");
    expect(html).toContain("2 players · 3 runs this week");
  });

  it("keeps old runs off today's board", async () => {
    publicNamesFor.mockImplementation(async () => new Map());
    const store = await storeWith([run(A, 120, NOW - 2 * 86_400_000)]);
    const html = await renderLeaderboard("today", { store, now: () => NOW });
    expect(html).toContain("No runs today yet");
    expect(html).not.toContain(`/address/${A}`);
  });

  it("renders the page even when the store fails", async () => {
    const broken = { leaderboard: async () => { throw new Error("db down"); } } as unknown as GameStore;
    const html = await renderLeaderboard("all", { store: broken, now: () => NOW });
    expect(html).toContain("couldn't load");
  });
});
