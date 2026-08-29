/**
 * Window manager — STUB that satisfies the contract in ./types.ts so the rest
 * of the shell can be built against it. The real implementation (drag, resize
 * from 8 handles, z-order, minimize/maximize, persistence, focus trap, mobile
 * fullscreen mode, iframe nav sync) replaces this file. Spec: brief §4, §7, §8.
 */
import type {
  WindowId, WindowManager, WindowManagerOptions, WindowSpec, WindowState, WmEvent, WmMode,
} from "./types";
import { isFrameNavMessage } from "./types";
import { h } from "../util/dom";

export function createWindowManager(opts: WindowManagerOptions): WindowManager {
  const root = opts.root;
  let mode: WmMode = opts.mode ?? "desktop";
  const listeners = new Set<(e: WmEvent) => void>();
  const wins = new Map<WindowId, { state: WindowState; el: HTMLElement; frame: HTMLIFrameElement | null; cleanup: (() => void) | void; spec: WindowSpec }>();
  let z = 10;

  const emit = (e: WmEvent) => { for (const l of listeners) l(e); };
  const states = () => [...wins.values()].map((w) => w.state);

  const onMessage = (ev: MessageEvent) => {
    if (ev.origin !== location.origin || !isFrameNavMessage(ev.data)) return;
    for (const [id, w] of wins) {
      if (w.frame && w.frame.contentWindow === ev.source) {
        w.state.path = ev.data.path;
        emit({ type: "navigate", id, path: ev.data.path });
      }
    }
  };
  window.addEventListener("message", onMessage);

  const focus = (id: WindowId) => {
    const w = wins.get(id);
    if (!w) return;
    for (const o of wins.values()) o.state.focused = false;
    w.state.focused = true;
    w.state.zIndex = ++z;
    w.el.style.zIndex = String(z);
    emit({ type: "focus", id });
    emit({ type: "change" });
  };

  const wm: WindowManager = {
    open(spec) {
      const existing = wins.get(spec.id);
      if (existing && (spec.singleton ?? true)) {
        if (spec.content.kind === "iframe" && existing.frame) wm.navigate(spec.id, spec.content.src);
        wm.restore(spec.id);
        return spec.id;
      }
      const rw = root.clientWidth, rh = root.clientHeight;
      const size = spec.defaultSize ?? { w: Math.round(rw * 0.75), h: Math.round(rh * 0.75) };
      const rect = { x: Math.round((rw - size.w) / 2), y: Math.round((rh - size.h) / 2), w: size.w, h: size.h };
      const body = h("div", { class: "ph-win-body" });
      const el = h("div", { class: "ph-win", role: "dialog", "aria-label": spec.title, tabindex: -1 },
        h("div", { class: "ph-win-title" },
          h("img", { class: "ph-win-icon", src: spec.icon, alt: "" }),
          h("span", { class: "ph-win-name" }, spec.title),
          h("button", { class: "ph-win-btn", "aria-label": "Close", onclick: () => wm.close(spec.id) }, "✕")),
        body);
      el.style.cssText = `position:absolute;transform:translate(${rect.x}px,${rect.y}px);width:${rect.w}px;height:${rect.h}px`;
      let frame: HTMLIFrameElement | null = null;
      let cleanup: (() => void) | void = undefined;
      const state: WindowState = { id: spec.id, title: spec.title, icon: spec.icon, rect, minimized: false, maximized: false, focused: false, zIndex: z };
      if (spec.content.kind === "iframe") {
        frame = h("iframe", { class: "ph-win-frame", src: spec.content.src, title: spec.title, allow: "clipboard-write", referrerpolicy: "same-origin" });
        body.append(frame);
        state.path = spec.content.src;
      } else {
        cleanup = spec.content.mount(body, { id: spec.id, close: () => wm.close(spec.id), setTitle: (t) => { state.title = t; emit({ type: "change" }); } });
      }
      root.append(el);
      wins.set(spec.id, { state, el, frame, cleanup, spec });
      emit({ type: "open", id: spec.id });
      focus(spec.id);
      return spec.id;
    },
    close(id) {
      const w = wins.get(id);
      if (!w) return;
      if (typeof w.cleanup === "function") w.cleanup();
      w.el.remove();
      wins.delete(id);
      emit({ type: "close", id });
      emit({ type: "change" });
      const next = states().sort((a, b) => b.zIndex - a.zIndex)[0];
      if (next) focus(next.id); else emit({ type: "focus", id: null });
      w.spec.returnFocusTo?.focus();
    },
    focus,
    minimize(id) { const w = wins.get(id); if (!w) return; w.state.minimized = true; w.el.style.display = "none"; emit({ type: "change" }); },
    restore(id) { const w = wins.get(id); if (!w) return; w.state.minimized = false; w.el.style.display = ""; focus(id); },
    toggleMaximize(id) { const w = wins.get(id); if (!w) return; w.state.maximized = !w.state.maximized; emit({ type: "change" }); },
    navigate(id, path) { const w = wins.get(id); if (!w?.frame) return; w.frame.src = path; w.state.path = path; },
    list: states,
    get: (id) => wins.get(id)?.state,
    focused: () => states().find((s) => s.focused)?.id ?? null,
    setMode(m) { mode = m; emit({ type: "change" }); },
    mode: () => mode,
    on(l) { listeners.add(l); return () => listeners.delete(l); },
    destroy() { window.removeEventListener("message", onMessage); for (const id of [...wins.keys()]) wm.close(id); listeners.clear(); },
  };
  return wm;
}
