import { describe, expect, it } from "vitest";
import { checkInputs, createSteerRecorder, MAX_LOG_ENTRIES, quantizeSteer, STEER_SCALE, totalTicks } from "./inputs.js";

describe("quantizeSteer", () => {
  it("maps full deflection to ±STEER_SCALE and clamps past it", () => {
    expect(quantizeSteer(1)).toBe(STEER_SCALE);
    expect(quantizeSteer(-1)).toBe(-STEER_SCALE);
    expect(quantizeSteer(7)).toBe(STEER_SCALE);
    expect(quantizeSteer(0.5)).toBe(STEER_SCALE / 2);
    expect(quantizeSteer(Number.NaN)).toBe(0);
  });
});

describe("createSteerRecorder", () => {
  it("run-length-encodes and returns exactly the value the server will replay", () => {
    const rec = createSteerRecorder();
    const stepped = [0.3, 0.3, 0.3, -1, -1, 0, 0.30001].map((v) => rec.push(v));
    expect(rec.log()).toEqual([[77, 3], [-256, 2], [0, 1], [77, 1]]);
    expect(rec.ticks()).toBe(7);
    // The server divides k by STEER_SCALE: the game must step with the same number.
    expect(stepped[0]).toBe(77 / STEER_SCALE);
    expect(totalTicks(rec.log())).toBe(7);
  });

  it("hands out copies, so a sent log cannot change under the sender", () => {
    const rec = createSteerRecorder();
    rec.push(1);
    const before = rec.log();
    rec.push(1);
    expect(before).toEqual([[256, 1]]);
  });
});

describe("checkInputs", () => {
  it("accepts a well-formed log and counts its ticks", () => {
    expect(checkInputs([[0, 10], [256, 5], [-256, 1]], 1000)).toEqual({ ok: true, log: [[0, 10], [256, 5], [-256, 1]], ticks: 16 });
  });

  it("refuses everything else", () => {
    const bad: unknown[] = [
      null, {}, "inputs", [],
      [[0]], [[0, 1, 2]], [["0", 1]], [[0.5, 1]], [[257, 1]], [[-257, 1]],
      [[0, 0]], [[0, -3]], [[0, 1.5]], [[0, "1"]],
    ];
    for (const raw of bad) expect(checkInputs(raw, 1000).ok, JSON.stringify(raw)).toBe(false);
  });

  it("caps the length of a run and the size of a log", () => {
    expect(checkInputs([[0, 600], [0, 401]], 1000).ok).toBe(false);
    expect(checkInputs([[0, 1000]], 1000).ok).toBe(true);
    const huge = Array.from({ length: MAX_LOG_ENTRIES + 1 }, () => [0, 1]);
    expect(checkInputs(huge, 1e9).ok).toBe(false);
  });
});
