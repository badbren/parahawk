import { afterEach, describe, expect, it } from "vitest";
import { createMemoryStore, type KeyValueStore } from "../session/store";
import { iconBadges, type IconBadge } from "../desktop/icon-badges";
import { LATEST_RELEASE } from "../../web/changelog-data";
import { SEEN_KEY, UPDATED_BADGE, createChangelogBadge, isChangelogPath } from "./changelog-badge";

/** A stand-in for icon-badges that records what was set and lets the test "open" apps. */
function fakeBadges() {
  const shown = new Map<string, IconBadge>();
  const opened = new Set<(id: string) => void>();
  return {
    shown,
    open: (id: string) => { for (const fn of [...opened]) fn(id); },
    set(id: string, badge: IconBadge | null) { if (badge) shown.set(id, badge); else shown.delete(id); },
    onOpened(fn: (id: string) => void) { opened.add(fn); return () => { opened.delete(fn); }; },
  };
}

/** Site-window navigation the test can drive. */
function fakeNav() {
  const fns = new Set<(path: string) => void>();
  return {
    go: (path: string) => { for (const fn of [...fns]) fn(path); },
    onNavigate: (fn: (path: string) => void) => { fns.add(fn); return () => { fns.delete(fn); }; },
  };
}

describe("isChangelogPath", () => {
  it("matches the Changelog page however the link spells it", () => {
    expect(isChangelogPath("/changelog")).toBe(true);
    expect(isChangelogPath("/changelog?from=footer")).toBe(true);
    expect(isChangelogPath("/changelog#v1.3")).toBe(true);
    expect(isChangelogPath("/changelog/1.3")).toBe(true);
  });

  it("leaves every other page alone", () => {
    expect(isChangelogPath("/")).toBe(false);
    expect(isChangelogPath("/changelogs")).toBe(false);
    expect(isChangelogPath("/about?changelog")).toBe(false);
  });
});

describe("the Changelog icon's '!'", () => {
  it("shows for a first-time visitor and clears when the Changelog opens", () => {
    const store = createMemoryStore();
    const badges = fakeBadges();
    createChangelogBadge(store, { latest: "1.4", badges });
    expect(badges.shown.get("changelog")).toEqual(UPDATED_BADGE);
    expect(UPDATED_BADGE).toMatchObject({ text: "!", pulse: true });

    badges.open("changelog");
    expect(badges.shown.has("changelog")).toBe(false);
    expect(store.get(SEEN_KEY)).toBe("1.4");
  });

  it("stays away once this version has been seen, and comes back for the next one", () => {
    const store = createMemoryStore();
    store.set(SEEN_KEY, "1.4");
    const quiet = fakeBadges();
    createChangelogBadge(store, { latest: "1.4", badges: quiet });
    expect(quiet.shown.has("changelog")).toBe(false);

    const next = fakeBadges();
    createChangelogBadge(store, { latest: "1.5", badges: next });
    expect(next.shown.get("changelog")).toEqual(UPDATED_BADGE);
  });

  it("treats a hand-edited or garbage stored value as unseen", () => {
    for (const junk of [3, { v: "1.4" }, "", "1.4 "]) {
      const store = createMemoryStore();
      store.set(SEEN_KEY, junk);
      const badges = fakeBadges();
      createChangelogBadge(store, { latest: "1.4", badges });
      expect(badges.shown.has("changelog")).toBe(true);
    }
  });

  it("ignores other apps opening", () => {
    const badges = fakeBadges();
    createChangelogBadge(createMemoryStore(), { latest: "1.4", badges });
    badges.open("chat");
    badges.open("parahawk");
    expect(badges.shown.has("changelog")).toBe(true);
  });

  it("clears when any window navigates to /changelog (e.g. the footer link inside Parahawk)", () => {
    const store = createMemoryStore();
    const badges = fakeBadges();
    const nav = fakeNav();
    createChangelogBadge(store, { latest: "1.4", badges, onNavigate: nav.onNavigate });
    nav.go("/history");
    expect(badges.shown.has("changelog")).toBe(true);
    nav.go("/changelog?x=1");
    expect(badges.shown.has("changelog")).toBe(false);
    expect(store.get(SEEN_KEY)).toBe("1.4");
  });

  it("stops listening once stopped", () => {
    const store = createMemoryStore();
    const badges = fakeBadges();
    const nav = fakeNav();
    const stop = createChangelogBadge(store, { latest: "1.4", badges, onNavigate: nav.onNavigate });
    stop();
    badges.open("changelog");
    nav.go("/changelog");
    expect(store.get(SEEN_KEY)).toBeNull();
    expect(badges.shown.has("changelog")).toBe(true);
  });

  it("survives blocked storage: shows the '!', and still clears it on open", () => {
    const broken: KeyValueStore = {
      get: () => { throw new Error("blocked"); },
      set: () => { throw new Error("blocked"); },
      remove: () => { throw new Error("blocked"); },
    };
    const badges = fakeBadges();
    createChangelogBadge(broken, { latest: "1.4", badges });
    expect(badges.shown.has("changelog")).toBe(true);
    expect(() => badges.open("changelog")).not.toThrow();
    expect(badges.shown.has("changelog")).toBe(false);
  });

  it("drives the real desktop badge registry", () => {
    const store = createMemoryStore();
    const stop = createChangelogBadge(store, { latest: LATEST_RELEASE.version, badges: iconBadges });
    try {
      expect(iconBadges.get("changelog")).toEqual(UPDATED_BADGE);
      iconBadges.notifyOpened("changelog");
      expect(iconBadges.get("changelog")).toBeNull();
      expect(store.get(SEEN_KEY)).toBe(LATEST_RELEASE.version);
    } finally {
      stop();
      iconBadges.set("changelog", null);
    }
  });
});

afterEach(() => {
  iconBadges.set("changelog", null);
});
