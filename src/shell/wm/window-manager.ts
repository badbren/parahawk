/**
 * Window manager — the real implementation of ./types.ts. Spec: brief §4
 * (drag, 8-handle resize, z-order, maximize into the desktop area, persistence,
 * snap), §7 (mobile fullscreen mode) and §8 (keyboard + ARIA).
 *
 * Geometry is applied with `transform: translate()` only — top/left never
 * change after creation. Root size is read once per gesture; pointer moves are
 * coalesced onto one animation frame.
 */
import type {
  Rect, Size, WindowId, WindowManager, WindowManagerOptions, WindowSpec, WindowState, WmEvent, WmMode,
} from "./types";
import { isFrameNavMessage } from "./types";
import { h, clamp } from "../util/dom";

const DEFAULT_MIN: Size = { w: 420, h: 320 };
/** How much of the title bar must stay reachable on every edge (px). */
const KEEP = 40;
const SNAP_PX = 8;
const SAVE_DEBOUNCE_MS = 150;

type HandleDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: HandleDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

interface Persisted {
  rect: Rect;
  maximized: boolean;
}

interface Win {
  state: WindowState;
  spec: WindowSpec;
  el: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  frame: HTMLIFrameElement | null;
  shield: HTMLElement | null;
  handles: HTMLElement[];
  maxBtn: HTMLButtonElement;
  cleanup: (() => void) | void;
  min: Size;
  saveTimer: number | null;
  /** Cleanup for listeners attached to this window's elements. */
  dispose: () => void;
}

interface Gesture {
  kind: "drag" | "resize";
  w: Win;
  dir: HandleDir | null;
  pointerId: number;
  startX: number;
  startY: number;
  start: Rect;
  rw: number;
  rh: number;
  lastX: number;
  lastY: number;
  raf: number;
  snap: "left" | "right" | null;
  target: HTMLElement;
  /** Root's viewport left edge, read once at gesture start. */
  rootLeft: number;
}

export function createWindowManager(opts: WindowManagerOptions): WindowManager {
  const root = opts.root;
  const storage = opts.storage;
  const cascadeStep = opts.cascadeStep ?? 28;
  let mode: WmMode = opts.mode ?? "desktop";
  const listeners = new Set<(e: WmEvent) => void>();
  const wins = new Map<WindowId, Win>();
  let z = 10;
  let gesture: Gesture | null = null;
  let changeRaf = 0;
  let snapPreview: HTMLElement | null = null;
  let destroyed = false;

  // ── Events ──────────────────────────────────────────────────────────────
  const emit = (e: WmEvent) => { for (const l of listeners) l(e); };
  /** 'change' coalesced to one per animation frame. */
  const change = () => {
    if (changeRaf) return;
    changeRaf = requestAnimationFrame(() => { changeRaf = 0; if (!destroyed) emit({ type: "change" }); });
  };
  const states = () => [...wins.values()].map((w) => w.state);
  const rootSize = () => ({ rw: root.clientWidth, rh: root.clientHeight });

  // ── Geometry ────────────────────────────────────────────────────────────
  const constrain = (r: Rect, rw: number, rh: number): Rect => ({
    x: clamp(r.x, KEEP - r.w, rw - KEEP),
    y: clamp(r.y, 0, Math.max(0, rh - KEEP)),
    w: r.w,
    h: r.h,
  });

  const validRect = (r: unknown, min: Size, rw: number, rh: number): r is Rect => {
    if (typeof r !== "object" || r === null) return false;
    const o = r as Record<string, unknown>;
    const nums = [o.x, o.y, o.w, o.h];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return false;
    const { x, y, w, h: hh } = o as unknown as Rect;
    if (w < min.w || hh < min.h || w > rw || hh > rh) return false;
    if (y < 0 || y + KEEP > rh) return false;
    if (x + KEEP > rw || x + w - KEEP < 0) return false;
    return true;
  };

  const defaultRect = (spec: WindowSpec, rw: number, rh: number, min: Size): Rect => {
    const size = spec.defaultSize ?? { w: Math.round(rw * 0.75), h: Math.round(rh * 0.75) };
    const w = clamp(Math.max(size.w, min.w), 1, rw);
    const hh = clamp(Math.max(size.h, min.h), 1, rh);
    const n = [...wins.values()].filter((o) => !o.state.minimized).length;
    const off = n * cascadeStep;
    return constrain({ x: Math.round((rw - w) / 2) + off, y: Math.round((rh - hh) / 2) + off, w, h: hh }, rw, rh);
  };

  /** Pushes state.rect / maximized / mode into the DOM. */
  const apply = (w: Win) => {
    const { el, state } = w;
    const full = mode === "mobile" || state.maximized;
    el.classList.toggle("ph-win-max", state.maximized && mode !== "mobile");
    el.classList.toggle("ph-win-mobile", mode === "mobile");
    const resizable = !full && (w.spec.resizable ?? true);
    el.classList.toggle("ph-win-resizable", resizable);
    if (full) {
      el.style.transform = "";
      el.style.width = "";
      el.style.height = "";
    } else {
      el.style.transform = `translate(${state.rect.x}px,${state.rect.y}px)`;
      el.style.width = `${state.rect.w}px`;
      el.style.height = `${state.rect.h}px`;
    }
  };

  /** Max/restore button glyph + label — only touched when the flag flips (never per frame). */
  const applyMaxBtn = (w: Win) => {
    w.maxBtn.textContent = w.state.maximized ? "❐" : "□";
    w.maxBtn.setAttribute("aria-label", w.state.maximized ? "Restore" : "Maximize");
  };

  /** Only same-origin absolute paths may be framed (never javascript:, data:, or protocol-relative). */
  const safePath = (p: string): boolean => p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\");

  const save = (w: Win) => {
    if (!storage) return;
    if (w.saveTimer != null) clearTimeout(w.saveTimer);
    w.saveTimer = window.setTimeout(() => {
      w.saveTimer = null;
      storage.set<Persisted>(`wm.${w.state.id}`, { rect: w.state.rect, maximized: w.state.maximized });
    }, SAVE_DEBOUNCE_MS);
  };

  // ── Focus / z-order ─────────────────────────────────────────────────────
  const setShields = () => {
    for (const w of wins.values()) {
      if (!w.shield) continue;
      w.shield.hidden = !(gesture !== null || !w.state.focused);
    }
  };

  const focus = (id: WindowId) => {
    const w = wins.get(id);
    if (!w || w.state.minimized) return;
    const already = w.state.focused;
    for (const o of wins.values()) {
      o.state.focused = o === w;
      o.el.classList.toggle("ph-win-focused", o === w);
    }
    if (!already || w.state.zIndex !== z) {
      w.state.zIndex = ++z;
      w.el.style.zIndex = String(z);
    }
    setShields();
    if (!already) {
      emit({ type: "focus", id });
      change();
    }
  };

  /** Move keyboard focus into a window's chrome (used on open / restore). */
  const focusChrome = (w: Win) => { w.el.focus({ preventScroll: true }); };

  const focusables = (w: Win): HTMLElement[] => {
    const sel = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])';
    return [...w.el.querySelectorAll<HTMLElement>(sel)].filter((e) => !e.hidden && e.offsetParent !== null);
  };

  // ── Gestures ────────────────────────────────────────────────────────────
  const showSnap = (side: "left" | "right" | null, rw: number, rh: number) => {
    if (!side) { snapPreview?.remove(); snapPreview = null; return; }
    if (!snapPreview) { snapPreview = h("div", { class: "ph-win-snap", "aria-hidden": "true" }); root.append(snapPreview); }
    const half = Math.floor(rw / 2);
    snapPreview.style.transform = `translate(${side === "left" ? 0 : rw - half}px,0)`;
    snapPreview.style.width = `${half}px`;
    snapPreview.style.height = `${rh}px`;
  };

  const step = () => {
    const g = gesture;
    if (!g) return;
    g.raf = 0;
    const dx = g.lastX - g.startX, dy = g.lastY - g.startY;
    const s = g.start, w = g.w;
    if (g.kind === "drag") {
      w.state.rect = constrain({ x: s.x + dx, y: s.y + dy, w: s.w, h: s.h }, g.rw, g.rh);
      const px = g.lastX - g.rootLeft;
      const snap: Gesture["snap"] = px <= SNAP_PX ? "left" : px >= g.rw - SNAP_PX ? "right" : null;
      if (snap !== g.snap) { g.snap = snap; showSnap(snap, g.rw, g.rh); }
    } else {
      const d = g.dir ?? "se";
      let { x, y, w: ww, h: hh } = s;
      if (d.includes("e")) ww = Math.max(w.min.w, s.w + dx);
      if (d.includes("s")) hh = Math.max(w.min.h, s.h + dy);
      if (d.includes("w")) { ww = Math.max(w.min.w, s.w - dx); x = s.x + s.w - ww; }
      if (d.includes("n")) { hh = Math.max(w.min.h, s.h - dy); y = s.y + s.h - hh; }
      if (y < 0) { hh += y; y = 0; }
      w.state.rect = { x, y, w: ww, h: hh };
    }
    apply(w);
    change();
  };

  const onPointerMove = (ev: PointerEvent) => {
    const g = gesture;
    if (!g || ev.pointerId !== g.pointerId) return;
    g.lastX = ev.clientX;
    g.lastY = ev.clientY;
    if (!g.raf) g.raf = requestAnimationFrame(step);
  };

  const endGesture = (ev: PointerEvent) => {
    const g = gesture;
    if (!g || ev.pointerId !== g.pointerId) return;
    if (g.raf) { cancelAnimationFrame(g.raf); g.raf = 0; }
    g.lastX = ev.clientX; g.lastY = ev.clientY;
    step();
    if (g.kind === "drag" && g.snap && ev.type === "pointerup") {
      const half = Math.floor(g.rw / 2);
      g.w.state.rect = { x: g.snap === "left" ? 0 : g.rw - half, y: 0, w: Math.max(g.w.min.w, half), h: g.rh };
      apply(g.w);
    }
    showSnap(null, 0, 0);
    try { g.target.releasePointerCapture(g.pointerId); } catch { /* already released */ }
    g.target.removeEventListener("pointermove", onPointerMove);
    g.target.removeEventListener("pointerup", endGesture);
    g.target.removeEventListener("pointercancel", endGesture);
    g.w.el.classList.remove("ph-win-dragging");
    gesture = null;
    setShields();
    save(g.w);
    change();
  };

  /** Tear a gesture down without applying it (window closed / destroyed mid-drag). */
  const abortGesture = () => {
    const g = gesture;
    if (!g) return;
    if (g.raf) cancelAnimationFrame(g.raf);
    try { g.target.releasePointerCapture(g.pointerId); } catch { /* already released */ }
    g.target.removeEventListener("pointermove", onPointerMove);
    g.target.removeEventListener("pointerup", endGesture);
    g.target.removeEventListener("pointercancel", endGesture);
    g.w.el.classList.remove("ph-win-dragging");
    gesture = null;
    showSnap(null, 0, 0);
  };

  const beginGesture = (ev: PointerEvent, w: Win, kind: Gesture["kind"], dir: HandleDir | null, target: HTMLElement) => {
    if (gesture || ev.button !== 0) return;
    if (mode === "mobile" || w.state.maximized) return;
    if (kind === "resize" && !(w.spec.resizable ?? true)) return;
    ev.preventDefault();
    const { rw, rh } = rootSize();
    gesture = {
      kind, w, dir, pointerId: ev.pointerId, startX: ev.clientX, startY: ev.clientY,
      start: { ...w.state.rect }, rw, rh, lastX: ev.clientX, lastY: ev.clientY, raf: 0, snap: null, target,
      rootLeft: root.getBoundingClientRect().left,
    };
    try { target.setPointerCapture(ev.pointerId); } catch { /* unsupported */ }
    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", endGesture);
    target.addEventListener("pointercancel", endGesture);
    w.el.classList.add("ph-win-dragging");
    setShields();
  };

  // ── Global listeners ────────────────────────────────────────────────────
  const onMessage = (ev: MessageEvent) => {
    if (ev.origin !== location.origin || !isFrameNavMessage(ev.data) || !safePath(ev.data.path)) return;
    for (const [id, w] of wins) {
      if (w.frame && w.frame.contentWindow === ev.source) {
        w.state.path = ev.data.path;
        emit({ type: "navigate", id, path: ev.data.path });
      }
    }
  };
  /** Focus moved into an iframe (keyboard or a click the shield didn't cover) — the parent only sees `blur`. */
  const onBlur = () => {
    setTimeout(() => {
      if (destroyed) return;
      const a = document.activeElement;
      if (!(a instanceof HTMLIFrameElement)) return;
      for (const [id, w] of wins) if (w.frame === a && !w.state.focused) focus(id);
    }, 0);
  };
  let resizeTimer: number | null = null;
  const onResize = () => {
    if (resizeTimer != null) clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      const { rw, rh } = rootSize();
      for (const w of wins.values()) {
        const r = w.state.rect;
        const next = constrain({ x: r.x, y: r.y, w: Math.min(r.w, Math.max(w.min.w, rw)), h: Math.min(r.h, Math.max(w.min.h, rh)) }, rw, rh);
        if (next.x !== r.x || next.y !== r.y || next.w !== r.w || next.h !== r.h) { w.state.rect = next; apply(w); }
      }
      change();
    }, 100);
  };
  window.addEventListener("message", onMessage);
  window.addEventListener("blur", onBlur);
  window.addEventListener("resize", onResize);

  // ── Window construction ─────────────────────────────────────────────────
  const build = (spec: WindowSpec): Win => {
    const min = spec.minSize ?? DEFAULT_MIN;
    const { rw, rh } = rootSize();
    const saved = storage?.get<Persisted>(`wm.${spec.id}`) ?? null;
    let rect: Rect;
    let maximized = false;
    if (saved && validRect(saved.rect, min, rw, rh)) {
      rect = saved.rect;
      maximized = saved.maximized === true;
    } else {
      rect = defaultRect(spec, rw, rh, min);
    }

    const state: WindowState = {
      id: spec.id, title: spec.title, icon: spec.icon, rect, minimized: false, maximized, focused: false, zIndex: z,
    };

    const body = h("div", { class: "ph-win-body" });
    const backBtn = h("button", { class: "ph-win-btn ph-win-btn-back", type: "button", "aria-label": "Back to desktop" }, "‹ Back");
    const minBtn = h("button", { class: "ph-win-btn ph-win-btn-min", type: "button", "aria-label": "Minimize" }, "─");
    const maxBtn = h("button", { class: "ph-win-btn ph-win-btn-max", type: "button", "aria-label": "Maximize" }, "□");
    const closeBtn = h("button", { class: "ph-win-btn ph-win-btn-close", type: "button", "aria-label": "Close" }, "✕");
    const name = h("span", { class: "ph-win-name" }, spec.title);
    const title = h("div", { class: "ph-win-title" },
      backBtn,
      h("img", { class: "ph-win-icon", src: spec.icon, alt: "", draggable: false }),
      name,
      h("div", { class: "ph-win-btns" }, minBtn, maxBtn, closeBtn));
    const el = h("div", { class: "ph-win", role: "dialog", "aria-label": spec.title, "aria-modal": "false", tabindex: -1, "data-win": spec.id }, title, body);
    el.style.zIndex = String(z);

    const handles = HANDLES.map((d) => h("div", { class: `ph-win-h ph-win-h-${d}`, "data-dir": d, "aria-hidden": "true" }));
    el.append(...handles);

    let frame: HTMLIFrameElement | null = null;
    let shield: HTMLElement | null = null;
    if (spec.content.kind === "iframe") {
      const src = safePath(spec.content.src) ? spec.content.src : "/";
      frame = h("iframe", { class: "ph-win-frame", src, title: spec.title, allow: "clipboard-write", referrerpolicy: "same-origin" });
      shield = h("div", { class: "ph-win-shield", "aria-hidden": "true" });
      body.append(frame, shield);
      state.path = src;
    }

    const w: Win = { state, spec, el, title, body, frame, shield, handles, maxBtn, cleanup: undefined, min, saveTimer: null, dispose: () => undefined };
    applyMaxBtn(w);

    // Listeners
    const offs: Array<() => void> = [];
    const on = <K extends keyof HTMLElementEventMap>(t: HTMLElement, k: K, fn: (ev: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
      t.addEventListener(k, fn, o);
      offs.push(() => t.removeEventListener(k, fn, o));
    };
    const isBtn = (t: EventTarget | null) => t instanceof Element && t.closest(".ph-win-btn") !== null;

    on(el, "pointerdown", () => focus(spec.id), { capture: true });
    on(el, "focusin", () => { if (!state.focused) focus(spec.id); });
    on(title, "pointerdown", (ev) => { if (!isBtn(ev.target)) beginGesture(ev, w, "drag", null, title); });
    on(title, "dblclick", (ev) => { if (!isBtn(ev.target) && mode !== "mobile") wm.toggleMaximize(spec.id); });
    for (const hd of handles) {
      on(hd, "pointerdown", (ev) => beginGesture(ev, w, "resize", hd.dataset.dir as HandleDir, hd));
    }
    on(minBtn, "click", () => wm.minimize(spec.id));
    on(maxBtn, "click", () => wm.toggleMaximize(spec.id));
    on(closeBtn, "click", () => wm.close(spec.id));
    on(backBtn, "click", () => wm.close(spec.id));
    on(el, "keydown", (ev) => {
      const t = ev.target as HTMLElement | null;
      const inChrome = t === el || (t !== null && title.contains(t));
      if (ev.key === "Escape" && inChrome) { ev.preventDefault(); wm.close(spec.id); return; }
      if (ev.key !== "Tab") return;
      const list = focusables(w);
      if (!list.length) { ev.preventDefault(); return; }
      const first = list[0] as HTMLElement, last = list[list.length - 1] as HTMLElement;
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? list.indexOf(active) : -1;
      if (ev.shiftKey && (idx <= 0)) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && (idx === -1 || idx === list.length - 1)) { ev.preventDefault(); first.focus(); }
    });
    w.dispose = () => { for (const f of offs) f(); };
    return w;
  };

  // ── API ─────────────────────────────────────────────────────────────────
  const wm: WindowManager = {
    open(spec) {
      const existing = wins.get(spec.id);
      if (existing && (spec.singleton ?? true)) {
        if (spec.content.kind === "iframe" && existing.frame) wm.navigate(spec.id, spec.content.src);
        wm.restore(spec.id);
        return spec.id;
      }
      if (existing) wm.close(spec.id);
      const w = build(spec);
      root.append(w.el);
      wins.set(spec.id, w);
      apply(w);
      if (spec.content.kind === "element") {
        w.cleanup = spec.content.mount(w.body, {
          id: spec.id,
          close: () => wm.close(spec.id),
          setTitle: (t) => { w.state.title = t; w.el.setAttribute("aria-label", t); const n = w.title.querySelector(".ph-win-name"); if (n) n.textContent = t; change(); },
        });
      }
      emit({ type: "open", id: spec.id });
      focus(spec.id);
      focusChrome(w);
      return spec.id;
    },
    close(id) {
      const w = wins.get(id);
      if (!w) return;
      if (gesture?.w === w) abortGesture();
      if (w.saveTimer != null) { clearTimeout(w.saveTimer); w.saveTimer = null; storage?.set<Persisted>(`wm.${id}`, { rect: w.state.rect, maximized: w.state.maximized }); }
      if (typeof w.cleanup === "function") { try { w.cleanup(); } catch (err) { console.error("[wm] cleanup failed", err); } }
      w.dispose();
      w.el.remove();
      wins.delete(id);
      emit({ type: "close", id });
      const next = states().filter((s) => !s.minimized).sort((a, b) => b.zIndex - a.zIndex)[0];
      if (next) focus(next.id); else emit({ type: "focus", id: null });
      setShields();
      change();
      const rf = w.spec.returnFocusTo;
      if (rf && rf.isConnected) rf.focus({ preventScroll: true });
      else if (next) { const nw = wins.get(next.id); if (nw) focusChrome(nw); }
    },
    focus(id) {
      const w = wins.get(id);
      if (!w) return;
      if (w.state.minimized) wm.restore(id); else focus(id);
    },
    minimize(id) {
      const w = wins.get(id);
      if (!w || w.state.minimized) return;
      const hadFocus = w.el.contains(document.activeElement);
      w.state.minimized = true;
      w.state.focused = false;
      w.el.classList.remove("ph-win-focused");
      w.el.hidden = true;
      const next = states().filter((s) => !s.minimized).sort((a, b) => b.zIndex - a.zIndex)[0];
      if (next) { focus(next.id); if (hadFocus) { const nw = wins.get(next.id); if (nw) focusChrome(nw); } }
      else { emit({ type: "focus", id: null }); if (hadFocus) w.spec.returnFocusTo?.focus({ preventScroll: true }); }
      change();
    },
    restore(id) {
      const w = wins.get(id);
      if (!w) return;
      if (w.state.minimized) { w.state.minimized = false; w.el.hidden = false; }
      focus(id);
      focusChrome(w);
      change();
    },
    toggleMaximize(id) {
      const w = wins.get(id);
      if (!w || mode === "mobile") return;
      w.state.maximized = !w.state.maximized;
      apply(w);
      applyMaxBtn(w);
      save(w);
      change();
    },
    navigate(id, path) {
      const w = wins.get(id);
      if (!w?.frame || !safePath(path)) return;
      if (w.state.path !== path) w.frame.src = path;
      w.state.path = path;
    },
    list: states,
    get: (id) => wins.get(id)?.state,
    focused: () => states().find((s) => s.focused)?.id ?? null,
    setMode(m) {
      if (m === mode) return;
      mode = m;
      root.classList.toggle("ph-windows-mobile", m === "mobile");
      for (const w of wins.values()) apply(w);
      change();
    },
    mode: () => mode,
    on(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    destroy() {
      destroyed = true;
      window.removeEventListener("message", onMessage);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      if (resizeTimer != null) clearTimeout(resizeTimer);
      if (changeRaf) cancelAnimationFrame(changeRaf);
      for (const id of [...wins.keys()]) wm.close(id);
      showSnap(null, 0, 0);
      root.classList.remove("ph-windows-mobile");
      listeners.clear();
    },
  };
  root.classList.toggle("ph-windows-mobile", mode === "mobile");
  return wm;
}
