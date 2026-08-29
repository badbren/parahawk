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
  const reducedMotion = prefersReducedMotion();
  let mode: WmMode = isMobileViewport() ? "mobile" : "desktop";
  const store = createLocalStore();

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
  const wallpaper = createWallpaper(canvas, { reducedMotion, quietBottomPx: 0 });
  const tick = createTickFeed({ url: rootEl.dataset.tick || "/api/tick" });
  const wm = createWindowManager({ root: windowsRoot, storage: store, mode });
  const desktop = createDesktop({ iconsRoot, taskbarRoot: taskbar, wm, apps: APPS, store, tick, mode });

  tick.subscribe((t, meta) => {
    wallpaper.update({
      poolHashratePhs: t.hashratePhs, avg1dPhs: t.avg1dPhs, networkDifficulty: t.difficulty,
      potAgeBlocks: t.potBlocks, potAgeHours: t.potHours, potVerdict: t.potVerdict,
      btcPriceUsd: t.btcUsd, phdBanked: t.phdBanked, chainHeight: t.height,
    });
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
      ignoreReducedMotion: forceBoot,
      onComplete: () => {
        try { sessionStorage.setItem(BOOTED_KEY, "1"); } catch { /* ignore */ }
        reveal();
      },
    });
  } else {
    reveal();
  }

  // Debug handle.
  (window as unknown as { ph: unknown }).ph = { wm, desktop, wallpaper, tick, apps: APPS };
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
else main();
