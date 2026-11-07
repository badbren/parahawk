/**
 * The Changelog icon's flashing "!": shown while this browser hasn't opened the
 * Changelog since the latest release, cleared the moment it does.
 *
 * "Latest" is LATEST_RELEASE from the changelog data (web/changelog-data.ts),
 * bundled into the shell, so a release that adds an entry brings the "!" back for
 * everyone on its own. The version this browser last saw is kept in the store.
 * First-time visitors see the "!" too: they haven't seen it either.
 *
 * Seen means either of: the Changelog window opened (icon, start menu, deep
 * link — desktop.ts reports every open), or any site window navigated to
 * /changelog (the footer link inside the Parahawk window, say). The mechanics
 * are shared with About's "!" (seen-badge.ts).
 */
import { LATEST_RELEASE } from "../../web/changelog-data";
import { iconBadges } from "../desktop/icon-badges";
import type { KeyValueStore } from "../session/store";
import { createSeenBadge, frameNavigations, pagePath } from "./seen-badge";

export { UPDATED_BADGE } from "./seen-badge";

const APP_ID = "changelog";

/** Store key: the release version this browser last opened the Changelog for. */
export const SEEN_KEY = "changelog.seen";

/** True for the Changelog page, however it is spelled: /changelog, /changelog?x, /changelog#top. */
export const isChangelogPath = pagePath("/changelog");

export interface ChangelogBadgeDeps {
  /** The version that counts as new (LATEST_RELEASE.version). */
  latest: string;
  badges: Pick<typeof iconBadges, "set" | "onOpened">;
  /** Reports the path of every page a site window shows. Returns an unsubscribe. */
  onNavigate?: (fn: (path: string) => void) => () => void;
}

/** The badge's logic, with its inputs passed in (tests). watchChangelog wires the real ones. */
export function createChangelogBadge(store: KeyValueStore, deps: ChangelogBadgeDeps): () => void {
  return createSeenBadge(store, {
    appId: APP_ID,
    seenKey: SEEN_KEY,
    latest: deps.latest,
    isPage: isChangelogPath,
    badges: deps.badges,
    ...(deps.onNavigate ? { onNavigate: deps.onNavigate } : {}),
  });
}

/** Started once from main.ts. Returns a stop function. */
export function watchChangelog(store: KeyValueStore): () => void {
  return createChangelogBadge(store, { latest: LATEST_RELEASE.version, badges: iconBadges, onNavigate: frameNavigations });
}
