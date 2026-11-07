/**
 * Taskbar: start button (wordmark + menu), one button per open window, and a
 * sunken tray on the right — difficulty, LIVE/STALE, wallet, clock.
 * Fixed height (var(--ph-taskbar-h)); nothing here changes the bar's height.
 */
import type { WindowManager, WindowState, WmMode } from "../wm/types";
import type { TickFeed } from "../data/tick";
import { fmtDifficulty } from "../data/tick";
import type { WalletId, WalletSession } from "../session/wallet";
import type { ProfileSession } from "../session/profile";
import { shortAddress } from "../session/wallet";
import { sameAddress } from "../../profile/rules";
import { avatarEl } from "../apps/avatar";
import { BRAND } from "./registry";
import { h } from "../util/dom";
import { openMenu, openPopover, type Floating, type MenuItem } from "./context-menu";

export interface TaskbarOptions {
  root: HTMLElement;
  wm: WindowManager;
  tick: TickFeed;
  mode: WmMode;
  /** Items for the start menu, built fresh each time it opens. */
  startItems: () => MenuItem[];
  /** Wallet sign-in. Omitted in tests / harnesses, where the button stays a notice. */
  wallet?: WalletSession;
  /** Opens the Profile window (the tray's shortcut once signed in). */
  openProfile?: () => void;
  /** Display name for the wallet button, when the signed-in person has one (session/profile.ts). */
  profile?: ProfileSession;
}

export interface Taskbar {
  setMode(mode: WmMode): void;
  destroy(): void;
}

/** A tick older than this is shown as STALE. */
const LIVE_MAX_AGE_MS = 90_000;

export function createTaskbar(opts: TaskbarOptions): Taskbar {
  const { root, wm, tick } = opts;
  root.classList.add("ph-taskbar");
  if (!root.getAttribute("role")) root.setAttribute("role", "toolbar");

  // ── Start ────────────────────────────────────────────────────────────────
  let menu: Floating | null = null;
  const start = h("button", {
    class: "ph-tb-btn ph-tb-start", type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": "Start menu",
  }, h("img", { src: BRAND.parasiteIcon(64), alt: "" }), h("span", {}, "Parahawk"));
  start.addEventListener("click", () => {
    if (menu) { menu.close(); return; }
    start.setAttribute("aria-expanded", "true");
    menu = openMenu({
      items: opts.startItems(), label: "Start menu", anchor: start, ignore: [start], returnFocusTo: start,
      onClose: () => { menu = null; start.setAttribute("aria-expanded", "false"); },
    });
  });

  // ── Window buttons ───────────────────────────────────────────────────────
  const windows = h("div", { class: "ph-tb-windows", role: "group", "aria-label": "Open windows" });
  const buttons = new Map<string, { el: HTMLButtonElement; img: HTMLImageElement; label: HTMLSpanElement }>();
  const onWinClick = (w: WindowState) => (w.focused && !w.minimized ? wm.minimize(w.id) : wm.restore(w.id));
  const renderWindows = () => {
    const list = wm.list().sort((a, b) => a.zIndex - b.zIndex);
    // Keep stable order: existing buttons stay where they are; new ones append.
    const seen = new Set<string>();
    for (const w of list) {
      seen.add(w.id);
      let b = buttons.get(w.id);
      if (!b) {
        const img = h("img", { src: w.icon, alt: "" });
        const label = h("span", {}, w.title);
        const el = h("button", { class: "ph-tb-btn ph-tb-win", type: "button", "data-win": w.id }, img, label);
        el.addEventListener("click", () => { const s = wm.get(w.id); if (s) onWinClick(s); });
        b = { el, img, label };
        buttons.set(w.id, b);
        windows.append(el);
      }
      if (b.img.getAttribute("src") !== w.icon) b.img.src = w.icon;
      if (b.label.textContent !== w.title) b.label.textContent = w.title;
      b.el.title = w.title;
      b.el.setAttribute("aria-label", w.title + (w.minimized ? " (minimized)" : ""));
      b.el.classList.toggle("is-on", w.focused && !w.minimized);
      b.el.classList.toggle("is-min", w.minimized);
      b.el.setAttribute("aria-pressed", String(w.focused && !w.minimized));
    }
    for (const [id, b] of buttons) {
      if (!seen.has(id)) { b.el.remove(); buttons.delete(id); }
    }
  };
  const offWm = wm.on(renderWindows);

  // ── Tray ─────────────────────────────────────────────────────────────────
  const diff = h("span", { class: "ph-tb-diff", title: "Network difficulty" }, "DIFF —");
  const liveDot = h("span", { class: "ph-tb-dot", "aria-hidden": "true" });
  const liveLabel = h("span", {}, "STALE");
  const live = h("span", { class: "ph-tb-live", role: "status", "aria-live": "off" }, liveDot, liveLabel);
  let lastTickAt = 0;
  const renderLive = () => {
    const ok = lastTickAt > 0 && Date.now() - lastTickAt < LIVE_MAX_AGE_MS;
    live.classList.toggle("is-live", ok);
    liveLabel.textContent = ok ? "LIVE" : "STALE";
    live.title = ok ? "Live pool data" : "Pool data is stale";
  };
  const offTick = tick.subscribe((t, meta) => {
    diff.textContent = "DIFF " + fmtDifficulty(t.difficulty);
    // Liveness = when the feed last delivered (client clock, immune to server/client skew);
    // a replayed tick falls back to its server timestamp.
    if (meta.fresh) lastTickAt = Date.now();
    else if (lastTickAt === 0) { const gen = Date.parse(t.generatedAt); lastTickAt = Number.isFinite(gen) ? gen : 0; }
    renderLive();
  });
  const liveTimer = window.setInterval(renderLive, 15_000);

  // ── Wallet ───────────────────────────────────────────────────────────────
  // Signed out: a picker of the wallets we support, each flagged installed or
  // not. Signed in: the display name (or the short address until there is one),
  // with Profile / Disconnect behind it.
  const session = opts.wallet;
  let wallet: Floating | null = null;
  const walletFull = h("span", { class: "ph-tb-wallet-full" }, "Connect wallet");
  const walletShort = h("span", { class: "ph-tb-wallet-short", "aria-hidden": "true" }, "Wallet");
  /** The signed-in person's little profile picture, when they have one. */
  const walletPic = h("span", { class: "ph-tb-wallet-pic" });
  const walletBtn = h("button", {
    class: "ph-tb-btn ph-tb-wallet", type: "button", "aria-haspopup": session ? "menu" : "dialog", "aria-expanded": "false",
  }, walletPic, walletFull, walletShort);

  const closeWallet = () => { wallet?.close(); };

  /** Signed-in menu: jump to Profile, or sign out. */
  const signedInItems = (): MenuItem[] => [
    ...(opts.openProfile ? [{ label: "Open Profile", onSelect: () => opts.openProfile?.() }] : []),
    { label: "Disconnect", onSelect: () => session?.disconnect() },
  ];

  /** A short note anchored to the wallet button — errors, and wallets that are not ready yet. */
  const notice = (title: string, text: string) => {
    wallet = openPopover({
      label: "Wallet", anchor: walletBtn, ignore: [walletBtn], returnFocusTo: walletBtn,
      body: [h("strong", {}, title), h("br"), text],
      onClose: () => { wallet = null; walletBtn.setAttribute("aria-expanded", "false"); },
    });
  };

  /**
   * Signed-out picker, in the session's order (Xverse, then WalletConnect).
   * A wallet that is not set up yet says so; an uninstalled one links out
   * instead of failing.
   */
  const signedOutItems = (): MenuItem[] => {
    const list = session?.providers() ?? [];
    return list.map<MenuItem>((p) => {
      const icon = p.icon ? { icon: p.icon } : {};
      if (!p.ready) {
        return { label: `${p.label} — coming soon`, ...icon,
          onSelect: () => notice(`${p.label} is coming soon`, "It needs a little setup on our side first. Xverse works today.") };
      }
      return p.installed
        ? { label: p.label, ...icon, onSelect: () => { void connect(p.id); } }
        : { label: `${p.label} — install`, ...icon, href: p.site, target: "_blank" };
    });
  };

  const connect = async (id: WalletId) => {
    if (!session) return;
    walletFull.textContent = id === "xverse" ? "Check Xverse…" : "Connecting…";
    try {
      await session.connect(id);
      // render() runs off the session subscription and restores the label.
    } catch (err) {
      render();
      // Surface the wallet's own reason rather than failing silently.
      notice("Could not connect", (err as Error).message);
    }
  };

  /** The signed-in wallet's display name — only when the profile is this same address (session/profile.ts). */
  const nameOf = (address: string): string | null => {
    const p = opts.profile?.current();
    return p && p.displayName && sameAddress(p.address, address) ? p.displayName : null;
  };

  let lastPic: string | null = null;
  const render = () => {
    const acct = session?.account() ?? null;
    walletBtn.classList.toggle("is-on", acct != null);
    const own = opts.profile?.current();
    const pic = acct && own?.avatarUrl && sameAddress(own.address, acct.address) ? own.avatarUrl : null;
    if (pic !== lastPic) {
      lastPic = pic;
      walletPic.replaceChildren(...(pic ? [avatarEl({ url: pic, name: null, seed: acct!.address, size: 16 })] : []));
    }
    if (acct) {
      const name = nameOf(acct.address);
      walletFull.textContent = name ?? shortAddress(acct.address);
      walletShort.textContent = name ? (name.length > 9 ? `${name.slice(0, 8)}…` : name) : shortAddress(acct.address, 3, 3);
      walletBtn.title = `${name ? `${name} · ` : ""}${acct.address} — click for Profile`;
    } else {
      walletFull.textContent = "Connect wallet";
      walletShort.textContent = "Wallet";
      walletBtn.title = session ? "Sign in with Xverse" : "Wallet login coming soon";
    }
  };

  walletBtn.addEventListener("click", () => {
    if (wallet) { closeWallet(); return; }
    walletBtn.setAttribute("aria-expanded", "true");
    const onClose = () => { wallet = null; walletBtn.setAttribute("aria-expanded", "false"); };
    if (!session) {
      wallet = openPopover({
        label: "Wallet", anchor: walletBtn, ignore: [walletBtn], returnFocusTo: walletBtn,
        body: [h("strong", {}, "Wallet login coming soon"), h("br"), "Xverse · WalletConnect"],
        onClose,
      });
      return;
    }
    wallet = openMenu({
      items: session.account() ? signedInItems() : signedOutItems(),
      label: "Wallet", anchor: walletBtn, ignore: [walletBtn], returnFocusTo: walletBtn, onClose,
    });
  });

  const offWallet = session?.subscribe(() => { render(); closeWallet(); });
  // A new or changed display name relabels the button; the open menu can stay.
  const offProfile = opts.profile?.subscribe(() => render());
  render();

  const clock = h("time", { class: "ph-tb-clock" }, "");
  const renderClock = () => {
    const d = new Date();
    clock.textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    clock.setAttribute("datetime", d.toISOString());
  };
  renderClock();
  let clockInterval: number | null = null;
  // First tick lands on the minute boundary, then every 60s.
  const clockTimeout = window.setTimeout(() => {
    renderClock();
    clockInterval = window.setInterval(renderClock, 60_000);
  }, 60_000 - (Date.now() % 60_000));

  const tray = h("div", { class: "ph-tb-tray" }, diff, live, walletBtn, clock);
  root.replaceChildren(start, windows, tray);
  renderWindows();

  const setMode = (m: WmMode) => root.classList.toggle("ph-taskbar--mobile", m === "mobile");
  setMode(opts.mode);

  return {
    setMode,
    destroy() {
      offWm(); offTick(); offWallet?.(); offProfile?.();
      clearInterval(liveTimer); clearTimeout(clockTimeout);
      if (clockInterval != null) clearInterval(clockInterval);
      menu?.close(); wallet?.close();
      buttons.clear();
      root.replaceChildren();
      root.classList.remove("ph-taskbar--mobile");
    },
  };
}
