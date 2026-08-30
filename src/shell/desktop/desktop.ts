/**
 * Desktop shell: icon grid (selection, keyboard, drag-to-bin), taskbar,
 * Recycle Bin, right-click menu. Spec: brief §5, §7, §8.
 *
 * Grid: column-major on desktop (fills down, then across), row-major scrollable
 * on mobile. Recycle Bin is always first. Apps the user dragged into the bin
 * are kept in the store ("desktop.hidden") and listed inside the bin window.
 */
import type { AppSpec } from "./registry";
import { ICONS } from "./registry";
import type { WindowId, WindowManager, WindowSpec, WmMode } from "../wm/types";
import type { KeyValueStore } from "../session/store";
import type { WalletSession } from "../session/wallet";
import type { PracticeLedger } from "../session/ledger";
import type { TickFeed } from "../data/tick";
import { h } from "../util/dom";
import { createHiddenApps } from "./hidden";
import { createTaskbar } from "./taskbar";
import { mountRecycleBin } from "./recycle-bin";
import { openMenu, type Floating, type MenuItem } from "./context-menu";

export interface DesktopOptions {
  /** Where the icon grid renders (inside the desktop area, beneath windows). */
  iconsRoot: HTMLElement;
  /** The taskbar element (already positioned by the shell layout). */
  taskbarRoot: HTMLElement;
  wm: WindowManager;
  apps: AppSpec[];
  store: KeyValueStore;
  tick: TickFeed;
  /** Wallet sign-in. Apps flagged `requiresWallet` appear only while connected. */
  wallet?: WalletSession;
  /** Practice progress — ore banked and Blacks claimed. */
  ledger?: PracticeLedger;
  mode: WmMode;
  /** Shell-level items appended to both the desktop context menu and the start menu (e.g. wallpaper motion). */
  extraMenuItems?: () => MenuItem[];
}

export interface Desktop {
  /** Open an app by registry id; `path` is the deep link for iframe apps. Returns the window id or null if unknown/hidden. */
  openApp(id: string, path?: string | null): WindowId | null;
  setMode(mode: WmMode): void;
  destroy(): void;
}

const BIN_ID = "recycle-bin";
const DRAG_THRESHOLD_PX = 6;

export function createDesktop(opts: DesktopOptions): Desktop {
  const { iconsRoot, taskbarRoot, wm, apps, tick, wallet, ledger } = opts;
  const hidden = createHiddenApps(opts.store);
  const area = iconsRoot.parentElement ?? iconsRoot;
  const classicHref = () => location.pathname + "?classic=1";

  iconsRoot.classList.add("ph-icons");
  if (!iconsRoot.getAttribute("role")) iconsRoot.setAttribute("role", "group");

  // ── Icons ────────────────────────────────────────────────────────────────
  const icons = new Map<string, HTMLButtonElement>();
  let selectedId: string | null = null;

  /** An app the user can see right now: not feature-flagged off, not in the bin, wallet gate satisfied. */
  const available = (a: AppSpec): boolean =>
    !a.hidden && (!a.requiresWallet || wallet?.account() != null);

  const shownApps = (): AppSpec[] => {
    const list = apps.filter((a) => available(a) && (a.system || !hidden.has(a.id)));
    return [...list.filter((a) => a.system), ...list.filter((a) => !a.system)];
  };
  const iconSrc = (app: AppSpec) => (app.id === BIN_ID && hidden.list().length > 0 ? ICONS.recycleBinFull : app.icon);

  const select = (id: string | null, focus = false) => {
    selectedId = id;
    let first = true;
    for (const [aid, el] of icons) {
      const on = aid === id;
      el.classList.toggle("is-selected", on);
      // Roving tabindex: the selected icon (or the first) is the tab stop.
      el.tabIndex = on || (id === null && first) ? 0 : -1;
      first = false;
      if (on && focus) el.focus();
    }
  };

  const makeIcon = (app: AppSpec): HTMLButtonElement => {
    const el = h("button", { class: "ph-icon", type: "button", "data-app": app.id, tabindex: -1, "aria-label": app.label },
      h("img", { src: iconSrc(app), alt: "", draggable: "false" }),
      h("span", { class: "ph-icon-label", "aria-hidden": "true" }, app.label));
    if (app.system) el.dataset.system = "1";
    return el;
  };

  const renderIcons = () => {
    const list = shownApps();
    const keep = new Set(list.map((a) => a.id));
    for (const [id, el] of icons) if (!keep.has(id)) { el.remove(); icons.delete(id); }
    const ordered: HTMLElement[] = [];
    for (const app of list) {
      let el = icons.get(app.id);
      if (!el) { el = makeIcon(app); icons.set(app.id, el); }
      const img = el.querySelector("img");
      const src = iconSrc(app);
      if (img && img.getAttribute("src") !== src) img.src = src;
      ordered.push(el);
    }
    iconsRoot.replaceChildren(...ordered);
    if (selectedId && !icons.has(selectedId)) selectedId = null;
    select(selectedId);
  };

  // ── Open ─────────────────────────────────────────────────────────────────
  const buildSpec = (app: AppSpec, path: string | null, launcher: HTMLElement | null): WindowSpec => {
    const spec = app.open({ path, launcher, tick, wallet, ledger });
    if (app.id !== BIN_ID) return spec;
    return { ...spec, content: { kind: "element", mount: (host) => mountRecycleBin(host, { apps, hidden }) } };
  };

  const openApp = (id: string, path: string | null = null): WindowId | null => {
    const app = apps.find((a) => a.id === id);
    if (!app || !available(app)) return null;
    return wm.open(buildSpec(app, path, icons.get(id) ?? null));
  };

  // ── Selection + keyboard ─────────────────────────────────────────────────
  const iconOf = (t: EventTarget | null): HTMLButtonElement | null =>
    (t instanceof Element ? t.closest<HTMLButtonElement>(".ph-icon") : null);
  const appIdOf = (el: HTMLElement) => el.dataset.app ?? "";

  /** Geometric arrow navigation: same column/row first, else nearest in that direction. */
  const neighbour = (from: HTMLElement, key: string): HTMLElement | null => {
    const f = from.getBoundingClientRect();
    const fx = f.left + f.width / 2, fy = f.top + f.height / 2;
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const el of icons.values()) {
      if (el === from) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = cx - fx, dy = cy - fy;
      let ahead = false, lateral = 0, along = 0;
      if (key === "ArrowDown") { ahead = dy > 1; along = dy; lateral = Math.abs(dx); }
      else if (key === "ArrowUp") { ahead = dy < -1; along = -dy; lateral = Math.abs(dx); }
      else if (key === "ArrowRight") { ahead = dx > 1; along = dx; lateral = Math.abs(dy); }
      else if (key === "ArrowLeft") { ahead = dx < -1; along = -dx; lateral = Math.abs(dy); }
      if (!ahead) continue;
      // Same line (lateral < half a cell) wins outright; otherwise weight lateral drift heavily.
      const sameLine = lateral < Math.min(f.width, f.height) / 2;
      const score = sameLine ? along : 1e6 + along + lateral * 4;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    const el = iconOf(ev.target);
    if (!el) return;
    const id = appIdOf(el);
    switch (ev.key) {
      case "Enter":
      case " ":
        ev.preventDefault();
        select(id);
        openApp(id);
        return;
      case "Escape":
        ev.preventDefault();
        select(null);
        el.blur();
        return;
      case "ArrowUp": case "ArrowDown": case "ArrowLeft": case "ArrowRight": {
        ev.preventDefault();
        const n = neighbour(el, ev.key);
        if (n) select(appIdOf(n), true);
        return;
      }
      case "Home": ev.preventDefault(); { const first = iconsRoot.querySelector<HTMLElement>(".ph-icon"); if (first) select(appIdOf(first), true); } return;
      case "End": ev.preventDefault(); { const all = iconsRoot.querySelectorAll<HTMLElement>(".ph-icon"); const last = all[all.length - 1]; if (last) select(appIdOf(last), true); } return;
      case "ContextMenu": case "F10":
        if (ev.key === "F10" && !ev.shiftKey) return;
        ev.preventDefault();
        { const r = el.getBoundingClientRect(); showContextMenu(r.left + r.width / 2, r.top + r.height / 2, el); }
        return;
      case "Delete":
        if (!el.dataset.system) { ev.preventDefault(); hideApp(id); }
        return;
    }
  };

  // ── Pointer: select / tap-open / drag-to-bin ─────────────────────────────
  let suppressClick = false;
  let drag: { el: HTMLButtonElement; id: string; pointerId: number; x0: number; y0: number; ghost: HTMLElement | null; over: HTMLElement | null } | null = null;

  const binEl = () => icons.get(BIN_ID) ?? null;
  const hideApp = (id: string) => {
    const app = apps.find((a) => a.id === id);
    if (!app || app.system) return;
    hidden.add(id);
  };

  const endDrag = (drop: boolean) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.el.classList.remove("is-dragging");
    d.over?.classList.remove("is-target");
    if (d.ghost) { d.ghost.remove(); }
    try { d.el.releasePointerCapture(d.pointerId); } catch { /* already released */ }
    if (d.ghost) suppressClick = true;
    if (drop && d.ghost && d.over) hideApp(d.id);
  };

  const onPointerDown = (ev: PointerEvent) => {
    suppressClick = false; // a stale suppress (tap with no click) must not eat this gesture's click
    const el = iconOf(ev.target);
    if (!el) {
      // Empty desktop: clear selection (but not when clicking inside a window).
      if (ev.target instanceof Element && !ev.target.closest(".ph-win")) select(null);
      return;
    }
    const id = appIdOf(el);
    select(id);
    if (ev.button !== 0 || ev.pointerType === "touch" || el.dataset.system) return;
    drag = { el, id, pointerId: ev.pointerId, x0: ev.clientX, y0: ev.clientY, ghost: null, over: null };
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    // The pointerup was lost (released over an iframe / outside the document): abandon, never ghost with no button held.
    if ((ev.buttons & 1) === 0) { endDrag(false); return; }
    const dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
    if (!drag.ghost) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      const label = drag.el.querySelector(".ph-icon-label")?.textContent ?? "";
      const img = drag.el.querySelector("img");
      drag.ghost = h("div", { class: "ph-icon-ghost", "aria-hidden": "true" },
        h("img", { src: img?.getAttribute("src") ?? "", alt: "" }), h("span", { class: "ph-icon-label" }, label));
      document.body.append(drag.ghost);
      drag.el.classList.add("is-dragging");
      try { drag.el.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    }
    drag.ghost.style.transform = `translate(${Math.round(ev.clientX - 48)}px,${Math.round(ev.clientY - 40)}px)`;
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const bin = binEl();
    const over = bin && under && bin.contains(under) ? bin : null;
    if (over !== drag.over) { drag.over?.classList.remove("is-target"); over?.classList.add("is-target"); drag.over = over; }
  };

  const onPointerUp = (ev: PointerEvent) => {
    if (drag && ev.pointerId === drag.pointerId) { endDrag(true); return; }
    // Touch: single tap opens.
    const el = iconOf(ev.target);
    if (el && ev.pointerType === "touch" && ev.button === 0) { suppressClick = true; openApp(appIdOf(el)); }
  };
  const onPointerCancel = () => endDrag(false);

  const onClick = (ev: MouseEvent) => {
    if (suppressClick) { suppressClick = false; ev.preventDefault(); ev.stopPropagation(); return; }
    const el = iconOf(ev.target);
    if (el) select(appIdOf(el));
  };
  const onDblClick = (ev: MouseEvent) => {
    const el = iconOf(ev.target);
    if (!el) return;
    ev.preventDefault();
    openApp(appIdOf(el));
  };

  // ── Context menu ─────────────────────────────────────────────────────────
  let ctx: Floating | null = null;
  const menuItems = (): MenuItem[] => [
    { label: "Open Parahawk", onSelect: () => openApp("parahawk") },
    { label: "Refresh data", onSelect: () => { void tick.refresh(); } },
    { label: "Show hidden apps", onSelect: () => openApp(BIN_ID) },
    ...(opts.extraMenuItems?.() ?? []),
    { label: "Classic site", href: classicHref(), target: "_top" },
  ];
  const showContextMenu = (x: number, y: number, returnFocusTo: HTMLElement | null) => {
    ctx?.close();
    ctx = openMenu({ items: menuItems(), label: "Desktop menu", x, y, returnFocusTo, onClose: () => { ctx = null; } });
  };
  const onContextMenu = (ev: MouseEvent) => {
    if (ev.target instanceof Element && ev.target.closest(".ph-win")) return;
    ev.preventDefault();
    const icon = iconOf(ev.target);
    if (icon) select(appIdOf(icon)); else select(null);
    showContextMenu(ev.clientX, ev.clientY, icon);
  };

  // ── Taskbar ──────────────────────────────────────────────────────────────
  const taskbar = createTaskbar({
    root: taskbarRoot, wm, tick, mode: opts.mode, wallet,
    openProfile: () => { openApp("profile"); },
    startItems: () => [
      ...shownApps().filter((a) => !a.system).map<MenuItem>((a) => ({ label: a.label, icon: a.icon, onSelect: () => openApp(a.id) })),
      { label: "Show hidden apps", icon: ICONS.recycleBin, onSelect: () => openApp(BIN_ID) },
      ...(opts.extraMenuItems?.() ?? []),
      { label: "Classic site", href: classicHref(), target: "_top" },
    ],
  });

  // ── Wire up ──────────────────────────────────────────────────────────────
  area.addEventListener("pointerdown", onPointerDown);
  area.addEventListener("pointermove", onPointerMove);
  area.addEventListener("pointerup", onPointerUp);
  area.addEventListener("pointercancel", onPointerCancel);
  area.addEventListener("contextmenu", onContextMenu);
  iconsRoot.addEventListener("click", onClick);
  iconsRoot.addEventListener("dblclick", onDblClick);
  iconsRoot.addEventListener("keydown", onKeyDown);
  const offHidden = hidden.subscribe(renderIcons);
  // Signing in adds the Profile icon; signing out takes it away — and closes the
  // window with it, so a signed-out desktop never leaves an orphaned Profile open.
  let sawAccount = wallet?.account() != null;
  const offWallet = wallet?.subscribe((acct) => {
    const has = acct != null;
    if (!has && sawAccount) wm.close("profile");
    sawAccount = has;
    renderIcons();
  });

  const setMode = (m: WmMode) => {
    iconsRoot.classList.toggle("ph-icons--mobile", m === "mobile");
    taskbar.setMode(m);
  };
  setMode(opts.mode);
  renderIcons();

  return {
    openApp,
    setMode,
    destroy() {
      endDrag(false);
      ctx?.close();
      offHidden();
      offWallet?.();
      taskbar.destroy();
      area.removeEventListener("pointerdown", onPointerDown);
      area.removeEventListener("pointermove", onPointerMove);
      area.removeEventListener("pointerup", onPointerUp);
      area.removeEventListener("pointercancel", onPointerCancel);
      area.removeEventListener("contextmenu", onContextMenu);
      iconsRoot.removeEventListener("click", onClick);
      iconsRoot.removeEventListener("dblclick", onDblClick);
      iconsRoot.removeEventListener("keydown", onKeyDown);
      iconsRoot.classList.remove("ph-icons--mobile");
      iconsRoot.replaceChildren();
      icons.clear();
    },
  };
}
