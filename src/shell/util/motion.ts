/**
 * The desktop's motion preference, shared by everything that animates.
 *
 * "on" is the default (the owner wants the motion for everyone); "off" holds
 * everything still; "auto" follows the OS prefers-reduced-motion setting
 * (Windows "Show animations" off → static). The desktop menu cycles it and
 * ?motion= sets it from a link (main.ts). Persisted per browser via the store.
 */
import { createLocalStore, type KeyValueStore } from "../session/store";
import { prefersReducedMotion } from "./dom";

export const MOTION_KEY = "desktop.motion";

export type MotionPref = "auto" | "on" | "off";

export function readMotionPref(store: KeyValueStore = createLocalStore()): MotionPref {
  const v = store.get<string>(MOTION_KEY);
  return v === "auto" || v === "off" ? v : "on";
}

/** Whether a preference means "hold still", given what the OS asks for. */
export const isMotionReduced = (pref: MotionPref, osReduced: boolean = prefersReducedMotion()): boolean =>
  pref === "on" ? false : pref === "off" ? true : osReduced;

/** Read fresh each call, so a change made in the desktop menu applies to the next picture drawn. */
export const motionReduced = (): boolean => isMotionReduced(readMotionPref());
