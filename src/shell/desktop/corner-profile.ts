/**
 * The way into your profile: a small round button in the desktop's top-right
 * corner, beside the PARAHAWK logo the wallpaper draws there (owner,
 * 2026-11-06: "next to the parahawk icon at top right maybe we need a little
 * profile icon thing and thats where i can click my profile and edit it" — and
 * no app or icon that says Account or Profile anywhere else).
 *
 * Signed in: it shows your picture (or a silhouette) and opens the Profile
 * editor. Signed out: it opens the taskbar's wallet picker. It sits on the
 * desktop layer, under the windows, and isn't shown on phones.
 */
import type { WalletSession } from "../session/wallet";
import type { ProfileSession } from "../session/profile";
import { CORNER_BUTTON_PX, cornerLogoBox } from "./wallpaper-horizon";
import { h } from "../util/dom";
import "./corner-profile.css";

export interface CornerProfileOptions {
  /** The desktop layer (windows are a later sibling, so they cover the button). */
  area: HTMLElement;
  /** Inserted before this child of `area`. */
  before: Element;
  wallet: WalletSession;
  profile: ProfileSession;
  openProfile(): void;
}

const SILHOUETTE =
  'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" stroke="#e6e6e6" stroke-width="2.2" stroke-linecap="round">' +
    '<circle cx="20" cy="15" r="6.5"/><path d="M8.5 33a11.5 11.5 0 0 1 23 0"/></svg>');

export function createCornerProfile(opts: CornerProfileOptions): () => void {
  const img = h("img", { src: SILHOUETTE, alt: "", draggable: "false" });
  const btn = h("button", { class: "ph-corner-profile", type: "button", "aria-label": "Your profile", title: "Your profile" }, img);
  opts.area.insertBefore(btn, opts.before);

  /** Line it up with the logo's letters (the wallpaper places the logo with the same function). */
  const place = (): void => {
    const W = window.innerWidth;
    btn.hidden = W < 768;
    if (btn.hidden) return;
    const box = cornerLogoBox(W);
    btn.style.top = `${Math.round(box.inkCy - CORNER_BUTTON_PX / 2)}px`;
    btn.style.right = `${Math.round(box.edge)}px`;
  };
  const render = (): void => {
    const signedIn = opts.wallet.account() != null, pic = signedIn ? opts.profile.current().avatarUrl : null;
    btn.classList.toggle("is-on", signedIn);
    btn.classList.toggle("has-pic", !!pic);
    const src = pic ?? SILHOUETTE;
    if (img.getAttribute("src") !== src) img.src = src;
    btn.title = signedIn ? "Your profile" : "Sign in";
  };

  btn.addEventListener("click", () => {
    if (opts.wallet.account()) { opts.openProfile(); return; }
    // Signed out: the taskbar's wallet picker (Xverse, WalletConnect, MetaMask) does the signing in.
    document.querySelector<HTMLButtonElement>(".ph-tb-wallet")?.click();
  });
  const offWallet = opts.wallet.subscribe(render);
  const offProfile = opts.profile.subscribe(render);
  window.addEventListener("resize", place);
  place(); render();
  return () => { offWallet(); offProfile(); window.removeEventListener("resize", place); btn.remove(); };
}
