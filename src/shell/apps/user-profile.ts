/**
 * Someone's public profile: what you see when you click a name in Chat, a row
 * on the Leaderboard, or a "(name)" next to a wallet on the Parahawk pages.
 * Reached at /u/<ref>, where ref is a wallet address or "~<uid>" for someone
 * who keeps their wallet private.
 *
 * Top: their picture, name and wallet (with a jump to the wallet page), as
 * GET /api/profile/public/:ref allows — someone private never shows their name
 * and their wallet together. Below: their stats and Parahawk badges
 * (public-stats.ts). The owner also gets two moderation buttons.
 *
 * One window for everyone: clicking another person while it's open switches it
 * (registry.ts calls showUserProfile before the window manager focuses it).
 */
import "./user-profile.css";
import { sameAddress } from "../../profile/rules";
import type { ServerSession } from "../session/me";
import type { ProfileSession } from "../session/profile";
import type { WindowHandle } from "../wm/types";
import { h } from "../util/dom";
import { avatarEl } from "./avatar";
import { mountPublicStats } from "./public-stats";

export interface UserProfileContext {
  /** The deep link it was opened with, e.g. "/u/bc1q…" or "/u/~k3x9…". */
  path: string | null;
  me?: ServerSession;
  profile?: ProfileSession;
  openPath?: (path: string) => void;
  /** The window, for its title. */
  win?: WindowHandle;
}

/** GET /api/profile/public/:ref (src/web/profile-routes.ts). */
interface PublicProfile {
  ref: string;
  uid: string | null;
  name: string | null;
  avatarUrl: string | null;
  isPrivate: boolean;
  address: string | null;
  isOwner: boolean;
}

/** "/u/<ref>" → the ref, or null when the path isn't a profile link. */
export function refFromPath(path: string | null): string | null {
  if (!path) return null;
  const m = /^\/u\/([^/?#]+)/.exec(path);
  if (!m) return null;
  try { return decodeURIComponent(m[1]!); } catch { return null; }
}

const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

/** The profile window that is open right now, if any. */
let live: { show(path: string | null): void } | null = null;

/**
 * Point the open profile window at another person. Returns false when no
 * profile window is open (the caller's new window will mount with the path).
 */
export function showUserProfile(path: string | null): boolean {
  if (!live) return false;
  live.show(path);
  return true;
}

export function mountUserProfile(host: HTMLElement, ctx: UserProfileContext): () => void {
  const { me, profile, openPath, win } = ctx;
  host.classList.add("ph-up");
  let ref = refFromPath(ctx.path);
  let seq = 0;
  let stopStats: (() => void) | null = null;
  let dead = false;

  const message = (text: string, retry = false) => {
    stopStats?.();
    stopStats = null;
    const kids: Array<Node | string> = [h("p", {}, text)];
    if (retry) {
      const again = h("button", { class: "ph-up-btn", type: "button" }, "Try again");
      again.addEventListener("click", () => { void load(); });
      kids.push(again);
    }
    host.replaceChildren(h("div", { class: "ph-up-msg" }, ...kids));
  };

  /** Is this profile the signed-in person's own? */
  const isYou = (p: PublicProfile): boolean => {
    const own = profile?.current();
    if (p.ref.startsWith("~")) return !!own?.uid && own.uid === p.uid;
    return sameAddress(me?.current().address ?? null, p.address);
  };

  /** Owner-only moderation: reset a name, remove a picture. */
  const modTools = (p: PublicProfile): HTMLElement | null => {
    if (!me?.isAdmin() || isYou(p) || (!p.name && !p.avatarUrl)) return null;
    const out = h("div", { class: "ph-up-mod" }, h("span", {}, "Owner:"));
    const act = (label: string, path: string) => {
      const b = h("button", { class: "ph-up-btn ph-up-btn-link", type: "button" }, label);
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const res = await fetch(path, { method: "DELETE", credentials: "same-origin", cache: "no-store" });
          if (!res.ok) throw new Error(String(res.status));
          await load();
        } catch {
          b.disabled = false;
          b.textContent = "Couldn't — try again";
        }
      });
      out.append(b);
    };
    const target = encodeURIComponent(p.ref);
    if (p.name) act("Reset name", `/api/profile/names/${target}`);
    if (p.avatarUrl) act("Remove picture", `/api/profile/avatar/${target}`);
    return out;
  };

  const paint = (p: PublicProfile) => {
    const you = isYou(p);
    const title = p.name ?? (p.address ? short(p.address) : "Private profile");
    win?.setTitle(`Profile — ${title}`);

    const tags = h("div", { class: "ph-up-tags" },
      you ? h("span", { class: "ph-up-tag is-you" }, "you") : null,
      p.isOwner ? h("span", { class: "ph-up-tag is-owner" }, "Parahawk owner") : null,
      p.isPrivate ? h("span", { class: "ph-up-tag" }, "private") : null);

    let wallet: HTMLElement;
    if (p.address) {
      const go = h("button", { class: "ph-up-btn ph-up-btn-go", type: "button" }, "Open wallet page →");
      go.addEventListener("click", () => openPath?.(`/address/${encodeURIComponent(p.address!)}`));
      go.hidden = !openPath;
      wallet = h("div", { class: "ph-up-wallet" },
        h("code", { class: "ph-up-addr", title: p.address }, short(p.address)),
        go);
    } else {
      wallet = h("p", { class: "ph-up-dim" }, "Keeps their wallet private.");
    }

    // Someone looked up by wallet with no public name: say why there's no name.
    const note = !p.name && p.address
      ? h("p", { class: "ph-up-dim" }, p.isPrivate
        ? "This wallet's owner keeps their name private."
        : "No Parahawk profile yet — these are the wallet's own numbers.")
      : null;

    const head = h("header", { class: "ph-up-head" },
      avatarEl({ url: p.avatarUrl, name: p.name, seed: p.address ?? p.ref, size: 72 }),
      h("div", { class: "ph-up-who" },
        h("h1", { class: `ph-up-name${p.name ? "" : " is-plain"}` }, title),
        tags, wallet, note, modTools(p)));

    const statsHost = h("section", { class: "ph-up-stats" });
    stopStats?.();
    host.replaceChildren(head, statsHost);
    stopStats = mountPublicStats(statsHost, p.ref, openPath ? { openPath } : {});
  };

  const load = async () => {
    const mine = ++seq;
    if (!ref) { win?.setTitle("Profile"); message("No profile picked."); return; }
    host.setAttribute("aria-busy", "true");
    try {
      const res = await fetch(`/api/profile/public/${encodeURIComponent(ref)}`, { credentials: "same-origin" });
      if (dead || mine !== seq) return;
      if (res.status === 404) { win?.setTitle("Profile"); message("No profile here. It may have been removed."); return; }
      if (res.status === 400) { win?.setTitle("Profile"); message("That isn't a wallet address."); return; }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as PublicProfile;
      if (dead || mine !== seq) return;
      paint(body);
    } catch {
      if (!dead && mine === seq) message("Couldn't load this profile.", true);
    } finally {
      if (mine === seq) host.removeAttribute("aria-busy");
    }
  };

  const self = {
    show(path: string | null) {
      const next = refFromPath(path);
      if (next === ref) return;
      ref = next;
      host.scrollTop = 0;
      void load();
    },
  };
  live = self;
  void load();

  // Signing in or out can change "you" and the owner's tools: repaint from the server.
  const offMe = me?.subscribe(() => { void load(); });

  return () => {
    dead = true;
    seq++;
    if (live === self) live = null;
    offMe?.();
    stopStats?.();
    stopStats = null;
    host.classList.remove("ph-up");
  };
}
