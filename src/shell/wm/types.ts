/**
 * Window manager contract — the one interface every other shell module codes
 * against. Read this before touching wm/window-manager.ts, desktop/*.ts or
 * main.ts. Behavioural spec lives in PARAHAWK-DESKTOP-BRIEF.md §4.
 */

export type WindowId = string;

export interface Size {
  w: number;
  h: number;
}

/** Geometry in desktop-area pixels (origin = top-left of the desktop area, not the viewport). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * What goes inside a window.
 *  - `iframe`: a same-origin URL. The existing parahawk.space pages are served
 *    unchanged when requested by a frame (server keys on Sec-Fetch-Dest).
 *  - `element`: a mount function for shell-native content (Recycle Bin, stubs,
 *    later the game). Returns an optional cleanup that runs on close.
 */
export type WindowContent =
  | { kind: "iframe"; src: string }
  | { kind: "element"; mount: (host: HTMLElement, win: WindowHandle) => (() => void) | void };

export interface WindowSpec {
  id: WindowId;
  title: string;
  /** URL of the title-bar icon (also used by the taskbar button). */
  icon: string;
  content: WindowContent;
  /** Default: 75% of the desktop area, centred. */
  defaultSize?: Size;
  /** Default: 420 × 320. */
  minSize?: Size;
  /** Default: true. */
  resizable?: boolean;
  /** Default: true — opening again focuses the existing window instead of creating a second. */
  singleton?: boolean;
  /** Element to return keyboard focus to when the window closes (the launching icon). */
  returnFocusTo?: HTMLElement | null;
}

export interface WindowState {
  id: WindowId;
  title: string;
  icon: string;
  /** The window's un-maximized geometry. While maximized or in mobile mode the on-screen box is the whole root; don't read this as the visible box. */
  rect: Rect;
  minimized: boolean;
  maximized: boolean;
  focused: boolean;
  zIndex: number;
  /** iframe windows only: the frame's current path+search, kept in sync via postMessage. */
  path?: string;
}

/** Given to `element` content so shell-native apps can drive their own window. */
export interface WindowHandle {
  id: WindowId;
  close(): void;
  setTitle(title: string): void;
}

export type WmEvent =
  | { type: "open"; id: WindowId }
  | { type: "close"; id: WindowId }
  | { type: "focus"; id: WindowId | null }
  /** Any state change worth re-rendering the taskbar for (geometry, minimize, maximize, title). */
  | { type: "change" }
  /** An iframe window navigated (or reloaded) to `path`. The shell mirrors it into the URL bar. */
  | { type: "navigate"; id: WindowId; path: string };

export type WmMode = "desktop" | "mobile";

export interface WindowManager {
  /** Opens (or, for singletons, focuses) a window. Returns its id. */
  open(spec: WindowSpec): WindowId;
  close(id: WindowId): void;
  focus(id: WindowId): void;
  minimize(id: WindowId): void;
  /** Un-minimizes and focuses. */
  restore(id: WindowId): void;
  toggleMaximize(id: WindowId): void;
  /** iframe windows only: point the frame at a new same-origin path. */
  navigate(id: WindowId, path: string): void;
  list(): WindowState[];
  get(id: WindowId): WindowState | undefined;
  focused(): WindowId | null;
  /**
   * `mobile` (< 768px): windows are fullscreen inside the desktop area, no drag
   * or resize, a back affordance in the title bar. Switching modes re-lays-out
   * every open window.
   */
  setMode(mode: WmMode): void;
  mode(): WmMode;
  on(listener: (e: WmEvent) => void): () => void;
  destroy(): void;
}

export interface WindowManagerOptions {
  /**
   * The desktop area element. Windows are absolutely positioned inside it and
   * maximize fills it — it must NOT include the taskbar.
   */
  root: HTMLElement;
  /** Persists geometry per window id. Omit for no persistence. */
  storage?: import("../session/store").KeyValueStore;
  mode?: WmMode;
  /** Offset for second and subsequent windows. Default 28. */
  cascadeStep?: number;
}

/** Message an iframe'd page posts to the shell on load (see layout.ts framed script). */
export interface FrameNavMessage {
  ph: "nav";
  path: string;
  title?: string;
}

export function isFrameNavMessage(data: unknown): data is FrameNavMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { ph?: unknown }).ph === "nav" &&
    typeof (data as { path?: unknown }).path === "string"
  );
}
