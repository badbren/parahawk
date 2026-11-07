/**
 * The About page's revision. Bump it whenever what the page SAYS changes, and
 * the About icon on the desktop flashes "!" for everyone until they open it —
 * the same way a new release lights up the Changelog.
 *
 * Node-free on purpose: the desktop shell bundles this file.
 *
 * about-meta.test.ts fingerprints the page and checks it against
 * ABOUT_BODY_SHA256, so an About edit that forgets the bump fails the tests and
 * prints the new fingerprint. When it does: bump ABOUT_REVISION, then paste the
 * printed value into ABOUT_BODY_SHA256.
 */

/** The page's current revision (a date; add a suffix like "-2" for a second change on one day). */
export const ABOUT_REVISION = "2026-11-06-2";

/** sha256 of the About page body at ABOUT_REVISION, as computed by about-meta.test.ts. */
export const ABOUT_BODY_SHA256 = "ef0bd27f089d76bfb841a95a89833b25d8fa83ff87d7f908cdea95705ca44630";
