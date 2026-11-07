import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../session/store";
import type { IconBadge } from "../desktop/icon-badges";
import { ABOUT_SEEN_KEY, createAboutBadge, isAboutPath } from "./about-badge";
import { UPDATED_BADGE } from "./seen-badge";

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

function fakeNav() {
  const fns = new Set<(path: string) => void>();
  return {
    go: (path: string) => { for (const fn of [...fns]) fn(path); },
    onNavigate: (fn: (path: string) => void) => { fns.add(fn); return () => { fns.delete(fn); }; },
  };
}

describe("isAboutPath", () => {
  it("matches the About page however a link spells it, and nothing else", () => {
    for (const p of ["/about", "/about?x=1", "/about#math", "/about/more"]) expect(isAboutPath(p)).toBe(true);
    for (const p of ["/", "/aboutx", "/changelog", "/u/about"]) expect(isAboutPath(p)).toBe(false);
  });
});

describe("the About icon's '!'", () => {
  it("shows on the site About icon for a first-time visitor and clears when About opens", () => {
    const store = createMemoryStore();
    const badges = fakeBadges();
    createAboutBadge(store, { latest: "2026-11-06", badges });
    expect(badges.shown.get("site-about")).toEqual(UPDATED_BADGE);

    // "about" is the Whitepaper's id — opening it must not count as reading About.
    badges.open("about");
    expect(badges.shown.has("site-about")).toBe(true);

    badges.open("site-about");
    expect(badges.shown.has("site-about")).toBe(false);
    expect(store.get(ABOUT_SEEN_KEY)).toBe("2026-11-06");
  });

  it("stays away once this revision was seen, and comes back for the next one", () => {
    const store = createMemoryStore();
    store.set(ABOUT_SEEN_KEY, "2026-11-06");
    const quiet = fakeBadges();
    createAboutBadge(store, { latest: "2026-11-06", badges: quiet });
    expect(quiet.shown.has("site-about")).toBe(false);

    const next = fakeBadges();
    createAboutBadge(store, { latest: "2026-11-20", badges: next });
    expect(next.shown.get("site-about")).toEqual(UPDATED_BADGE);
  });

  it("clears when any window shows /about, not for other pages", () => {
    const store = createMemoryStore();
    const badges = fakeBadges();
    const nav = fakeNav();
    createAboutBadge(store, { latest: "r2", badges, onNavigate: nav.onNavigate });
    nav.go("/aboutx");
    nav.go("/changelog");
    expect(badges.shown.has("site-about")).toBe(true);
    nav.go("/about#math");
    expect(badges.shown.has("site-about")).toBe(false);
    expect(store.get(ABOUT_SEEN_KEY)).toBe("r2");
  });

  it("keeps the About and Changelog marks apart", () => {
    const store = createMemoryStore();
    store.set("changelog.seen", "2026-11-06");
    const badges = fakeBadges();
    createAboutBadge(store, { latest: "2026-11-06", badges });
    expect(badges.shown.has("site-about")).toBe(true);
  });
});
