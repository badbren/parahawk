/**
 * Floating layers: a keyboard-navigable menu (start menu, desktop right-click)
 * and a plain popover (wallet notice). One positioning + dismissal core:
 * Escape / outside pointerdown / Tab-out close the layer and return focus.
 */
import { clamp, h } from "../util/dom";

export interface MenuItem {
  label: string;
  icon?: string;
  /** Link items render as <a>; `target` defaults to _self. */
  href?: string;
  target?: string;
  onSelect?: () => void;
}

interface FloatingOptions {
  /** Absolute viewport point (context menus) … */
  x?: number;
  y?: number;
  /** … or an anchor element the layer sits above (taskbar). */
  anchor?: HTMLElement;
  /** Elements whose pointerdown should NOT count as "outside" (the toggling button). */
  ignore?: HTMLElement[];
  returnFocusTo?: HTMLElement | null;
  onClose?: () => void;
}

export interface Floating {
  el: HTMLElement;
  close(): void;
}

const GAP = 4;

function mountFloating(el: HTMLElement, opts: FloatingOptions): Floating {
  document.body.append(el);
  // Position after mount so we can measure.
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = 0, top = 0;
  if (opts.anchor) {
    const a = opts.anchor.getBoundingClientRect();
    left = a.left;
    top = a.top - r.height - GAP;
  } else {
    left = opts.x ?? 0;
    top = opts.y ?? 0;
    if (top + r.height > vh) top = (opts.y ?? 0) - r.height;
  }
  el.style.left = `${clamp(left, GAP, Math.max(GAP, vw - r.width - GAP))}px`;
  el.style.top = `${clamp(top, GAP, Math.max(GAP, vh - r.height - GAP))}px`;

  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", close);
    window.removeEventListener("blur", close);
    const hadFocus = el.contains(document.activeElement);
    el.remove();
    if (hadFocus) opts.returnFocusTo?.focus();
    opts.onClose?.();
  };
  const onDown = (ev: PointerEvent) => {
    const t = ev.target as Node | null;
    if (!t) return;
    if (el.contains(t)) return;
    if (opts.ignore?.some((i) => i.contains(t))) return;
    close();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); close(); return; }
    if (ev.key === "Tab" && el.contains(document.activeElement)) close();
  };
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", close);
  window.addEventListener("blur", close);
  return { el, close };
}

export interface MenuOptions extends FloatingOptions {
  items: MenuItem[];
  label: string;
}

export function openMenu(opts: MenuOptions): Floating {
  const menu = h("div", { class: "ph-menu", role: "menu", "aria-label": opts.label });
  let fl: Floating | null = null;
  const nodes: HTMLElement[] = opts.items.map((it) => {
    const inner = [it.icon ? h("img", { src: it.icon, alt: "" }) : null, h("span", {}, it.label)];
    const node = it.href
      ? h("a", { class: "ph-menu-item", role: "menuitem", href: it.href, target: it.target ?? "_self", tabindex: -1 }, ...inner)
      : h("button", { class: "ph-menu-item", role: "menuitem", type: "button", tabindex: -1 }, ...inner);
    node.addEventListener("click", () => {
      if (!it.href) { fl?.close(); it.onSelect?.(); } else fl?.close();
    });
    node.addEventListener("pointerenter", () => node.focus());
    return node;
  });
  menu.append(...nodes);
  menu.addEventListener("keydown", (ev) => {
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    const n = nodes.length;
    let next = -1;
    if (ev.key === "ArrowDown") next = (i + 1) % n;
    else if (ev.key === "ArrowUp") next = (i - 1 + n) % n;
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = n - 1;
    if (next >= 0) { ev.preventDefault(); nodes[next]?.focus(); }
  });
  fl = mountFloating(menu, opts);
  nodes[0]?.focus();
  return fl;
}

export interface PopoverOptions extends FloatingOptions {
  label: string;
  body: Array<Node | string>;
}

export function openPopover(opts: PopoverOptions): Floating {
  const el = h("div", { class: "ph-popover", role: "dialog", "aria-label": opts.label, tabindex: -1 }, ...opts.body);
  const fl = mountFloating(el, opts);
  el.focus();
  return fl;
}
