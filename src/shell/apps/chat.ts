/**
 * Chat — one shared room for the people who use Parahawk.
 *
 * Anyone can read along; posting needs the Xverse sign-in (the server session),
 * so every message comes from an address that proved itself. Messages arrive by
 * polling src/web/chat-routes.ts: every 3 s while the window is open and the
 * tab is visible, every 15 s when it is hidden, never after the window closes.
 *
 * Each reply carries the messages plus one entry per author (`authors`, keyed
 * by `ref`): name, picture, badges (Parasite Pool's first, then Parahawk's),
 * and whether it's you. A ref is the
 * author's wallet, or "~<uid>" for someone who keeps their wallet private —
 * this window never sees a private person's address, and never compares
 * addresses itself. Clicking a name or picture opens that person's profile
 * (/u/<ref>).
 *
 * Message text is only ever put on screen as text nodes; links become <a>
 * elements built here, so nothing anyone types is parsed as HTML. The rules
 * (length, links) are src/chat/rules.ts, shared with the server.
 *
 * watchChatUnread() runs from desktop start and keeps the Chat icon's unread
 * count while the window is closed.
 */
import { CHAT_MAX_CHARS, CHAT_PAGE, charCount, cleanBody, splitLinks } from "../../chat/rules";
import { iconBadges } from "../desktop/icon-badges";
import type { ServerSession } from "../session/me";
import type { ProfileSession } from "../session/profile";
import { createLocalStore } from "../session/store";
import type { WalletSession } from "../session/wallet";
import { h } from "../util/dom";
import "./chat.css";

export interface ChatContext {
  me?: ServerSession;
  profile?: ProfileSession;
  wallet?: WalletSession;
  openApp?: (id: string) => void;
  /** Opens a site path in its window — e.g. someone's profile at /u/<ref>. */
  openPath?: (path: string) => void;
}

/** One message as /api/chat/messages sends it; who wrote it is `authors[ref]`. */
interface WireMessage {
  id: number;
  ref: string;
  body: string;
  at: number;
}
/** "pool" = a Parasite Pool badge (shown first, a touch stronger); "parahawk" = one of ours. */
interface BadgeChip { id: string; emoji: string; name: string; kind: "pool" | "parahawk" }
/** One author, as the server describes them to this reader. */
interface WireAuthor {
  /** Wallet address, "~<uid>" (private), or "?<tag>" (couldn't look them up — not a link). */
  ref: string;
  name: string;
  /** True when `name` is a chosen display name rather than a short address. */
  named: boolean;
  avatarUrl: string | null;
  badges: BadgeChip[];
  mine: boolean;
}
interface Viewer { address: string | null; admin: boolean }
interface ListReply { messages: WireMessage[]; authors?: Record<string, WireAuthor>; latestId: number; removed: number[]; viewer: Viewer }

const POLL_VISIBLE_MS = 3_000;
const POLL_HIDDEN_MS = 15_000;
/** Every Nth poll re-reads the latest page, so renames, new pictures and badges catch up. */
const FULL_REFRESH_EVERY = 20;
const UNREAD_POLL_MS = 45_000;
/** Messages an open window keeps. */
const KEEP = 300;
/** Back-to-back messages from one person within this long share one name line. */
const GROUP_MS = 5 * 60_000;
/** Badge chips shown next to a name (owner: "worst case it'll show two then say +4"); the rest fold into "+N". */
const SHOW_BADGES = 2;
const SEEN_KEY = "chat.lastSeen";
const ID = "chat";

const seenStore = createLocalStore();
/** Chat windows mounted right now (the app is a singleton, so 0 or 1). */
let openWindows = 0;

const readSeen = (): number | null => {
  const v = seenStore.get<number>(SEEN_KEY);
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
};
const writeSeen = (id: number) => { seenStore.set(SEEN_KEY, id); };

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

// ── Authors ──────────────────────────────────────────────────────────────────

/** Read one author off the wire defensively: a malformed entry becomes a plain, unlinked one. */
function readAuthor(ref: string, raw: unknown): WireAuthor {
  const a = (raw ?? {}) as Partial<WireAuthor>;
  const avatar = typeof a.avatarUrl === "string" && a.avatarUrl.startsWith("/") && !a.avatarUrl.startsWith("//") ? a.avatarUrl : null;
  const badges = Array.isArray(a.badges)
    ? a.badges
      .filter((b): b is BadgeChip => !!b && typeof b.emoji === "string" && typeof b.name === "string")
      .map((b): BadgeChip => ({ id: String(b.id ?? b.name), emoji: b.emoji, name: b.name, kind: b.kind === "pool" ? "pool" : "parahawk" }))
    : [];
  return {
    ref,
    name: typeof a.name === "string" && a.name !== "" ? a.name : "Someone",
    named: a.named === true,
    avatarUrl: avatar,
    badges,
    mine: a.mine === true,
  };
}

const sameAuthor = (a: WireAuthor, b: WireAuthor) =>
  a.name === b.name && a.named === b.named && a.avatarUrl === b.avatarUrl && a.mine === b.mine &&
  a.badges.length === b.badges.length &&
  a.badges.every((x, i) => x.id === b.badges[i]!.id && x.emoji === b.badges[i]!.emoji && x.kind === b.badges[i]!.kind);

/** A ref that leads somewhere: a wallet or a private uid. "?…" tags don't. */
const linkable = (ref: string) => ref !== "" && !ref.startsWith("?");

// ── Formatting ───────────────────────────────────────────────────────────────

/** A steady colour per person, from the shell's palette, so people are easy to tell apart. */
const NAME_COLORS = ["#8fd14f", "#f5c451", "#6ec8ff", "#ff9e6e", "#c59bff", "#5fd3b8", "#ff7aa8", "#d8dde6"];
function colorFor(ref: string): string {
  let n = 0;
  for (let i = 0; i < ref.length; i++) n = (n * 31 + ref.charCodeAt(i)) >>> 0;
  return NAME_COLORS[n % NAME_COLORS.length]!;
}

/** The letter on a picture-less avatar: a name's first character, or a wallet's first character after its prefix. */
function initialFor(a: WireAuthor): string {
  if (a.ref.startsWith("?")) return "?";
  const src = a.named ? a.name : a.name.replace(/^(bc1[qp]|tb1[qp]|[13])/i, "");
  const ch = [...src].find((c) => /[\p{L}\p{N}]/u.test(c)) ?? [...src][0] ?? "?";
  return ch.toUpperCase();
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const startOfDay = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
function dayLabel(ms: number): string {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const d = new Date(ms);
  return d.toLocaleDateString([], {
    weekday: "short", month: "short", day: "numeric",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}),
  });
}

/** The body as text nodes and links — never HTML. */
function bodyNodes(text: string): Array<Node | string> {
  return splitLinks(text).map((p) =>
    p.kind === "link" ? h("a", { href: p.href, target: "_blank", rel: "noopener noreferrer" }, p.text) : p.text);
}

/** A round picture, or a coloured circle with their initial when there's none (or it fails to load). */
function avatarEl(a: WireAuthor): HTMLElement {
  const el = h("span", { class: "ph-chat-av", style: `background:${colorFor(a.ref)}` }, h("span", { class: "ph-chat-av-l" }, initialFor(a)));
  if (a.avatarUrl) {
    const img = h("img", { src: a.avatarUrl, alt: "", loading: "lazy", decoding: "async", draggable: "false" });
    img.addEventListener("error", () => img.remove(), { once: true });
    el.append(img);
  }
  return el;
}

/** "Block Finder · Parasite Pool" — what a chip's tooltip says. */
const badgeTitle = (b: BadgeChip) => `${b.name} · ${b.kind === "pool" ? "Parasite Pool" : "Parahawk"}`;

/**
 * Their badges as emoji chips: the first SHOW_BADGES (pool badges come first),
 * then "+N" whose tooltip lists the rest.
 */
function badgesEl(a: WireAuthor): HTMLElement | null {
  if (a.badges.length === 0) return null;
  const shown = a.badges.slice(0, SHOW_BADGES);
  const rest = a.badges.slice(SHOW_BADGES);
  return h("span", { class: "ph-chat-badges", role: "img", "aria-label": `Badges: ${a.badges.map(badgeTitle).join(", ")}` },
    ...shown.map((b) => h("span", { class: `ph-chat-badge${b.kind === "pool" ? " is-pool" : ""}`, title: badgeTitle(b), "aria-hidden": "true" }, b.emoji)),
    rest.length > 0
      ? h("span", { class: "ph-chat-more", title: rest.map(badgeTitle).join("\n"), "aria-hidden": "true" }, `+${rest.length}`)
      : null);
}

// ── The window ───────────────────────────────────────────────────────────────

export function mountChat(host: HTMLElement, ctx: ChatContext): (() => void) | void {
  const { me, profile, openPath } = ctx;
  host.classList.add("ph-chat");
  openWindows++;
  iconBadges.set(ID, null);

  let msgs: WireMessage[] = [];
  /** Everyone this window has messages from, by ref. */
  const authors = new Map<string, WireAuthor>();
  let viewer: Viewer = { address: me?.current().address ?? null, admin: me?.isAdmin() ?? false };
  /** The highest id this window has accounted for; the next poll asks for anything newer. */
  let cursor: number | null = null;
  let loaded = false;
  let alive = true;
  let polls = 0;
  /** Re-read the latest page on the next poll (the reader changed, so "mine" did). */
  let wantFull = false;
  /** What the list currently shows at its end, for appending without a full repaint. */
  let tail: { day: number; last: WireMessage | null } = { day: -1, last: null };

  const authorOf = (m: WireMessage): WireAuthor =>
    authors.get(m.ref) ?? { ref: m.ref, name: "Someone", named: false, avatarUrl: null, badges: [], mine: false };

  /** Opens someone's profile window. */
  const openProfile = (a: WireAuthor) => {
    if (openPath && linkable(a.ref)) openPath(`/u/${encodeURIComponent(a.ref)}`);
  };

  // ── Frame ────────────────────────────────────────────────────────────────
  const postingAs = h("p", { class: "ph-chat-as" });
  const head = h("header", { class: "ph-chat-head" },
    h("div", {}, h("h1", {}, "Chat"), h("p", {}, "One room for everyone on Parahawk.")),
    postingAs);

  const list = h("div", { class: "ph-chat-list", role: "log", "aria-live": "polite", "aria-label": "Messages", tabindex: 0 });
  const pill = h("button", { class: "ph-chat-pill", type: "button", hidden: true }, "New messages ↓");
  const wrap = h("div", { class: "ph-chat-wrap" }, list, pill);

  const input = h("textarea", { class: "ph-chat-input", rows: 1, placeholder: "Say something…", "aria-label": "Message", spellcheck: "true" });
  const send = h("button", { class: "ph-chat-send", type: "submit" }, "Send");
  const form = h("form", { class: "ph-chat-form" }, input, send);
  const err = h("p", { class: "ph-chat-err", role: "alert" });
  const counter = h("span", { class: "ph-chat-count" });
  const composer = h("div", { class: "ph-chat-composer" }, form, h("div", { class: "ph-chat-foot" }, err, counter));
  const signin = h("p", { class: "ph-chat-signin" });
  const bottom = h("div", { class: "ph-chat-bottom" });
  const status = h("p", { class: "ph-chat-status", "aria-live": "polite" });

  host.replaceChildren(head, wrap, status, bottom);

  // ── Scrolling ────────────────────────────────────────────────────────────
  const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 24;
  const toBottom = () => { list.scrollTop = list.scrollHeight; pill.hidden = true; };
  list.addEventListener("scroll", () => { if (atBottom()) pill.hidden = true; });
  pill.addEventListener("click", () => { toBottom(); input.focus({ preventScroll: true }); });

  // ── Messages ─────────────────────────────────────────────────────────────
  const canDelete = (m: WireMessage) => viewer.admin || (viewer.address !== null && authorOf(m).mine);

  /** The name (and, for the first line of a group, the picture) — a link to their profile when there is one. */
  const whoEl = (a: WireAuthor): HTMLElement => {
    const name = h("span", { class: `ph-chat-name${a.named ? "" : " is-addr"}`, style: `color:${colorFor(a.ref)}` }, a.name);
    if (!openPath || !linkable(a.ref)) return h("span", { class: "ph-chat-who" }, name);
    const btn = h("button", { class: "ph-chat-who is-link", type: "button", title: `View ${a.name}'s profile` }, name);
    btn.addEventListener("click", () => openProfile(a));
    return btn;
  };

  const messageEl = (m: WireMessage, cont: boolean): HTMLElement => {
    const a = authorOf(m);
    const when = new Date(m.at);
    const el = h("div", { class: `ph-chat-msg${a.mine ? " is-mine" : ""}${cont ? " is-cont" : ""}`, "data-id": String(m.id) },
      cont ? null : h("div", { class: "ph-chat-meta" },
        whoEl(a),
        badgesEl(a),
        a.mine ? h("span", { class: "ph-chat-you" }, "you") : null,
        h("time", { class: "ph-chat-time", datetime: when.toISOString(), title: when.toLocaleString() }, clock(m.at))),
      h("div", { class: "ph-chat-body", title: cont ? `${a.name} · ${when.toLocaleString()}` : null }, ...bodyNodes(m.body)));
    if (!cont) {
      // The picture sits in the left gutter of a group's first line; it opens the profile too
      // (mouse only — the name button is the keyboard stop).
      const av = avatarEl(a);
      av.classList.add("ph-chat-msg-av");
      if (openPath && linkable(a.ref)) {
        av.classList.add("is-link");
        av.setAttribute("aria-hidden", "true");
        av.title = `View ${a.name}'s profile`;
        av.addEventListener("click", () => openProfile(a));
      } else {
        av.setAttribute("aria-hidden", "true");
      }
      el.prepend(av);
    }
    if (canDelete(m)) {
      const del = h("button", { class: "ph-chat-del", type: "button", title: "Delete message", "aria-label": `Delete message from ${a.name}` }, "×");
      let armed = 0;
      del.addEventListener("click", () => {
        if (!armed) {
          // Two clicks: the first arms it, so a stray click never deletes anything.
          del.textContent = "Delete?";
          del.classList.add("is-armed");
          armed = window.setTimeout(() => { armed = 0; del.textContent = "×"; del.classList.remove("is-armed"); }, 3_000);
          return;
        }
        window.clearTimeout(armed);
        armed = 0;
        del.disabled = true;
        void remove(m.id).finally(() => { del.disabled = false; });
      });
      el.append(del);
    }
    return el;
  };

  const dayEl = (ms: number) => h("div", { class: "ph-chat-day", role: "separator" }, h("span", {}, dayLabel(ms)));
  const emptyEl = () => h("p", { class: "ph-chat-empty" },
    viewer.address ? "No messages yet — say hi." : "No messages yet.");

  /** Add messages to the end of the list without touching what is already there (screen readers hear only the new ones). */
  const appendEls = (fresh: WireMessage[]) => {
    if (fresh.length === 0) return;
    list.querySelector(".ph-chat-empty")?.remove();
    const frag = document.createDocumentFragment();
    for (const m of fresh) {
      const day = startOfDay(m.at);
      if (day !== tail.day) { frag.append(dayEl(m.at)); tail = { day, last: null }; }
      const prev = tail.last;
      frag.append(messageEl(m, prev !== null && prev.ref === m.ref && m.at - prev.at < GROUP_MS));
      tail.last = m;
    }
    list.append(frag);
  };

  /** Repaint the whole list (deletions, renames, a different viewer), keeping the reader where they were. */
  const repaint = () => {
    const stick = atBottom();
    const top = list.scrollTop;
    list.replaceChildren();
    tail = { day: -1, last: null };
    // Forget people whose messages have all scrolled out of what this window keeps.
    const used = new Set(msgs.map((m) => m.ref));
    for (const ref of [...authors.keys()]) if (!used.has(ref)) authors.delete(ref);
    if (msgs.length === 0) list.append(emptyEl()); else appendEls(msgs);
    if (stick) toBottom(); else list.scrollTop = top;
    paintComposer();
  };

  /** Fold a server reply into the window. `page` = it was a "latest page" read, not an "after" read. */
  const apply = (reply: ListReply, page: boolean) => {
    let needRepaint = false;
    if (reply.viewer.address !== viewer.address || reply.viewer.admin !== viewer.admin) {
      viewer = { address: reply.viewer.address, admin: reply.viewer.admin === true };
      needRepaint = true;
    }

    // Who's who: a changed name, picture, badge or "mine" redraws their lines.
    for (const [ref, raw] of Object.entries(reply.authors ?? {})) {
      const next = readAuthor(ref, raw);
      const have = authors.get(ref);
      if (!have) { authors.set(ref, next); continue; }
      if (!sameAuthor(have, next)) { authors.set(ref, next); needRepaint = true; }
    }

    const gone = new Set(reply.removed);
    if (gone.size > 0) {
      const before = msgs.length;
      msgs = msgs.filter((m) => !gone.has(m.id));
      if (msgs.length !== before) needRepaint = true;
    }

    const byId = new Map(msgs.map((m) => [m.id, m]));
    const newest = msgs.length ? msgs[msgs.length - 1]!.id : 0;
    const appended: WireMessage[] = [];
    for (const raw of reply.messages) {
      if (gone.has(raw.id) || typeof raw.ref !== "string") continue;
      const m: WireMessage = { id: raw.id, ref: raw.ref, body: raw.body, at: raw.at };
      const have = byId.get(m.id);
      if (have) {
        // Someone switched privacy on or off: their old lines move to the new ref.
        if (have.ref !== m.ref) { have.ref = m.ref; needRepaint = true; }
        continue;
      }
      if (m.id > newest) appended.push(m); else needRepaint = true; // a late arrival lands in the middle
      msgs.push(m);
      byId.set(m.id, m);
    }
    msgs.sort((a, b) => a.id - b.id);
    if (msgs.length > KEEP) { msgs = msgs.slice(-KEEP); needRepaint = true; }

    // Move the cursor. A short read means nothing newer existed when the server
    // looked (it reads latestId first), so deleted ids up to there are skipped too.
    const maxSeen = reply.messages.reduce((n, m) => Math.max(n, m.id), cursor ?? 0);
    cursor = page || reply.messages.length < CHAT_PAGE ? Math.max(maxSeen, reply.latestId) : maxSeen;

    const stick = atBottom();
    if (!loaded) { loaded = true; repaint(); toBottom(); }
    else if (needRepaint) repaint();
    else if (appended.length > 0) {
      appendEls(appended);
      const mineOnly = appended.every((m) => authorOf(m).mine);
      if (stick || mineOnly) toBottom(); else pill.hidden = false;
    }
    writeSeen(cursor);
    iconBadges.set(ID, null);
  };

  const setStatus = (text: string, bad = false) => {
    status.textContent = text;
    status.classList.toggle("is-bad", bad);
  };

  // ── Polling ──────────────────────────────────────────────────────────────
  let timer = 0;
  let busy = false;
  const pull = async (page: boolean) => {
    let after = page || cursor === null ? null : cursor;
    // Catch up in pages after a long sleep; a few rounds at most per poll.
    for (let round = 0; round < 4 && alive; round++) {
      const url = after === null ? `/api/chat/messages?limit=${CHAT_PAGE}` : `/api/chat/messages?after=${after}&limit=${CHAT_PAGE}`;
      const r = await fetchJson<ListReply>(url);
      if (!alive) return;
      if (!r.ok || !r.data || !Array.isArray(r.data.messages)) {
        setStatus(loaded ? "Reconnecting…" : "Couldn't reach the chat. Trying again…", true);
        if (!loaded) list.replaceChildren(h("p", { class: "ph-chat-empty" }, "Loading…"));
        return;
      }
      setStatus("");
      apply(r.data, after === null);
      if (after === null || r.data.messages.length < CHAT_PAGE) return;
      after = cursor;
    }
  };
  const delay = () => (document.visibilityState === "visible" ? POLL_VISIBLE_MS : POLL_HIDDEN_MS);
  const schedule = (ms: number) => {
    window.clearTimeout(timer);
    if (alive) timer = window.setTimeout(() => { void poll(); }, ms);
  };
  const poll = async () => {
    if (!alive) return;
    if (busy) { schedule(delay()); return; }
    busy = true;
    try {
      polls++;
      const full = !loaded || wantFull || polls % FULL_REFRESH_EVERY === 0;
      wantFull = false;
      await pull(full);
    } finally {
      busy = false;
      schedule(delay());
    }
  };
  const onVisibility = () => { if (document.visibilityState === "visible") schedule(0); };
  document.addEventListener("visibilitychange", onVisibility);

  // ── Deleting ─────────────────────────────────────────────────────────────
  const remove = async (id: number) => {
    const r = await fetchJson<{ ok?: boolean; error?: string }>(`/api/chat/messages/${id}`, { method: "DELETE" });
    if (!alive) return;
    if (r.ok || r.status === 404) {
      msgs = msgs.filter((m) => m.id !== id);
      repaint();
      err.textContent = "";
    } else {
      err.textContent = r.data?.error ?? "Couldn't delete that — try again.";
    }
  };

  // ── Composer ─────────────────────────────────────────────────────────────
  let sending = false;
  const paintCounter = () => {
    const n = charCount(input.value.trim());
    counter.textContent = n >= CHAT_MAX_CHARS - 100 ? `${n}/${CHAT_MAX_CHARS}` : "";
    counter.classList.toggle("is-over", n > CHAT_MAX_CHARS);
    send.disabled = sending || n === 0;
  };
  const grow = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight + 2, 132)}px`;
  };
  input.addEventListener("input", () => { paintCounter(); grow(); if (err.textContent) err.textContent = ""; });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (sending) return;
    const checked = cleanBody(input.value);
    if (!checked.ok) { err.textContent = checked.error; return; }
    sending = true;
    paintCounter();
    void (async () => {
      const r = await fetchJson<{ ok?: boolean; message?: WireMessage; authors?: Record<string, WireAuthor>; error?: string }>("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: checked.body }),
      });
      sending = false;
      if (!alive) return;
      if (r.ok && r.data?.message) {
        input.value = "";
        grow();
        err.textContent = "";
        apply({ messages: [r.data.message], authors: r.data.authors ?? {}, latestId: cursor ?? 0, removed: [], viewer }, false);
        toBottom();
      } else if (r.status === 401) {
        err.textContent = "Your sign-in has expired — connect Xverse again from the taskbar.";
        void me?.refresh();
      } else {
        err.textContent = r.data?.error ?? "Couldn't send — check your connection.";
      }
      paintCounter();
      input.focus({ preventScroll: true });
    })();
  });

  /** Who you are posting as (with your picture, once the room has seen you), and whether you can post at all. */
  function paintComposer() {
    const signedIn = viewer.address !== null;
    if (signedIn) {
      const self = [...authors.values()].find((a) => a.mine) ?? null;
      const chosen = profile?.current().address === viewer.address ? profile.current().displayName : null;
      const label = chosen ?? self?.name ?? `${viewer.address!.slice(0, 6)}…${viewer.address!.slice(-4)}`;
      const color = colorFor(self?.ref ?? viewer.address!);
      const av = self ? avatarEl({ ...self, name: label, named: chosen != null || self.named }) : null;
      av?.classList.add("ph-chat-as-av");
      av?.setAttribute("aria-hidden", "true");
      postingAs.replaceChildren("posting as ", ...(av ? [av] : []), h("b", { style: `color:${color}` }, label));
      if (bottom.firstChild !== composer) bottom.replaceChildren(composer);
      paintCounter();
    } else {
      postingAs.replaceChildren(h("span", { class: "ph-chat-ro" }, "read-only"));
      signin.replaceChildren("Chat needs the ", h("strong", {}, "Xverse"), " sign-in — taskbar → ", h("strong", {}, "Connect wallet"), ".");
      bottom.replaceChildren(signin);
    }
  }

  // ── Who's here ───────────────────────────────────────────────────────────
  const offMe = me?.subscribe((now) => {
    if (now.address === viewer.address && now.admin === viewer.admin) return;
    viewer = { address: now.address, admin: now.admin };
    // "mine" belongs to the old reader: guess from the wallet for now (a public
    // ref IS the wallet), then let the next full read settle it — private refs too.
    for (const [ref, a] of authors) authors.set(ref, { ...a, mine: now.address !== null && ref === now.address });
    wantFull = true;
    repaint();
    schedule(0);
  });
  // Your own rename shows on your messages straight away; others' arrive with the next full read.
  const offProfile = profile?.subscribe((p) => {
    let changed = false;
    if (p.address && p.address === viewer.address && p.displayName) {
      for (const [ref, a] of authors) {
        if (a.mine && (a.name !== p.displayName || !a.named)) { authors.set(ref, { ...a, name: p.displayName, named: true }); changed = true; }
      }
    }
    if (changed) repaint(); else paintComposer();
  });

  paintComposer();
  list.append(h("p", { class: "ph-chat-empty" }, "Loading…"));
  schedule(0);
  if (viewer.address) input.focus({ preventScroll: true });

  return () => {
    alive = false;
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    offMe?.();
    offProfile?.();
    if (cursor !== null) writeSeen(cursor);
    openWindows = Math.max(0, openWindows - 1);
    host.classList.remove("ph-chat");
  };
}

// ── The icon's unread count ──────────────────────────────────────────────────

/**
 * Runs from desktop start (main.ts) while the Chat window is closed: keeps the
 * Chat icon's unread badge current. Counts other people's messages after the
 * last one this browser saw. A browser that has never opened Chat starts from
 * "now" rather than showing the whole backlog as unread.
 */
export function watchChatUnread(me: ServerSession): () => void {
  let timer = 0;
  let alive = true;
  let busy = false;

  const schedule = (ms: number) => {
    window.clearTimeout(timer);
    if (alive) timer = window.setTimeout(() => { void check(); }, ms);
  };
  const paint = (count: number) => {
    iconBadges.set(ID, count > 0
      ? { text: count > 9 ? "9+" : String(count), label: `${count} unread message${count === 1 ? "" : "s"}` }
      : null);
  };
  const check = async () => {
    if (!alive) return;
    if (busy || openWindows > 0 || document.visibilityState !== "visible") { schedule(UNREAD_POLL_MS); return; }
    busy = true;
    try {
      const seen = readSeen();
      const r = await fetchJson<{ latestId?: number; count?: number }>(`/api/chat/unread?after=${seen ?? 0}`);
      if (!alive || openWindows > 0 || !r.ok || !r.data) return;
      const latest = typeof r.data.latestId === "number" ? r.data.latestId : 0;
      if (seen === null || latest < seen) {
        // First visit (or a room that was reset): start counting from now.
        writeSeen(latest);
        paint(0);
      } else {
        paint(typeof r.data.count === "number" ? r.data.count : 0);
      }
    } finally {
      busy = false;
      schedule(UNREAD_POLL_MS);
    }
  };

  const offOpened = iconBadges.onOpened((id) => { if (id === ID) iconBadges.set(ID, null); });
  const onVisibility = () => { if (document.visibilityState === "visible") schedule(1_500); };
  document.addEventListener("visibilitychange", onVisibility);
  // Signing in or out changes whose messages count as "others'".
  const offMe = me.subscribe(() => schedule(1_500));
  schedule(5_000);

  return () => {
    alive = false;
    window.clearTimeout(timer);
    offOpened();
    offMe();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
