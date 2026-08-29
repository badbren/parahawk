/**
 * The app registry. Adding an app to the desktop = adding one entry here.
 * Order = icon order on the desktop (top-left down). The Recycle Bin is a
 * system item and always comes first (brief §5).
 */
import type { WindowSpec } from "../wm/types";

export interface AppOpenContext {
  /** Deep-link path for iframe apps, e.g. "/history". null = the app's default. */
  path: string | null;
  /** The icon element that launched the app — focus returns here on close. */
  launcher: HTMLElement | null;
}

export interface AppSpec {
  id: string;
  label: string;
  /** Icon URL (desktop icon; also the window/taskbar icon unless the WindowSpec overrides it). */
  icon: string;
  open(ctx: AppOpenContext): WindowSpec;
  /** Default true. */
  singleton?: boolean;
  /** Not shown on the desktop yet (feature-flagged placeholder). */
  hidden?: boolean;
  /** System items (Recycle Bin) can't be dragged into the bin. */
  system?: boolean;
}

export const BRAND = {
  parasiteIcon: (px: 64 | 128 | 256 | 512 = 128) => `/assets/brand/icon-parahawk-${px}.png`,
  parasiteWhite: "/assets/brand/parasite-white-512.png",
  parasiteGold: "/assets/brand/parasite-gold-512.png",
  parasiteLogoSvg: "/assets/brand/parasite-logo-currentcolor.svg",
} as const;

/** Inline SVG data URIs for shell-native icons — same palette as the site, no requests. */
const svgIcon = (body: string) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" stroke="#e6e6e6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
  );

export const ICONS = {
  recycleBin: svgIcon(
    '<path d="M12 14h24M20 14v-3h8v3M15 14l2 24h14l2-24"/><path d="M20 20v13M24 20v13M28 20v13"/>',
  ),
  recycleBinFull: svgIcon(
    '<path d="M12 14h24M20 14v-3h8v3M15 14l2 24h14l2-24"/><path d="M20 20v13M24 20v13M28 20v13"/><path d="M17 11l3-5 4 2 4-3 3 6" stroke="#8fd14f"/>',
  ),
  game: svgIcon('<rect x="8" y="16" width="32" height="18" rx="6"/><path d="M16 22v6M13 25h6M30 23h.1M34 27h.1"/>'),
  mint: svgIcon('<circle cx="24" cy="24" r="14"/><path d="M20 17h6a3.5 3.5 0 0 1 0 7h-6zM20 24h7a3.5 3.5 0 0 1 0 7h-7zM22 14v3M22 31v3"/>'),
  wiki: svgIcon('<path d="M8 12h14v24H8zM26 12h14v24H26z"/><path d="M12 18h6M12 23h6M30 18h6M30 23h6"/>'),
} as const;

/** Every app the desktop knows about. */
export const APPS: AppSpec[] = [
  {
    id: "recycle-bin",
    label: "Recycle Bin",
    icon: ICONS.recycleBin,
    system: true,
    open: ({ launcher }) => ({
      id: "recycle-bin",
      title: "Recycle Bin",
      icon: ICONS.recycleBin,
      defaultSize: { w: 520, h: 380 },
      returnFocusTo: launcher,
      // Mounted by desktop/recycle-bin.ts via main.ts; the registry stays declarative.
      content: { kind: "element", mount: () => undefined },
    }),
  },
  {
    id: "parahawk",
    label: "Parahawk",
    icon: BRAND.parasiteIcon(128),
    open: ({ path, launcher }) => ({
      id: "parahawk",
      title: "Parahawk",
      icon: BRAND.parasiteIcon(64),
      content: { kind: "iframe", src: path ?? "/" },
      returnFocusTo: launcher,
    }),
  },
  {
    id: "game",
    label: "Game",
    icon: ICONS.game,
    hidden: true,
    open: ({ launcher }) => ({
      id: "game",
      title: "Game",
      icon: ICONS.game,
      defaultSize: { w: 640, h: 420 },
      returnFocusTo: launcher,
      content: { kind: "element", mount: (host) => { host.textContent = "Coming soon."; } },
    }),
  },
  {
    id: "mint",
    label: "Mint",
    icon: ICONS.mint,
    hidden: true,
    open: ({ launcher }) => ({
      id: "mint",
      title: "Mint",
      icon: ICONS.mint,
      defaultSize: { w: 640, h: 420 },
      returnFocusTo: launcher,
      content: { kind: "element", mount: (host) => { host.textContent = "Coming soon."; } },
    }),
  },
];

export const getApp = (id: string): AppSpec | undefined => APPS.find((a) => a.id === id);
