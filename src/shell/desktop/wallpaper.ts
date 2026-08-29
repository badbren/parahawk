/**
 * Live wallpaper — concept C "The Core". Rendered on a full-desktop <canvas>
 * behind the icons. STUB: paints black and the reading; the real renderer
 * replaces this file (keep the exported API identical).
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

export function createWallpaper(canvas: HTMLCanvasElement, _opts: WallpaperOptions = {}): Wallpaper {
  const ctx = canvas.getContext("2d");
  let stats: WallpaperStats = {
    poolHashratePhs: 0, avg1dPhs: null, networkDifficulty: 0, potAgeBlocks: 0, potAgeHours: 0,
    potVerdict: "", btcPriceUsd: 0, phdBanked: 0, chainHeight: 0,
  };
  const draw = () => {
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, hgt);
    ctx.fillStyle = "#8a8a8a"; ctx.font = "14px Consolas, monospace"; ctx.textAlign = "center";
    ctx.fillText(`${stats.poolHashratePhs.toFixed(1)} PH/s — wallpaper stub`, w * 0.6, hgt * 0.5);
  };
  return {
    update(s) { stats = { ...stats, ...s }; draw(); },
    setDimmed() {}, pause() {}, resume() {}, blockFound() {},
    resize: draw,
    destroy() {},
  };
}
