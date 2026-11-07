import { describe, expect, it } from "vitest";
import { APPS, appForPath } from "./registry.js";

describe("appForPath", () => {
  it("opens a section's own window for its paths and anything under them", () => {
    expect(appForPath("/changelog")).toBe("changelog");
    expect(appForPath("/inscribe?x=1")).toBe("inscribe");
    expect(appForPath("/about#team")).toBe("site-about");
    expect(appForPath("/community")).toBe("community");
    expect(appForPath("/u/bc1qexample")).toBe("user");
  });

  it("keeps the pool's own sections inside the Parahawk window", () => {
    for (const p of ["/history#top", "/potmath", "/marketplace", "/board", "/badges/miner?x=1", "/account"]) {
      expect(appForPath(p)).toBe("parahawk");
    }
  });

  it("leaves everything else to the Parahawk window", () => {
    expect(appForPath("/")).toBe("parahawk");
    expect(appForPath("/historyish")).toBe("parahawk");
    expect(appForPath("/nowhere")).toBe("parahawk");
  });

  it("every app id is unique", () => {
    expect(new Set(APPS.map((a) => a.id)).size).toBe(APPS.length);
  });
});
