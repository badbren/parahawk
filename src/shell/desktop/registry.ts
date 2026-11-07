/**
 * The app registry. Adding an app to the desktop = adding one entry here.
 * Order = icon order on the desktop (top-left down). The Recycle Bin has no
 * icon since 2026-11-06 (owner: "not needed"); it stays as the "Show hidden
 * apps" window, for anything a visitor hid before then.
 */
import type { WindowSpec } from "../wm/types";
import type { TickFeed } from "../data/tick";
import type { WalletSession } from "../session/wallet";
import type { PracticeLedger } from "../session/ledger";
import type { ServerSession } from "../session/me";
import type { ProfileSession } from "../session/profile";
import { mountAbout } from "../apps/about";
import { mountCollection } from "../apps/collection";
import { mountBurn } from "../apps/burn";
import { mountProfile } from "../apps/profile";
import { mountBlockHunt } from "../apps/game/blockhunt";
import { mountLeaderboard } from "../apps/leaderboard";
import { mountChat } from "../apps/chat";
import { mountSuggestions } from "../apps/suggestions";
import { mountUserProfile, showUserProfile } from "../apps/user-profile";
import { mountAdmin } from "../apps/admin";
import { mountInscribe } from "../apps/inscribe";

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
  /** Practice progress — ore banked and Whites claimed. Absent in tests. */
  ledger?: PracticeLedger;
  /** The server session — who is signed in, and whether it is the owner. Absent in tests. */
  me?: ServerSession;
  /** The signed-in person's profile (display name). Absent in tests. */
  profile?: ProfileSession;
  /** Opens another desktop app by id — e.g. Burn's empty state sends people to Block Hunt. Absent in tests. */
  openApp?: (id: string) => void;
  /** Opens a site path in whichever window owns it — e.g. Profile → `/address/bc1q…`. Absent in tests. */
  openPath?: (path: string) => void;
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
  /**
   * Openable (links, deep links, other apps) but no desktop icon or start-menu
   * entry of its own — e.g. someone's public profile, reached by clicking their name.
   */
  noIcon?: boolean;
  /**
   * Greyed out on the desktop and won't open from anywhere (icon, keyboard,
   * start menu, deep links, other apps); clicking says this instead. The
   * BTC Hunters apps, until they launch (owner, 2026-11-06).
   */
  comingSoon?: string;
  /** System items (Recycle Bin) can't be dragged into the bin. */
  system?: boolean;
  /**
   * Icon appears only while a wallet is connected, and disappears on sign-out.
   * The desktop re-renders on every session change (desktop.ts).
   */
  requiresWallet?: boolean;
  /**
   * Icon appears only while the SERVER session is the owner's (session/me.ts).
   * Cosmetic: the page behind it checks the session itself and refuses anyone else.
   */
  requiresAdmin?: boolean;
  /**
   * Site paths this app answers for, so a deep link like /badges opens the
   * Badges window rather than the generic Parahawk one. Prefix match on whole
   * segments; "/" is left to the Parahawk app.
   */
  paths?: string[];
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
  // A hooded BTC Hunter: X eyes, and the laser leaving the right one.
  collection: svgIcon('<path d="M13 41v-5c0-4 4-7 8-7h6c4 0 8 3 8 7v5"/><path d="M15 21c0-8 4-14 9-14s9 6 9 14c0 4-2 7-5 8h-8c-3-1-5-4-5-8z"/><path d="M18 17l4 4M22 17l-4 4M26 17l4 4M30 17l-4 4" stroke="#ffa02e"/><path d="M30 19h14" stroke="#ffa02e" stroke-width="1.5"/>'),
  whitepaper: svgIcon('<path d="M12 6h18l6 6v30H12z"/><path d="M30 6v6h6"/><path d="M17 18h12M17 23h14"/><circle cx="27" cy="33" r="4" stroke="#ffd24a"/>'),
  pool: svgIcon('<path d="M8 40h32M8 40V9"/><path d="M12 33l7-9 6 5 9-13 5 4" stroke="#8fd14f"/>'),
  calculator: svgIcon('<rect x="13" y="7" width="22" height="34" rx="2"/><rect x="17" y="11" width="14" height="7" stroke="#8fd14f"/><path d="M18 25h.01M24 25h.01M30 25h.01M18 31h.01M24 31h.01M30 31h.01M18 37h.01M24 37h.01M30 37h.01" stroke-width="3"/>'),
  marketplace: svgIcon('<path d="M9 18l3-9h24l3 9z"/><path d="M12 22v17h24V22"/><path d="M21 39v-9h6v9" stroke="#8fd14f"/>'),
  inscribe: svgIcon('<path d="M33 8l7 7-20 20-9 2 2-9z"/><path d="M29 12l7 7" stroke="#8fd14f"/><path d="M9 42h30"/>'),
  bravocados: svgIcon('<path d="M24 6c-6 0-9 9-12 16-4 10 2 20 12 20s16-10 12-20c-3-7-6-16-12-16z"/><circle cx="24" cy="30" r="6" stroke="#8fd14f"/>'),
  badges: svgIcon('<path d="M17 6l7 11 7-11"/><circle cx="24" cy="29" r="11" stroke="#ffd24a"/><path d="M24 23l2 4 4 .5-3 3 .8 4-3.8-2-3.8 2 .8-4-3-3 4-.5z"/>'),
  community: svgIcon('<circle cx="17" cy="17" r="5"/><circle cx="31" cy="17" r="5" stroke="#8fd14f"/><path d="M8 38a9 9 0 0 1 18 0"/><path d="M22 38a9 9 0 0 1 18 0" stroke="#8fd14f"/>'),
  account: svgIcon('<circle cx="16" cy="24" r="8"/><circle cx="16" cy="24" r="2.5" stroke="#8fd14f"/><path d="M24 24h17M35 24v6M40 24v5"/>'),
  siteAbout: svgIcon('<circle cx="24" cy="24" r="17"/><path d="M24 21v12" stroke="#8fd14f"/><path d="M24 15h.01" stroke="#8fd14f" stroke-width="3"/>'),
  changelog: svgIcon('<path d="M12 6h18l6 6v30H12z"/><path d="M30 6v6h6"/><path d="M17 20h14M17 26h14M17 32h9" stroke="#8fd14f"/>'),
  // A flame: two burn into one.
  burn: svgIcon('<path d="M24 5c2 7 10 11 10 22a10 10 0 0 1-20 0c0-6 3-9 5-13 0 5 2 7 4 8-1-7 0-12 1-17z" stroke="#ffa02e"/><path d="M24 41c-3.5 0-5.5-2.5-5.5-5.5 0-3.5 2.5-5.5 5.5-9.5 3 4 5.5 6 5.5 9.5s-2 5.5-5.5 5.5z"/>'),
  admin: svgIcon('<path d="M24 6l14 5v11c0 9-6 15-14 19-8-4-14-10-14-19V11z" stroke="#ffd24a"/><path d="M18 24l4 4 8-8" stroke="#8fd14f"/>'),
  // A trophy: the cup in gold, handles and stand in the shell grey.
  leaderboard: svgIcon('<path d="M16 8h16v9a8 8 0 0 1-16 0z" stroke="#ffd24a"/><path d="M16 11h-5a5 5 0 0 0 6 7M32 11h5a5 5 0 0 1-6 7"/><path d="M24 25v6M18 40h12M20 31h8v9h-8z"/>'),
  // Two speech bubbles: yours in green, theirs in grey.
  chat: svgIcon('<path d="M7 9h22v15H16l-6 5v-5H7z"/><path d="M19 28v5h13l6 5v-5h3V18h-7" stroke="#8fd14f"/><path d="M12 15h12M12 19h8"/>'),
  // A suggestion box: a slot on top, a note going in.
  suggestions: svgIcon('<rect x="9" y="22" width="30" height="18" rx="2"/><path d="M17 27h14"/><path d="M19 22V8h10l3 3v11" stroke="#8fd14f"/><path d="M22 13h6M22 17h6" stroke="#8fd14f"/>'),
} as const;

/**
 * One window onto one section of the site. Every section gets its own icon and
 * its own window, so two can sit side by side; inside, it is the same page the
 * site has always served, with the site's own nav still there.
 */
function sitePage(id: string, label: string, icon: string, path: string, opts: Partial<AppSpec> = {}): AppSpec {
  return {
    id,
    label,
    icon,
    paths: [path],
    ...opts,
    open: ({ path: deepLink, launcher }) => ({
      id,
      title: label,
      icon,
      content: { kind: "iframe", src: deepLink ?? path },
      returnFocusTo: launcher,
    }),
  };
}

/**
 * Desktop icon order, top-left down (owner, 2026-11-06): Parahawk, About,
 * Changelog, Chat, Inscribe, then the rest, with the BTC Hunters (NFT) apps —
 * greyed out for now — at the bottom, the Whitepaper last. Apps not listed
 * follow in registry order.
 */
export const DESKTOP_ORDER: readonly string[] = [
  "parahawk", "site-about", "changelog", "chat", "inscribe",
  "community", "suggestions", "admin",
  "collection", "burn", "game", "about",
];

/** Every app the desktop knows about. */
export const APPS: AppSpec[] = [
  {
    id: "recycle-bin",
    label: "Recycle Bin",
    icon: ICONS.recycleBin,
    system: true,
    noIcon: true,
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
    // The id stays "about" so saved window positions survive the rename.
    id: "about",
    label: "Whitepaper",
    icon: ICONS.whitepaper,
    // Strictly the BTC Hunters (NFT) project, later (owner, 2026-11-06).
    comingSoon: "Coming soon",
    open: ({ launcher, tick }) => ({
      id: "about",
      title: "Whitepaper — how BTC Hunters work",
      icon: ICONS.whitepaper,
      returnFocusTo: launcher,
      content: { kind: "element", mount: (host) => mountAbout(host, tick) },
    }),
  },
  {
    id: "collection",
    label: "Collection",
    icon: ICONS.collection,
    comingSoon: "Coming soon",
    open: ({ launcher, tick }) => ({
      id: "collection",
      title: "BTC Hunters — the collection",
      icon: ICONS.collection,
      minSize: { w: 420, h: 460 },
      returnFocusTo: launcher,
      content: { kind: "element", mount: (host) => mountCollection(host, tick) },
    }),
  },
  {
    id: "burn",
    label: "Burn",
    icon: ICONS.burn,
    comingSoon: "Coming soon",
    open: ({ launcher, ledger, wallet, tick, openApp }) => ({
      id: "burn",
      title: "Burn — climb the ladder",
      icon: ICONS.burn,
      minSize: { w: 420, h: 440 },
      returnFocusTo: launcher,
      content: {
        kind: "element",
        mount: (host) => {
          if (!ledger) { host.textContent = "Practice pieces are unavailable."; return; }
          return mountBurn(host, { ledger, ...(wallet ? { wallet } : {}), ...(tick ? { tick } : {}), ...(openApp ? { openApp } : {}) });
        },
      },
    }),
  },
  {
    id: "game",
    label: "Block Hunt",
    icon: ICONS.game,
    comingSoon: "Coming soon",
    open: ({ launcher, ledger }) => ({
      id: "game",
      title: "Block Hunt — practice run",
      icon: ICONS.game,
      defaultSize: { w: 560, h: 680 },
      minSize: { w: 380, h: 460 },
      returnFocusTo: launcher,
      content: { kind: "element", mount: (host, win) => mountBlockHunt(host, { ledger, win }) },
    }),
  },
  {
    id: "leaderboard",
    label: "Leaderboard",
    icon: ICONS.leaderboard,
    // Now a tab inside Parahawk (/leaderboard); this window stays only until that page is done.
    noIcon: true,
    open: ({ launcher, me }) => ({
      id: "leaderboard",
      title: "Leaderboard — Block Hunt",
      icon: ICONS.leaderboard,
      minSize: { w: 420, h: 420 },
      returnFocusTo: launcher,
      content: { kind: "element", mount: (host) => mountLeaderboard(host, { me }) },
    }),
  },
  {
    id: "chat",
    label: "Chat",
    icon: ICONS.chat,
    open: ({ launcher, me, profile, wallet, openApp, openPath }) => ({
      id: "chat",
      title: "Chat",
      icon: ICONS.chat,
      minSize: { w: 340, h: 360 },
      returnFocusTo: launcher,
      content: {
        kind: "element",
        mount: (host) => mountChat(host, {
          ...(me ? { me } : {}), ...(profile ? { profile } : {}), ...(wallet ? { wallet } : {}), ...(openApp ? { openApp } : {}),
          ...(openPath ? { openPath } : {}),
        }),
      },
    }),
  },
  {
    id: "suggestions",
    label: "Suggestions",
    icon: ICONS.suggestions,
    open: ({ launcher, me, profile }) => ({
      id: "suggestions",
      title: "Suggestions",
      icon: ICONS.suggestions,
      minSize: { w: 340, h: 380 },
      returnFocusTo: launcher,
      content: {
        kind: "element",
        mount: (host) => mountSuggestions(host, { ...(me ? { me } : {}), ...(profile ? { profile } : {}) }),
      },
    }),
  },
  // Everything about the pool (Pool, Calculator, Marketplace, Bravocados, Badges,
  // Account) lives inside the Parahawk window as its tabs — no icons of their own
  // (owner, 2026-11-06); their deep links open the Parahawk window.
  // Inscribe, About, Community and Changelog moved OUT of Parahawk and are only reachable from here.
  {
    // Native, not an iframe of /inscribe: Xverse injects into the top page only.
    id: "inscribe",
    label: "Inscribe",
    icon: ICONS.inscribe,
    paths: ["/inscribe"],
    open: ({ launcher, wallet, tick, me }) => ({
      id: "inscribe",
      title: "Inscribe",
      icon: ICONS.inscribe,
      minSize: { w: 360, h: 420 },
      returnFocusTo: launcher,
      content: { kind: "element", mount: (host) => mountInscribe(host, { ...(wallet ? { wallet } : {}), ...(tick ? { tick } : {}), ...(me ? { me } : {}) }) },
    }),
  },
  sitePage("site-about", "About", ICONS.siteAbout, "/about"),
  sitePage("community", "Community", ICONS.community, "/community"),
  sitePage("changelog", "Changelog", ICONS.changelog, "/changelog"),
  {
    // The owner's dashboard (shell-native). The old /admin page lives on as its Prices tab.
    id: "admin",
    label: "Admin",
    icon: ICONS.admin,
    requiresAdmin: true,
    paths: ["/admin"],
    open: ({ launcher, me, openPath, openApp }) => ({
      id: "admin",
      title: "Admin",
      icon: ICONS.admin,
      returnFocusTo: launcher,
      content: {
        kind: "element",
        mount: (host) => mountAdmin(host, { ...(me ? { me } : {}), ...(openPath ? { openPath } : {}), ...(openApp ? { openApp } : {}) }),
      },
    }),
  },
  {
    // Someone's public profile: click a name in Chat, a Leaderboard row, or a
    // "(name)" next to a wallet. No icon of its own; reached at /u/<ref>.
    id: "user",
    label: "Profile",
    icon: ICONS.profile,
    noIcon: true,
    paths: ["/u"],
    open: ({ path, launcher, me, profile, openPath }) => {
      // One window for everyone: if it's already open on someone, switch it to
      // this person (the window manager then just focuses it).
      showUserProfile(path);
      return {
        id: "user",
        title: "Profile",
        icon: ICONS.profile,
        returnFocusTo: launcher,
        content: {
          kind: "element",
          mount: (host, win) => mountUserProfile(host, {
            path, win, ...(me ? { me } : {}), ...(profile ? { profile } : {}), ...(openPath ? { openPath } : {}),
          }),
        },
      };
    },
  },
  {
    id: "profile",
    label: "Profile",
    icon: ICONS.profile,
    requiresWallet: true,
    // No desktop icon: it opens from the round button by the corner logo (desktop/corner-profile.ts).
    noIcon: true,
    open: ({ launcher, wallet, me, profile, tick, openApp, openPath }) => ({
      id: "profile",
      title: "Profile",
      icon: ICONS.profile,
      returnFocusTo: launcher,
      content: {
        kind: "element",
        mount: (host) => {
          if (!wallet) { host.textContent = "Wallet unavailable."; return; }
          return mountProfile(host, {
            wallet,
            ...(me ? { me } : {}), ...(profile ? { profile } : {}), ...(tick ? { tick } : {}),
            ...(openApp ? { openApp } : {}), ...(openPath ? { openPath } : {}),
          });
        },
      },
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

/**
 * The app a site path belongs to: /badges/miner opens Badges, /history opens
 * Pool, and anything without a section of its own opens the Parahawk window.
 */
export function appForPath(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? "/";
  for (const app of APPS) {
    if (app.paths?.some((p) => p !== "/" && (bare === p || bare.startsWith(p + "/")))) return app.id;
  }
  return "parahawk";
}
