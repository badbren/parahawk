/**
 * The wallpaper's contract with the shell (main.ts). The one implementation is
 * the Hash Globe in wallpaper-horizon.ts. "The Core", the speedometer that
 * used to live in this file, was retired on 2026-11-06; it is in git history
 * (32a207c).
 */
export interface WallpaperStats {
  poolHashratePhs: number;
  avg1dPhs: number | null;
  networkDifficulty: number;
  potAgeBlocks: number;
  potAgeHours: number;
  potVerdict: string;
  btcPriceUsd: number;
  phdBanked: number;
  chainHeight: number;
  /** Blocks Parasite has found, all time (null = not known yet). */
  blocksFound?: number | null;
}

export interface Wallpaper {
  /** Partial update; readings ease to the new values. */
  update(stats: Partial<WallpaperStats>): void;
  /** Called by the shell when a window is open/focused: drop to ~40% intensity, smoothly. */
  setDimmed(dimmed: boolean): void;
  pause(): void;
  resume(): void;
  /** One-off celebration (≤3s), then back to idle. */
  blockFound(): void;
  /** Re-measure the canvas (the shell calls this on resize). */
  resize(): void;
  destroy(): void;
}

export interface WallpaperOptions {
  /** Left area to keep quiet, px (the icon column). Default 140. */
  quietLeftPx?: number;
  /** Bottom area to keep clear, px (the taskbar). Default 40. */
  quietBottomPx?: number;
  reducedMotion?: boolean;
}

export interface WallpaperDebug {
  debug(): { frameMs: number; gapMs: number; glyphs: number; level: number; scale: number; renderer: string };
}
