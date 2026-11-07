/**
 * The About icon's flashing "!": shown while this browser hasn't opened About
 * since its latest revision (ABOUT_REVISION in web/about-meta.ts), cleared the
 * moment it does — the About window opening, or any site window showing /about.
 * Same mechanics as the Changelog's "!" (seen-badge.ts).
 */
import { ABOUT_REVISION } from "../../web/about-meta";
import { iconBadges } from "../desktop/icon-badges";
import type { KeyValueStore } from "../session/store";
import { createSeenBadge, frameNavigations, pagePath } from "./seen-badge";

/** The site About page's desktop app (registry.ts) — not "about", which is the Whitepaper. */
const APP_ID = "site-about";

/** Store key: the About revision this browser last opened. */
export const ABOUT_SEEN_KEY = "about.seen";

export const isAboutPath = pagePath("/about");

export interface AboutBadgeDeps {
  /** The revision that counts as new (ABOUT_REVISION). */
  latest: string;
  badges: Pick<typeof iconBadges, "set" | "onOpened">;
  onNavigate?: (fn: (path: string) => void) => () => void;
}

/** The badge's logic, with its inputs passed in (tests). watchAbout wires the real ones. */
export function createAboutBadge(store: KeyValueStore, deps: AboutBadgeDeps): () => void {
  return createSeenBadge(store, {
    appId: APP_ID,
    seenKey: ABOUT_SEEN_KEY,
    latest: deps.latest,
    isPage: isAboutPath,
    badges: deps.badges,
    ...(deps.onNavigate ? { onNavigate: deps.onNavigate } : {}),
  });
}

/** Started once from main.ts. Returns a stop function. */
export function watchAbout(store: KeyValueStore): () => void {
  return createAboutBadge(store, { latest: ABOUT_REVISION, badges: iconBadges, onNavigate: frameNavigations });
}
