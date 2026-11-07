/**
 * Profile — the window that appears once a wallet is connected.
 *
 * Top to bottom: who you are (your display name, editable once you've signed
 * in with Xverse, and the address it belongs to), then the Parahawk dropdown:
 * your pool side — wallet page, returns, rentals and the Parahawk badges
 * (profile-parahawk.ts). Open by default; it remembers being open or shut, per
 * browser.
 *
 * The BTC Hunters dropdown (collection + practice runs) was taken out on
 * 2026-11-06 until the NFT project ships — it last lived in commit a72a834.
 */
import "./profile.css";
import { NAME_MAX, NAME_MIN, checkName, sameAddress, tidyName } from "../../profile/rules";
import type { ServerSession } from "../session/me";
import type { ProfileSession } from "../session/profile";
import type { TickFeed } from "../data/tick";
import type { WalletAccount, WalletSession } from "../session/wallet";
import { createLocalStore, type KeyValueStore } from "../session/store";
import { h } from "../util/dom";
import { mountParahawkSection } from "./profile-parahawk";
import { avatarEl, shrinkPicture } from "./avatar";

/** What the Profile window is given (registry.ts). Only the wallet is required. */
export interface ProfileContext {
  wallet: WalletSession;
  me?: ServerSession;
  /** Display name (session/profile.ts). */
  profile?: ProfileSession;
  tick?: TickFeed;
  openApp?: (id: string) => void;
  /** Opens a site path in its window — e.g. the wallet page `/address/<addr>`. */
  openPath?: (path: string) => void;
}

const CHAIN_LABEL: Record<WalletAccount["chain"], string> = { bitcoin: "Bitcoin", evm: "Ethereum / EVM" };
const WALLET_LABEL: Record<WalletAccount["id"], string> = { xverse: "Xverse", walletconnect: "WalletConnect" };

/** Which dropdowns are open, per browser (store key → "ph.profile.drops"). */
const DROPS_KEY = "profile.drops";
type DropId = "parahawk";
type Drops = Partial<Record<DropId, boolean>>;

function readDrops(store: KeyValueStore): Drops {
  const raw = store.get<unknown>(DROPS_KEY);
  if (!raw || typeof raw !== "object") return {};
  const out: Drops = {};
  for (const id of ["parahawk"] as const) {
    const v = (raw as Record<string, unknown>)[id];
    if (typeof v === "boolean") out[id] = v;
  }
  return out;
}

/** Builds the window for one connected wallet. Returns its cleanup. */
function mountAccount(host: HTMLElement, acct: WalletAccount, ctx: ProfileContext, prefs: KeyValueStore): () => void {
  const { wallet: session, me, profile, tick, openPath } = ctx;
  const cleanups: Array<() => void> = [];

  // ── Display name ─────────────────────────────────────────────────────────
  // Only an address the server has seen a signature for can own a name: the
  // Xverse sign-in. Any other wallet gets the reason instead of a form.
  const nameEl = h("h1", { class: "ph-prof-name" });
  const editBtn = h("button", { class: "ph-prof-btn", type: "button" }, "Set a name");
  const input = h("input", {
    class: "ph-prof-input", type: "text", maxlength: NAME_MAX + 4, autocomplete: "off", spellcheck: "false",
    "aria-label": "Display name", placeholder: "Pick a name",
  });
  const save = h("button", { class: "ph-prof-btn ph-prof-btn-go", type: "submit" }, "Save");
  const cancel = h("button", { class: "ph-prof-btn", type: "button" }, "Cancel");
  const clear = h("button", { class: "ph-prof-btn ph-prof-btn-link", type: "button" }, "Remove name");
  const form = h("form", { class: "ph-prof-name-form", novalidate: true }, input, save, cancel, clear);
  const err = h("p", { class: "ph-prof-err", role: "alert" });
  const hint = h("p", { class: "ph-prof-hint" },
    `${NAME_MIN}–${NAME_MAX} letters, numbers, spaces or _ - . — shown in Chat, in the taskbar, and next to your wallet across Parahawk.`);
  const locked = h("p", { class: "ph-prof-note ph-prof-locked" },
    "Display names need the Xverse sign-in (one signed message, nothing spent).");

  let editing = false;
  let busy = false;
  let loading = false;

  /** Signed in on the server as this very wallet. */
  const canName = () => profile != null && sameAddress(me?.current().address, acct.address);
  const currentName = (): string | null => {
    const p = profile?.current();
    return p && sameAddress(p.address, acct.address) ? p.displayName : null;
  };

  const paintName = () => {
    const can = canName();
    if (!can) editing = false;
    const name = currentName();
    nameEl.textContent = name ?? (loading ? "…" : "No display name yet");
    nameEl.classList.toggle("is-empty", name == null);
    editBtn.textContent = name ? "Edit name" : "Set a name";
    editBtn.hidden = !can || editing;
    form.hidden = !editing;
    hint.hidden = !editing;
    clear.hidden = name == null;
    locked.hidden = can || profile == null;
    input.disabled = busy;
    for (const b of [save, cancel, clear]) b.disabled = busy;
    save.textContent = busy ? "Saving…" : "Save";
  };

  const startEdit = () => {
    editing = true;
    input.value = currentName() ?? "";
    err.textContent = "";
    paintName();
    input.focus();
    input.select();
  };
  const stopEdit = () => {
    editing = false;
    err.textContent = "";
    paintName();
    editBtn.focus();
  };

  const saveName = async (next: string | null) => {
    if (!profile || busy) return;
    busy = true;
    err.textContent = "";
    paintName();
    try {
      await profile.setDisplayName(next);
      busy = false;
      stopEdit();
    } catch (e) {
      busy = false;
      err.textContent = (e as Error).message;
      paintName();
      input.focus();
    }
  };

  editBtn.addEventListener("click", startEdit);
  cancel.addEventListener("click", stopEdit);
  clear.addEventListener("click", () => { void saveName(null); });
  input.addEventListener("keydown", (ev) => {
    // Escape backs out of the edit, and goes no further (it isn't a close-the-window).
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); stopEdit(); }
  });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const typed = tidyName(input.value);
    const now = currentName();
    if (typed === (now ?? "")) { stopEdit(); return; }
    if (typed === "") { err.textContent = "Type a name, or press Remove name to go back to your address."; input.focus(); return; }
    // Instant feedback with the server's own rules; the server still decides (taken, limits).
    const checked = checkName(typed, { admin: me?.isAdmin() === true });
    if (!checked.ok) { err.textContent = checked.error; input.focus(); return; }
    void saveName(checked.name);
  });

  /** Ask for the name fresh each time the window opens for a signed-in wallet. */
  const loadName = async () => {
    if (!profile || !canName()) return;
    loading = true;
    paintName();
    await profile.refresh();
    loading = false;
    paintName();
  };
  /** Your own profile as the server last told us — only when it's this wallet's. */
  const ownInfo = () => {
    const p = profile?.current();
    return p && sameAddress(p.address, acct.address) ? p : null;
  };

  // ── Picture ──────────────────────────────────────────────────────────────
  // Cropped and shrunk to 128×128 in the browser (avatar.ts), checked again on the server.
  const picHost = h("div", { class: "ph-prof-pic" });
  const picInput = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true, tabindex: -1 });
  const picBtn = h("button", { class: "ph-prof-btn", type: "button" }, "Add a picture");
  const picRemove = h("button", { class: "ph-prof-btn ph-prof-btn-link", type: "button" }, "Remove picture");
  const picErr = h("p", { class: "ph-prof-err", role: "alert" });
  const picRow = h("div", { class: "ph-prof-pic-row" }, picBtn, picRemove, picInput);
  let picBusy = false;

  const paintPic = () => {
    const own = ownInfo();
    const url = own?.avatarUrl ?? null;
    picHost.replaceChildren(avatarEl({ url, name: currentName(), seed: acct.address, size: 64 }));
    const can = canName();
    picRow.hidden = !can;
    picRemove.hidden = !url;
    picBtn.textContent = picBusy ? "Saving…" : url ? "Change picture" : "Add a picture";
    picBtn.disabled = picBusy;
    picRemove.disabled = picBusy;
  };

  const savePicture = async (make: () => Promise<string | null>) => {
    if (!profile || picBusy) return;
    picBusy = true;
    picErr.textContent = "";
    paintPic();
    try {
      await profile.setAvatar(await make());
    } catch (e) {
      picErr.textContent = (e as Error).message;
    } finally {
      picBusy = false;
      paintPic();
    }
  };
  picBtn.addEventListener("click", () => picInput.click());
  picInput.addEventListener("change", () => {
    const file = picInput.files?.[0];
    picInput.value = "";
    if (file) void savePicture(() => shrinkPicture(file));
  });
  picRemove.addEventListener("click", () => { void savePicture(async () => null); });

  // ── Privacy ──────────────────────────────────────────────────────────────
  // On by default: your name shows in ( ) next to your wallet across Parahawk.
  // Off: your name and your wallet are never shown together anywhere.
  const privBox = h("input", { type: "checkbox", class: "ph-prof-check" });
  const privRow = h("label", { class: "ph-prof-priv" }, privBox, h("span", {}, "Show my name next to my wallet"));
  const privHint = h("p", { class: "ph-prof-hint ph-prof-priv-hint" });
  const privErr = h("p", { class: "ph-prof-err", role: "alert" });
  const publicLink = h("button", { class: "ph-prof-btn ph-prof-btn-link ph-prof-public", type: "button" }, "See your public profile");
  let privBusy = false;

  const paintPriv = () => {
    const own = ownInfo();
    const can = canName();
    const isPrivate = own?.isPrivate === true;
    privRow.hidden = !can;
    privHint.hidden = !can;
    privBox.checked = !isPrivate;
    privBox.disabled = privBusy;
    privHint.textContent = isPrivate
      ? "Off: your name and your wallet are never shown together. Chat shows your name, without your wallet."
      : "On: wherever your wallet shows on Parahawk, your name shows next to it, and people can click through to your profile.";
    publicLink.hidden = !can || !ctx.openPath || (isPrivate && !own?.uid);
  };
  privBox.addEventListener("change", () => {
    if (!profile || privBusy) return;
    const wantPrivate = !privBox.checked;
    privBusy = true;
    privErr.textContent = "";
    paintPriv();
    void profile.setPrivate(wantPrivate)
      .catch((e: unknown) => { privErr.textContent = (e as Error).message; })
      .finally(() => { privBusy = false; paintPriv(); });
  });
  publicLink.addEventListener("click", () => {
    const own = ownInfo();
    // Private: your profile's own link, which never spells out your wallet.
    const ref = own?.isPrivate && own.uid ? `~${own.uid}` : acct.address;
    ctx.openPath?.(`/u/${encodeURIComponent(ref)}`);
  });

  if (profile) cleanups.push(profile.subscribe(() => { paintName(); paintPic(); paintPriv(); }));
  if (me) {
    cleanups.push(me.subscribe(() => {
      paintName();
      paintPic();
      paintPriv();
      if (canName() && currentName() == null) void loadName();
    }));
  }

  // ── Identity ─────────────────────────────────────────────────────────────
  const addr = h("code", { class: "ph-prof-addr", title: acct.address }, acct.address);
  const copy = h("button", { class: "ph-prof-btn", type: "button" }, "Copy");
  let copyTimer: number | null = null;
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(acct.address).then(
      () => {
        copy.textContent = "Copied";
        if (copyTimer != null) clearTimeout(copyTimer);
        copyTimer = window.setTimeout(() => { copy.textContent = "Copy"; copyTimer = null; }, 1400);
      },
      () => { copy.textContent = "Press Ctrl+C"; },
    );
  });
  cleanups.push(() => { if (copyTimer != null) clearTimeout(copyTimer); });

  const identity = h("header", { class: "ph-prof-id" },
    h("div", { class: "ph-prof-who" },
      picHost,
      h("div", { class: "ph-prof-who-main" },
        h("div", { class: "ph-prof-name-row" }, nameEl, editBtn),
        form, err, hint, locked, picRow, picErr)),
    privRow, privHint, privErr, publicLink,
    h("div", { class: "ph-prof-id-top" },
      h("span", { class: "ph-prof-tag" }, WALLET_LABEL[acct.id]),
      h("span", { class: "ph-prof-tag" }, CHAIN_LABEL[acct.chain])),
    h("div", { class: "ph-prof-id-addr" }, addr, copy),
    h("p", { class: "ph-prof-dim" },
      "This is a read-only sign-in. Parahawk can see this address and nothing else — it cannot move funds, and it never asks you to sign a transaction to look at your profile."));

  // ── Dropdowns ────────────────────────────────────────────────────────────
  const saved = readDrops(prefs);
  const dropdown = (id: DropId, title: string, sub: string, openByDefault: boolean, body: HTMLElement, onOpen?: () => void) => {
    const d = h("details", { class: "ph-prof-drop", "data-drop": id },
      h("summary", {},
        h("span", { class: "ph-prof-drop-t" }, title),
        h("span", { class: "ph-prof-drop-s" }, sub)),
      body);
    d.open = saved[id] ?? openByDefault;
    if (d.open) onOpen?.();
    d.addEventListener("toggle", () => {
      if (d.open) onOpen?.();
      const all = readDrops(prefs);
      if (all[id] === d.open) return;
      all[id] = d.open;
      prefs.set(DROPS_KEY, all);
    });
    return d;
  };

  // Parahawk: your pool side. Mounted the first time it is open, so a shut
  // dropdown costs nothing.
  const phBody = h("div", { class: "ph-prof-drop-body ph-prof-ph" });
  let phMounted = false;
  const mountPh = () => {
    if (phMounted) return;
    phMounted = true;
    cleanups.push(mountParahawkSection(phBody, {
      account: acct, ...(me ? { me } : {}), ...(tick ? { tick } : {}), ...(openPath ? { openPath } : {}),
    }));
  };
  const parahawk = dropdown("parahawk", "Parahawk", "your wallet page, returns, rentals & badges", true, phBody, mountPh);

  const disconnect = h("button", { class: "ph-prof-btn ph-prof-btn-danger", type: "button" }, "Disconnect");
  disconnect.addEventListener("click", () => session.disconnect());
  const foot = h("footer", { class: "ph-prof-foot" }, disconnect);

  host.replaceChildren(identity, parahawk, foot);
  paintName();
  paintPic();
  paintPriv();
  void loadName();

  return () => { for (const off of cleanups.splice(0)) off(); };
}

export function mountProfile(host: HTMLElement, ctx: ProfileContext): () => void {
  const prefs = createLocalStore();
  host.classList.add("ph-prof");

  let shown: WalletAccount | null = null;
  let teardown: (() => void) | null = null;

  // The wallet session replays on subscribe and fires on every connect, switch
  // and sign-out. The same wallet again keeps the window as it is — no remount,
  // so a half-typed name or an open dropdown survives.
  const show = (acct: WalletAccount | null) => {
    if (acct && shown && acct.id === shown.id && acct.address === shown.address) return;
    teardown?.();
    teardown = null;
    shown = acct;
    if (!acct) {
      host.replaceChildren(h("div", { class: "ph-prof-empty" },
        h("p", {}, "No wallet connected."),
        h("p", { class: "ph-prof-dim" }, "Use ", h("strong", {}, "Connect wallet"), " in the taskbar to sign in again.")));
      return;
    }
    teardown = mountAccount(host, acct, ctx, prefs);
  };
  const offWallet = ctx.wallet.subscribe(show);

  return () => {
    offWallet();
    teardown?.();
    teardown = null;
    host.classList.remove("ph-prof");
  };
}
