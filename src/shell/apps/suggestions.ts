/**
 * Suggestions — a title and a notes box; whatever people write lands with the
 * owner, who reads them in the same window (the Inbox tab, owner only).
 *
 * Anyone can send, signed in or not. Who sent it is the server's call, from the
 * server session (src/web/suggestion-routes.ts); this window only says who it
 * will be. The Inbox tab and the count on the desktop icon read the same API,
 * which answers the owner and refuses everyone else — hiding the tab here is
 * cosmetic.
 */
import {
  NOTES_COUNTER_FROM,
  NOTES_MAX,
  TITLE_MAX,
  badgeText,
  checkSuggestion,
  type InboxItem,
  type InboxPage,
  type SuggestionStatus,
} from "../../suggestions/rules";
import { iconBadges } from "../desktop/icon-badges";
import type { ServerSession } from "../session/me";
import type { ProfileSession } from "../session/profile";
import { shortAddress } from "../session/wallet";
import { h } from "../util/dom";
import "./suggestions.css";

export interface SuggestionsContext {
  me?: ServerSession;
  profile?: ProfileSession;
}

const APP_ID = "suggestions";
const API = "/api/suggestions";
/** How often an open Inbox re-reads itself, and how often the owner's icon count is checked (visible tab only). */
const INBOX_REFRESH_MS = 60_000;
const WATCH_MS = 60_000;
/** Notes up to this long, on one line, are shown whole rather than behind "more". */
const SHORT_NOTES = 160;
/** A Delete has to be clicked twice within this long. */
const ARM_MS = 3_000;

// ── Shared bits ──────────────────────────────────────────────────────────────

/** The Suggestions icon's count of new ones (owner only; nothing for everyone else). */
function paintBadge(n: number): void {
  const text = badgeText(n);
  iconBadges.set(APP_ID, text ? { text, label: `${n} new suggestion${n === 1 ? "" : "s"}` } : null);
}

interface Reply<T> { ok: boolean; status: number; data: T | null }

async function call<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<Reply<T>> {
  try {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

const errorOf = (data: unknown): string | null => {
  const e = (data as { error?: unknown } | null)?.error;
  return typeof e === "string" && e ? e : null;
};
/** Server messages are lower-case fragments ("add some notes"); start them with a capital here. */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const pad = (n: number) => String(n).padStart(2, "0");
/** "18:45" today, "Nov 3 · 18:45" this year, "Nov 3, 2025 · 18:45" before. */
function when(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === today.toDateString()) return time;
  const date = d.toLocaleDateString([], {
    month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" as const } : {}),
  });
  return `${date} · ${time}`;
}

// ── The window ───────────────────────────────────────────────────────────────

export function mountSuggestions(host: HTMLElement, ctx: SuggestionsContext): () => void {
  const { me, profile } = ctx;
  host.classList.add("ph-sug");
  let destroyed = false;
  let tab: "send" | "inbox" = "send";
  /** Set once the person types in the form — the owner's first visit only jumps to the Inbox if they haven't. */
  let touched = false;

  // ── Frame ────────────────────────────────────────────────────────────────
  const head = h("header", { class: "ph-sug-head" },
    h("h1", {}, "Suggestions"),
    h("p", {}, "Ideas, bugs, things that bug you — tell the Parahawk owner."));

  const sendTab = h("button", {
    class: "ph-sug-tab", type: "button", role: "tab", id: "ph-sug-tab-send", "aria-controls": "ph-sug-panel-send", "aria-selected": "true",
  }, "Send");
  const inboxTab = h("button", {
    class: "ph-sug-tab", type: "button", role: "tab", id: "ph-sug-tab-inbox", "aria-controls": "ph-sug-panel-inbox", "aria-selected": "false",
  }, "Inbox");
  // The owner's only: shown once the server session says so.
  const tabs = h("div", { class: "ph-sug-tabs", role: "tablist", "aria-label": "Suggestions", hidden: true }, sendTab, inboxTab);

  // ── Send ─────────────────────────────────────────────────────────────────
  const title = h("input", {
    class: "ph-sug-input", type: "text", name: "title", maxlength: TITLE_MAX, autocomplete: "off",
    placeholder: "What's it about?", "aria-required": "true",
  });
  const notes = h("textarea", {
    class: "ph-sug-input ph-sug-notes", name: "notes", maxlength: NOTES_MAX, rows: 8,
    placeholder: "Tell me more — what you'd change, what broke, what you'd love to see.", "aria-required": "true",
  });
  const counter = h("span", { class: "ph-sug-count", "aria-live": "polite" });
  // The honeypot. People never see it (off-screen, skipped by keyboard and screen
  // readers); a bot that fills every field fills this too, and the server drops it.
  const trap = h("input", { type: "text", name: "website", tabindex: -1, autocomplete: "off" });
  const trapBox = h("div", { class: "ph-sug-trap", "aria-hidden": "true" }, h("label", {}, "Website ", trap));
  const as = h("p", { class: "ph-sug-as" });
  const err = h("p", { class: "ph-sug-err", role: "alert" });
  const send = h("button", { class: "ph-sug-btn ph-sug-btn-primary", type: "submit" }, "Send");
  const form = h("form", { class: "ph-sug-form", novalidate: true },
    h("label", { class: "ph-sug-field" }, h("span", { class: "ph-sug-label" }, "Title"), title),
    h("label", { class: "ph-sug-field" }, h("span", { class: "ph-sug-label" }, "Notes"), notes),
    h("div", { class: "ph-sug-row" }, as, counter),
    trapBox,
    err,
    h("div", { class: "ph-sug-actions" }, send, h("span", { class: "ph-sug-hint" }, "Ctrl+Enter sends")));

  const again = h("button", { class: "ph-sug-btn", type: "button" }, "Send another");
  const thanks = h("div", { class: "ph-sug-thanks", hidden: true },
    h("p", { class: "ph-sug-thanks-h" }, "Thanks — sent to the Parahawk owner."),
    again);
  const sendPanel = h("section", {
    class: "ph-sug-panel", role: "tabpanel", id: "ph-sug-panel-send", "aria-labelledby": "ph-sug-tab-send",
  }, form, thanks);

  // ── Inbox ────────────────────────────────────────────────────────────────
  const inboxMeta = h("p", { class: "ph-sug-meta", "aria-live": "polite" });
  const refresh = h("button", { class: "ph-sug-btn ph-sug-btn-sm", type: "button" }, "Refresh");
  const inboxList = h("div", { class: "ph-sug-list" });
  const inboxPanel = h("section", {
    class: "ph-sug-panel", role: "tabpanel", id: "ph-sug-panel-inbox", "aria-labelledby": "ph-sug-tab-inbox", hidden: true,
  }, h("div", { class: "ph-sug-toolbar" }, inboxMeta, refresh), inboxList);

  host.replaceChildren(head, tabs, sendPanel, inboxPanel);

  // ── Who it's from ────────────────────────────────────────────────────────
  const paintAs = () => {
    const p = profile?.current() ?? null;
    const address = p?.address ?? me?.current().address ?? null;
    if (!address) { as.replaceChildren("Sending as a guest"); return; }
    const name = p && p.address === address ? p.displayName : null;
    as.replaceChildren("Sending as ", h("strong", { title: address }, name ?? shortAddress(address, 6, 4)));
  };

  const paintCounter = () => {
    const n = notes.value.length;
    if (n < NOTES_COUNTER_FROM) { counter.textContent = ""; counter.className = "ph-sug-count"; return; }
    counter.textContent = `${n.toLocaleString("en-US")} / ${NOTES_MAX.toLocaleString("en-US")}`;
    counter.className = `ph-sug-count ${n >= NOTES_MAX ? "is-full" : "is-near"}`;
  };

  const clearInvalid = () => { title.removeAttribute("aria-invalid"); notes.removeAttribute("aria-invalid"); };
  const showError = (message: string, field: "title" | "notes" | null) => {
    err.textContent = sentence(message);
    clearInvalid();
    const el = field === "title" ? title : field === "notes" ? notes : null;
    if (el) { el.setAttribute("aria-invalid", "true"); el.focus(); }
  };

  const onInput = () => { touched = true; err.textContent = ""; clearInvalid(); paintCounter(); };
  title.addEventListener("input", onInput);
  notes.addEventListener("input", onInput);
  // Enter in the title moves on to the notes rather than sending half a suggestion.
  title.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); notes.focus(); }
  });
  notes.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && !ev.isComposing) { ev.preventDefault(); form.requestSubmit(); }
  });

  let sending = false;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (sending) return;
    const checked = checkSuggestion({ title: title.value, notes: notes.value });
    if (!checked.ok) { showError(checked.error, checked.field); return; }
    sending = true;
    send.disabled = true;
    send.textContent = "Sending…";
    err.textContent = "";
    void call<{ ok?: boolean; error?: string; field?: unknown }>("POST", API, {
      title: title.value, notes: notes.value, website: trap.value,
    }).then((r) => {
      if (destroyed) return;
      sending = false;
      send.disabled = false;
      send.textContent = "Send";
      if (r.ok) {
        form.reset();
        touched = false;
        paintCounter();
        form.hidden = true;
        thanks.hidden = false;
        again.focus();
        // The owner sending themselves a note: their inbox count moves too.
        if (me?.isAdmin()) void loadInbox();
        return;
      }
      const field = r.data?.field === "title" || r.data?.field === "notes" ? r.data.field : null;
      showError(
        errorOf(r.data) ?? (r.status === 0 ? "couldn't send — check your connection and try again" : "couldn't send that — try again in a moment"),
        field,
      );
    });
  });

  again.addEventListener("click", () => {
    thanks.hidden = true;
    form.hidden = false;
    title.focus();
  });

  // ── Tabs ─────────────────────────────────────────────────────────────────
  let inbox: InboxPage | null = null;
  let inboxState: "idle" | "loading" | "ready" | "error" = "idle";
  let inboxNote = "";
  let inboxSeq = 0;
  let firstInbox = true;

  const paintTabs = () => {
    sendTab.setAttribute("aria-selected", tab === "send" ? "true" : "false");
    inboxTab.setAttribute("aria-selected", tab === "inbox" ? "true" : "false");
    sendTab.tabIndex = tab === "send" ? 0 : -1;
    inboxTab.tabIndex = tab === "inbox" ? 0 : -1;
    sendPanel.hidden = tab !== "send";
    inboxPanel.hidden = tab !== "inbox";
    const n = inbox?.newCount ?? 0;
    inboxTab.textContent = n > 0 ? `Inbox (${n} new)` : "Inbox";
  };
  const select = (next: "send" | "inbox", focus = false) => {
    if (next === "inbox" && me?.isAdmin() !== true) next = "send";
    const changed = next !== tab;
    tab = next;
    paintTabs();
    if (focus) (tab === "send" ? sendTab : inboxTab).focus();
    if (changed && tab === "inbox") void loadInbox();
  };
  sendTab.addEventListener("click", () => select("send"));
  inboxTab.addEventListener("click", () => select("inbox"));
  tabs.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight" || ev.key === "Home" || ev.key === "End") {
      ev.preventDefault();
      select(ev.key === "ArrowLeft" || ev.key === "Home" ? "send" : "inbox", true);
    }
  });

  // ── Inbox: load + paint ──────────────────────────────────────────────────
  const setCount = (n: number) => {
    if (inbox) inbox.newCount = n;
    paintBadge(n);
    paintTabs();
  };

  const paintInbox = () => {
    if (!inbox) {
      inboxList.replaceChildren(h("p", { class: "ph-sug-empty" },
        inboxState === "error" ? "Couldn't load the inbox. Try Refresh." : "Loading suggestions…"));
      inboxMeta.textContent = "";
      return;
    }
    if (inbox.items.length === 0) {
      inboxList.replaceChildren(h("p", { class: "ph-sug-empty" }, "No suggestions yet. When someone sends one, it shows up here."));
    } else {
      inboxList.replaceChildren(...inbox.items.map(itemEl));
    }
    const total = inbox.items.length;
    inboxMeta.textContent = `${total} ${total === 1 ? "suggestion" : "suggestions"} · ${inbox.newCount} new`
      + (inboxState === "error" ? " · couldn't refresh" : "")
      + (inboxNote ? ` · ${inboxNote}` : "");
  };

  const loadInbox = async () => {
    if (me?.isAdmin() !== true) return;
    const seq = ++inboxSeq;
    inboxState = "loading";
    if (!inbox) paintInbox();
    refresh.disabled = true;
    const r = await call<InboxPage>("GET", `${API}?limit=200`);
    if (destroyed || seq !== inboxSeq) return;
    refresh.disabled = false;
    if (r.ok && r.data && Array.isArray(r.data.items)) {
      inbox = r.data;
      inboxState = "ready";
      inboxNote = "";
      paintBadge(inbox.newCount);
      // The owner opening the window to read: if there are new ones and nothing typed yet, show them.
      if (firstInbox && inbox.newCount > 0 && !touched && tab === "send") { tab = "inbox"; }
      firstInbox = false;
    } else if (r.status === 401 || r.status === 403) {
      // Not the owner after all (signed out elsewhere): back to Send, refresh who we are.
      inbox = null;
      inboxState = "idle";
      tabs.hidden = true;
      tab = "send";
      void me?.refresh();
    } else {
      inboxState = "error";
    }
    paintTabs();
    paintInbox();
  };
  refresh.addEventListener("click", () => { void loadInbox(); });

  const STATUS_LABEL: Record<SuggestionStatus, string> = { new: "NEW", read: "READ", done: "DONE" };

  /** One suggestion in the Inbox, with the owner's actions for its state. */
  function itemEl(item: InboxItem): HTMLElement {
    const from = item.address
      ? h("strong", { title: item.address }, item.name ?? shortAddress(item.address, 6, 4))
      : h("span", {}, "a guest");
    const d = new Date(item.at);
    const isShort = item.notes.length <= SHORT_NOTES && !item.notes.includes("\n");
    const body = isShort
      ? h("p", { class: "ph-sug-notes-full" }, item.notes)
      : h("details", { class: "ph-sug-more" },
          h("summary", {},
            h("span", { class: "ph-sug-preview" }, item.notes.split("\n")[0]!.slice(0, SHORT_NOTES)),
            h("span", { class: "ph-sug-toggle" })),
          h("p", { class: "ph-sug-notes-full" }, item.notes));

    const buttons: HTMLButtonElement[] = [];
    const act = (label: string, run: () => Promise<void>, extra = "") => {
      const b = h("button", { class: `ph-sug-btn ph-sug-btn-sm${extra}`, type: "button" }, label);
      b.addEventListener("click", () => {
        for (const x of buttons) x.disabled = true;
        void run().finally(() => { if (!destroyed) for (const x of buttons) x.disabled = false; });
      });
      buttons.push(b);
      return b;
    };
    const mark = (status: SuggestionStatus) => async () => {
      const r = await call<{ ok?: boolean; newCount?: number }>("PATCH", `${API}/${encodeURIComponent(item.id)}`, { status });
      if (destroyed) return;
      if (r.ok) {
        item.status = status;
        inboxNote = "";
        if (typeof r.data?.newCount === "number") setCount(r.data.newCount);
      } else {
        inboxNote = sentence(errorOf(r.data) ?? "couldn't update that");
        if (r.status === 404) void loadInbox();
      }
      paintInbox();
    };

    if (item.status === "new") act("Mark read", mark("read"));
    if (item.status !== "done") act("Done", mark("done"));
    if (item.status === "done") act("Reopen", mark("read"));

    // Delete takes two clicks: the first arms it for a few seconds.
    const del = h("button", { class: "ph-sug-btn ph-sug-btn-sm ph-sug-btn-del", type: "button" }, "Delete");
    let armed: number | null = null;
    del.addEventListener("click", () => {
      if (armed === null) {
        del.textContent = "Delete? Click again";
        del.classList.add("is-armed");
        armed = window.setTimeout(() => { armed = null; del.textContent = "Delete"; del.classList.remove("is-armed"); }, ARM_MS);
        return;
      }
      clearTimeout(armed);
      armed = null;
      for (const x of buttons) x.disabled = true;
      del.disabled = true;
      void call<{ ok?: boolean; newCount?: number }>("DELETE", `${API}/${encodeURIComponent(item.id)}`).then((r) => {
        if (destroyed) return;
        if (r.ok || r.status === 404) {
          if (inbox) inbox.items = inbox.items.filter((x) => x.id !== item.id);
          inboxNote = "";
          if (typeof r.data?.newCount === "number") setCount(r.data.newCount);
        } else {
          inboxNote = sentence(errorOf(r.data) ?? "couldn't delete that");
        }
        paintInbox();
      });
    });
    buttons.push(del);

    return h("article", { class: `ph-sug-item is-${item.status}` },
      h("header", { class: "ph-sug-item-head" },
        h("span", { class: `ph-sug-status is-${item.status}` }, STATUS_LABEL[item.status]),
        h("h3", { class: "ph-sug-item-title" }, item.title)),
      h("p", { class: "ph-sug-item-meta" },
        "from ", from, " · ",
        h("time", { datetime: d.toISOString(), title: d.toLocaleString() }, when(item.at))),
      body,
      h("div", { class: "ph-sug-item-actions" }, ...buttons));
  }

  // ── Owner or not ─────────────────────────────────────────────────────────
  const paintOwner = () => {
    const owner = me?.isAdmin() === true;
    tabs.hidden = !owner;
    if (!owner) {
      inbox = null;
      inboxState = "idle";
      firstInbox = true;
      if (tab === "inbox") tab = "send";
      paintTabs();
      return;
    }
    paintTabs();
    if (inboxState === "idle") void loadInbox();
  };

  const offProfile = profile?.subscribe(() => paintAs());
  const offMe = me?.subscribe(() => { paintAs(); paintOwner(); });
  paintAs();
  paintCounter();
  paintTabs();
  paintOwner();

  // An open Inbox keeps itself current while the page is visible.
  const timer = window.setInterval(() => {
    if (tab === "inbox" && document.visibilityState === "visible") void loadInbox();
  }, INBOX_REFRESH_MS);

  return () => {
    destroyed = true;
    clearInterval(timer);
    offProfile?.();
    offMe?.();
    host.classList.remove("ph-sug");
  };
}

/**
 * Runs from desktop start (main.ts): for the owner only, keeps a count of new
 * suggestions on the Suggestions icon. Checks every minute while the tab is
 * visible, and straight away when it becomes visible or the owner signs in;
 * everyone else never asks and never sees a badge.
 */
export function watchSuggestionsInbox(me: ServerSession): () => void {
  let timer: number | null = null;
  let seq = 0;

  const poll = async () => {
    if (!me.isAdmin() || document.visibilityState === "hidden") return;
    const mine = ++seq;
    const r = await call<{ new?: unknown }>("GET", `${API}/count`);
    if (mine !== seq || !me.isAdmin()) return;
    if (r.ok && typeof r.data?.new === "number") paintBadge(r.data.new);
    else if (r.status === 401 || r.status === 403) paintBadge(0);
  };

  const sync = () => {
    if (me.isAdmin()) {
      if (timer === null) {
        timer = window.setInterval(() => { void poll(); }, WATCH_MS);
        void poll();
      }
    } else {
      if (timer !== null) { clearInterval(timer); timer = null; }
      seq++;
      paintBadge(0);
    }
  };
  const onVisible = () => { if (document.visibilityState === "visible") void poll(); };

  const offMe = me.subscribe(sync);
  document.addEventListener("visibilitychange", onVisible);
  sync();

  return () => {
    offMe();
    document.removeEventListener("visibilitychange", onVisible);
    if (timer !== null) clearInterval(timer);
    timer = null;
    seq++;
  };
}
