/**
 * The app registry. Adding an app to the desktop = adding one entry here.
 * Order = icon order on the desktop (top-left down). The Recycle Bin is a
 * system item and always comes first (brief §5).
 */
import type { WindowSpec } from "../wm/types";
import type { TickFeed } from "../data/tick";
import type { WalletSession } from "../session/wallet";
import type { PracticeLedger } from "../session/ledger";
import { mountAbout } from "../apps/about";
import { mountProfile } from "../apps/profile";
import { mountBlockHunt } from "../apps/game/blockhunt";

export interface AppOpenContext {
  /** Deep-link path for iframe apps, e.g. "/history". null = the app's default. */
  path: string | null;
  /** The icon element that launched the app — focus returns here on close. */
  launcher: HTMLElement | null;
  /**
   * Shell-provided content for apps whose UI lives in the shell (Recycle Bin).
   * The registry stays declarative; desktop.ts supplies the mount.
   */
  mount?: (host: HTMLElement, win: import("../wm/types").WindowHandle) => (() => void) | void;
  /** Live pool data, for apps that show prices in USD. Absent in tests. */
  tick?: TickFeed;
  /** Wallet sign-in, for apps keyed to an address. Absent in tests. */
  wallet?: WalletSession;
  /** Practice progress — ore banked and Blacks claimed. Absent in tests. */
  ledger?: PracticeLedger;
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
  /**
   * Icon appears only while a wallet is connected, and disappears on sign-out.
   * The desktop re-renders on every session change (desktop.ts).
   */
  requiresWallet?: boolean;
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
  about: svgIcon('<circle cx="24" cy="24" r="17" stroke="#8fd14f"/><path d="M18.5 19a5.5 5.5 0 1 1 5.5 6.5V29"/><path d="M24 34.5h.01" stroke-width="3"/>'),
  profile: svgIcon('<circle cx="24" cy="18" r="7.5" stroke="#8fd14f"/><path d="M10 39a14 14 0 0 1 28 0"/><path d="M10 39h28"/>'),
  // A block, with the mite's tunnel driving down into it.
  game: svgIcon('<rect x="13" y="26" width="22" height="15" rx="2" stroke="#ffd24a"/><path d="M13 31h22M13 36h22"/><path d="M24 7v12" stroke="#8fd14f"/><path d="M19 12l5 7 5-7" stroke="#8fd14f"/>'),
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
    open: ({ launcher, mount }) => ({
      id: "recycle-bin",
      title: "Recycle Bin",
      icon: ICONS.recycleBin,
      defaultSize: { w: 520, h: 380 },
      returnFocusTo: launcher,
      // desktop.ts passes the real mount (desktop/recycle-bin.ts); the registry stays declarative.
      content: { kind: "element", mount: mount ?? (() => undefined) },
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
    id: "profile",
    label: "Profile",
    icon: ICONS.profile,
    requiresWallet: true,
    open: ({ launcher, wallet, ledger }) => ({
      id: "profile",
      title: "Profile",
      icon: ICONS.profile,
      defaultSize: { w: 660, h: 560 },
      returnFocusTo: launcher,
      content: {
        kind: "element",
        mount: (host) => {
          if (!wallet) { host.textContent = "Wallet unavailable."; return; }
          return mountProfile(host, wallet, ledger);
        },
      },
    }),
  },
  {
    id: "about",
    label: "What is this place?",
    icon: ICONS.about,
    open: ({ launcher, tick }) => ({
      id: "about",
      title: "What is this place?",
      icon: ICONS.about,
      defaultSize: { w: 760, h: 620 },
      returnFocusTo: launcher,
      content: { kind: "element", mount: (host) => mountAbout(host, tick) },
    }),
  },
  {
    id: "game",
    label: "Block Hunt",
    icon: ICONS.game,
    open: ({ launcher, ledger }) => ({
      id: "game",
      title: "Block Hunt — practice run",
      icon: ICONS.game,
      defaultSize: { w: 560, h: 680 },
      minSize: { w: 380, h: 460 },
      returnFocusTo: launcher,
      content: { kind: "element", mount: (host) => mountBlockHunt(host, { ledger }) },
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
