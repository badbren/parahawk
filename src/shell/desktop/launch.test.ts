import { describe, expect, it } from "vitest";
import { APPS, getApp, type AppSpec } from "./registry.js";
import { launchFor } from "./launch.js";

const everyone = () => true;

describe("launchFor — the coming-soon guard every open goes through", () => {
  it("refuses the BTC Hunters apps for now, whoever asks", () => {
    for (const id of ["collection", "burn", "game"]) {
      expect(launchFor(getApp(id), everyone)).toBe("soon");
    }
  });

  it("opens everything else that's available", () => {
    for (const id of ["parahawk", "changelog", "site-about", "chat", "inscribe", "suggestions", "community"]) {
      expect(launchFor(getApp(id), everyone)).toBe("open");
    }
  });

  it("greys out exactly the NFT apps: Collection, Burn, Block Hunt and the Whitepaper", () => {
    expect(APPS.filter((a) => a.comingSoon).map((a) => a.id).sort()).toEqual(["about", "burn", "collection", "game"]);
  });

  it("gates and unknown ids stay closed, coming soon or not", () => {
    expect(launchFor(undefined, everyone)).toBe("unavailable");
    const soon = getApp("game") as AppSpec;
    expect(launchFor(soon, () => false)).toBe("unavailable");
    expect(launchFor(getApp("parahawk"), () => false)).toBe("unavailable");
  });
});
