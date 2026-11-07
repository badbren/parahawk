import { describe, expect, it, vi } from "vitest";
import { countBlocksFound, createBlocksFound } from "./pool-blocks.js";

const round = (height: number) => ({ height, totalWorkDiff: 1, winner: null });
const FIVE = [938713, 945601, 954873, 958212, 958527].map(round);

describe("countBlocksFound", () => {
  it("is the number of completed rounds", () => {
    expect(countBlocksFound(FIVE.map((r) => r.height), 958527)).toBe(5);
  });
  it("counts a block pool-stats has seen before /api/rounds has", () => {
    expect(countBlocksFound(FIVE.map((r) => r.height), 975000)).toBe(6);
  });
  it("ignores a missing or older last-found height", () => {
    expect(countBlocksFound(FIVE.map((r) => r.height), null)).toBe(5);
    expect(countBlocksFound(FIVE.map((r) => r.height), 945601)).toBe(5);
  });
});

describe("createBlocksFound", () => {
  it("fetches once per TTL", async () => {
    const fetchRounds = vi.fn(async () => FIVE);
    const found = createBlocksFound(fetchRounds, 1000);
    expect(await found(958527, 0)).toBe(5);
    expect(await found(958527, 999)).toBe(5);
    expect(fetchRounds).toHaveBeenCalledTimes(1);
    expect(await found(958527, 1000)).toBe(5);
    expect(fetchRounds).toHaveBeenCalledTimes(2);
  });
  it("shares one fetch between concurrent callers", async () => {
    const fetchRounds = vi.fn(async () => FIVE);
    const found = createBlocksFound(fetchRounds, 1000);
    expect(await Promise.all([found(null, 0), found(null, 0), found(null, 0)])).toEqual([5, 5, 5]);
    expect(fetchRounds).toHaveBeenCalledTimes(1);
  });
  it("is unknown (null) when the first fetch fails or comes back empty", async () => {
    expect(await createBlocksFound(async () => { throw new Error("down"); })(null, 0)).toBeNull();
    expect(await createBlocksFound(async () => [])(null, 0)).toBeNull();
  });
  it("keeps the last good list when a refresh fails", async () => {
    let fail = false;
    const found = createBlocksFound(async () => { if (fail) throw new Error("down"); return FIVE; }, 1000);
    expect(await found(null, 0)).toBe(5);
    fail = true;
    expect(await found(975000, 5000)).toBe(6);
  });
});
