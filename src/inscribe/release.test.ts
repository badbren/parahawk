import { describe, expect, it } from "vitest";
import { TEST_INSCRIPTIONS_BEFORE_RELEASE, mayInscribe } from "./release.js";

describe("the release gate", () => {
  it("lets only the owner through while it's closed", () => {
    expect(mayInscribe(true, false)).toBe(true);
    expect(mayInscribe(false, false)).toBe(false);
  });

  it("lets everyone through once it's open", () => {
    expect(mayInscribe(true, true)).toBe(true);
    expect(mayInscribe(false, true)).toBe(true);
  });

  it("names a real number of test inscriptions", () => {
    expect(Number.isInteger(TEST_INSCRIPTIONS_BEFORE_RELEASE)).toBe(true);
    expect(TEST_INSCRIPTIONS_BEFORE_RELEASE).toBeGreaterThan(0);
  });
});
