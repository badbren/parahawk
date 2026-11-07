import { renderPage } from "../layout.js";
import { createGameStore, type GameStore } from "../../game/store.js";
import { rankBoard, windowStart } from "../../game/board.js";
import type { Leaderboard } from "../../game/types.js";
import { nameTag, walletCell, walletNames, type WalletNames } from "../addr.js";
import { esc, fmtInt, timeAgo } from "../format.js";

/**
 * Leaderboard — the Block Hunt board, as a tab inside the Parahawk window
 * (owner, 2026-11-06: "let's not make that an icon and keep that in Parahawk").
 * Same numbers as GET /api/game/leaderboard: best run per wallet, ranked, for
 * today / this week / all time, read straight from the game store. Each wallet
 * carries its owner's Parahawk name, "(badbren)", which opens their profile.
 */
export type BoardWindow = "today" | "week" | "all";

export function parseBoardWindow(raw: unknown): BoardWindow {
  return raw === "today" || raw === "all" ? raw : "week";
}

const WINDOWS: Array<[BoardWindow, string]> = [
  ["today", "Today"],
  ["week", "This week"],
  ["all", "All time"],
];
const IN_WINDOW: Record<BoardWindow, string> = { today: "today", week: "this week", all: "all time" };
const ROWS = 50;

let kept: GameStore | null = null;
/**
 * The game store, read-only here. A local file store reads its file only when
 * it's made, and the API's own instance is the one writing it, so locally it's
 * made fresh for every render; the database store is made once and kept.
 */
function boardStore(): GameStore {
  if (kept) return kept;
  const s = createGameStore();
  if (s.kind !== "file") kept = s;
  return s;
}

/** The wallet page only knows bc1 addresses; anything else is shown, not linked. */
const isBc1 = (a: string) => /^bc1[0-9a-z]{8,}$/i.test(a);

function walletOf(address: string, names: WalletNames): string {
  if (isBc1(address)) return walletCell(address, undefined, names);
  const label = address.length > 16 ? `${address.slice(0, 12)}…${address.slice(-4)}` : address;
  return `<span>${esc(label)}</span>${nameTag(address, names)}`;
}

/** The page body for a ranked board — pure, so it's tested without a store. */
export function leaderboardBody(board: Leaderboard, names: WalletNames): string {
  const window = board.window as BoardWindow;
  const tabs = WINDOWS.map(([w, label]) =>
    w === window
      ? `<span class="lbw on" aria-current="page">${label}</span>`
      : `<a class="lbw" href="/leaderboard?window=${w}">${label}</a>`).join("");

  const rows = board.rows.length === 0
    ? `<tr><td colspan="5" class="dim">No runs ${IN_WINDOW[window]} yet. Open <strong>Block Hunt</strong> on the desktop to get on the board.</td></tr>`
    : board.rows.map((r) => `<tr>
        <td class="dim">${r.rank}</td>
        <td>${walletOf(r.address, names)}</td>
        <td class="green">${fmtInt(r.best)}</td>
        <td>${fmtInt(r.runs)}</td>
        <td class="dim">${esc(timeAgo(r.bestAt))}</td>
      </tr>`).join("");

  const stats = board.players > 0
    ? `${fmtInt(board.players)} player${board.players === 1 ? "" : "s"} · ${fmtInt(board.totalRuns)} run${board.totalRuns === 1 ? "" : "s"} ${IN_WINDOW[window]}`
    : `nobody has played ${IN_WINDOW[window]} yet`;

  return `
<h1>Leaderboard 🏆</h1>
<p class="lead">Block Hunt — the best run per wallet. Click a wallet for its stats, or a name for that person's profile.</p>
<div class="lbtabs">${tabs}<span class="lbstat dim">${stats}</span></div>
<div class="tscroll"><table>
  <thead><tr><th>#</th><th>Wallet</th><th>Best</th><th>Runs</th><th>When</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>
<p class="muted-note"><span class="lbbadge">PRACTICE</span> Runs are free and nothing is claimed: no BTC Hunter is minted and no Ordinal is inscribed. Every score is the server's own replay of the run, not the player's word.</p>
<style>
.lbtabs{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 6px}
.lbw{border:1px solid var(--line);padding:6px 14px;font-size:16px;color:var(--dim)}
a.lbw{border-bottom:1px solid var(--line)}
a.lbw:hover{color:#fff;border-color:#33501f}
.lbw.on{color:#000;background:var(--green);border-color:var(--green)}
.lbstat{margin-left:auto;font-size:15px}
.lbbadge{display:inline-block;border:1px solid var(--amber);color:var(--amber);font-size:12px;letter-spacing:1px;padding:1px 6px;margin-right:4px}
.tscroll{max-height:640px;overflow:auto;border:1px solid var(--line)}
.tscroll table{margin:0}
.tscroll thead th{position:sticky;top:0;background:#0d0d0d;z-index:1}
</style>`;
}

export interface LeaderboardDeps {
  store?: GameStore;
  now?: () => number;
}

export async function renderLeaderboard(window: BoardWindow = "week", deps: LeaderboardDeps = {}): Promise<string> {
  const now = (deps.now ?? Date.now)();
  let body: string;
  try {
    const agg = await (deps.store ?? boardStore()).leaderboard(windowStart(window, now), ROWS);
    const names = await walletNames(agg.entries.map((e) => e.address));
    // Names go next to the wallet (walletCell), so the row's own name stays the address.
    body = leaderboardBody(rankBoard(agg, window, now, (a) => a), names);
  } catch (err) {
    console.error("[/leaderboard] failed:", err);
    body = `<h1>Leaderboard 🏆</h1><p class="lead">The board couldn't load just now — try again in a minute.</p>`;
  }
  return renderPage({ title: "Leaderboard", active: "leaderboard", body });
}
