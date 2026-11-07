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
import { largeAreaBeside } from "./desktop/large-area";
import { createDesktop } from "./desktop/desktop";
import { APPS } from "./desktop/registry";
import { createHorizonWallpaper } from "./desktop/wallpaper-horizon";
import { createTickFeed } from "./data/tick";
import { createLocalStore } from "./session/store";
import { createWalletSession } from "./session/wallet";
import { createPracticeLedger } from "./session/ledger";
import { createServerSession } from "./session/me";
import { createProfileSession } from "./session/profile";
import { startActivityTracker } from "./session/activity";
import { watchChatUnread } from "./apps/chat";
import { watchSuggestionsInbox } from "./apps/suggestions";
import { watchChangelog } from "./apps/changelog-badge";
import { watchAbout } from "./apps/about-badge";
import { playBoot } from "./boot/boot";
import { h, isMobileViewport, prefersReducedMotion } from "./util/dom";
import { MOTION_KEY, isMotionReduced, readMotionPref, type MotionPref } from "./util/motion";
import type { WmMode } from "./wm/types";
// Last, so its orange text and icon labels win over every stylesheet above (theme.css).
import "./theme.css";

const BOOTED_KEY = "ph.booted";
const CLASSIC_KEY = "ph.classic";

/** Wallpaper/intro motion preference (util/motion.ts); the desktop menu cycles it. */
const MOTION_CYCLE: Record<MotionPref, MotionPref> = { auto: "on", on: "off", off: "auto" };

/**
 * The classic view is switched off for now (owner's call, 2026-10-22): every
 * visit is the desktop. It used to be a sticky per-browser choice, and with no
 * way back from the plain site it trapped people there. Browsers that still
 * carry the old flag get it cleared here, so they come back to the desktop.
 */
function clearClassicFlag(): void {
  try { localStorage.removeItem(CLASSIC_KEY); } catch { /* storage blocked: nothing to clear */ }
}

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

function main(): void {
  const rootEl = document.getElementById("ph-root");
  if (!rootEl) return;
  clearClassicFlag();
  document.body.classList.add("ph-body");

  const openPath = sameOriginPath(rootEl.dataset.open);
  const bootMode = rootEl.dataset.boot === "full" ? "full" : "skip";
  const osReducedMotion = prefersReducedMotion();
  let mode: WmMode = isMobileViewport() ? "mobile" : "desktop";
  const store = createLocalStore();
  // Default is "on": the owner wants the motion for everyone. "auto" (follow the
  // OS reduced-motion setting) and "off" are one click away in the desktop menu.
  const readMotion = (): MotionPref => readMotionPref(store);
  const effectiveReduced = (pref: MotionPref): boolean => isMotionReduced(pref, osReducedMotion);
  // ?motion=on|off|auto sets the preference from a link (demo / support).
  try {
    const q = new URLSearchParams(location.search).get("motion");
    if (q === "on" || q === "off" || q === "auto") store.set(MOTION_KEY, q);
  } catch { /* ignore */ }
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
  // The Hash Globe (desktop/wallpaper-horizon.ts), the owner's pick on 2026-11-06.
  const makeWallpaper = (reduced: boolean) => createHorizonWallpaper(canvas, { reducedMotion: reduced, quietBottomPx: 0 });
  let wallpaper = makeWallpaper(reducedMotion);
  const applyTick = (t: import("./data/tick").Tick) =>
    wallpaper.update({
      poolHashratePhs: t.hashratePhs, avg1dPhs: t.avg1dPhs, networkDifficulty: t.difficulty,
      potAgeBlocks: t.potBlocks, potAgeHours: t.potHours, potVerdict: t.potVerdict,
      btcPriceUsd: t.btcUsd, phdBanked: t.phdBanked, chainHeight: t.height, blocksFound: t.blocksFound ?? null,
    });
  /** Rebuild the wallpaper (new motion setting), keeping data and dim state. */
  const swapWallpaper = () => {
    wallpaper.destroy();
    wallpaper = makeWallpaper(effectiveReduced(motion));
    wallpaper.resize();
    const last = tick.latest();
    if (last) applyTick(last);
    wallpaper.setDimmed(wm.list().some((w) => !w.minimized));
    wallpaper.resume();
  };
  const setMotion = (pref: MotionPref) => {
    motion = pref;
    store.set(MOTION_KEY, pref);
    swapWallpaper();
  };
  const motionLabel = (): string => {
    const state = effectiveReduced(motion) ? "static" : "animated";
    const pref = motion === "auto" ? "Auto" : motion === "on" ? "On" : "Off";
    return `Wallpaper motion: ${pref} · ${state}`;
  };
  const tick = createTickFeed({ url: rootEl.dataset.tick || "/api/tick" });
  // Windows open big beside the icon columns, so the icons stay in view (desktop/large-area.ts).
  const wm = createWindowManager({ root: windowsRoot, storage: store, mode, largeArea: () => largeAreaBeside(iconsRoot, windowsRoot) });
  // Identity only — reads an address, never moves funds. A previous session is
  // resumed silently (no popup) so the Profile icon survives a reload.
  // The server's view of who this is — only it can say "owner" (session/me.ts).
  // Made first: an Xverse sign-in IS a server session, so the wallet resumes from it.
  const me = createServerSession();
  const wallet = createWalletSession(store, { server: me });
  // Practice progress follows the signed-in wallet, falling back to a per-browser
  // record for guests. Nothing here is an NFT; every screen that reads it says so.
  const ledger = createPracticeLedger(store, wallet.account());
  wallet.subscribe((acct) => ledger.setIdentity(acct));
  // The display name follows the server session; site activity feeds the Parahawk badges.
  const profile = createProfileSession(me);
  startActivityTracker(me);
  // Icon badges that keep running while their windows are closed (desktop/icon-badges.ts).
  watchChatUnread(me);
  watchSuggestionsInbox(me);
  watchChangelog(store);
  watchAbout(store);
  void me.refresh();
  const desktop = createDesktop({
    iconsRoot, taskbarRoot: taskbar, wm, apps: APPS, store, tick, wallet, ledger, me, profile, mode,
    extraMenuItems: () => [
      { label: motionLabel(), onSelect: () => setMotion(MOTION_CYCLE[motion]) },
    ],
  });

  tick.subscribe((t, meta) => {
    applyTick(t);
    if (meta.blockFound) wallpaper.blockFound();
  });

  // Dim the wallpaper whenever any window is visible, and mirror the page a
  // site window is showing into the URL bar, so the address is always a link
  // back to what is on screen. Whichever site window navigated last owns it.
  let urlOwner: string | null = null;
  wm.on((e) => {
    const anyVisible = wm.list().some((w) => !w.minimized);
    wallpaper.setDimmed(anyVisible);
    if (e.type === "navigate") {
      urlOwner = e.id;
      history.replaceState(null, "", e.path);
      // Signing in or out happens on /account; ask the server who we are now.
      void me.refresh();
    } else if (e.type === "close" && e.id === urlOwner) {
      urlOwner = null;
      history.replaceState(null, "", "/");
    }
    // A closed game can no longer say it stopped playing; resume for it.
    if (e.type === "close" && e.id === "game" && gamePlaying) { gamePlaying = false; wallpaper.resume(); }
  });

  // A live Block Hunt run wants the whole frame budget (the owner's Edge
  // rasterises in software), so the wallpaper holds still while one is in play
  // and picks up again the moment it ends. The game announces it with a
  // bubbling `ph:game-playing` event.
  let gamePlaying = false;
  rootEl.addEventListener("ph:game-playing", (ev) => {
    const playing = (ev as CustomEvent<{ playing?: boolean }>).detail?.playing === true;
    if (playing === gamePlaying) return;
    gamePlaying = playing;
    if (playing) wallpaper.pause(); else wallpaper.resume();
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
    if (openPath) desktop.openPath(openPath);
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
      // "BLOCK N IMMINENT" counts itself: the first tick is already in flight (tick.start() above).
      poolBlocks: () => tick.latest()?.blocksFound ?? null,
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
  (window as unknown as { ph: unknown }).ph = { wm, desktop, get wallpaper() { return wallpaper; }, tick, wallet, ledger, me, profile, apps: APPS, setMotion, getMotion: () => motion };
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
else main();
