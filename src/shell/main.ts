/**
 * Shell entry. Builds the desktop DOM inside #ph-root, wires the window
 * manager, desktop, wallpaper, live tick, boot cinematic and deep links.
 *
 * Server contract (src/web/desktop-page.ts):
 *   <div id="ph-root" data-open="/history" data-boot="full|skip"></div>
 *   data-open: path to open Parahawk on (absent/empty = nothing open)
 *   data-boot: "full" on a plain visit to /, "skip" on deep links
 *   data-tick: (dev harness only) override the tick endpoint URL
 */
import "./shell.css";
import { createWindowManager } from "./wm/window-manager";
import { createDesktop } from "./desktop/desktop";
import { APPS } from "./desktop/registry";
import { createWallpaper } from "./desktop/wallpaper";
import { createTickFeed } from "./data/tick";
import { createLocalStore } from "./session/store";
import { playBoot } from "./boot/boot";
import { h, isMobileViewport, prefersReducedMotion } from "./util/dom";
import type { WmMode } from "./wm/types";

const BOOTED_KEY = "ph.booted";
const CLASSIC_KEY = "ph.classic";
const MOTION_KEY = "desktop.motion";

/**
 * Wallpaper/intro motion preference. "auto" follows the OS
 * prefers-reduced-motion setting (Windows "Show animations" off → static);
 * "on" / "off" override it. Persisted per browser via the store.
 */
type MotionPref = "auto" | "on" | "off";
const MOTION_CYCLE: Record<MotionPref, MotionPref> = { auto: "on", on: "off", off: "auto" };

/**
 * Classic-site opt-out. The plain pages set/clear localStorage["ph.classic"]
 * when they see ?classic=1 / ?classic=0 (see layout.ts). If it's set, this
 * top-level visit should be the plain site: bounce to the same URL with
 * ?classic=1 (the server's desktop gate lets that through). Cache-safe: the
 * CDN never has to know about the preference.
 */
/** data-open comes from the request URL. The server sanitizes it; this is defence in depth. */
function sameOriginPath(raw: string | undefined): string | null {
  if (!raw || raw[0] !== "/" || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  try {
    const u = new URL(raw, location.origin);
    if (u.origin !== location.origin) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

function classicRedirect(): boolean {
  try {
    if (localStorage.getItem(CLASSIC_KEY) !== "1") return false;
  } catch {
    return false;
  }
  const u = new URL(location.href);
  u.searchParams.set("classic", "1");
  location.replace(u.pathname + u.search + u.hash);
  return true;
}

function main(): void {
  const rootEl = document.getElementById("ph-root");
  if (!rootEl) return;
  if (classicRedirect()) return;
  document.body.classList.add("ph-body");

  const openPath = sameOriginPath(rootEl.dataset.open);
  const bootMode = rootEl.dataset.boot === "full" ? "full" : "skip";
  const osReducedMotion = prefersReducedMotion();
  let mode: WmMode = isMobileViewport() ? "mobile" : "desktop";
  const store = createLocalStore();
  const readMotion = (): MotionPref => {
    const v = store.get<string>(MOTION_KEY);
    return v === "on" || v === "off" ? v : "auto";
  };
  const effectiveReduced = (pref: MotionPref): boolean => (pref === "on" ? false : pref === "off" ? true : osReducedMotion);
  let motion = readMotion();
  const reducedMotion = effectiveReduced(motion);

  // ── DOM ──────────────────────────────────────────────────────────────────
  const canvas = h("canvas", { class: "ph-wallpaper", "aria-hidden": "true" });
  const iconsRoot = h("div", { class: "ph-icons", role: "group", "aria-label": "Desktop" });
  const windowsRoot = h("div", { class: "ph-windows" });
  // desktop.ts attaches empty-desktop click/context-menu handling to iconsRoot.parentElement
  // (this element), because .ph-icons itself is pointer-events:none so windows/icons stay clickable.
  const desktopArea = h("div", { class: "ph-desktop" }, iconsRoot, windowsRoot);
  const taskbar = h("div", { class: "ph-taskbar", role: "toolbar", "aria-label": "Taskbar" });
  rootEl.replaceChildren(canvas, desktopArea, taskbar);

  // ── Modules ──────────────────────────────────────────────────────────────
  let wallpaper = createWallpaper(canvas, { reducedMotion, quietBottomPx: 0 });
  const applyTick = (t: import("./data/tick").Tick) =>
    wallpaper.update({
      poolHashratePhs: t.hashratePhs, avg1dPhs: t.avg1dPhs, networkDifficulty: t.difficulty,
      potAgeBlocks: t.potBlocks, potAgeHours: t.potHours, potVerdict: t.potVerdict,
      btcPriceUsd: t.btcUsd, phdBanked: t.phdBanked, chainHeight: t.height,
    });
  /** Swap the wallpaper for one with the new motion setting, keeping data and dim state. */
  const setMotion = (pref: MotionPref) => {
    motion = pref;
    store.set(MOTION_KEY, pref);
    wallpaper.destroy();
    wallpaper = createWallpaper(canvas, { reducedMotion: effectiveReduced(pref), quietBottomPx: 0 });
    wallpaper.resize();
    const last = tick.latest();
    if (last) applyTick(last);
    wallpaper.setDimmed(wm.list().some((w) => !w.minimized));
    wallpaper.resume();
  };
  const motionLabel = (): string => {
    const state = effectiveReduced(motion) ? "static" : "animated";
    const pref = motion === "auto" ? "Auto" : motion === "on" ? "On" : "Off";
    return `Wallpaper motion: ${pref} · ${state}`;
  };
  const tick = createTickFeed({ url: rootEl.dataset.tick || "/api/tick" });
  const wm = createWindowManager({ root: windowsRoot, storage: store, mode });
  const desktop = createDesktop({
    iconsRoot, taskbarRoot: taskbar, wm, apps: APPS, store, tick, mode,
    extraMenuItems: () => [{ label: motionLabel(), onSelect: () => setMotion(MOTION_CYCLE[motion]) }],
  });

  tick.subscribe((t, meta) => {
    applyTick(t);
    if (meta.blockFound) wallpaper.blockFound();
  });

  // Dim the wallpaper whenever any window is visible; mirror the Parahawk window's path into the URL bar.
  wm.on((e) => {
    const anyVisible = wm.list().some((w) => !w.minimized);
    wallpaper.setDimmed(anyVisible);
    if (e.type === "navigate" && e.id === "parahawk") {
      history.replaceState(null, "", e.path);
    } else if (e.type === "close" && e.id === "parahawk") {
      history.replaceState(null, "", "/");
    }
  });

  // ── Responsive mode ──────────────────────────────────────────────────────
  const mq = matchMedia("(max-width: 767px)");
  mq.addEventListener("change", () => {
    mode = mq.matches ? "mobile" : "desktop";
    wm.setMode(mode);
    desktop.setMode(mode);
  });
  window.addEventListener("resize", () => wallpaper.resize());
  wallpaper.resize();

  // ── Boot, then reveal ────────────────────────────────────────────────────
  // Start polling before the cinematic so the dial shows real numbers the moment the desktop appears.
  tick.start();

  const reveal = () => {
    rootEl.removeAttribute("data-booting");
    wallpaper.resume();
    if (openPath) desktop.openApp("parahawk", openPath);
  };

  let seenBoot = false;
  try { seenBoot = sessionStorage.getItem(BOOTED_KEY) === "1"; } catch { /* ignore */ }
  // ?boot=1 replays the intro regardless of session/reduced-motion (QA aid + shareable).
  let forceBoot = false;
  try { forceBoot = new URLSearchParams(location.search).get("boot") === "1"; } catch { /* ignore */ }
  const wantBoot = forceBoot || (bootMode === "full" && !seenBoot && !reducedMotion);
  if (wantBoot) {
    rootEl.setAttribute("data-booting", "1");
    const bootEl = h("div", { class: "ph-boot" });
    document.body.append(bootEl);
    wallpaper.pause();
    playBoot(bootEl, {
      // Brief §7: phones and slow connections get the 3-second cut.
      short: mode === "mobile" || (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true,
      // wantBoot already accounts for the OS setting and the user's motion preference.
      ignoreReducedMotion: true,
      onComplete: () => {
        try { sessionStorage.setItem(BOOTED_KEY, "1"); } catch { /* ignore */ }
        reveal();
      },
    });
  } else {
    reveal();
  }

  // ?perf=1 — on-screen frame-time readout for diagnosing "it lags" reports.
  let perfOn = false;
  try { perfOn = new URLSearchParams(location.search).get("perf") === "1"; } catch { /* ignore */ }
  if (perfOn) {
    const box = h("pre", { class: "ph-perf", "aria-hidden": "true" });
    document.body.append(box);
    const samples: number[] = [];
    let last = performance.now();
    const sample = (now: number) => {
      samples.push(now - last); last = now;
      if (samples.length > 120) samples.shift();
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    setInterval(() => {
      if (samples.length < 10) return;
      const s = [...samples].sort((x, y) => x - y);
      const avg = samples.reduce((x, y) => x + y, 0) / samples.length;
      const d = wallpaper.debug();
      const lines = [
        `fps ${(1000 / avg).toFixed(0)}  avg ${avg.toFixed(1)}ms  p95 ${s[Math.floor(s.length * 0.95)]!.toFixed(1)}ms  worst ${s[s.length - 1]!.toFixed(0)}ms`,
        `wallpaper js ${d.frameMs.toFixed(2)}ms  pacing ${d.gapMs}ms  glyphs ${d.glyphs}  level ${d.level}  scale ${d.scale}  motion ${motion}`,
        `dpr ${devicePixelRatio}  canvas ${canvas.width}x${canvas.height}  reduced-motion(os) ${osReducedMotion}`,
        `renderer ${d.renderer}`,
      ];
      box.textContent = lines.join(String.fromCharCode(10));
    }, 1000);
  }

  // Debug handle.
  (window as unknown as { ph: unknown }).ph = { wm, desktop, get wallpaper() { return wallpaper; }, tick, apps: APPS, setMotion, getMotion: () => motion };
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
else main();
