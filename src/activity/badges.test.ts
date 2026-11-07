import { describe, expect, it } from "vitest";
import {
  EARLY_HAWK_BEFORE,
  PARAHAWK_BADGES,
  chipBadges,
  TRUSTED_MIN_DAYS,
  TRUSTED_MIN_SECONDS,
  evaluateBadges,
  isTrusted,
  type BadgeInput,
  type BadgeView,
} from "./badges.js";
import { countersOf } from "./rules.js";

const NOW = Date.UTC(2026, 10, 6, 12);
const input = (over: Partial<ReturnType<typeof countersOf>> = {}, rest: Partial<Omit<BadgeInput, "counters">> = {}): BadgeInput => ({
  counters: { ...countersOf(null), ...over },
  rentals: 0,
  firstSeen: null,
  now: NOW,
  ...rest,
});
const byId = (views: BadgeView[], id: string) => {
  const v = views.find((b) => b.id === id);
  if (!v) throw new Error(`no badge ${id}`);
  return v;
};

describe("the badge table", () => {
  it("has unique ids and something to say for each", () => {
    expect(new Set(PARAHAWK_BADGES.map((b) => b.id)).size).toBe(PARAHAWK_BADGES.length);
    for (const b of PARAHAWK_BADGES) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.howto.length).toBeGreaterThan(0);
      expect(b.need).toBeGreaterThan(0);
    }
  });

  it("includes the owner's asks: own-wallet search and hours on the site", () => {
    expect(PARAHAWK_BADGES.some((b) => b.metric === "selfSearches")).toBe(true);
    expect(PARAHAWK_BADGES.filter((b) => b.metric === "secondsOnSite").map((b) => b.need)).toEqual([3_600, 36_000, 180_000]);
  });
});

describe("evaluating", () => {
  it("a brand-new wallet has earned nothing", () => {
    const views = evaluateBadges(input());
    expect(views.filter((b) => b.earned)).toEqual([]);
    expect(byId(views, "looked-yourself-up").progress.label).toBe("not yet");
  });

  it("earns the one-step badges on the first event", () => {
    const views = evaluateBadges(input({ selfSearches: 1, chatMessages: 1, suggestions: 1 }, { rentals: 1 }));
    for (const id of ["looked-yourself-up", "first-words", "suggestion-box", "renter"]) expect(byId(views, id).earned).toBe(true);
    expect(byId(views, "chatterbox").earned).toBe(false);
    expect(byId(views, "chatterbox").progress).toEqual({ have: 1, need: 100, label: "1 / 100 messages" });
  });

  it("shows time progress in minutes under an hour, hours above", () => {
    const views = evaluateBadges(input({ secondsOnSite: 23 * 60 + 40 }));
    expect(byId(views, "hours-1").progress.label).toBe("23 / 60 min");
    expect(byId(views, "hours-10").progress.label).toBe("23 min / 10 h");
    const later = evaluateBadges(input({ secondsOnSite: 3.27 * 3_600 }));
    expect(byId(later, "hours-1").earned).toBe(true);
    expect(byId(later, "hours-10").progress.label).toBe("3.2 / 10 h");
    expect(byId(later, "hours-50").progress.label).toBe("3.2 / 50 h");
  });

  it("days and wallet lookups count up to their thresholds", () => {
    const views = evaluateBadges(input({ activeDays: 7, walletSearches: 4 }));
    expect(byId(views, "days-3").earned).toBe(true);
    expect(byId(views, "days-7").earned).toBe(true);
    expect(byId(views, "days-30").progress.label).toBe("7 / 30 days");
    expect(byId(views, "wallet-watcher").progress.label).toBe("4 / 10 wallets");
  });

  it("caps progress at the threshold", () => {
    expect(byId(evaluateBadges(input({ chatMessages: 250 })), "chatterbox").progress).toMatchObject({ have: 100, need: 100 });
  });

  it("Early Hawk goes to wallets first seen before the cutoff, and closes after it", () => {
    expect(byId(evaluateBadges(input({}, { firstSeen: EARLY_HAWK_BEFORE - 1 })), "early-hawk").earned).toBe(true);
    expect(byId(evaluateBadges(input({}, { firstSeen: EARLY_HAWK_BEFORE })), "early-hawk").earned).toBe(false);
    expect(byId(evaluateBadges(input({}, { firstSeen: null })), "early-hawk").progress.label).toMatch(/^before /);
    expect(byId(evaluateBadges(input({}, { firstSeen: null, now: EARLY_HAWK_BEFORE + 1 })), "early-hawk").progress.label).toBe("closed");
  });
});

describe("Trusted", () => {
  it("needs the hours AND the days", () => {
    expect(TRUSTED_MIN_SECONDS).toBe(10 * 3_600);
    expect(TRUSTED_MIN_DAYS).toBe(14);
    expect(isTrusted({ secondsOnSite: TRUSTED_MIN_SECONDS, activeDays: TRUSTED_MIN_DAYS })).toBe(true);
    expect(isTrusted({ secondsOnSite: 500 * 3_600, activeDays: TRUSTED_MIN_DAYS - 1 })).toBe(false); // a tab left open all week
    expect(isTrusted({ secondsOnSite: TRUSTED_MIN_SECONDS - 1, activeDays: 60 })).toBe(false);
  });

  it("says its perk plainly, and shows both bars until earned", () => {
    const locked = byId(evaluateBadges(input({ secondsOnSite: 5 * 3_600, activeDays: 3 })), "trusted");
    expect(locked.earned).toBe(false);
    expect(locked.desc).toBe("Lets you update Kiss My Hash's price on the Marketplace when it's out of date.");
    expect(locked.parts?.map((p) => p.label)).toEqual(["5.0 / 10 h", "3 / 14 days"]);
    // The overall bar follows the part furthest behind (days: 3/14 < hours: 5/10).
    expect(locked.progress).toMatchObject({ have: 3, need: 14 });
    expect(locked.progress.label).toBe("5.0 / 10 h · 3 / 14 days");

    const halfway = byId(evaluateBadges(input({ secondsOnSite: 20 * 3_600, activeDays: 9 })), "trusted");
    expect(halfway.parts?.map((p) => p.label)).toEqual(["10 h ✓", "9 / 14 days"]);

    const earned = byId(evaluateBadges(input({ secondsOnSite: 11 * 3_600, activeDays: 15 })), "trusted");
    expect(earned.earned).toBe(true);
    expect(earned.perk).toBe("You can update hand-typed prices");
    expect(earned.progress.label).toBe("earned");
  });
});

describe("the owner", () => {
  it("holds every badge, whatever the counters say", () => {
    const views = evaluateBadges(input({}, { owner: true }));
    expect(views.length).toBe(PARAHAWK_BADGES.length);
    for (const v of views) {
      expect(v.earned).toBe(true);
      expect(v.progress.label).toBe("earned");
    }
    expect(byId(views, "trusted").perk).toBe("You can update hand-typed prices");
  });

  it("only the owner: the same blank counters earn nothing for anyone else", () => {
    expect(evaluateBadges(input()).filter((b) => b.earned)).toEqual([]);
  });
});

describe("chipBadges", () => {
  it("keeps the top tier of each ladder and ranks them by CHIP_ORDER", () => {
    const views = evaluateBadges(input({ secondsOnSite: 60 * 3_600, activeDays: 4, chatMessages: 150, walletSearches: 10 }));
    expect(chipBadges(views).map((b) => b.id)).toEqual(["hours-50", "chatterbox", "wallet-watcher", "days-3"]);
  });

  it("skips anything not earned", () => {
    expect(chipBadges(evaluateBadges(input()))).toEqual([]);
  });
});
