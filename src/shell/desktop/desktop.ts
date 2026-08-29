/**
 * Desktop shell: icon grid, selection + keyboard, taskbar, Recycle Bin,
 * right-click menu. STUB: renders a plain icon list and a bare taskbar so
 * main.ts can be wired end-to-end. The real implementation replaces this file
 * (keep the exported API identical). Spec: brief §5, §7, §8.
 */
import type { AppSpec } from "./registry";
import type { WindowId, WindowManager, WmMode } from "../wm/types";
import type { KeyValueStore } from "../session/store";
import type { TickFeed } from "../data/tick";
import { fmtDifficulty } from "../data/tick";
import { h } from "../util/dom";

export interface DesktopOptions {
  /** Where the icon grid renders (inside the desktop area, beneath windows). */
  iconsRoot: HTMLElement;
  /** The taskbar element (already positioned by the shell layout). */
  taskbarRoot: HTMLElement;
  wm: WindowManager;
  apps: AppSpec[];
  store: KeyValueStore;
  tick: TickFeed;
  mode: WmMode;
}

export interface Desktop {
  /** Open an app by registry id; `path` is the deep link for iframe apps. Returns the window id or null if unknown/hidden. */
  openApp(id: string, path?: string | null): WindowId | null;
  setMode(mode: WmMode): void;
  destroy(): void;
}

export function createDesktop(opts: DesktopOptions): Desktop {
  const { iconsRoot, taskbarRoot, wm, apps, tick } = opts;
  const visible = () => apps.filter((a) => !a.hidden);

  const desktop: Desktop = {
    openApp(id, path = null) {
      const app = apps.find((a) => a.id === id);
      if (!app || app.hidden) return null;
      const launcher = iconsRoot.querySelector<HTMLElement>(`[data-app="${id}"]`);
      return wm.open(app.open({ path, launcher }));
    },
    setMode() {},
    destroy() { iconsRoot.replaceChildren(); taskbarRoot.replaceChildren(); },
  };

  for (const app of visible()) {
    iconsRoot.append(
      h("button", { class: "ph-icon", "data-app": app.id, ondblclick: () => desktop.openApp(app.id) },
        h("img", { src: app.icon, alt: "" }),
        h("span", {}, app.label)),
    );
  }

  const diff = h("span", { class: "ph-tb-diff" }, "—");
  const clock = h("span", { class: "ph-tb-clock" }, "");
  const buttons = h("div", { class: "ph-tb-windows" });
  taskbarRoot.append(h("button", { class: "ph-tb-start" }, "PARAHAWK"), buttons, h("div", { class: "ph-tb-right" }, diff, clock));
  const renderButtons = () => {
    buttons.replaceChildren(...wm.list().map((w) =>
      h("button", { class: "ph-tb-win" + (w.focused ? " on" : ""), onclick: () => (w.focused && !w.minimized ? wm.minimize(w.id) : wm.restore(w.id)) }, w.title)));
  };
  wm.on(renderButtons);
  tick.subscribe((t) => { diff.textContent = fmtDifficulty(t.difficulty); });
  const tickClock = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
  tickClock(); setInterval(tickClock, 15_000);
  return desktop;
}
