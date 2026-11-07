/**
 * Leaderboard — the Block Hunt board, and your own stats.
 *
 * Best score per signed-in wallet for today, the last 7 days or all time, plus
 * runs, wins and the Whites those runs paid out; then the signed-in player's
 * own all-time stats and what they have burned. Data comes from
 * src/web/game-routes.ts via data/game-runs.ts.
 *
 * Honesty rule: this is a PRACTICE board — runs are free, nothing is minted
 * and no Ordinal is inscribed — and the window says so above the numbers.
 */
import { TIERS } from "../../econ/tokenomics";
import {
  GAME_RECORDED_EVENT,
  fetchLeaderboard,
  fetchStats,
  type Leaderboard,
  type LeaderboardWindow,
  type PlayerStats,
} from "../data/game-runs";
import type { ServerSession } from "../session/me";
import { h } from "../util/dom";
import "./leaderboard.css";

const TABS: ReadonlyArray<{ id: LeaderboardWindow; label: string; title: string; empty: string }> = [
  { id: "today", label: "Today", title: "Since midnight UTC", empty: "today" },
  { id: "week", label: "This week", title: "The last 7 days", empty: "this week" },
  { id: "all", label: "All time", title: "Every run", empty: "yet" },
];

/** How often an open board re-reads itself (only while the page is visible). */
const REFRESH_MS = 30_000;

export interface LeaderboardOptions {
  /** The server session — who "you" are on the board. Absent in tests. */
  me?: ServerSession;
}

const num = (n: number) => n.toLocaleString("en-US");
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const day = (ms: number) => new Date(ms).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });

const howToJoin = () =>
  h("span", {}, "Sign in with ", h("strong", {}, "Xverse"), " (", h("strong", {}, "Connect wallet"),
    ", bottom right), play ", h("strong", {}, "Block Hunt"), " and finish a run — your best lands here.");

function stat(label: string, value: string, note?: string): HTMLElement {
  return h("div", { class: "ph-lb-stat" },
    h("span", { class: "ph-lb-stat-v" }, value),
    h("span", { class: "ph-lb-stat-l" }, label),
    note ? h("span", { class: "ph-lb-stat-n" }, note) : null);
}

export function mountLeaderboard(host: HTMLElement, opts: LeaderboardOptions = {}): () => void {
  host.classList.add("ph-lb");
  const me = opts.me;
  let active: LeaderboardWindow = "today";
  let board: Leaderboard | null = null;
  let boardState: "loading" | "ready" | "error" = "loading";
  let stats: PlayerStats | null = null;
  /** Bumped per request so a slow, older answer never paints over a newer one. */
  let boardSeq = 0, statsSeq = 0;

  // ── Static frame ─────────────────────────────────────────────────────────
  const head = h("header", { class: "ph-lb-head" },
    h("h1", {}, "Leaderboard"),
    h("p", {}, "Block Hunt, best score per signed-in wallet."),
    h("p", { class: "ph-lb-note" },
      h("span", { class: "ph-lb-badge" }, "PRACTICE"),
      " Runs are free and nothing is claimed: no BTC Hunter is minted and no Ordinal is inscribed. Scores are checked for plausibility, not yet replayed."));

  const tabButtons = TABS.map((t) => {
    const b = h("button", { class: "ph-lb-tab", type: "button", role: "tab", title: t.title, "aria-selected": t.id === active ? "true" : "false" }, t.label);
    b.addEventListener("click", () => { if (active !== t.id) { active = t.id; paintTabs(); void loadBoard(); } });
    return b;
  });
  const tabs = h("div", { class: "ph-lb-tabs", role: "tablist", "aria-label": "Time window" }, ...tabButtons);
  const boardBox = h("div", { class: "ph-lb-board", role: "tabpanel" });
  const boardMeta = h("p", { class: "ph-lb-meta" });
  const boardSec = h("section", { class: "ph-lb-sec" }, tabs, boardBox, boardMeta);
  const statsBox = h("div", {});
  const statsSec = h("section", { class: "ph-lb-sec" }, h("h2", {}, "Your stats"), statsBox);
  host.replaceChildren(head, boardSec, statsSec);

  const paintTabs = () => {
    TABS.forEach((t, i) => tabButtons[i]!.setAttribute("aria-selected", t.id === active ? "true" : "false"));
  };

  // ── The board ────────────────────────────────────────────────────────────
  const paintBoard = () => {
    const you = me?.current().address ?? null;
    const tab = TABS.find((t) => t.id === active)!;
    if (boardState === "loading" && !board) {
      boardBox.replaceChildren(h("p", { class: "ph-lb-empty" }, "Loading the board…"));
      boardMeta.textContent = "";
      return;
    }
    if (boardState === "error" && !board) {
      boardBox.replaceChildren(h("p", { class: "ph-lb-empty" }, "Couldn't reach the board. It will try again shortly."));
      boardMeta.textContent = "";
      return;
    }
    if (!board) return;
    if (board.rows.length === 0) {
      boardBox.replaceChildren(h("div", { class: "ph-lb-empty" },
        h("p", {}, h("strong", {}, `No runs on the board ${tab.empty}.`)), h("p", {}, howToJoin())));
    } else {
      const rows = board.rows.map((r) => {
        const isYou = you !== null && r.address === you;
        return h("tr", { class: isYou ? "is-you" : "" },
          h("td", { class: `ph-lb-rank${r.rank <= 3 ? ` is-top${r.rank}` : ""}` }, String(r.rank)),
          h("th", { scope: "row", title: r.address }, r.name, isYou ? h("span", { class: "ph-lb-you" }, "you") : null),
          h("td", { class: "ph-num ph-lb-best" }, num(r.best)),
          h("td", { class: "ph-num" }, num(r.runs)),
          h("td", { class: "ph-num" }, num(r.wins)),
          h("td", { class: "ph-num" }, num(r.whitesWon)));
      });
      boardBox.replaceChildren(h("div", { class: "ph-lb-scroll" },
        h("table", { class: "ph-lb-table" },
          h("thead", {}, h("tr", {},
            h("th", { scope: "col", class: "ph-num" }, "#"),
            h("th", { scope: "col" }, "Player"),
            h("th", { scope: "col", class: "ph-num" }, "Best"),
            h("th", { scope: "col", class: "ph-num" }, "Runs"),
            h("th", { scope: "col", class: "ph-num" }, "Wins"),
            h("th", { scope: "col", class: "ph-num", title: "Whites paid out by their runs: 2 a win, 1 a loss" }, "Whites won"))),
          h("tbody", {}, ...rows))));
    }
    boardMeta.textContent = `${num(board.players)} ${board.players === 1 ? "player" : "players"} · ${num(board.totalRuns)} ${board.totalRuns === 1 ? "run" : "runs"} · updated ${clock(board.generatedAt)}`
      + (boardState === "error" ? " · couldn't refresh" : "");
  };

  const loadBoard = async () => {
    const seq = ++boardSeq;
    const want = active;
    if (!board || board.window !== want) { board = null; boardState = "loading"; paintBoard(); }
    const next = await fetchLeaderboard(want);
    if (seq !== boardSeq) return;
    if (next) { board = next; boardState = "ready"; } else { boardState = "error"; }
    paintBoard();
  };

  // ── Your stats ───────────────────────────────────────────────────────────
  const paintStats = () => {
    const address = me?.current().address ?? null;
    if (!address) {
      statsBox.replaceChildren(h("p", { class: "ph-lb-empty" }, howToJoin()));
      return;
    }
    if (!stats || stats.address !== address) {
      statsBox.replaceChildren(h("p", { class: "ph-lb-empty" }, "Loading your stats…"));
      return;
    }
    const s = stats;
    const tiles = h("div", { class: "ph-lb-stats" },
      stat("runs", num(s.runs), s.firstAt ? `since ${day(s.firstAt)}` : "none yet"),
      stat("win rate", s.winRate === null ? "—" : `${Math.round(s.winRate * 100)}%`, `${num(s.wins)} won · ${num(s.losses)} lost`),
      stat("best", num(s.best), "highest score, all time"),
      stat("Whites won", num(s.whitesWon), "2 a win, 1 a loss"));

    const burnRows = TIERS
      .filter((t) => (s.burned[t.id] ?? 0) > 0 || (s.made[t.id] ?? 0) > 0)
      .map((t) => h("tr", {},
        h("th", { scope: "row" },
          h("span", { class: "ph-lb-chip" }, h("i", { class: "ph-lb-swatch", style: `background:${t.swatch}`, "aria-hidden": "true" }), t.name)),
        h("td", { class: "ph-num" }, num(s.made[t.id] ?? 0)),
        h("td", { class: "ph-num" }, num(s.burned[t.id] ?? 0))));
    const burns = burnRows.length
      ? h("div", { class: "ph-lb-scroll" }, h("table", { class: "ph-lb-table" },
          h("thead", {}, h("tr", {},
            h("th", { scope: "col" }, "Tier"),
            h("th", { scope: "col", class: "ph-num" }, "Made by burning"),
            h("th", { scope: "col", class: "ph-num" }, "Burned"))),
          h("tbody", {}, ...burnRows)))
      : h("p", { class: "ph-lb-dim" }, "No burns yet — burn two of a tier to make one of the next.");

    statsBox.replaceChildren(tiles, burns,
      h("p", { class: "ph-lb-dim" }, s.lastAt ? `Last run ${day(s.lastAt)} at ${clock(s.lastAt)}.` : "Finish a run to start your record."));
  };

  const loadStats = async () => {
    const address = me?.current().address ?? null;
    const seq = ++statsSeq;
    if (!address) { stats = null; paintStats(); return; }
    paintStats();
    const next = await fetchStats(address);
    if (seq !== statsSeq) return;
    if (next) stats = next;
    paintStats();
  };

  // ── Wiring ───────────────────────────────────────────────────────────────
  const refresh = () => { void loadBoard(); void loadStats(); };
  const onRecorded = () => refresh();
  window.addEventListener(GAME_RECORDED_EVENT, onRecorded);
  const timer = window.setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  // Signing in or out changes who "you" are on the board and whose stats show.
  const offMe = me?.subscribe(() => { paintBoard(); void loadStats(); });
  refresh();

  return () => {
    boardSeq++; statsSeq++;
    window.removeEventListener(GAME_RECORDED_EVENT, onRecorded);
    clearInterval(timer);
    offMe?.();
    host.classList.remove("ph-lb");
  };
}
