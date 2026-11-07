import { describe, expect, it } from "vitest";
import { LATEST_RELEASE, RELEASES } from "./changelog-data.js";

// The Changelog icon's "!" fires when LATEST_RELEASE changes, so a release that
// adds an entry but forgets to move `current: true` would never flag. These
// hold the shape the badge depends on.
describe("changelog data", () => {
  it("has exactly one current release, and it is the newest (first)", () => {
    const current = RELEASES.filter((r) => r.current);
    expect(current).toHaveLength(1);
    expect(RELEASES[0]?.current).toBe(true);
    expect(LATEST_RELEASE).toBe(RELEASES[0]);
  });

  it("lists releases newest first, each with a unique version and a real date", () => {
    expect(new Set(RELEASES.map((r) => r.version)).size).toBe(RELEASES.length);
    for (const r of RELEASES) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.summary.length).toBeGreaterThan(0);
      expect(r.changes.length).toBeGreaterThan(0);
    }
    const dates = RELEASES.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
