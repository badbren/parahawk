/**
 * Admin — the owner's dashboard: who's using the site, traffic, Parahawk badges
 * earned, Chat, Suggestions, Block Hunt, and the price tools.
 *
 * Owner-only: the icon shows only for the owner's server session, and every
 * number comes from GET /api/admin/stats (src/web/admin-routes.ts), which checks
 * again. Refreshes every minute while the window is open and the tab is visible.
 * The Prices tab is the old /admin page, without the site header.
 */
import "./admin.css";
import type { ServerSession } from "../session/me";
import { h } from "../util/dom";

export interface AdminContext {
  me?: ServerSession;
  openPath?: (path: string) => void;
  openApp?: (id: string) => void;
}

// ── The API's answer (src/admin/stats.ts AdminStats), as read here ──────────

interface Chip { id: string; emoji: string; name: string }
interface User {
  address: string; name: string | null; isPrivate: boolean; avatarUrl: string | null; owner: boolean;
  firstSeen: number | null; lastSeen: number | null; secondsOnSite: number; activeDays: number;
  chatMessages: number; searches: number; suggestions: number; rentals: number | null; badges: Chip[];
}
interface Earner { address: string; name: string | null; isPrivate: boolean; badgeId: string; emoji: string; badgeName: string; at: number }
interface BadgeRow { id: string; emoji: string; name: string; desc: string; holders: number }
interface TrafficDay { day: string; visitors: number; views: number }
interface Traffic {
  days: TrafficDay[]; today: TrafficDay;
  last7: { visitors: number; views: number }; last30: { visitors: number; views: number };
  backend: "supabase" | "memory";
}
interface Overview {
  visitorsToday: number | null; viewsToday: number | null; visitors7d: number | null;
  wallets: number; activeToday: number; newThisWeek: number; named: number;
  chatToday: number | null; chattersToday: number | null; chatTotal: number | null;
  suggestionsNew: number | null; suggestionsWeek: number | null;
  runsToday: number | null; playersToday: number | null; badgesThisWeek: number;
}
interface Stats {
  generatedAt: number; overview: Overview; users: User[];
  badges: { table: BadgeRow[]; recent: Earner[] };
  traffic: Traffic | null; errors: string[];
}

type Tab = "overview" | "users" | "badges" | "traffic" | "prices";
const TABS: Array<[Tab, string]> = [
  ["overview", "Overview"], ["users", "Users"], ["badges", "Badges"], ["traffic", "Traffic"], ["prices", "Prices"],
];
const REFRESH_MS = 60_000;

// ── Formatting ───────────────────────────────────────────────────────────────

const int = (n: number | null | undefined): string => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

function ago(ms: number | null, now: number): string {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const hr = Math.round(m / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

const date = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

/** "45 min" · "3.2 h" · "41 h". */
function time(seconds: number): string {
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min} min`;
  const hrs = seconds / 3600;
  return hrs < 10 ? `${(Math.floor(hrs * 10) / 10).toFixed(1)} h` : `${Math.floor(hrs)} h`;
}

/** A picture, or a coloured circle with their first letter. */
function avatar(u: Pick<User, "address" | "name" | "avatarUrl">): HTMLElement {
  if (u.avatarUrl) return h("img", { class: "ph-adm-av", src: u.avatarUrl, alt: "", loading: "lazy", width: 22, height: 22 });
  let hash = 0;
  for (const c of u.address) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const letter = (u.name ?? u.address.replace(/^bc1[pq]?/i, "")).trim().charAt(0).toUpperCase() || "?";
  return h("span", { class: "ph-adm-av ph-adm-av-txt", style: `background:hsl(${hash % 360} 45% 32%)`, "aria-hidden": "true" }, letter);
}

/** Name (or short wallet) with "you" / "private" tags. */
function who(u: { address: string; name: string | null; isPrivate: boolean; owner?: boolean }): HTMLElement {
  return h("span", { class: "ph-adm-who" },
    h("span", { class: u.name ? "ph-adm-name" : "ph-adm-dim" }, u.name ?? short(u.address)),
    u.owner ? h("span", { class: "ph-adm-tag" }, "you") : null,
    u.isPrivate ? h("span", { class: "ph-adm-tag ph-adm-tag-priv", title: "Keeps their name and wallet apart in public" }, "private") : null);
}

function bar(value: number, max: number, cls = ""): HTMLElement {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return h("span", { class: `ph-adm-bar ${cls}`, "aria-hidden": "true" }, h("i", { style: `width:${pct.toFixed(1)}%` }));
}

// ── The window ───────────────────────────────────────────────────────────────

export function mountAdmin(host: HTMLElement, ctx: AdminContext): () => void {
  host.classList.add("ph-adm");

  const updated = h("span", { class: "ph-adm-updated" }, "");
  const refreshBtn = h("button", { class: "ph-adm-btn", type: "button" }, "Refresh");
  const notice = h("p", { class: "ph-adm-notice", hidden: true });
  const head = h("header", { class: "ph-adm-head" },
    h("div", { class: "ph-adm-head-row" },
      h("h1", {}, "Admin"),
      h("span", { class: "ph-adm-head-sub" }, "only you can see this"),
      h("span", { class: "ph-adm-spacer" }),
      updated, refreshBtn),
    notice);

  const tabEls = new Map<Tab, HTMLButtonElement>();
  const panels = new Map<Tab, HTMLElement>();
  for (const [id, label] of TABS) {
    tabEls.set(id, h("button", {
      class: "ph-adm-tab", type: "button", role: "tab", id: `ph-adm-tab-${id}`,
      "aria-controls": `ph-adm-panel-${id}`, "aria-selected": id === "overview" ? "true" : "false",
    }, label));
    panels.set(id, h("section", {
      class: `ph-adm-panel ph-adm-panel-${id}`, role: "tabpanel", id: `ph-adm-panel-${id}`,
      "aria-labelledby": `ph-adm-tab-${id}`, hidden: id !== "overview",
    }));
  }
  const tabs = h("div", { class: "ph-adm-tabs", role: "tablist", "aria-label": "Admin" }, ...tabEls.values());
  const body = h("div", { class: "ph-adm-body" }, ...panels.values());
  host.replaceChildren(head, tabs, body);

  let tab: Tab = "overview";
  let data: Stats | null = null;
  let loadedAt = 0;
  let loading = false;
  let ctl: AbortController | null = null;
  let dead = false;
  let pricesFrame: HTMLIFrameElement | null = null;

  const showTab = (next: Tab) => {
    tab = next;
    for (const [id, el] of tabEls) el.setAttribute("aria-selected", id === next ? "true" : "false");
    for (const [id, el] of panels) el.hidden = id !== next;
    // The Prices tab is the old /admin page; load it the first time it's shown.
    if (next === "prices" && !pricesFrame) {
      pricesFrame = h("iframe", { class: "ph-adm-frame", src: "/admin?bare=1", title: "Prices" });
      panels.get("prices")!.replaceChildren(pricesFrame);
    }
  };
  for (const [id, el] of tabEls) el.addEventListener("click", () => showTab(id));

  const message = (tabId: Tab, ...kids: Array<Node | string>) =>
    panels.get(tabId)!.replaceChildren(h("p", { class: "ph-adm-msg" }, ...kids));

  const openProfile = (address: string) => ctx.openPath?.(`/u/${encodeURIComponent(address)}`);

  // ── Overview ───────────────────────────────────────────────────────────────
  const card = (label: string, value: string, note: string, onClick?: () => void): HTMLElement => {
    const el = h(onClick ? "button" : "div", { class: `ph-adm-card${onClick ? " is-link" : ""}`, ...(onClick ? { type: "button" } : {}) },
      h("span", { class: "ph-adm-card-v" }, value),
      h("span", { class: "ph-adm-card-l" }, label),
      note ? h("span", { class: "ph-adm-card-n" }, note) : null);
    if (onClick) el.addEventListener("click", onClick);
    return el;
  };

  const renderOverview = (s: Stats) => {
    const o = s.overview;
    const now = Date.now();
    const cards = h("div", { class: "ph-adm-cards" },
      card("visitors today", int(o.visitorsToday), o.visitorsToday == null ? "traffic counter unavailable" : `${int(o.viewsToday)} page views · ${int(o.visitors7d)} this week`, () => showTab("traffic")),
      card("signed in today", int(o.activeToday), `of ${int(o.wallets)} wallets that have signed in`, () => showTab("users")),
      card("new this week", int(o.newThisWeek), "wallets signing in for the first time", () => showTab("users")),
      card("names set", int(o.named), `of ${int(o.wallets)} wallets`),
      card("chat today", int(o.chatToday), o.chatToday == null ? "chat unavailable" : `${int(o.chattersToday)} ${o.chattersToday === 1 ? "person" : "people"} · ${int(o.chatTotal)} all time`, ctx.openApp ? () => ctx.openApp?.("chat") : undefined),
      card("new suggestions", int(o.suggestionsNew), o.suggestionsNew == null ? "suggestions unavailable" : `${int(o.suggestionsWeek)} sent this week · open inbox`, ctx.openApp ? () => ctx.openApp?.("suggestions") : undefined),
      card("Block Hunt runs today", int(o.runsToday), o.runsToday == null ? "game unavailable" : `${int(o.playersToday)} ${o.playersToday === 1 ? "player" : "players"}`),
      card("badges earned this week", int(o.badgesThisWeek), "Parahawk badges", () => showTab("badges")));

    const recentUsers = s.users.filter((u) => !u.owner).slice(0, 6);
    const activeList = recentUsers.length === 0
      ? h("p", { class: "ph-adm-dim" }, "Nobody else has signed in yet.")
      : h("ul", { class: "ph-adm-mini" }, ...recentUsers.map((u) =>
          h("li", {},
            h("button", { class: "ph-adm-rowbtn", type: "button", onclick: () => openProfile(u.address) },
              avatar(u), who(u), h("span", { class: "ph-adm-dim ph-adm-right" }, ago(u.lastSeen, now))))));

    const earners = s.badges.recent.slice(0, 6);
    const earnList = earners.length === 0
      ? h("p", { class: "ph-adm-dim" }, "No badges earned yet.")
      : h("ul", { class: "ph-adm-mini" }, ...earners.map((e) =>
          h("li", {},
            h("button", { class: "ph-adm-rowbtn", type: "button", onclick: () => openProfile(e.address) },
              h("span", { class: "ph-adm-emoji", "aria-hidden": "true" }, e.emoji),
              who(e), h("span", { class: "ph-adm-dim" }, e.badgeName),
              h("span", { class: "ph-adm-dim ph-adm-right" }, e.at ? ago(e.at, now) : "before tracking")))));

    panels.get("overview")!.replaceChildren(
      cards,
      h("div", { class: "ph-adm-cols" },
        h("div", { class: "ph-adm-box" }, h("h2", {}, "Recently active"), activeList),
        h("div", { class: "ph-adm-box" }, h("h2", {}, "Latest badges"), earnList)));
  };

  // ── Users ──────────────────────────────────────────────────────────────────
  const renderUsers = (s: Stats) => {
    const now = Date.now();
    if (s.users.length === 0) { message("users", "Nobody has signed in yet."); return; }
    const rows = s.users.map((u) => {
      const tr = h("tr", { class: `ph-adm-tr${u.owner ? " is-owner" : ""}`, tabindex: 0, title: `${u.address} — open profile` },
        h("td", {}, h("span", { class: "ph-adm-cell-who" }, avatar(u), who(u))),
        h("td", { class: "ph-adm-mono" }, short(u.address)),
        h("td", {}, date(u.firstSeen)),
        h("td", {}, ago(u.lastSeen, now)),
        h("td", { class: "ph-adm-num" }, time(u.secondsOnSite)),
        h("td", { class: "ph-adm-num" }, int(u.activeDays)),
        h("td", { class: "ph-adm-num" }, int(u.chatMessages)),
        h("td", { class: "ph-adm-badges" }, ...u.badges.map((b) => h("span", { title: b.name }, b.emoji))));
      const open = () => openProfile(u.address);
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter") open(); });
      return tr;
    });
    panels.get("users")!.replaceChildren(
      h("p", { class: "ph-adm-dim ph-adm-lead" }, `${int(s.users.filter((u) => !u.owner).length)} wallets have signed in (not counting you). Click one for their profile.`),
      h("div", { class: "ph-adm-scroll" },
        h("table", { class: "ph-adm-table" },
          h("thead", {}, h("tr", {},
            h("th", { scope: "col" }, "Who"), h("th", { scope: "col" }, "Wallet"), h("th", { scope: "col" }, "First seen"),
            h("th", { scope: "col" }, "Last seen"), h("th", { scope: "col", class: "ph-adm-num" }, "Time"),
            h("th", { scope: "col", class: "ph-adm-num" }, "Days"), h("th", { scope: "col", class: "ph-adm-num" }, "Chat"),
            h("th", { scope: "col" }, "Badges"))),
          h("tbody", {}, ...rows))));
  };

  // ── Badges ─────────────────────────────────────────────────────────────────
  const renderBadges = (s: Stats) => {
    const now = Date.now();
    const table = h("table", { class: "ph-adm-table" },
      h("thead", {}, h("tr", {},
        h("th", { scope: "col" }, "Badge"), h("th", { scope: "col" }, "How it's earned"), h("th", { scope: "col", class: "ph-adm-num" }, "Holders"))),
      h("tbody", {}, ...s.badges.table.map((b) => h("tr", {},
        h("td", {}, h("span", { class: "ph-adm-emoji", "aria-hidden": "true" }, b.emoji), " ", h("strong", {}, b.name)),
        h("td", { class: "ph-adm-dim" }, b.desc),
        h("td", { class: "ph-adm-num" }, int(b.holders))))));
    const recent = s.badges.recent.length === 0
      ? h("p", { class: "ph-adm-dim" }, "No badges earned yet.")
      : h("ul", { class: "ph-adm-mini" }, ...s.badges.recent.map((e) => h("li", {},
          h("button", { class: "ph-adm-rowbtn", type: "button", onclick: () => openProfile(e.address) },
            h("span", { class: "ph-adm-emoji", "aria-hidden": "true" }, e.emoji),
            who(e),
            h("span", {}, e.badgeName),
            h("span", { class: "ph-adm-dim ph-adm-right", title: e.at ? new Date(e.at).toLocaleString() : "earned before badge times were tracked" },
              e.at ? ago(e.at, now) : "before tracking")))));
    panels.get("badges")!.replaceChildren(
      h("p", { class: "ph-adm-dim ph-adm-lead" }, "Parahawk's own badges. Holder counts don't include you (you hold them all)."),
      h("div", { class: "ph-adm-scroll" }, table),
      h("h2", { class: "ph-adm-h2" }, "Who earned what"),
      recent);
  };

  // ── Traffic ────────────────────────────────────────────────────────────────
  const renderTraffic = (s: Stats) => {
    const t = s.traffic;
    if (!t) { message("traffic", "The traffic counter couldn't be read just now — try Refresh in a minute."); return; }
    const maxViews = Math.max(1, ...t.days.map((d) => d.views));
    const maxVisitors = Math.max(1, ...t.days.map((d) => d.visitors));
    const rows = [...t.days].reverse().map((d) => h("tr", {},
      h("td", { class: "ph-adm-mono" }, d.day),
      h("td", { class: "ph-adm-num" }, int(d.visitors)),
      h("td", { class: "ph-adm-barcell" }, bar(d.visitors, maxVisitors, "is-visitors")),
      h("td", { class: "ph-adm-num" }, int(d.views)),
      h("td", { class: "ph-adm-barcell" }, bar(d.views, maxViews))));
    panels.get("traffic")!.replaceChildren(
      h("div", { class: "ph-adm-cards" },
        card("visitors today", int(t.today.visitors), `${int(t.today.views)} page views`),
        card("last 7 days", int(t.last7.visitors), `${int(t.last7.views)} page views`),
        card("last 30 days", int(t.last30.visitors), `${int(t.last30.views)} page views`)),
      h("p", { class: "ph-adm-dim ph-adm-lead" },
        "Unique visitors (by IP) and page views per UTC day, counted on the Parahawk pages.",
        t.backend === "memory" ? " Local test server: not saved, resets on restart." : ""),
      h("div", { class: "ph-adm-scroll" },
        h("table", { class: "ph-adm-table" },
          h("thead", {}, h("tr", {},
            h("th", { scope: "col" }, "Day (UTC)"), h("th", { scope: "col", class: "ph-adm-num" }, "Visitors"), h("th", { scope: "col" }, ""),
            h("th", { scope: "col", class: "ph-adm-num" }, "Views"), h("th", { scope: "col" }, ""))),
          h("tbody", {}, ...rows))));
  };

  const render = () => {
    if (!data) return;
    renderOverview(data);
    renderUsers(data);
    renderBadges(data);
    renderTraffic(data);
    notice.hidden = data.errors.length === 0;
    notice.textContent = data.errors.length ? `Couldn't load: ${data.errors.join(" · ")}` : "";
  };

  const paintUpdated = () => {
    updated.textContent = loading ? "Updating…" : loadedAt ? `updated ${ago(loadedAt, Date.now())}` : "";
  };

  const load = async () => {
    if (dead) return;
    ctl?.abort();
    const mine = (ctl = new AbortController());
    loading = true;
    paintUpdated();
    if (!data) for (const id of ["overview", "users", "badges", "traffic"] as const) message(id, "Loading…");
    try {
      const res = await fetch("/api/admin/stats", { credentials: "same-origin", cache: "no-store", signal: mine.signal });
      if (dead || mine !== ctl) return;
      if (res.status === 401 || res.status === 403) {
        data = null;
        for (const id of ["overview", "users", "badges", "traffic"] as const) message(id, "Owner only. Sign in with the owner wallet (taskbar → Connect wallet).");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      data = (await res.json()) as Stats;
      if (dead || mine !== ctl) return;
      loadedAt = Date.now();
      render();
    } catch {
      if (dead || mine.signal.aborted) return;
      if (!data) for (const id of ["overview", "users", "badges", "traffic"] as const) message(id, "Couldn't load the numbers. Try Refresh.");
      notice.hidden = false;
      notice.textContent = "Couldn't refresh just now — showing the last numbers.";
    } finally {
      if (mine === ctl) { loading = false; paintUpdated(); }
    }
  };

  refreshBtn.addEventListener("click", () => {
    void load();
    // The price tools don't refresh themselves.
    if (tab === "prices" && pricesFrame) pricesFrame.src = "/admin?bare=1";
  });

  // Every minute while open and visible; catch up when the tab comes back.
  const visible = () => document.visibilityState === "visible";
  const timer = window.setInterval(() => {
    paintUpdated();
    if (visible() && !loading && Date.now() - loadedAt >= REFRESH_MS) void load();
  }, 15_000);
  const onVisibility = () => { if (visible() && Date.now() - loadedAt >= REFRESH_MS) void load(); };
  document.addEventListener("visibilitychange", onVisibility);

  void load();

  return () => {
    dead = true;
    ctl?.abort();
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    host.classList.remove("ph-adm");
  };
}
