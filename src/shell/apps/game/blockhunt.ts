/**
 * Block Hunt — the parasite digs down a mineshaft toward a block.
 *
 * This file is the screen, the speakers and the hands. The game itself is
 * src/game/sim.ts: a pure simulation stepped at a fixed TICK_HZ, fed one
 * steering value per tick. This loop samples the keyboard, mouse or finger once
 * per tick, records it (src/game/inputs.ts) and steps the sim with exactly the
 * recorded value, so the run it shows is the run the server can replay from the
 * seed and the log. Drawing interpolates between ticks, so motion stays smooth
 * at 60, 144 or whatever the screen runs at.
 *
 * Nothing here decides a score. A signed-in run is dealt by the server
 * (startRun: a fresh seed and a ticket), and on finishing the ticket and the
 * steer log go back (submitRun); the server replays them and its verdict is the
 * one shown. Without a ticket — a guest, offline, a forced ?gameseed= — the run
 * is practice and is not sent anywhere. The only randomness here is cosmetic
 * (sparks, shake, glints), seeded per run so a seed always looks the same.
 *
 * Drawing order matters, because the owner browses with hardware acceleration
 * off:
 *   1. rock across the whole view, banded so strata scroll past
 *   2. the passage carved out of it as a dark void, lined with timber; a fork's
 *      pillar is rock laid back over it
 *   3. beams, lanterns, the headlamp, gas, hazards, finds, the mite
 *   4. the vault and the block
 * Painting the passage over full-width rock gets banded walls without a
 * per-frame clip, and everything small — ore, the mite, boulders, rubble,
 * beams, lanterns, glints, gas puffs — is a sprite rendered once and blitted.
 *
 * Words on screen are rationed. One banner at a time, queued by importance,
 * in the band above the mite (passage already travelled, so it never hides
 * what is coming); moments that land together share one banner. Pops are for
 * what changed your lamp or your score by more than a hash — at most three,
 * stacked beside the mite on its roomier side, never on it.
 *
 * A run ends payoff first: its beat (BLOCK FOUND, or the lamp guttering out),
 * then the pieces it won (the reveal), then the run's numbers.
 */
import {
  BLOCK_BONUS,
  BLOCK_WINDOW_SECONDS,
  CATCH_RADIUS,
  DAMAGE,
  LAMP_FROM_NONCE,
  LAMP_FROM_OVERCLOCK,
  LAMP_LOW,
  LAMP_MAX,
  MAX_MULT,
  MAX_NONCES,
  MULT_STEP_STREAK,
  NONCE_VALUE,
  OVERCLOCK_REACH,
  OVERCLOCK_SECONDS,
  RUN_SECONDS,
  STRATA,
  type Hazard,
  type HazardKind,
  type RunPlan,
  type Stratum,
  createRng,
  laneOf,
  multiplierFor,
  stratumAt,
  viewAheadAt,
} from "../../../game/blockrun";
import { type Sim, type SimEvent, TICK_HZ, createSim, resultOf, step, steerToward, timeOf } from "../../../game/sim";
import { createSteerRecorder, type SteerRecorder } from "../../../game/inputs";
import { type BotKind, createBot } from "../../../game/bots";
import { PLAY_PRICE_USD, WHITES_PER_LOSS, WHITES_PER_WIN, fmtDollars } from "../../../econ/tokenomics";
import type { PracticeClaim, PracticeLedger } from "../../session/ledger";
import type { WindowHandle } from "../../wm/types";
import { showReveal } from "../reveal";
import { type RunTicket, type RunVerdict, startRun, submitRun } from "../../data/game-runs";
import { createGameSound } from "./sound";
import "./game.css";
import { h, prefersReducedMotion } from "../../util/dom";

export type RunOutcome = "win" | "lose";

/**
 * The mite rides this far down the view. It sits high because you are going
 * *down*: everything still ahead of you is deeper, so it lives below the mite
 * and rises to meet you. Putting the lookahead above instead reads as climbing.
 */
const MITE_Y_FRACTION = 0.28;
const TICK_MS = 1000 / TICK_HZ;
/** Never simulate more than this much catch-up in one frame (a stall, a slow tab). */
const MAX_CATCHUP_MS = 250;
/** After a key press, the mouse must move this far (px) before it takes the steering back. */
const MOUSE_WAKE_PX = 6;
/** Vertical spacing of wall strata bands, in seconds of travel. */
const BAND_SECONDS = 0.5;
/** Screen rows used to trace each passage wall. Lower = cheaper, blockier. */
const WALL_STEP_PX = 7;
/** Mineshaft furniture, in seconds of travel between each: planks, beam sets, lanterns, ore glints. */
const PLANK_SECONDS = 0.2;
const SET_SECONDS = 1.3;
const LANTERN_SECONDS = 2.6;
const GLINT_SECONDS = 0.33;
/** A boulder lands this far ahead of you, after falling for this long. */
const ROCK_LAND_LEAD = 1.5;
const ROCK_FALL = 0.7;
/** A cave-in slumps off its wall this far ahead of you, after the wall cracks for this long. */
const CAVE_LEAD = 1.35;
const CAVE_WARN = 0.55;
/** Below this the dark starts closing in. */
const LAMP_DIM_FROM = 70;
/**
 * Widest the shaft is ever drawn, in CSS pixels. The model works in fractions
 * of the shaft, so without this a maximised window renders the same passage as
 * an enormous cavern. Rock simply fills whatever is left over.
 */
const SHAFT_MAX_PX = 560;
/** Widest the canvas itself is ever made: the shaft plus a frame of rock. Keeps the cost flat on big windows. */
const CANVAS_MAX_PX = SHAFT_MAX_PX + 360;
/** Live particles are capped, so a busy stretch can never cost frames. */
const MAX_SPARKS = 110;
/** Sprite boxes, in CSS px. Sprites are drawn 1:1, so these are their on-screen sizes. */
const GEM_BOX = 36;
const PICKUP_BOX = 44;
/** A gas puff's sprite, drawn scaled to the pocket. */
const PUFF_BOX = 96;
/** Floating numbers: how many can be up at once, their line spacing (px) and how long each lasts (s). */
const MAX_POPS = 3;
const POP_LINE = 15;
const POP_LIFE = 1.05;
/** How long each ending's beat holds the screen before the pieces come out. */
const WIN_BEAT_MS = 1300;
const LOSE_BEAT_MS = 1500;
/** Seconds of the ending that animate; after that the last frame just stays. */
const END_SECONDS = 1.6;
/**
 * How dark the rock gets at the canvas's own left and right edges, when the
 * canvas is capped narrower than its window. The stage behind it (game.css,
 * .ph-game-stage) starts at this same darkness, so the seam does not show.
 */
const SIDE_DARK = 0.8;
/** The canvas's side fade, eased (smoothstep) so it meets the stage's slow gradient without a crease: [offset, darkness]. */
const SIDE_FADE: ReadonlyArray<readonly [number, string]> = [0, 0.2, 0.4, 0.6, 0.8, 1].map((u) => [u, `rgba(0,0,0,${(SIDE_DARK * (1 - u * u * (3 - 2 * u))).toFixed(3)})`] as const);
/** The lamp guttering out, one step per 50 ms: how much light is left. */
const GUTTER = [1, 0.35, 1, 0.9, 0.2, 0.75, 0, 0.5, 0, 0, 0.25];

type Phase = "ready" | "playing" | "paused" | "done";

/** A number or word beside the mite. `side` is which side of it; `slot` how many newer pops sit below it. */
interface Pop { text: string; color: string; side: -1 | 1; age: number; slot: number; lift: number }
interface Spark { x: number; y: number; vx: number; vy: number; age: number; life: number; color: string; size: number }
/**
 * One line across the top band. Higher `prio` goes first and can cut a lower
 * one short; a queued banner that has waited longer than `ttl` seconds is old
 * news and is dropped (0: only if nothing else is up).
 */
interface BannerSpec { key: string; title: string; suffix?: string; sub?: string; color: string; dur: number; prio: number; ttl: number }
interface Banner extends BannerSpec { age: number }

/** Everything that is only for the eyes. The game state is the sim's. */
interface View {
  pops: Pop[];
  sparks: Spark[];
  hurtFlash: number;
  gasFlash: number;
  shake: number;
  tilt: number;
  scroll: number;
  /** Real seconds since the run began, for banner timing. */
  clock: number;
  /** Boulders that have landed and cave-ins that have slumped, so each thuds once. */
  landed: Set<number>;
  gasTick: number;
  banner: Banner | null;
  queue: Array<BannerSpec & { at: number }>;
  /** The fork's warning has been given. */
  forkCalled: boolean;
  /** How the run ended, once it has, and seconds since. */
  ending: RunOutcome | null;
  endAge: number;
}

/** What a run comes to: the server's verdict when there is one, else the local sim's. */
interface Final { score: number; won: boolean; nonces: number; stale: number; scrapes: number; whites: number; verified: boolean }

export interface BlockHuntOptions {
  /** Called once when a run ends, with the ore banked and how it ended (the server's word when ranked). */
  onRunEnd?: (ore: number, outcome: RunOutcome) => void;
  /**
   * Where runs accumulate. Given one, every finished run is recorded and its
   * Whites awarded; without one each run stands alone and nothing is awarded.
   */
  ledger?: PracticeLedger;
  /** Force the run's seed — practice only, never ranked. `?gameseed=` fills this in for support and QA. */
  seed?: number;
  /** The window the game runs in, so its title can say whether this run is ranked or practice. */
  win?: Pick<WindowHandle, "setTitle">;
}

function seedFromUrl(): number | null {
  try {
    const raw = new URLSearchParams(location.search).get("gameseed");
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n >>> 0 : null;
  } catch {
    return null;
  }
}

/** Resolve to null if `p` has not settled within `ms`. Never rejects. */
function within<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(null); });
  });
}

/** A fresh seed for an unranked run, from the platform's CSPRNG — never the last seed stepped on. */
function freshSeed(): number {
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0]! >>> 0;
  } catch {
    return (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
  }
}

/**
 * The desktop's own motion setting (right-click → Wallpaper motion), so the
 * game calms down exactly when the wallpaper does: "off" always, "auto" when
 * the OS asks for reduced motion, "on" never. Unset means the shell default, on.
 */
function calmMotion(): boolean {
  let pref: unknown = null;
  try { pref = JSON.parse(localStorage.getItem("ph.desktop.motion") ?? "null"); } catch { /* storage blocked */ }
  return pref === "off" || (pref === "auto" && prefersReducedMotion());
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** A stable pseudo-random 0..1 from an integer, for furniture that must not flicker between frames. */
const hash01 = (n: number): number => {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 0x1_0000_0000;
};

/** Mix two #rrggbb colours. Used once per stratum, never per pixel. */
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** What glints in the rock at each depth: quartz, then green, copper, gold. */
const GLINT_COLOR: Record<string, string> = {
  "Surface rock": "#d8dccb",
  "The mempool": "#9be05a",
  "Deep rock": "#e09a58",
  "The vein": "#ffd24a",
  "The vault": "#ffe9a3",
};

const ARCHETYPE_NAME: Record<RunPlan["archetype"], string> = {
  winding: "A winding shaft",
  zigzag: "Tight switchbacks",
  caverns: "Caverns",
  forked: "A forked shaft",
};

/** What is new in each layer, said once on the way in. Index = stratum. */
const STRATUM_HINT = ["", "stale shares ahead", "falling rock, cave-ins and gas", "rich ore, and more of everything", "the block is close"];

export function mountBlockHunt(host: HTMLElement, opts: BlockHuntOptions = {}): () => void {
  host.classList.add("ph-game");
  const calm = calmMotion();
  const sound = createGameSound();
  /** A seed someone forced: practice only, and never ranked. */
  const forcedSeed = opts.seed ?? seedFromUrl();

  // ── DOM ──────────────────────────────────────────────────────────────────
  const canvas = h("canvas", { class: "ph-game-canvas", tabindex: "0", "aria-label": "Block hunt. Left and right arrows, A and D, or the mouse to steer down the mineshaft. P pauses, M mutes." });
  const ctx = canvas.getContext("2d");

  const depthFill = h("i", { class: "ph-game-air-fill" });
  const windowMark = h("i", { class: "ph-game-air-window", style: `left:${((1 - BLOCK_WINDOW_SECONDS / RUN_SECONDS) * 100).toFixed(2)}%` });
  const depthBar = h("div", { class: "ph-game-air", role: "progressbar", "aria-label": "Depth", "aria-valuemin": "0", "aria-valuemax": "100" }, windowMark, depthFill);
  const lampFill = h("i", { class: "ph-game-lamp-fill" });
  const lampPct = h("span", { class: "ph-game-lamp-v" }, String(LAMP_MAX));
  const lampBar = h("div", { class: "ph-game-lamp", role: "meter", "aria-label": "Lamp", "aria-valuemin": "0", "aria-valuemax": String(LAMP_MAX), "aria-valuenow": String(LAMP_MAX) },
    h("span", { class: "ph-game-lamp-l" }, "Lamp"), h("b", {}, lampFill), lampPct);
  const stratumOut = h("span", { class: "ph-game-stratum" }, STRATA[0].name);
  const timeOut = h("span", { class: "ph-game-time" }, `${RUN_SECONDS}s`);
  const scoreOut = h("span", { class: "ph-game-ore-v" }, "0");
  const multOut = h("span", { class: "ph-game-mult" }, "×1");
  const pips = Array.from({ length: MULT_STEP_STREAK }, () => h("i"));
  const streakOut = h("span", { class: "ph-game-pips", "aria-hidden": "true" }, ...pips);
  const ocFill = h("i");
  const ocOut = h("span", { class: "ph-game-oc", hidden: true, title: "Overclocked" }, h("b", {}, ocFill));
  const muteBtn = h("button", { class: "ph-game-mute", type: "button", title: "Sound (M)", "aria-label": "Sound" });
  const paintMute = () => {
    muteBtn.classList.toggle("is-off", sound.muted());
    muteBtn.setAttribute("aria-pressed", String(!sound.muted()));
  };
  const toggleMute = () => { sound.setMuted(!sound.muted()); if (!sound.muted()) sound.unlock(); paintMute(); };
  muteBtn.addEventListener("click", () => { toggleMute(); canvas.focus(); });
  paintMute();

  const hud = h("div", { class: "ph-game-hud" },
    h("div", { class: "ph-game-depth" },
      h("div", { class: "ph-game-depth-top" }, stratumOut, timeOut),
      lampBar,
      depthBar),
    h("div", { class: "ph-game-score" },
      h("div", { class: "ph-game-score-top" }, h("span", { class: "ph-game-hud-l" }, "Hashes"), scoreOut, multOut),
      h("div", { class: "ph-game-score-bot" }, streakOut, ocOut)),
    muteBtn);

  const overlay = h("div", { class: "ph-game-overlay" });
  // Rock either side of a capped canvas (game.css): beside it, never under it.
  const sides = [h("i", { class: "ph-game-side is-l", "aria-hidden": "true" }), h("i", { class: "ph-game-side is-r", "aria-hidden": "true" })];
  const stage = h("div", { class: "ph-game-stage" }, ...sides, canvas, overlay);

  // Direction sources, newest last. Hold left, tap right: you go right, and
  // letting go of right goes back to left — the way two held keys should feel.
  const dirs: Array<{ src: string; dir: -1 | 1 }> = [];
  const press = (src: string, dir: -1 | 1) => { release(src); dirs.push({ src, dir }); };
  const release = (src: string) => { const i = dirs.findIndex((d) => d.src === src); if (i >= 0) dirs.splice(i, 1); };
  const heldDir = (): -1 | 0 | 1 => dirs[dirs.length - 1]?.dir ?? 0;

  const padBtn = (glyph: string, delta: -1 | 1, cls: string) => {
    const src = delta < 0 ? "pad-left" : "pad-right";
    const b = h("button", { class: `ph-game-pad-b ${cls}`, type: "button", "aria-label": delta < 0 ? "Steer left" : "Steer right" }, glyph);
    const down = (ev: Event) => { ev.preventDefault(); press(src, delta); pointerX = null; keyAt = performance.now(); };
    const up = (ev: Event) => { ev.preventDefault(); release(src); };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("pointerleave", up);
    return b;
  };
  const pad = h("div", { class: "ph-game-pad ph-game-pad--lr" }, padBtn("◀", -1, "is-left"), padBtn("▶", 1, "is-right"));

  host.replaceChildren(hud, stage, pad);

  // ── State ────────────────────────────────────────────────────────────────
  let phase: Phase = "ready";
  let sim: Sim | null = null;
  let recorder: SteerRecorder = createSteerRecorder();
  let view: View | null = null;
  /** Where the sim was one tick ago, for drawing between ticks. */
  let prevX = 0, prevTick = 0;
  let acc = 0;
  let pointerX: number | null = null;
  /** A target set by the debug handle: steered toward through the same inputs a mouse uses. */
  let autoTarget: number | null = null;
  let bot: ((s: Sim) => number) | null = null;
  let dragging = false;
  /** Where the mouse was when a key took over; it has to leave here to steer again. */
  let mouseAnchor: { x: number; y: number } | null = null;
  let lastMouse: { x: number; y: number } | null = null;
  let visible = true;
  let raf = 0;
  let lastMs = 0;
  let dpr = 1;
  let cardTimer: number | null = null;
  let closeReveal: (() => void) | null = null;
  /** The window closed: finish what a run owes (its Whites), but draw nothing more. */
  let disposed = false;
  let seed = forcedSeed ?? freshSeed();
  /** The server's ticket for this run, when it is ranked. */
  let ticket: RunTicket | null = null;
  /** Waiting on a ticket. */
  let starting = false;
  /** Cosmetic randomness only (sparks, shake), seeded per run so a seed always looks the same. */
  let fx = createRng(seed ^ 0x51ed27);
  /** Pixels per second of descent, for the moment being drawn. */
  let pps = 1;
  /** When the last steering key went down, until the tick that applied it. */
  let keyAt: number | null = null;
  const drawTimes: number[] = [];
  const frameGaps: number[] = [];
  const inputLatency: number[] = [];

  /** Tell the desktop when a run is live, so it can rest the wallpaper behind it. */
  const announcePlaying = (playing: boolean) => {
    host.dispatchEvent(new CustomEvent("ph:game-playing", { bubbles: true, detail: { playing } }));
  };

  /** The window's title: whether the run on screen is ranked. Before the first run, neither. */
  const setTitle = (title: string) => {
    try { opts.win?.setTitle(title); } catch { /* the window is going away */ }
  };
  setTitle("Block Hunt");

  // ── Textures and sprites ─────────────────────────────────────────────────
  // Everything is rasterised once at device resolution and blitted 1:1.
  const sprite = (w: number, hgt: number, paint: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * dpr);
    c.height = Math.ceil(hgt * dpr);
    const g = c.getContext("2d");
    if (g) { g.scale(dpr, dpr); paint(g); }
    return c;
  };

  /**
   * The rock: a tile with grit, bedding streaks, cracks and pebbles, repeated
   * as a pattern — one draw call per frame however big the view gets. Every
   * mark that crosses an edge is drawn again on the far side, so it tiles.
   */
  let rockPattern: CanvasPattern | null = null;
  const ROCK_TILE = 256;
  const buildRockTexture = () => {
    if (!ctx) return;
    const tile = document.createElement("canvas");
    tile.width = ROCK_TILE;
    tile.height = ROCK_TILE;
    const g = tile.getContext("2d");
    if (!g) return;
    const T = ROCK_TILE;
    const rng = createRng(0x9e3779b9);
    const wrapped = (paint: () => void) => {
      for (const dx of [-T, 0, T]) for (const dy of [-T, 0, T]) { g.save(); g.translate(dx, dy); paint(); g.restore(); }
    };
    // Bedding: faint wavy streaks, lighter and darker, that run the full width.
    for (let i = 0; i < 18; i++) {
      const y = rng() * T, amp = 2 + rng() * 5, k = 1 + Math.floor(rng() * 3), ph = rng() * 6.28;
      const light = rng() < 0.45;
      g.strokeStyle = light ? `rgba(255,236,200,${(0.02 + rng() * 0.03).toFixed(3)})` : `rgba(0,0,0,${(0.08 + rng() * 0.12).toFixed(3)})`;
      g.lineWidth = 1 + rng() * 3;
      wrapped(() => {
        g.beginPath();
        for (let x = 0; x <= T; x += 8) {
          const yy = y + Math.sin((x / T) * Math.PI * 2 * k + ph) * amp;
          if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
        }
        g.stroke();
      });
    }
    // Grit catching the light, and shadow in the grain.
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(255,240,214,${(rng() * 0.04).toFixed(3)})`;
      g.fillRect(rng() * T, rng() * T, rng() * 1.4 + 0.4, rng() * 1.4 + 0.4);
    }
    for (let i = 0; i < 2800; i++) {
      g.fillStyle = `rgba(0,0,0,${(rng() * 0.12).toFixed(3)})`;
      g.fillRect(rng() * T, rng() * T, rng() * 2.4 + 0.5, rng() * 2.4 + 0.5);
    }
    // Pebbles: a dark body with a lit top edge.
    for (let i = 0; i < 26; i++) {
      const x = rng() * T, y = rng() * T, rx = 2 + rng() * 5, ry = 1.5 + rng() * 3.5;
      const r = 150 + Math.floor(rng() * 40), gg = 130 + Math.floor(rng() * 30), b = 105 + Math.floor(rng() * 20);
      wrapped(() => {
        g.fillStyle = "rgba(0,0,0,.28)";
        g.beginPath(); g.ellipse(x + 1, y + 1.5, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = `rgba(${r},${gg},${b},.22)`;
        g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "rgba(255,240,214,.12)";
        g.beginPath(); g.ellipse(x - rx * 0.25, y - ry * 0.35, rx * 0.5, ry * 0.35, 0, 0, Math.PI * 2); g.fill();
      });
    }
    // Cracks: short jagged runs, dark with a hairline of light beside them.
    for (let i = 0; i < 9; i++) {
      let x = rng() * T, y = rng() * T;
      const pts: Array<[number, number]> = [[x, y]];
      const ang = rng() * Math.PI * 2;
      for (let s = 0; s < 7; s++) { x += Math.cos(ang + (rng() - 0.5) * 1.4) * (5 + rng() * 9); y += Math.sin(ang + (rng() - 0.5) * 1.4) * (5 + rng() * 9); pts.push([x, y]); }
      wrapped(() => {
        g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = 1.3;
        g.beginPath(); pts.forEach(([px, py], j) => (j ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke();
        g.strokeStyle = "rgba(255,236,200,.06)"; g.lineWidth = 1;
        g.beginPath(); pts.forEach(([px, py], j) => (j ? g.lineTo(px + 1, py + 1) : g.moveTo(px + 1, py + 1))); g.stroke();
      });
    }
    rockPattern = ctx.createPattern(tile, "repeat");

    // The same rock, flattened onto its colour, for the stage behind the
    // canvas: a maximised window shows it either side of the capped canvas,
    // still and darker, so the shaft sits in rock rather than in a black box.
    // Painted once; game.css darkens it. A data: URL, as the CSP allows.
    try {
      const flat = document.createElement("canvas");
      flat.width = T;
      flat.height = T;
      const f = flat.getContext("2d");
      if (f) {
        f.fillStyle = rockFor(STRATA[0]);
        f.fillRect(0, 0, T, T);
        f.drawImage(tile, 0, 0);
        stage.style.setProperty("--ph-game-rock", `url("${flat.toDataURL("image/jpeg", 0.8)}")`);
      }
    } catch { /* no data URLs here: the stage stays plain black */ }
  };

  /** The mite silhouette. Optional — a fallback shape draws if it never loads. */
  const mite = new Image();
  let miteReady = false;
  mite.onload = () => { miteReady = true; miteSprite = null; };
  mite.src = "/assets/brand/parasite-white-512.png";

  let gemSprites = new Map<string, HTMLCanvasElement>();
  let nonceSprite: HTMLCanvasElement | null = null;
  let staleSprite: HTMLCanvasElement | null = null;
  let boostSprite: HTMLCanvasElement | null = null;
  let boulderSprites: HTMLCanvasElement[] = [];
  let rubbleSprite: HTMLCanvasElement | null = null;
  let gasPuffs: HTMLCanvasElement[] = [];
  let beamSprite: HTMLCanvasElement | null = null;
  let lanternSprite: HTMLCanvasElement | null = null;
  let lanternGlow: HTMLCanvasElement | null = null;
  const glintSprites = new Map<string, HTMLCanvasElement>();
  let miteSprite: HTMLCanvasElement | null = null;
  let miteSpriteSize = 0;
  let spriteDpr = 0;

  /** An irregular rock outline: `n` points around a centre, radius wobbling. */
  const rockPath = (g: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number, rng: () => number) => {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, rr = r * (0.72 + rng() * 0.32);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.86;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
  };

  /** A pointy-topped hexagon of radius r, as the current path. */
  const hexPath = (g: CanvasRenderingContext2D, r: number) => {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
  };
  /** A four-point glint, for the catchlight on a cut stone. */
  const glint = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => {
    g.fillStyle = "rgba(255,255,255,.95)";
    g.beginPath();
    g.moveTo(x, y - r); g.lineTo(x + r * 0.28, y - r * 0.28); g.lineTo(x + r, y); g.lineTo(x + r * 0.28, y + r * 0.28);
    g.lineTo(x, y + r); g.lineTo(x - r * 0.28, y + r * 0.28); g.lineTo(x - r, y); g.lineTo(x - r * 0.28, y - r * 0.28);
    g.closePath();
    g.fill();
  };

  const buildSprites = () => {
    spriteDpr = dpr;
    // Hashes: a cut green stone with its hex digit on the table, glowing, so
    // it reads as something worth picking up rather than a stray character.
    // Lit from the top left: the six facets round the table shade by facing.
    const FACET = ["#b8f283", "#7cc145", "#3f871c", "#4c9625", "#8fd14f", "#d4fbad"];
    gemSprites = new Map();
    for (const ch of "0123456789abcdef") {
      gemSprites.set(ch, sprite(GEM_BOX, GEM_BOX, (g) => {
        g.translate(GEM_BOX / 2, GEM_BOX / 2);
        const halo = g.createRadialGradient(0, 0, 5, 0, 0, GEM_BOX / 2);
        halo.addColorStop(0, "rgba(150,236,90,.5)");
        halo.addColorStop(1, "rgba(150,236,90,0)");
        g.fillStyle = halo;
        g.fillRect(-GEM_BOX / 2, -GEM_BOX / 2, GEM_BOX, GEM_BOX);
        const R = 12.5, r = 8.4;
        for (let i = 0; i < 6; i++) {
          const a0 = -Math.PI / 2 + (i * Math.PI) / 3, a1 = a0 + Math.PI / 3;
          g.beginPath();
          g.moveTo(Math.cos(a0) * R, Math.sin(a0) * R); g.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);
          g.lineTo(Math.cos(a1) * r, Math.sin(a1) * r); g.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
          g.closePath();
          g.fillStyle = FACET[i]!;
          g.fill();
        }
        const table = g.createLinearGradient(-r, -r, r, r);
        table.addColorStop(0, "#effee0");
        table.addColorStop(1, "#b2ec7c");
        hexPath(g, r);
        g.fillStyle = table;
        g.fill();
        hexPath(g, R);
        g.strokeStyle = "rgba(12,44,2,.9)";
        g.lineWidth = 1.3;
        g.stroke();
        g.font = "800 12px ui-monospace,Consolas,monospace";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = "#123604";
        g.fillText(ch, 0, 1);
        glint(g, -7.5, -7, 3.2);
      }));
    }
    // A nonce: a gold brilliant in a ring — rarer, bigger and warmer than any hash.
    nonceSprite = sprite(PICKUP_BOX, PICKUP_BOX, (g) => {
      g.translate(PICKUP_BOX / 2, PICKUP_BOX / 2);
      const halo = g.createRadialGradient(0, 0, 6, 0, 0, PICKUP_BOX / 2);
      halo.addColorStop(0, "rgba(255,206,80,.5)");
      halo.addColorStop(1, "rgba(255,206,80,0)");
      g.fillStyle = halo;
      g.fillRect(-PICKUP_BOX / 2, -PICKUP_BOX / 2, PICKUP_BOX, PICKUP_BOX);
      g.shadowColor = "rgba(255,210,74,.8)";
      g.shadowBlur = 8;
      g.strokeStyle = "#ffd24a";
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(0, 0, 17, 0, Math.PI * 2);
      g.stroke();
      g.shadowBlur = 0;
      // Crown over pavilion, facets picked out, outlined dark.
      const crown = g.createLinearGradient(0, -11, 0, -3);
      crown.addColorStop(0, "#fff6cf");
      crown.addColorStop(1, "#ffd24a");
      g.fillStyle = crown;
      g.beginPath(); g.moveTo(-6.5, -10); g.lineTo(6.5, -10); g.lineTo(11, -3.5); g.lineTo(-11, -3.5); g.closePath(); g.fill();
      const pav = g.createLinearGradient(-11, 0, 11, 0);
      pav.addColorStop(0, "#f7c43a");
      pav.addColorStop(1, "#a96a06");
      g.fillStyle = pav;
      g.beginPath(); g.moveTo(-11, -3.5); g.lineTo(11, -3.5); g.lineTo(0, 12.5); g.closePath(); g.fill();
      g.strokeStyle = "rgba(110,66,0,.6)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-6.5, -10); g.lineTo(-3, -3.5); g.lineTo(0, -10); g.lineTo(3, -3.5); g.lineTo(6.5, -10);
      g.moveTo(-3, -3.5); g.lineTo(0, 12.5); g.lineTo(3, -3.5);
      g.stroke();
      g.strokeStyle = "#4a2d00";
      g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(-6.5, -10); g.lineTo(6.5, -10); g.lineTo(11, -3.5); g.lineTo(0, 12.5); g.lineTo(-11, -3.5); g.closePath(); g.stroke();
      glint(g, -5, -7.5, 3.6);
    });
    staleSprite = sprite(PICKUP_BOX, PICKUP_BOX, (g) => {
      g.translate(PICKUP_BOX / 2, PICKUP_BOX / 2);
      g.shadowColor = "rgba(255,79,95,.75)";
      g.shadowBlur = 10;
      g.fillStyle = "rgba(58,6,12,.95)";
      g.strokeStyle = "#ff4f5f";
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(-13, -13, 26, 26, 5);
      g.fill();
      g.stroke();
      g.shadowBlur = 0;
      g.strokeStyle = "#ff7e8a";
      g.lineWidth = 3.2;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(-6.5, -6.5); g.lineTo(6.5, 6.5);
      g.moveTo(6.5, -6.5); g.lineTo(-6.5, 6.5);
      g.stroke();
    });
    boostSprite = sprite(PICKUP_BOX, PICKUP_BOX, (g) => {
      g.translate(PICKUP_BOX / 2, PICKUP_BOX / 2);
      g.shadowColor = "rgba(92,225,255,.85)";
      g.shadowBlur = 12;
      g.strokeStyle = "#5ce1ff";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 15, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = "#d4f8ff";
      g.beginPath();
      g.moveTo(2.5, -11); g.lineTo(-6.5, 2); g.lineTo(-1, 2); g.lineTo(-3.5, 11);
      g.lineTo(6.5, -2.5); g.lineTo(1, -2.5); g.closePath();
      g.fill();
    });
    // Boulders: three shapes, each shaded from the top left, with a crack or two.
    boulderSprites = [0, 1, 2].map((v) => sprite(64, 64, (g) => {
      const rng = createRng(0x51a7e + v * 977);
      g.translate(32, 33);
      g.shadowColor = "rgba(0,0,0,.7)"; g.shadowBlur = 8; g.shadowOffsetY = 4;
      rockPath(g, 0, 0, 25, 9 + v, rng);
      const fill = g.createRadialGradient(-8, -10, 2, 0, 0, 30);
      fill.addColorStop(0, "#8a8178"); fill.addColorStop(0.55, "#5a524b"); fill.addColorStop(1, "#2e2a26");
      g.fillStyle = fill; g.fill();
      g.shadowColor = "transparent";
      g.strokeStyle = "rgba(0,0,0,.6)"; g.lineWidth = 1.5; g.stroke();
      g.strokeStyle = "rgba(0,0,0,.45)"; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(-6 + rng() * 4, -14); g.lineTo(-2, -4); g.lineTo(-7, 6); g.stroke();
      g.strokeStyle = "rgba(255,240,214,.18)"; g.lineWidth = 1;
      g.beginPath(); g.arc(-6, -8, 12, Math.PI * 1.05, Math.PI * 1.6); g.stroke();
    }));
    // Rubble: a heap slumped against the left wall; drawn mirrored for the right.
    rubbleSprite = sprite(140, 70, (g) => {
      const rng = createRng(0xcafe11);
      g.fillStyle = "rgba(0,0,0,.45)";
      g.beginPath(); g.moveTo(0, 6); g.quadraticCurveTo(150, 35, 0, 66); g.closePath(); g.fill();
      for (let i = 0; i < 26; i++) {
        const along = rng(), x = 6 + along * 118 * (1 - Math.abs(rng() - 0.5)), y = 35 + (rng() - 0.5) * 50 * (1 - along * 0.7);
        const r = 6 + rng() * 12 * (1 - along * 0.5);
        rockPath(g, x, y, r, 7, rng);
        const shade = 70 + Math.floor(rng() * 50);
        g.fillStyle = `rgb(${shade},${shade - 6},${shade - 14})`;
        g.fill();
        g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = 1; g.stroke();
        g.fillStyle = "rgba(255,240,214,.12)";
        g.beginPath(); g.arc(x - r * 0.3, y - r * 0.35, r * 0.35, 0, Math.PI * 2); g.fill();
      }
    });
    // Firedamp: puffs, each a few soft lobes round its centre with a faint
    // brighter rim, every lobe wholly inside the sprite so no puff ever shows
    // a straight edge. A pocket is several of them, overlapping (drawGas).
    gasPuffs = [0, 1, 2].map((v) => sprite(PUFF_BOX, PUFF_BOX, (g) => {
      const rng = createRng(0x6a5 + v * 131);
      const c = PUFF_BOX / 2;
      for (let i = 0; i < 5; i++) {
        const a = rng() * Math.PI * 2, d = rng() * 11;
        const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d * 0.8;
        const r = 22 + rng() * 13;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, "rgba(150,226,106,.25)");
        grad.addColorStop(0.6, "rgba(136,212,96,.13)");
        grad.addColorStop(0.86, "rgba(190,248,146,.17)");
        grad.addColorStop(1, "rgba(190,248,146,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }));
    // A timber beam: grain along its length, darker ends, iron straps.
    beamSprite = sprite(256, 14, (g) => {
      const rng = createRng(0xbea4);
      const body = g.createLinearGradient(0, 0, 0, 14);
      body.addColorStop(0, "#6b4a26"); body.addColorStop(0.5, "#57391b"); body.addColorStop(1, "#2f1f0e");
      g.fillStyle = body; g.fillRect(0, 0, 256, 14);
      for (let i = 0; i < 9; i++) {
        g.strokeStyle = `rgba(0,0,0,${(0.12 + rng() * 0.2).toFixed(2)})`; g.lineWidth = 1;
        const y = 2 + rng() * 10;
        g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 1.2); g.stroke();
      }
      g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, 0, 6, 14); g.fillRect(250, 0, 6, 14);
      g.fillStyle = "#3a3632"; g.fillRect(14, 0, 5, 14); g.fillRect(237, 0, 5, 14);
      g.fillStyle = "rgba(255,240,214,.18)"; g.fillRect(0, 0, 256, 1);
    });
    lanternSprite = sprite(20, 28, (g) => {
      g.fillStyle = "#2a2622"; g.fillRect(8, 0, 4, 5);
      g.strokeStyle = "#1c1916"; g.lineWidth = 2;
      g.beginPath(); g.roundRect(3, 5, 14, 19, 3); g.stroke();
      const glass = g.createLinearGradient(0, 6, 0, 24);
      glass.addColorStop(0, "#ffe7a6"); glass.addColorStop(1, "#ff9a3c");
      g.fillStyle = glass; g.beginPath(); g.roundRect(4, 6, 12, 17, 2); g.fill();
      g.fillStyle = "#fffbe8"; g.fillRect(9, 10, 2, 7);
      g.fillStyle = "#2a2622"; g.fillRect(2, 23, 16, 3);
    });
    lanternGlow = sprite(150, 150, (g) => {
      const grad = g.createRadialGradient(75, 75, 0, 75, 75, 75);
      grad.addColorStop(0, "rgba(255,190,100,.5)");
      grad.addColorStop(0.4, "rgba(255,160,70,.16)");
      grad.addColorStop(1, "rgba(255,150,60,0)");
      g.fillStyle = grad; g.fillRect(0, 0, 150, 150);
    });
    glintSprites.clear();
    for (const color of new Set(Object.values(GLINT_COLOR))) {
      glintSprites.set(color, sprite(14, 14, (g) => {
        g.translate(7, 7);
        g.shadowColor = color; g.shadowBlur = 5;
        g.strokeStyle = color; g.lineWidth = 1.2; g.lineCap = "round";
        g.beginPath(); g.moveTo(-5, 0); g.lineTo(5, 0); g.moveTo(0, -5); g.lineTo(0, 5); g.stroke();
        g.fillStyle = "#fff"; g.beginPath(); g.arc(0, 0, 1.3, 0, Math.PI * 2); g.fill();
      }));
    }
    miteSprite = null;
  };

  /** The mite at its current on-screen size, downsampled once with full quality. */
  const miteAt = (size: number): HTMLCanvasElement | null => {
    if (!miteReady) return null;
    const px = Math.round(size);
    if (miteSprite && miteSpriteSize === px) return miteSprite;
    miteSpriteSize = px;
    miteSprite = sprite(px, px, (g) => {
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(mite, 0, 0, px, px);
    });
    return miteSprite;
  };

  const blit = (img: CanvasImageSource, cx: number, cy: number, w: number, hgt: number) => {
    ctx?.drawImage(img, cx - w / 2, cy - hgt / 2, w, hgt);
  };

  // ── Geometry ─────────────────────────────────────────────────────────────
  const viewW = () => canvas.width / dpr;
  const viewH = () => canvas.height / dpr;
  /** Drawn width of the shaft, and where its left edge sits in the view. */
  const shaftW = () => Math.min(viewW(), SHAFT_MAX_PX);
  const shaftLeft = () => (viewW() - shaftW()) / 2;
  /** Map a model position (0..1 across the shaft) to a screen x. */
  const shaftX = (f: number) => shaftLeft() + f * shaftW();
  const miteY = () => viewH() * MITE_Y_FRACTION;
  const miteSize = () => Math.min(shaftW() * 0.11, 44);
  /** The view below the mite is what is still to come; how much of the run fits in it sets the pace. */
  const ppsAt = (plan: RunPlan, t: number) => (viewH() - miteY()) / viewAheadAt(plan, t);
  /** Run-time of whatever sits at screen row y, and back. Deeper is further down. */
  const timeAtY = (y: number, elapsed: number) => elapsed + (y - miteY()) / pps;
  const yAtTime = (t: number, elapsed: number) => miteY() + (t - elapsed) * pps;
  const wallL = (t: number) => { const p = sim!.plan.passage; return shaftX(p.centreAt(t) - p.halfWidthAt(t)); };
  const wallR = (t: number) => { const p = sim!.plan.passage; return shaftX(p.centreAt(t) + p.halfWidthAt(t)); };

  /** The run time and position being drawn: between the last tick and this one. */
  const drawn = () => {
    if (!sim) return { t: 0, x: 0.5 };
    const a = phase === "playing" ? clamp(acc / TICK_MS, 0, 1) : 1;
    return { t: (prevTick + (sim.tick - prevTick) * a) / TICK_HZ, x: lerp(prevX, sim.x, a) };
  };

  /** Width of the stage either side of the canvas, last time it was measured. */
  let stageBar = -1;
  const sizeCanvas = () => {
    const box = stage.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    const cssW = Math.max(240, Math.min(Math.floor(box.width), CANVAS_MAX_PX));
    const cssH = Math.max(240, Math.floor(box.height));
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    // Resizing the bitmap clears it and reallocates; only do it when it changed.
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!rockPattern) buildRockTexture();
    if (spriteDpr !== dpr) buildSprites();
    if (sim) pps = ppsAt(sim.plan, drawn().t);
    // Where the canvas stops, for the stage's rock either side of it (game.css).
    const bar = Math.max(0, Math.floor((box.width - cssW) / 2));
    if (bar !== stageBar) { stageBar = bar; stage.style.setProperty("--ph-game-bar", `${bar}px`); }
  };

  // ── Effects ──────────────────────────────────────────────────────────────
  const burst = (x: number, y: number, n: number, color: string, speed = 90, gravity = 1) => {
    if (!view) return;
    for (let i = 0; i < n && view.sparks.length < MAX_SPARKS; i++) {
      const a = fx() * Math.PI * 2, v = speed * (0.4 + fx() * 0.8);
      view.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3 * gravity, age: 0, life: 0.35 + fx() * 0.35, color, size: 1.5 + fx() * 2 });
    }
  };

  /**
   * Put a banner up, or queue it. Only one is ever on screen: a more important
   * one cuts the current short, an equal or lesser one waits its turn (and is
   * dropped if it waits past its ttl), and the same banner again just restarts.
   */
  const announce = (spec: BannerSpec) => {
    if (!view) return;
    const cur = view.banner;
    if (!cur) { view.banner = { ...spec, age: 0 }; return; }
    if (cur.key === spec.key) { Object.assign(cur, { suffix: undefined, sub: undefined }, spec); cur.age = Math.min(cur.age, 0.14); return; }
    if (spec.prio > cur.prio) {
      cur.age = Math.max(cur.age, cur.dur - 0.12);
      view.queue = view.queue.filter((q) => q.key !== spec.key);
      view.queue.unshift({ ...spec, at: view.clock });
      return;
    }
    if (spec.ttl <= 0) return;
    view.queue = view.queue.filter((q) => q.key !== spec.key);
    view.queue.push({ ...spec, at: view.clock });
    view.queue.sort((a, b) => b.prio - a.prio);
  };

  /** Which side of the mite has more room right now: pops go there. */
  const roomySide = (): -1 | 1 => {
    if (!sim) return 1;
    const [a, b] = laneOf(sim.plan.passage, timeOf(sim), sim.x);
    return b - sim.x >= sim.x - a ? 1 : -1;
  };

  /** A pop beside the mite. Older pops on that side step up a line; past MAX_POPS the oldest goes. */
  const pop = (text: string, color: string): Pop | null => {
    if (!view) return null;
    const p: Pop = { text, color, side: roomySide(), age: 0, slot: 0, lift: 0 };
    for (const q of view.pops) if (q.side === p.side) q.slot++;
    view.pops.unshift(p);
    if (view.pops.length > MAX_POPS) view.pops.length = MAX_POPS;
    return p;
  };

  // ── Render: the shaft ────────────────────────────────────────────────────
  /** Rock colour per stratum: the layer's hue mixed in once, instead of a full-view wash every frame. */
  const rockCache = new Map<string, string>();
  const rockFor = (s: Stratum) => {
    let c = rockCache.get(s.name);
    if (!c) { c = mix("#1c1812", s.accent, 0.06); rockCache.set(s.name, c); }
    return c;
  };
  /** The rock pattern, positioned so it scrolls with the descent. */
  const rockFill = () => {
    if (!ctx || !view || !rockPattern) return null;
    rockPattern.setTransform(new DOMMatrix([1, 0, 0, 1, 0, -(view.scroll % ROCK_TILE)]));
    return rockPattern;
  };

  /** The side fades, for the size they were built at. */
  let sideFade: { key: string; left: CanvasGradient; right: CanvasGradient } | null = null;
  const drawRock = (w: number, hgt: number, elapsed: number, stratum: Stratum) => {
    if (!ctx || !view) return;
    ctx.fillStyle = rockFor(stratum);
    ctx.fillRect(0, 0, w, hgt);
    const pat = rockFill();
    if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, w, hgt); }
    // Bedding planes, so the walls visibly scroll past and depth reads. They
    // spread apart as the descent speeds up.
    const firstBand = Math.ceil(timeAtY(hgt, elapsed) / BAND_SECONDS) * BAND_SECONDS;
    const lastBand = timeAtY(0, elapsed);
    for (let t = firstBand; t > lastBand; t -= BAND_SECONDS) {
      if (Math.round(t / BAND_SECONDS) % 4 !== 0) continue;
      const y = Math.round(yAtTime(t, elapsed)) + 0.5;
      ctx.strokeStyle = "rgba(0,0,0,.45)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.strokeStyle = "rgba(255,240,214,.05)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y + 2); ctx.lineTo(w, y + 2); ctx.stroke();
    }
    // Darken the rock away from the shaft, so the eye stays down the passage —
    // to SIDE_DARK at the canvas's edges, where the stage's own rock takes over.
    const sl = shaftLeft(), sw = shaftW();
    if (sl > 1) {
      // Built once per size, not per frame.
      const key = `${w}|${sl}|${sw}`;
      if (sideFade?.key !== key) {
        const left = ctx.createLinearGradient(0, 0, sl, 0);
        const right = ctx.createLinearGradient(w, 0, sl + sw, 0);
        for (const [u, c] of SIDE_FADE) { left.addColorStop(u, c); right.addColorStop(u, c); }
        sideFade = { key, left, right };
      }
      ctx.fillStyle = sideFade.left;
      ctx.fillRect(0, 0, sl, hgt);
      ctx.fillStyle = sideFade.right;
      ctx.fillRect(sl + sw, 0, w - sl - sw, hgt);
    }
  };

  /** Ore glinting in the rock beside the walls — quartz, green, copper, gold as you go down, thick in a vein. */
  const drawGlints = (hgt: number, elapsed: number, now: number) => {
    if (!ctx || !sim) return;
    const plan = sim.plan;
    const k0 = Math.floor(timeAtY(-10, elapsed) / GLINT_SECONDS) * 3, k1 = Math.ceil(timeAtY(hgt + 10, elapsed) / GLINT_SECONDS) * 3;
    for (let k = k0; k <= k1; k++) {
      const t = (k / 3 + hash01(k * 29 + 11) * 0.3) * GLINT_SECONDS;
      // Two in three only show in a vein: that is what a vein looks like.
      const vein = plan.veins.some((v) => t >= v.t && t <= v.t + v.dur);
      if (k % 3 !== 0 && !vein) continue;
      const r1 = hash01(k * 7 + plan.seed), r2 = hash01(k * 13 + 5 + plan.seed);
      const y = yAtTime(t, elapsed);
      const side = r1 < 0.5 ? -1 : 1;
      const x = side < 0 ? wallL(t) - 10 - r2 * 70 : wallR(t) + 10 + r2 * 70;
      const spr = glintSprites.get(vein ? "#ffd24a" : GLINT_COLOR[stratumAt(plan, t).name] ?? "#ffd24a");
      if (!spr) continue;
      const tw = Math.max(0, Math.sin(now / 1000 * 2.3 + k * 1.37));
      ctx.globalAlpha = 0.22 + 0.78 * tw * tw * tw * tw;
      blit(spr, x, y, 14, 14);
    }
    ctx.globalAlpha = 1;
  };

  /** Trace a wall from top to bottom (or back), as part of the current path. */
  const traceEdge = (hgt: number, elapsed: number, edge: (t: number) => number, down: boolean) => {
    if (!ctx) return;
    if (down) for (let y = -WALL_STEP_PX; y <= hgt + WALL_STEP_PX; y += WALL_STEP_PX) ctx.lineTo(edge(timeAtY(y, elapsed)), y);
    else for (let y = hgt + WALL_STEP_PX; y >= -WALL_STEP_PX; y -= WALL_STEP_PX) ctx.lineTo(edge(timeAtY(y, elapsed)), y);
  };

  const drawPassage = (hgt: number, elapsed: number, stratum: Stratum) => {
    if (!ctx || !sim) return;
    const { passage, fork } = sim.plan;
    // Carve the passage out as a single dark shape.
    ctx.beginPath();
    ctx.moveTo(wallL(timeAtY(-WALL_STEP_PX, elapsed)), -WALL_STEP_PX);
    traceEdge(hgt, elapsed, wallL, true);
    traceEdge(hgt, elapsed, wallR, false);
    ctx.closePath();
    ctx.fillStyle = "#050403";
    ctx.fill();

    // A fork's pillar: rock laid back over the void between the two lanes.
    const tTop = timeAtY(-WALL_STEP_PX, elapsed), tBot = timeAtY(hgt + WALL_STEP_PX, elapsed);
    const pillarOnScreen = fork != null && fork.t1 > tTop && fork.t0 < tBot;
    const pl = (t: number) => shaftX(passage.centreAt(t) - passage.pillarAt(t));
    const pr = (t: number) => shaftX(passage.centreAt(t) + passage.pillarAt(t));
    if (pillarOnScreen) {
      ctx.beginPath();
      const y0 = Math.max(-WALL_STEP_PX, yAtTime(fork.t0, elapsed)), y1 = Math.min(hgt + WALL_STEP_PX, yAtTime(fork.t1, elapsed));
      ctx.moveTo(pl(timeAtY(y0, elapsed)), y0);
      for (let y = y0; y <= y1; y += WALL_STEP_PX / 2) ctx.lineTo(pl(timeAtY(y, elapsed)), y);
      for (let y = y1; y >= y0; y -= WALL_STEP_PX / 2) ctx.lineTo(pr(timeAtY(y, elapsed)), y);
      ctx.closePath();
      ctx.fillStyle = rockFor(stratum);
      ctx.fill();
      const pat = rockFill();
      if (pat) { ctx.fillStyle = pat; ctx.fill(); }
    }

    // Timber lagging lines every wall: planks pinned to the rock, so they
    // scroll with it. One path for every plank, stroked twice.
    const k0 = Math.floor(timeAtY(-20, elapsed) / PLANK_SECONDS), k1 = Math.ceil(timeAtY(hgt + 20, elapsed) / PLANK_SECONDS);
    ctx.beginPath();
    for (let k = k0; k <= k1; k++) {
      const ta = k * PLANK_SECONDS, tb = ta + PLANK_SECONDS;
      const ya = yAtTime(ta, elapsed) + 1.5, yb = yAtTime(tb, elapsed) - 1.5;
      ctx.moveTo(wallL(ta), ya); ctx.lineTo(wallL(tb), yb);
      ctx.moveTo(wallR(ta), ya); ctx.lineTo(wallR(tb), yb);
      if (pillarOnScreen && passage.pillarAt(ta) > 0.004 && passage.pillarAt(tb) > 0.004) {
        ctx.moveTo(pl(ta), ya); ctx.lineTo(pl(tb), yb);
        ctx.moveTo(pr(ta), ya); ctx.lineTo(pr(tb), yb);
      }
    }
    ctx.lineCap = "butt";
    ctx.strokeStyle = "#3d2914";
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.strokeStyle = "rgba(120,84,44,.55)";
    ctx.lineWidth = 3;
    ctx.stroke();
    // The cut face in the layer's colour, thin: where the timber meets the void.
    ctx.strokeStyle = stratum.accent;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  /** Cross-beams: a timber set every so often, spanning each open lane. */
  const drawBeams = (hgt: number, elapsed: number) => {
    if (!ctx || !sim || !beamSprite) return;
    const k0 = Math.floor(timeAtY(-20, elapsed) / SET_SECONDS), k1 = Math.ceil(timeAtY(hgt + 20, elapsed) / SET_SECONDS);
    ctx.globalAlpha = 0.82;
    for (let k = k0; k <= k1; k++) {
      const t = k * SET_SECONDS + 0.55;
      if (t > RUN_SECONDS - 1.5) continue;
      const y = yAtTime(t, elapsed);
      if (y < -20 || y > hgt + 20) continue;
      for (const [a, b] of sim.plan.passage.lanesAt(t)) {
        const xa = shaftX(a) - 9, xb = shaftX(b) + 9;
        ctx.drawImage(beamSprite, xa, y - 6, xb - xa, 12);
      }
    }
    ctx.globalAlpha = 1;
  };

  /** Lanterns hung on the timber, alternating walls, each with a warm pool of light. */
  const drawLanterns = (hgt: number, elapsed: number, now: number) => {
    if (!ctx || !sim || !lanternSprite || !lanternGlow) return;
    const k0 = Math.floor(timeAtY(-60, elapsed) / LANTERN_SECONDS), k1 = Math.ceil(timeAtY(hgt + 60, elapsed) / LANTERN_SECONDS);
    for (let k = k0; k <= k1; k++) {
      const t = k * LANTERN_SECONDS + 1.1;
      if (t < 0.5 || t > RUN_SECONDS - 2) continue;
      const y = yAtTime(t, elapsed);
      if (y < -60 || y > hgt + 60) continue;
      const left = k % 2 === 0;
      const x = left ? wallL(t) + 9 : wallR(t) - 9;
      const flicker = calm ? 1 : 0.86 + 0.14 * Math.sin(now / 90 + k * 2.1) * Math.sin(now / 37 + k);
      ctx.globalAlpha = 0.75 * flicker;
      blit(lanternGlow, x, y + 4, 150, 150);
      ctx.globalAlpha = 1;
      blit(lanternSprite, x, y, 20, 28);
    }
  };

  const overclockLeft = (t: number) => (sim ? Math.max(0, sim.overclockUntil - t) : 0);

  const drawLamp = (hgt: number, t: number, x: number) => {
    if (!ctx || !sim) return;
    const cx = shaftX(x), cy = miteY();
    const strength = 0.55 + 0.45 * (sim.lamp / LAMP_MAX);
    const r = Math.min(shaftW(), hgt) * 0.42 * strength;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const oc = overclockLeft(t) > 0;
    g.addColorStop(0, oc ? "rgba(92,225,255,.2)" : `rgba(255,214,140,${(0.16 * strength).toFixed(3)})`);
    g.addColorStop(1, oc ? "rgba(92,225,255,0)" : "rgba(255,214,140,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };

  // ── Render: hazards, finds, the mite ─────────────────────────────────────
  /** Fade things in as they come into the lamp's reach rather than popping. */
  const reachAlpha = (y: number, hgt: number) => clamp(1.15 - Math.abs(y - miteY()) / (hgt * 0.9), 0.22, 1);

  /**
   * A gas pocket: a loose column of puffs down the stretch it hangs over,
   * each a little off the line and sized to the pocket, drifting and
   * breathing by position and alpha only. Where the puffs sit is fixed per
   * pocket, so the cloud keeps its shape while it scrolls past.
   */
  const GAS_PUFFS = 7;
  const drawGas = (hgt: number, elapsed: number, now: number) => {
    if (!ctx || !sim || gasPuffs.length === 0) return;
    const sw = shaftW();
    sim.plan.hazards.forEach((hz, i) => {
      if (hz.kind !== "gas") return;
      const y0 = yAtTime(hz.t, elapsed), y1 = yAtTime(hz.t + hz.span, elapsed);
      const wide = hz.r * 2 * sw;
      if (y1 < -wide || y0 > hgt + wide) return;
      const cx = shaftX(hz.x);
      for (let k = 0; k < GAS_PUFFS; k++) {
        const u = 0.08 + (0.84 * k) / (GAS_PUFFS - 1);
        const size = wide * (1.05 + hash01(i * 31 + k * 7) * 0.45);
        // Kept off the rock: gas fills the passage, it does not float over the wall.
        const tk = hz.t + hz.span * u, inset = size * 0.24;
        const lo = wallL(tk) + inset, hi = wallR(tk) - inset;
        const want = cx + (hash01(i * 97 + k * 13) - 0.5) * wide * 0.45;
        const px = lo < hi ? clamp(want, lo, hi) : (lo + hi) / 2;
        const dx = calm ? 0 : Math.sin(now / 1900 + k * 1.7 + i) * 4;
        const dy = calm ? 0 : Math.sin(now / 2300 + k * 2.3) * 3;
        ctx.globalAlpha = calm ? 0.9 : 0.74 + 0.26 * Math.sin(now / 1100 + k * 0.9 + i);
        ctx.drawImage(gasPuffs[(i + k) % gasPuffs.length]!, px + dx - size / 2, lerp(y0, y1, u) + dy - size / 2, size, size);
      }
    });
    ctx.globalAlpha = 1;
  };

  const drawHazards = (hgt: number, elapsed: number) => {
    if (!ctx || !sim || !view) return;
    const { hazards } = sim.plan;
    const sw = shaftW();
    for (let i = sim.nextHazard; i < hazards.length; i++) {
      const hz = hazards[i]!;
      if (hz.kind === "gas") continue;
      const yRest = yAtTime(hz.t, elapsed);
      if (yRest > hgt + 80) break;
      if (hz.kind === "stale") {
        if (!staleSprite || yRest < -40) continue;
        const size = PICKUP_BOX * clamp(sw / 520, 0.75, 1.1);
        ctx.globalAlpha = reachAlpha(yRest, hgt);
        blit(staleSprite, shaftX(hz.x), yRest, size, size);
        ctx.globalAlpha = 1;
      } else if (hz.kind === "rock") {
        const spr = boulderSprites[i % boulderSprites.length];
        if (!spr) continue;
        const size = Math.max(30, hz.r * 2 * sw * 1.15);
        const landAt = hz.t - ROCK_LAND_LEAD;
        if (elapsed < landAt - ROCK_FALL) continue;
        let y = yRest, spin = 0;
        if (elapsed < landAt) {
          // Still falling: it comes down the shaft past you and lodges ahead.
          const u = (elapsed - (landAt - ROCK_FALL)) / ROCK_FALL;
          y = lerp(-size, yRest, u * u);
          spin = (1 - u) * 3 * (i % 2 ? 1 : -1);
          ctx.fillStyle = `rgba(0,0,0,${(0.45 * u).toFixed(3)})`;
          ctx.beginPath(); ctx.ellipse(shaftX(hz.x), yRest + size * 0.32, size * 0.42 * u, size * 0.14 * u, 0, 0, Math.PI * 2); ctx.fill();
        } else if (!view.landed.has(i)) {
          view.landed.add(i);
          burst(shaftX(hz.x), yRest + size * 0.3, 10, "rgba(170,150,120,.9)", 70, 0.2);
          if (yRest < hgt) sound.rock();
        }
        ctx.save();
        ctx.translate(shaftX(hz.x), y);
        if (spin && !calm) ctx.rotate(spin);
        ctx.drawImage(spr, -size / 2, -size / 2, size, size);
        ctx.restore();
      } else if (hz.kind === "cavein") {
        if (!rubbleSprite) continue;
        const slump = hz.t - CAVE_LEAD;
        if (elapsed < slump - CAVE_WARN) continue;
        const wall = hz.side < 0 ? wallL(hz.t) : wallR(hz.t);
        if (elapsed < slump) {
          // The wall cracks and sheds grit before it goes.
          if (fx() < 0.5) burst(wall - hz.side * 4, yRest - 10 + fx() * 20, 1, "rgba(190,170,140,.9)", 40, 0.1);
          ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(wall, yRest - 24); ctx.lineTo(wall - hz.side * 8, yRest - 6); ctx.lineTo(wall - hz.side * 3, yRest + 8); ctx.lineTo(wall - hz.side * 10, yRest + 22); ctx.stroke();
          continue;
        }
        if (!view.landed.has(i)) {
          view.landed.add(i);
          burst(wall - hz.side * hz.r * sw, yRest, 16, "rgba(170,150,120,.9)", 110, 0.3);
          view.shake = Math.max(view.shake, 0.35);
          if (yRest < hgt) sound.cavein();
        }
        const grow = clamp((elapsed - slump) / 0.25, 0, 1);
        const width = (hz.r * 2 * sw + 14) * (0.4 + 0.6 * grow);
        ctx.save();
        ctx.translate(wall, yRest);
        if (hz.side > 0) ctx.scale(-1, 1);
        ctx.drawImage(rubbleSprite, -6, -30, width, 60);
        ctx.restore();
      }
    }
  };

  const drawFinds = (hgt: number, elapsed: number, now: number) => {
    if (!ctx || !sim) return;
    const pulse = 0.78 + Math.sin(now / 260) * 0.22;
    const { finds } = sim.plan;
    for (let i = sim.nextFind; i < finds.length; i++) {
      const f = finds[i]!;
      const y = yAtTime(f.t, elapsed);
      if (y > hgt + 30) break;
      if (y < -30) continue;
      const a = reachAlpha(y, hgt);
      if (f.kind === "nonce") {
        if (!nonceSprite) continue;
        ctx.globalAlpha = a * pulse;
        blit(nonceSprite, shaftX(f.x), y, PICKUP_BOX, PICKUP_BOX);
      } else {
        const spr = gemSprites.get(f.glyph);
        if (!spr) continue;
        ctx.globalAlpha = a;
        blit(spr, shaftX(f.x), y, GEM_BOX, GEM_BOX);
      }
    }
    // The overclock, until it has passed.
    const b = sim.plan.boost;
    if (b && !sim.boostResolved && boostSprite) {
      const y = yAtTime(b.t, elapsed);
      if (y > -PICKUP_BOX && y < hgt + PICKUP_BOX) {
        ctx.globalAlpha = reachAlpha(y, hgt) * pulse;
        blit(boostSprite, shaftX(b.x), y, PICKUP_BOX, PICKUP_BOX);
      }
    }
    ctx.globalAlpha = 1;
  };

  /** The grail: the vault opens and the block is simply there, waiting. */
  const drawBlock = (elapsed: number, now: number) => {
    if (!ctx || !sim) return;
    const secondsLeft = RUN_SECONDS - elapsed;
    const ahead = viewAheadAt(sim.plan, elapsed);
    if (secondsLeft > ahead) return;
    const y = yAtTime(RUN_SECONDS, elapsed);
    const size = Math.min(shaftW() * 0.5, 190);

    // Glow around it, so it reads as the thing you came for.
    const cx = shaftX(0.5);
    const g = ctx.createRadialGradient(cx, y, 0, cx, y, size * 1.5);
    g.addColorStop(0, "rgba(255,210,74,.34)");
    g.addColorStop(1, "rgba(255,210,74,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - size * 1.5, y - size * 1.5, size * 3, size * 3);

    ctx.save();
    ctx.translate(cx, y);
    if (!calm) ctx.rotate(Math.sin(now / 1400) * 0.05);
    ctx.fillStyle = "#ffd24a";
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.fillStyle = "rgba(0,0,0,.18)";
    for (let i = 1; i < 5; i++) ctx.fillRect(-size / 2, -size / 2 + (size / 5) * i, size, 2);
    ctx.fillStyle = "#0a0900";
    ctx.font = `700 ${Math.round(size * 0.15)}px ui-monospace,Consolas,monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("BLOCK", 0, -size * 0.07);
    // Its hash, on its face: leading zeros resolving as you close in — the
    // same idea as the boot intro. On the block, so it is always in view.
    const closeness = clamp(1 - secondsLeft / ahead, 0, 1);
    const zeros = Math.floor(closeness * 8);
    ctx.fillStyle = "rgba(42,29,0,.82)";
    ctx.font = `700 ${Math.round(size * 0.095)}px ui-monospace,Consolas,monospace`;
    ctx.fillText("0".repeat(zeros) + (zeros < 8 ? "…" : ""), 0, size * 0.17);
    ctx.restore();
  };

  const drawMite = (t: number, x: number) => {
    if (!ctx || !sim || !view) return;
    const mx = shaftX(x), my = miteY();
    const size = miteSize();

    // Overclocked: the reach you have right now, and how long it lasts.
    const left = overclockLeft(t);
    if (left > 0) {
      const reach = CATCH_RADIUS * OVERCLOCK_REACH * shaftW();
      ctx.strokeStyle = "rgba(92,225,255,.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mx, my, reach, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#5ce1ff";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(mx, my, size * 0.78, -Math.PI / 2, -Math.PI / 2 + (left / OVERCLOCK_SECONDS) * Math.PI * 2);
      ctx.stroke();
    }

    const spr = miteAt(size);
    ctx.save();
    ctx.translate(mx, my);
    if (!calm) ctx.rotate(view.tilt);
    if (spr) ctx.drawImage(spr, -size / 2, -size / 2, size, size);
    else {
      ctx.fillStyle = "#e6e6e6";
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  const drawSparks = () => {
    if (!ctx || !view || view.sparks.length === 0) return;
    for (const s of view.sparks) {
      ctx.globalAlpha = Math.max(0, 1 - s.age / s.life);
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    }
    ctx.globalAlpha = 1;
  };

  /**
   * Pops sit beside the mite on the side they were born (its roomier side),
   * follow it across the shaft, and stack upward — newest level with the mite.
   * Text reads outward from the mite, so it never lies across it.
   */
  const drawPops = (x: number) => {
    if (!ctx || !view || view.pops.length === 0) return;
    const mx = shaftX(x), my = miteY() + 1, gap = miteSize() * 0.55 + 5;
    ctx.font = "700 12px ui-monospace,Consolas,monospace";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    for (const p of view.pops) {
      const a = p.age < 0.08 ? p.age / 0.08 : p.age > 0.62 ? Math.max(0, (POP_LIFE - p.age) / (POP_LIFE - 0.62)) : 1;
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.textAlign = p.side > 0 ? "left" : "right";
      const px = mx + p.side * gap, py = my - p.lift;
      ctx.strokeText(p.text, px, py);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, px, py);
    }
    ctx.globalAlpha = 1;
  };

  /**
   * The banner: one line, small, in the band above the mite — over passage
   * already travelled, so it never hides what is coming — on a soft dark
   * strip so it reads over lantern light and rock alike.
   */
  const drawBanner = () => {
    if (!ctx || !view?.banner) return;
    const b = view.banner;
    const IN = 0.14, OUT = 0.3;
    const a = b.age < IN ? b.age / IN : b.age > b.dur - OUT ? Math.max(0, (b.dur - b.age) / OUT) : 1;
    if (a <= 0) return;
    const band = Math.max(36, miteY() - miteSize() / 2 - 6);
    const cy = Math.max(20, band * 0.42);
    const cx = shaftX(0.5), sw = shaftW();
    const tall = b.sub ? 38 : 26;
    ctx.globalAlpha = a;
    const strip = ctx.createLinearGradient(cx - sw / 2, 0, cx + sw / 2, 0);
    strip.addColorStop(0, "rgba(0,0,0,0)");
    strip.addColorStop(0.22, "rgba(0,0,0,.58)");
    strip.addColorStop(0.78, "rgba(0,0,0,.58)");
    strip.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = strip;
    const top = cy - (b.sub ? 19 : 13);
    ctx.fillRect(cx - sw / 2, top, sw, tall);

    ctx.save();
    ctx.translate(cx, b.sub ? cy - 5 : cy);
    if (!calm && b.age < IN) { const s = 1 + (IN - b.age) * 0.9; ctx.scale(s, s); }
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    // Title, and any suffix after it on the same line ("THE VEIN · FASTER").
    ctx.font = "900 20px Impact,'Arial Narrow',sans-serif";
    const tw = ctx.measureText(b.title).width;
    const suffix = b.suffix ? `  ·  ${b.suffix}` : "";
    ctx.font = "700 11px ui-monospace,Consolas,monospace";
    const xw = suffix ? ctx.measureText(suffix).width : 0;
    const x0 = -(tw + xw) / 2;
    ctx.textAlign = "left";
    ctx.font = "900 20px Impact,'Arial Narrow',sans-serif";
    ctx.lineWidth = 4;
    ctx.strokeText(b.title, x0, 0);
    ctx.fillStyle = b.color;
    ctx.fillText(b.title, x0, 0);
    if (suffix) {
      ctx.font = "700 11px ui-monospace,Consolas,monospace";
      ctx.lineWidth = 3;
      ctx.strokeText(suffix, x0 + tw, 1);
      ctx.fillStyle = "#f5c451";
      ctx.fillText(suffix, x0 + tw, 1);
    }
    if (b.sub) {
      ctx.textAlign = "center";
      ctx.font = "600 10px ui-monospace,Consolas,monospace";
      ctx.lineWidth = 3;
      ctx.strokeText(b.sub, 0, 16);
      ctx.fillStyle = "#d8d8d8";
      ctx.fillText(b.sub, 0, 16);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  /**
   * As the lamp fails, the dark closes in around you. When it goes out, the
   * flame gutters — a few stutters of light (none if motion is calmed) — and
   * the shaft goes black.
   */
  const drawDark = (w: number, hgt: number, x: number) => {
    if (!ctx || !sim || !view) return;
    const out = view.ending === "lose" ? view.endAge : -1;
    if (out < 0 && sim.lamp >= LAMP_DIM_FROM) return;
    const cx = shaftX(x), cy = miteY();
    let open: number;
    if (out >= 0) {
      const left = calm ? Math.max(0, 1 - out / 0.55) : GUTTER[Math.floor(out / 0.05)] ?? 0;
      open = 0.18 * left;
    } else {
      open = lerp(0.18, 1.1, clamp(sim.lamp / LAMP_DIM_FROM, 0, 1));
    }
    const r0 = hgt * open, r1 = Math.max(r0 + 40, r0 * 1.7);
    const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${out >= 0 ? 0.97 : 0.9})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hgt);
    if (out >= 0.5) {
      ctx.fillStyle = `rgba(0,0,0,${(0.97 * clamp((out - 0.5) / 0.3, 0, 1)).toFixed(3)})`;
      ctx.fillRect(0, 0, w, hgt);
    }
  };

  /** A big word in the middle of the shaft, on a dark strip: the ending's beat. */
  const drawBeat = (text: string, color: string, alpha: number, grow: number, hgt: number) => {
    if (!ctx || alpha <= 0) return;
    const cx = shaftX(0.5), cy = hgt * 0.5, sw = shaftW();
    ctx.globalAlpha = alpha;
    const strip = ctx.createLinearGradient(cx - sw / 2, 0, cx + sw / 2, 0);
    strip.addColorStop(0, "rgba(0,0,0,0)");
    strip.addColorStop(0.2, "rgba(0,0,0,.62)");
    strip.addColorStop(0.8, "rgba(0,0,0,.62)");
    strip.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = strip;
    ctx.fillRect(cx - sw / 2, cy - 30, sw, 60);
    ctx.save();
    ctx.translate(cx, cy);
    if (grow !== 1) ctx.scale(grow, grow);
    ctx.font = "900 38px Impact,'Arial Narrow',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,.9)";
    ctx.strokeText(text, 0, 1);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 1);
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  const draw = (now = performance.now()) => {
    if (!ctx) return;
    const w = viewW(), hgt = viewH();
    if (!sim || !view) { ctx.fillStyle = "#0d0d0c"; ctx.fillRect(0, 0, w, hgt); return; }
    const { t: elapsed, x } = drawn();
    pps = ppsAt(sim.plan, elapsed);
    const stratum = stratumAt(sim.plan, elapsed);

    // A knock moves the view about, briefly. Never for anyone who has asked
    // the desktop to keep still.
    const shaking = !calm && view.shake > 0;
    if (shaking) {
      const amp = 6 * view.shake;
      ctx.save();
      ctx.translate((fx() - 0.5) * 2 * amp, (fx() - 0.5) * 2 * amp);
    }

    drawRock(w, hgt, elapsed, stratum);
    drawGlints(hgt, elapsed, now);
    drawPassage(hgt, elapsed, stratum);
    drawBeams(hgt, elapsed);
    drawLanterns(hgt, elapsed, now);
    drawLamp(hgt, elapsed, x);
    drawGas(hgt, elapsed, now);
    drawBlock(elapsed, now);
    drawHazards(hgt, elapsed);
    drawFinds(hgt, elapsed, now);
    drawSparks();
    drawMite(elapsed, x);
    drawPops(x);
    if (shaking) ctx.restore();

    drawDark(w, hgt, x);

    // A wash when something hurts, green while you breathe gas.
    if (view.hurtFlash > 0) {
      ctx.fillStyle = `rgba(255,70,80,${(view.hurtFlash * 0.24).toFixed(3)})`;
      ctx.fillRect(0, 0, w, hgt);
    }
    if (view.gasFlash > 0) {
      ctx.fillStyle = `rgba(120,220,90,${(view.gasFlash * 0.14).toFixed(3)})`;
      ctx.fillRect(0, 0, w, hgt);
    }

    if (view.ending === "win") {
      // Latching on: the vault whites out, then settles warm, and says so.
      const e = view.endAge;
      const flash = e < 0.1 ? 1 : Math.max(0.2, 1 - (e - 0.1) / 0.6);
      ctx.fillStyle = `rgba(255,226,140,${(flash * 0.85).toFixed(3)})`;
      ctx.fillRect(0, 0, w, hgt);
      drawBeat("BLOCK FOUND", "#ffd24a", Math.min(1, e / 0.12), calm ? 1 : 1 + Math.max(0, 0.3 - e) * 0.5, hgt);
    } else if (view.ending === "lose") {
      drawBeat("LAMP OUT", "#ff8a5c", clamp((view.endAge - 0.55) / 0.25, 0, 1), 1, hgt);
    } else {
      drawBanner();
    }
  };

  // ── HUD ──────────────────────────────────────────────────────────────────
  // Written only when a value changes: rewriting the DOM every frame cost a
  // style recalc and layout per frame for numbers that move a few times a second.
  const shown = { score: -1, mult: -1, pct: -1, secs: -1, pips: -1, oc: -1, ocOn: false, window: false, lamp: -1, low: false };
  const updateHud = () => {
    if (!sim) return;
    const t = timeOf(sim);
    const score = Math.round(sim.score);
    if (score !== shown.score) { shown.score = score; scoreOut.textContent = String(score); }
    const m = multiplierFor(sim.streak);
    if (m !== shown.mult) {
      shown.mult = m;
      multOut.textContent = `×${m}`;
      multOut.classList.toggle("is-up", m > 1);
      multOut.classList.toggle("is-max", m >= MAX_MULT);
    }
    const lit = m >= MAX_MULT ? MULT_STEP_STREAK : sim.streak % MULT_STEP_STREAK;
    if (lit !== shown.pips) {
      shown.pips = lit;
      pips.forEach((p, i) => p.classList.toggle("on", i < lit));
      streakOut.classList.toggle("is-max", m >= MAX_MULT);
    }
    const pct = Math.min(1, t / RUN_SECONDS);
    const pctRounded = Math.round(pct * 400);
    if (pctRounded !== shown.pct) {
      shown.pct = pctRounded;
      depthFill.style.transform = `scaleX(${pct.toFixed(4)})`;
      depthBar.setAttribute("aria-valuenow", String(Math.round(pct * 100)));
    }
    const inWindow = t >= RUN_SECONDS - BLOCK_WINDOW_SECONDS;
    if (inWindow !== shown.window) { shown.window = inWindow; depthBar.classList.toggle("is-window", inWindow); }
    const secs = Math.max(0, Math.ceil(RUN_SECONDS - t));
    if (secs !== shown.secs) { shown.secs = secs; timeOut.textContent = `${secs}s`; }
    const lamp = Math.max(0, Math.ceil(sim.lamp));
    if (lamp !== shown.lamp) {
      shown.lamp = lamp;
      lampFill.style.transform = `scaleX(${(lamp / LAMP_MAX).toFixed(3)})`;
      lampPct.textContent = String(lamp);
      lampBar.setAttribute("aria-valuenow", String(lamp));
      const low = lamp < LAMP_LOW;
      if (low !== shown.low) { shown.low = low; lampBar.classList.toggle("is-low", low); }
    }
    const left = overclockLeft(t);
    const ocOn = left > 0;
    if (ocOn !== shown.ocOn) { shown.ocOn = ocOn; ocOut.hidden = !ocOn; }
    const oc = Math.round((left / OVERCLOCK_SECONDS) * 100);
    if (ocOn && oc !== shown.oc) {
      shown.oc = oc;
      ocFill.style.transform = `scaleX(${(left / OVERCLOCK_SECONDS).toFixed(3)})`;
    }
    const stratum = stratumAt(sim.plan, t);
    if (stratumOut.textContent !== stratum.name) {
      stratumOut.textContent = stratum.name;
      stratumOut.style.color = stratum.accent;
    }
  };

  // ── The loop: sample input, step the sim, react, draw ────────────────────
  const HIT_TEXT: Record<Exclude<HazardKind, "gas">, string> = { stale: "STALE", rock: "ROCK", cavein: "CAVE-IN" };

  /**
   * Turn what one tick did into sparks, words and sound. Words are kept for
   * what matters: a hash is a spark and a note (the HUD counts it); a nonce,
   * a knock, a scrape or light coming back gets a pop; a new layer, the
   * overclock, a low lamp or a multiplier step gets the banner. Things that
   * land on the same tick share: a nonce's light rides on its pop, and a new
   * layer and its speed-up are one banner.
   */
  const react = (events: SimEvent[]) => {
    if (!sim || !view) return;
    const plan = sim.plan;
    const my = miteY();
    /** This tick's last pop, and whether it came from the overclock, so light gained can join it. */
    let last: Pop | null = null;
    let fromBoost = false;
    let layer = -1, faster = false;
    for (const e of events) {
      switch (e.type) {
        case "find": {
          const f = plan.finds[e.index]!;
          const sx = shaftX(f.x);
          if (f.kind === "nonce") {
            burst(sx, my, 16, "#ffd24a", 130);
            sound.nonce();
            last = pop(`◆ +${Math.round(e.gain)}`, "#ffd24a");
          } else {
            burst(sx, my, 6, "#a6e86a", 80);
            sound.pickup(Math.min(10, sim.streak % MULT_STEP_STREAK + Math.round((multiplierFor(sim.streak) - 1) * 8)));
          }
          if (e.multUp) {
            const m = multiplierFor(sim.streak);
            announce({ key: "mult", title: m >= MAX_MULT ? `MAX ×${m}` : `×${m}`, color: m >= MAX_MULT ? "#ffd24a" : "#f5c451", dur: 0.75, prio: 1, ttl: 0 });
          }
          break;
        }
        case "hazard":
          view.hurtFlash = 1;
          view.shake = e.kind === "stale" ? 0.6 : 1;
          burst(shaftX(sim.x), my, e.kind === "stale" ? 12 : 18, e.kind === "stale" ? "#ff5c6c" : "rgba(190,170,140,.95)", 130);
          last = pop(`${HIT_TEXT[e.kind]} −${e.damage}`, "#ff6b6b");
          if (e.kind === "stale") sound.stale(); else if (e.kind === "rock") sound.rock(); else sound.cavein();
          break;
        case "gas":
          last = pop("GAS", "#ff6b6b");
          break;
        case "scrape":
          view.hurtFlash = Math.max(view.hurtFlash, 0.6);
          view.shake = Math.max(view.shake, 0.45);
          burst(shaftX(sim.x) + e.side * 6, my, 7, "#ff9f43", 90);
          last = pop(`SCRAPE −${e.damage}`, "#ff9f43");
          sound.scrape();
          break;
        case "boost":
          burst(shaftX(sim.x), my, 18, "#5ce1ff", 140);
          announce({ key: "overclock", title: "OVERCLOCK", sub: `longer reach for ${OVERCLOCK_SECONDS}s`, color: "#5ce1ff", dur: 1.1, prio: 2, ttl: 0.6 });
          sound.overclock();
          fromBoost = true;
          break;
        case "lamp": {
          const gain = `lamp +${Math.round(e.amount)}`;
          if (last) last.text += ` · ${gain}`;
          else last = pop(gain, fromBoost ? "#5ce1ff" : "#ffcf7a");
          break;
        }
        case "lampLow":
          announce({ key: "lampLow", title: "LAMP LOW", sub: "a nonce ◆ tops it up", color: "#ff8a5c", dur: 1.4, prio: 4, ttl: 1 });
          sound.lowLamp();
          break;
        case "stratum":
          layer = e.index;
          break;
        case "adjust":
          faster = true;
          sound.whoosh();
          break;
        case "miss":
        case "win":
        case "lose":
          break;
      }
    }
    if (layer >= 0) {
      const s = STRATA[layer]!;
      announce({ key: "layer", title: s.name.toUpperCase(), ...(faster ? { suffix: "faster" } : {}), sub: STRATUM_HINT[layer] ?? "", color: GLINT_COLOR[s.name] ?? s.accent, dur: 1.6, prio: 3, ttl: 2 });
    } else if (faster) {
      announce({ key: "layer", title: "DIFFICULTY ADJUSTMENT", suffix: "faster", color: "#f5c451", dur: 1.2, prio: 3, ttl: 1 });
    }
  };

  /** This tick's steering: keys outrank the mouse, which outranks a bot. */
  const sampleSteer = (): number => {
    if (!sim) return 0;
    const dir = heldDir();
    if (dir !== 0) return dir;
    if (pointerX != null) return steerToward(sim, pointerX);
    if (bot) return bot(sim);
    if (autoTarget != null) return steerToward(sim, autoTarget);
    return 0;
  };

  const tickOnce = () => {
    if (!sim || !view) return;
    prevX = sim.x;
    prevTick = sim.tick;
    // Step with exactly what the recorder logged: that is what the server replays.
    const s = recorder.push(sampleSteer());
    const events = step(sim, s);
    if (keyAt != null) { inputLatency.push(performance.now() - keyAt); if (inputLatency.length > 40) inputLatency.shift(); keyAt = null; }
    react(events);
    if (sim.inGas) {
      view.gasFlash = 1;
      view.gasTick -= 1 / TICK_HZ;
      if (view.gasTick <= 0) { view.gasTick = 0.22; sound.gas(); }
    }
  };

  /** Sparks fly and fall, and the knocks and washes fade, by real time. */
  const settle = (secs: number) => {
    if (!view) return;
    let keep = 0;
    for (const s of view.sparks) {
      s.age += secs;
      if (s.age >= s.life) continue;
      s.x += s.vx * secs;
      s.y += s.vy * secs;
      s.vy += 260 * secs;
      view.sparks[keep++] = s;
    }
    view.sparks.length = keep;
    if (view.hurtFlash > 0) view.hurtFlash = Math.max(0, view.hurtFlash - secs / 0.34);
    if (view.gasFlash > 0) view.gasFlash = Math.max(0, view.gasFlash - secs / 0.3);
    if (view.shake > 0) view.shake = Math.max(0, view.shake - secs / 0.26);
  };

  /** Fade and move everything cosmetic by real time, so it looks the same at any frame rate. */
  const animate = (secs: number) => {
    if (!view || !sim) return;
    view.clock += secs;
    settle(secs);
    // Pops age out; the rest ease up to their line in the stack, drifting up a touch as they go.
    for (const p of view.pops) {
      p.age += secs;
      const target = p.slot * POP_LINE + p.age * 9;
      p.lift += (target - p.lift) * (1 - Math.exp(-16 * secs));
    }
    if (view.pops.some((p) => p.age >= POP_LIFE)) view.pops = view.pops.filter((p) => p.age < POP_LIFE);
    // The banner, then the next one waiting that is still news.
    if (view.banner) { view.banner.age += secs; if (view.banner.age >= view.banner.dur) view.banner = null; }
    while (!view.banner && view.queue.length) {
      const next = view.queue.shift()!;
      if (view.clock - next.at <= next.ttl) view.banner = { ...next, age: 0 };
    }
    // The fork, said once, as it comes into sight at the bottom of the view.
    const t = timeOf(sim), fork = sim.plan.fork;
    if (fork && !view.forkCalled && t >= fork.t0 - viewAheadAt(sim.plan, t) * 0.85) {
      view.forkCalled = true;
      announce({ key: "fork", title: "THE SHAFT FORKS", sub: "one side rich, one side safe", color: "#f5c451", dur: 1.6, prio: 3, ttl: 1.2 });
    }
    view.tilt += (clamp(sim.vx * 0.32, -0.42, 0.42) - view.tilt) * (1 - Math.exp(-14 * secs));
    view.scroll += secs * pps;
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!sim || !view) return;
    const gap = now - lastMs;
    lastMs = now;
    // The ending keeps animating after the run is over, so breaking into the
    // block (or the lamp guttering out) gets its own beat before anything
    // covers it; then the last frame simply stays.
    if (phase === "done") {
      if (view.ending && view.endAge < END_SECONDS) {
        const secs = Math.min(gap, 100) / 1000;
        view.endAge = Math.min(END_SECONDS, view.endAge + secs);
        settle(secs);
        draw(now);
      }
      return;
    }
    if (phase !== "playing") return;
    // A window that is minimised or scrolled away is not being played.
    if (!visible || document.hidden) { pause(); return; }
    frameGaps.push(gap);
    if (frameGaps.length > 240) frameGaps.shift();
    const t0 = performance.now();

    acc += Math.min(gap, MAX_CATCHUP_MS);
    while (acc >= TICK_MS && !sim.done) {
      tickOnce();
      acc -= TICK_MS;
    }
    animate(Math.min(gap, 100) / 1000);
    updateHud();
    if (sim.done) { finish(sim.won ? "win" : "lose"); return; }
    draw(now);
    drawTimes.push(performance.now() - t0);
    if (drawTimes.length > 240) drawTimes.shift();
  };

  // ── Phases ───────────────────────────────────────────────────────────────
  const kbd = (s: string) => h("kbd", { class: "ph-game-kbd" }, s);
  const legend = (sw: HTMLElement, name: string, text: string) =>
    h("li", {}, sw, h("span", {}, h("b", {}, name), " ", text));
  const swatch = (cls: string, glyph = "") => h("i", { class: `ph-game-sw ${cls}`, "aria-hidden": "true" }, glyph);
  const whites = (n: number) => `${n} White${n === 1 ? "" : "s"}`;

  const showReady = () => {
    phase = "ready";
    const go = h("button", { class: "ph-game-btn", type: "button" }, "Descend");
    go.addEventListener("click", () => void begin(go));
    // The button sits right under what a run pays, so it is on screen in the
    // default window; what is down the shaft follows for whoever reads on.
    overlay.replaceChildren(
      h("div", { class: "ph-game-card" },
        h("div", { class: "ph-game-kicker" }, `${RUN_SECONDS} seconds down the shaft`),
        h("h2", {}, "Block Hunt"),
        h("p", { class: "ph-game-lede" }, "You are the parasite. Dig down to the block with your lamp still lit and you win; let it go out on the way and you lose. Every shaft is different, and it gets faster at every new layer."),
        h("div", { class: "ph-game-payout" },
          h("span", { class: "is-win" }, "Win ", h("b", {}, whites(WHITES_PER_WIN))),
          h("span", { class: "is-lose" }, "Lose ", h("b", {}, whites(WHITES_PER_LOSS)))),
        go,
        h("p", { class: "ph-game-keys" }, kbd("←"), kbd("→"), " or ", kbd("A"), kbd("D"), " · mouse · ", kbd("P"), " pause · ", kbd("M"), " sound"),
        h("ul", { class: "ph-game-legend" },
          legend(swatch("is-hash", "a"), "Hashes", `+1 each. ${MULT_STEP_STREAK} in a row and the multiplier climbs, up to ×${MAX_MULT}.`),
          legend(swatch("is-nonce", "◆"), "Nonces", `+${NONCE_VALUE} and +${LAMP_FROM_NONCE} lamp. ${MAX_NONCES} a run, hidden near a wall.`),
          legend(swatch("is-boost"), "Overclock", `One a run, deep down. ${OVERCLOCK_SECONDS}s of longer reach and +${LAMP_FROM_OVERCLOCK} lamp.`),
          legend(swatch("is-stale", "✕"), "Stale shares", `From the mempool down. −${DAMAGE.stale} lamp and your streak.`),
          legend(swatch("is-rock"), "Falling rock & cave-ins", `Deep rock and below. −${DAMAGE.rock} to −${DAMAGE.cavein} lamp. Watch the wall crack.`),
          legend(swatch("is-gas"), "Gas", "Drains your lamp while you are in it. Go round."),
          legend(swatch("is-wall"), "Walls", `Scraping costs −${DAMAGE.scrape} lamp and your streak.`)),
        h("p", { class: "ph-game-free" },
          h("span", { class: "ph-game-badge" }, "PRACTICE"),
          ` Free. Signed in with a wallet, your run is dealt and scored by the server and goes on the board; as a guest it is just practice. Practice Whites go to your ledger in this browser — nothing is minted. When runs go live they cost ${fmtDollars(PLAY_PRICE_USD)}.`)),
    );
    overlay.classList.add("is-on");
  };

  const pause = () => {
    if (phase !== "playing") return;
    phase = "paused";
    dirs.length = 0;
    pointerX = null;
    sound.suspend();
    announcePlaying(false);
    const resume = h("button", { class: "ph-game-btn", type: "button", onclick: () => unpause() }, "Keep digging");
    overlay.replaceChildren(
      h("div", { class: "ph-game-card ph-game-card--small" },
        h("h2", {}, "Paused"),
        h("p", {}, `${Math.max(0, Math.ceil(RUN_SECONDS - (sim ? timeOf(sim) : 0)))} seconds to the block. `, kbd("P"), " or the button carries on."),
        resume),
    );
    overlay.classList.add("is-on");
    resume.focus();
  };

  const unpause = () => {
    if (phase !== "paused") return;
    phase = "playing";
    lastMs = performance.now();
    acc = 0;
    sound.resume();
    announcePlaying(true);
    overlay.classList.remove("is-on");
    overlay.replaceChildren();
    canvas.focus();
  };

  /**
   * The pack opening: the pieces this run won, over the game, before anything
   * else is shown. `onDone` runs when it is closed (or at once, with nothing
   * to show) and brings up whatever comes next.
   */
  const reveal = (awarded: PracticeClaim[], how: { runs: number; kicker: string; closeLabel: string }, onDone: () => void) => {
    if (!awarded.length) { onDone(); return; }
    overlay.classList.remove("is-on");
    overlay.replaceChildren();
    closeReveal = showReveal(stage, {
      claims: awarded,
      runs: how.runs,
      kicker: how.kicker,
      closeLabel: how.closeLabel,
      onClose: () => { closeReveal = null; if (!disposed) onDone(); },
    });
  };

  const finish = (outcome: RunOutcome) => {
    if (!sim || !view || phase === "done") return;
    phase = "done";
    announcePlaying(false);
    const local = resultOf(sim);
    const ranked = ticket;
    // Send the ticket and every tick's steering. The server replays them and
    // its numbers are the ones that count. Practice runs are not sent.
    const verdictP: Promise<RunVerdict | null> = ranked
      ? within(submitRun({ ticket: ranked.ticket, inputs: recorder.log() }), 8000)
      : Promise.resolve(null);
    // The beat has the screen to itself: no banner, no pops over it.
    view.ending = outcome;
    view.endAge = 0;
    view.banner = null;
    view.queue = [];
    view.pops = [];
    if (outcome === "win") { burst(shaftX(0.5), miteY(), 36, "#ffd24a", 220, 0.4); sound.win(); }
    else sound.lose();
    lastMs = performance.now();
    updateHud();
    draw();

    const ledger = opts.ledger;
    const before = ledger?.state();
    const lostAt = sim.lostAtTick != null ? sim.lostAtTick / TICK_HZ : 0;
    const knocks = local.hits.rock + local.hits.cavein;
    const hashes = Math.round(sim.score);
    const finds = sim.plan.finds.length;

    const row = (label: string, value: string, cls = "") =>
      h("div", { class: `ph-game-row${cls}` }, h("span", {}, label), h("b", {}, value));

    const render = (f: Final, status: string): HTMLButtonElement => {
      const won = f.won;
      const newBest = before != null && before.runs > 0 && f.score > before.bestRun;
      const again = h("button", { class: "ph-game-btn", type: "button" }, "Descend again");
      again.addEventListener("click", () => void begin(again));
      overlay.replaceChildren(
        h("div", { class: `ph-game-card ph-game-card--${won ? "win" : "lose"}` },
          h("div", { class: `ph-game-kicker${newBest ? " is-best" : ""}` },
            won ? (newBest ? "Block found · new personal best" : "Block found") : `Lamp out at ${lostAt.toFixed(1)}s`),
          h("h2", {}, won ? "You win" : "Lost in the dark"),
          h("p", { class: "ph-game-result" },
            won ? h("span", {}, "You won ", h("b", {}, whites(f.whites)), ".")
                : h("span", {}, `${Math.max(0, RUN_SECONDS - lostAt).toFixed(1)}s short of the block. `, h("b", {}, whites(f.whites)), " for the dig.")),
          h("p", { class: `ph-game-verify${f.verified ? " is-ok" : ""}` }, status),
          h("div", { class: "ph-game-tally" },
            row(`Hashes (${local.found} of ${finds} finds)`, String(hashes)),
            row("Nonces ◆", `${f.nonces} of ${MAX_NONCES}`, f.nonces > 0 ? " is-gold" : " is-dim"),
            row("Best streak", String(local.bestStreak), local.bestStreak >= MULT_STEP_STREAK ? "" : " is-dim"),
            won ? row("Lamp left", String(local.lamp), local.lamp >= LAMP_LOW ? " is-good" : " is-bad") : row("Lamp", "out", " is-bad"),
            row("Rock & cave-ins", knocks === 0 ? "clean" : String(knocks), knocks === 0 ? " is-good" : " is-bad"),
            row("Gas pockets", local.hits.gas === 0 ? "clean" : String(local.hits.gas), local.hits.gas === 0 ? " is-good" : " is-bad"),
            row("Stale shares ✕", f.stale === 0 ? "clean" : String(f.stale), f.stale === 0 ? " is-good" : " is-bad"),
            row("Wall scrapes", f.scrapes === 0 ? "clean" : String(f.scrapes), f.scrapes === 0 ? " is-good" : " is-dim"),
            row("Overclock", local.overclocked ? "caught" : "missed", local.overclocked ? " is-cyan" : " is-dim"),
            won ? row("Block bonus", `+${BLOCK_BONUS}`) : row("Block bonus", "—", " is-dim"),
            h("div", { class: "ph-game-row is-total" }, h("span", {}, "Ore banked"), h("b", {}, String(f.score)))),
          again,
          h("p", { class: "ph-game-free" },
            h("span", { class: "ph-game-badge" }, "PRACTICE"),
            ledger
              ? ` Your ${whites(f.whites)} went to your practice ledger in this browser. Nothing was minted and nothing was charged — the game is not live yet.`
              : " Nothing was minted and nothing was charged — the game is not live yet.")),
      );
      overlay.classList.add("is-on");
      return again;
    };

    // Payoff first: the ending's beat, then the pieces the run won (the
    // reveal), then the run's numbers once the reveal is closed. A ranked run
    // waits for the server's word before the pieces (it is quick), because
    // its verdict decides them.
    const ended = new Promise<void>((resolve) => { cardTimer = window.setTimeout(resolve, outcome === "win" ? WIN_BEAT_MS : LOSE_BEAT_MS); });
    let settled = false;
    void ended.then(() => {
      if (!ranked || settled || disposed || phase !== "done") return;
      // Still waiting: say so rather than show pieces that might change.
      overlay.replaceChildren(h("div", { class: "ph-game-card ph-game-card--small" }, h("h2", {}, "Checking"), h("p", {}, "The server is replaying your run…")));
      overlay.classList.add("is-on");
    });
    void Promise.all([ended, verdictP]).then(([, verdict]) => {
      settled = true;
      if (!sim || phase !== "done") return;
      let f: Final = {
        score: local.score, won: local.won, nonces: local.nonces, stale: local.stale, scrapes: local.scrapes,
        whites: local.won ? WHITES_PER_WIN : WHITES_PER_LOSS, verified: false,
      };
      let status: string;
      if (!ranked) {
        status = forcedSeed != null ? "Fixed seed — a practice run, not ranked." : "Practice run — sign in with a wallet to play ranked.";
      } else if (verdict) {
        const r = verdict.run;
        f = { score: r.score, won: r.won, nonces: r.nonces, stale: r.stale, scrapes: r.scrapes, whites: r.whitesAwarded, verified: true };
        status = r.score === local.score && r.won === local.won
          ? "✓ Verified — the server replayed your run, and it is on the board."
          : "✓ Verified — the server's replay of your run is the result that counts.";
      } else {
        status = "The server could not be reached — this run was not ranked.";
      }
      // The run happened, so it pays even if the window has since closed.
      ledger?.addRun(f.score);
      const awarded = ledger ? ledger.award(f.whites) : [];
      const runs = ledger?.state().runs ?? 1;
      opts.onRunEnd?.(f.score, f.won ? "win" : "lose");
      if (disposed) return;
      reveal(awarded, {
        runs,
        kicker: f.won ? `Block found — ${whites(f.whites)}` : `Lamp out — ${whites(f.whites)} for the dig`,
        closeLabel: "See your run",
      }, () => render(f, status).focus());
    });
  };

  /** Build a fresh run on a seed, ready to start. */
  function prepare(nextSeed: number) {
    seed = nextSeed >>> 0;
    sim = createSim(seed);
    recorder = createSteerRecorder();
    fx = createRng(seed ^ 0x51ed27);
    bot = null;
    autoTarget = null;
    prevX = sim.x;
    prevTick = 0;
    acc = 0;
    if (cardTimer != null) { clearTimeout(cardTimer); cardTimer = null; }
    view = {
      pops: [], sparks: [], hurtFlash: 0, gasFlash: 0, shake: 0, tilt: 0, scroll: 0, clock: 0,
      landed: new Set(), gasTick: 0, banner: null, queue: [], forkCalled: false, ending: null, endAge: 0,
    };
    sizeCanvas();
    Object.assign(shown, { score: -1, mult: -1, pct: -1, secs: -1, pips: -1, oc: -1, ocOn: true, window: true, lamp: -1, low: true });
    updateHud();
    draw();
  }

  function start() {
    if (!sim) return;
    phase = "playing";
    dirs.length = 0;
    pointerX = null;
    // Whatever the mouse was resting on when the button was clicked is not a steer.
    mouseAnchor = lastMouse;
    lastMs = performance.now();
    acc = 0;
    // What kind of shaft this is, and how long you have.
    announce({ key: "layer", title: ARCHETYPE_NAME[sim.plan.archetype].toUpperCase(), sub: `${RUN_SECONDS} seconds to the block`, color: GLINT_COLOR[STRATA[0].name] ?? "#e6e6e6", dur: 1.8, prio: 3, ttl: 1 });
    setTitle(ticket ? "Block Hunt — ranked run" : "Block Hunt — practice run");
    sound.unlock();
    sound.resume();
    announcePlaying(true);
    overlay.classList.remove("is-on");
    overlay.replaceChildren();
    canvas.focus();
  }

  /**
   * Descend: ask the server for a ranked run (a fresh seed and its ticket), or
   * play unranked on a fresh local seed if it says no. A forced seed is always
   * practice and never asks.
   */
  const begin = async (button?: HTMLButtonElement) => {
    if (starting || phase === "playing") return;
    starting = true;
    sound.unlock();
    if (button) { button.disabled = true; button.textContent = "Opening a shaft…"; }
    const t = forcedSeed == null ? await within(startRun(), 4000) : null;
    starting = false;
    ticket = t;
    prepare(t ? t.seed : forcedSeed ?? freshSeed());
    start();
  };

  // ── Input ────────────────────────────────────────────────────────────────
  const DIR: Record<string, -1 | 1> = { arrowleft: -1, arrowright: 1, a: -1, d: 1 };
  const onKeyDown = (ev: KeyboardEvent) => {
    const key = ev.key.toLowerCase();
    if (key === "m" && !ev.repeat) { ev.preventDefault(); toggleMute(); return; }
    if (key === "p" && (phase === "playing" || phase === "paused")) {
      ev.preventDefault();
      if (phase === "playing") pause(); else unpause();
      return;
    }
    if (phase === "ready" && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      void begin(overlay.querySelector<HTMLButtonElement>(".ph-game-btn") ?? undefined);
      return;
    }
    const dir = DIR[key];
    if (dir == null || phase !== "playing") return;
    ev.preventDefault();
    if (ev.repeat) return;
    press(key, dir);
    keyAt = performance.now();
    pointerX = null;
    mouseAnchor = lastMouse;
  };
  const onKeyUp = (ev: KeyboardEvent) => { release(ev.key.toLowerCase()); };
  const dropKeys = () => { dirs.length = 0; };
  const onBlur = () => { dropKeys(); pointerX = null; dragging = false; };
  // Focus moving to another window on the desktop takes the keys with it.
  const onFocusOut = (ev: FocusEvent) => { if (!host.contains(ev.relatedTarget as Node | null)) dropKeys(); };

  // Mouse: just move it — the mite follows. Touch and pen: drag on the shaft.
  const trackPointer = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    if (r.width <= 0) return;
    // The shaft may be narrower than the canvas, so map through it, not the box.
    const cssScale = r.width / viewW();
    const left = r.left + shaftLeft() * cssScale;
    pointerX = clamp((ev.clientX - left) / (shaftW() * cssScale), 0, 1);
  };
  const onPointerDown = (ev: PointerEvent) => {
    if (phase !== "playing") return;
    ev.preventDefault();
    dragging = true;
    mouseAnchor = null;
    canvas.setPointerCapture(ev.pointerId);
    trackPointer(ev);
  };
  const onPointerMove = (ev: PointerEvent) => {
    if (ev.pointerType === "mouse") lastMouse = { x: ev.clientX, y: ev.clientY };
    if (phase !== "playing") return;
    if (dragging) { trackPointer(ev); return; }
    if (ev.pointerType !== "mouse") return;
    if (mouseAnchor && Math.hypot(ev.clientX - mouseAnchor.x, ev.clientY - mouseAnchor.y) < MOUSE_WAKE_PX) return;
    mouseAnchor = null;
    trackPointer(ev);
  };
  const onPointerUp = (ev: PointerEvent) => {
    dragging = false;
    // A lifted finger stops steering; a mouse keeps following where it is.
    if (ev.pointerType !== "mouse") pointerX = null;
    try { canvas.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
  };
  const onPointerLeave = (ev: PointerEvent) => { if (!dragging && ev.pointerType === "mouse") pointerX = null; };

  host.addEventListener("keydown", onKeyDown);
  host.addEventListener("keyup", onKeyUp);
  host.addEventListener("focusout", onFocusOut);
  window.addEventListener("blur", onBlur);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);

  const ro = new ResizeObserver(() => { sizeCanvas(); draw(); });
  ro.observe(stage);
  // Minimised or covered windows pause the run rather than playing it blind.
  const io = new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); });
  io.observe(canvas);

  /**
   * Handle for the headless checks. Everything that steers goes through the
   * same per-tick input a mouse uses, so a checked run is an ordinary run with
   * an ordinary input log — the shape a server needs to replay it.
   */
  (host as unknown as { blockHunt?: unknown }).blockHunt = {
    phase: () => phase,
    ranked: () => ticket != null,
    state: () => (sim ? {
      seed: sim.plan.seed, archetype: sim.plan.archetype, tick: sim.tick, elapsed: +timeOf(sim).toFixed(2), x: +sim.x.toFixed(4),
      score: Math.round(sim.score), found: sim.found, nonces: sim.nonces, scrapes: sim.scrapes, hits: { ...sim.hits },
      streak: sim.streak, bestStreak: sim.bestStreak, lamp: Math.ceil(sim.lamp), done: sim.done, won: sim.won,
      lostAt: sim.lostAtTick != null ? sim.lostAtTick / TICK_HZ : null, overclocked: sim.overclocked,
      finds: sim.plan.finds.length, hazards: sim.plan.hazards.length, viewAhead: +viewAheadAt(sim.plan, timeOf(sim)).toFixed(2),
    } : null),
    /** Steer toward a position across the shaft, 0..1, through the inputs. */
    goTo: (x: number) => { autoTarget = clamp(x, 0, 1); },
    /** Let a bot play this run ("first", "typical" or "expert"), or stop one (null). */
    autoplay: (kind: BotKind | null) => { bot = kind && sim ? createBot(kind, sim.plan.seed) : null; },
    /** Where the next unresolved find is. */
    nextFind: () => {
      if (!sim) return null;
      const f = sim.plan.finds[sim.nextFind];
      return f ? { t: f.t, x: f.x, kind: f.kind } : null;
    },
    /** Hazards still ahead (and gas still hanging) within `seconds`. */
    hazardsAhead: (seconds = 1): Hazard[] => {
      if (!sim) return [];
      const e = timeOf(sim);
      return sim.plan.hazards.filter((hz) => (hz.kind === "gas" ? hz.t + hz.span >= e : hz.t >= e) && hz.t <= e + seconds).map((hz) => ({ ...hz }));
    },
    /** The overclock pickup, if it is still ahead. */
    boost: () => (sim && sim.plan.boost && !sim.boostResolved ? { ...sim.plan.boost } : null),
    /** The steer log so far: what a ranked run sends. */
    inputs: () => recorder.log(),
    /** The run's result as the sim scores it. */
    result: () => (sim ? resultOf(sim) : null),
    /** Frame timing: what the game costs per frame, how often frames arrive, and key-to-movement latency. */
    perf: () => {
      if (!drawTimes.length) return null;
      const s = [...drawTimes].sort((a, b) => a - b);
      const g = [...frameGaps].sort((a, b) => a - b);
      const avgGap = frameGaps.reduce((a, b) => a + b, 0) / Math.max(1, frameGaps.length);
      return {
        frames: s.length,
        avgMs: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3),
        p95Ms: +s[Math.floor(s.length * 0.95)]!.toFixed(3),
        maxMs: +s[s.length - 1]!.toFixed(3),
        fps: +(1000 / avgGap).toFixed(1),
        gapP95Ms: +(g[Math.floor(g.length * 0.95)] ?? 0).toFixed(1),
        inputLatencyMs: inputLatency.length ? +(inputLatency.reduce((a, b) => a + b, 0) / inputLatency.length).toFixed(1) : null,
      };
    },
  };

  prepare(seed);
  showReady();
  raf = requestAnimationFrame(frame);

  // ?win=1 — jump straight to the reward moment without playing. A preview
  // only: it awards nothing and saves nothing, and the reveal says so on its
  // face. Same support-link convention as ?perf=1 / ?boot=1 / ?gameseed=.
  try {
    if (new URLSearchParams(location.search).get("win") === "1") {
      const at = Date.now();
      const serial = (i: number) => "#" + (((at + i) >>> 0) * 2654435761 >>> 0).toString(16).padStart(8, "0").slice(0, 8);
      const preview: PracticeClaim[] = [0, 1].map((i) => ({ id: serial(i), at, ore: 0, tier: "white" }));
      reveal(preview, { runs: opts.ledger?.state().runs || 8, kicker: "Preview — what a win pays", closeLabel: "Done" }, showReady);
    }
  } catch { /* no URL access — skip the preview */ }

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    closeReveal?.();
    if (cardTimer != null) clearTimeout(cardTimer);
    if (phase === "playing") announcePlaying(false);
    sound.dispose();
    ro.disconnect();
    io.disconnect();
    host.removeEventListener("keydown", onKeyDown);
    host.removeEventListener("keyup", onKeyUp);
    host.removeEventListener("focusout", onFocusOut);
    window.removeEventListener("blur", onBlur);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    host.classList.remove("ph-game");
    host.replaceChildren();
  };
}
