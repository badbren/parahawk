/**
 * What opening a desktop app does right now — desktop.ts asks this on every
 * open, whatever started it (icon, keyboard, start menu, deep link, another app).
 *
 *   open         open its window
 *   soon         greyed out for now (AppSpec.comingSoon): say so, open nothing
 *   unavailable  unknown, feature-flagged off, or gated (wallet / owner): nothing
 */
import type { AppSpec } from "./registry";

export type Launch = "open" | "soon" | "unavailable";

export function launchFor(app: AppSpec | undefined, available: (a: AppSpec) => boolean): Launch {
  if (!app || !available(app)) return "unavailable";
  return app.comingSoon ? "soon" : "open";
}
