/**
 * Block Hunt — the parasite burrows down a winding passage and finds a block.
 *
 * Presentation, input and the loop. Every number and all the geometry come from
 * ./blockrun.ts, which is pure and tested; nothing here invents a value, and
 * scores go through blockrun's bankableScore() so no path can exceed the faucet
 * ceiling in src/econ/tokenomics.ts.
 *
 * The feel this is built for is descending through somewhere real and arriving
 * at something worth the trip, so the drawing order matters:
 *   1. rock across the whole view, banded so strata scroll past
 *   2. the passage carved out of it as a dark void
 *   3. a headlamp glow, finds, the mite
 *   4. the vault and the block
 * Painting the passage *over* full-width rock is what gets banded walls without
 * a per-frame clip, which matters — the owner browses with hardware
 * acceleration off.
 */
import {
  BLOCK_BONUS,
  BLOCK_WINDOW_SECONDS,
  MAX_NONCES,
  NONCE_VALUE,
  RUN_SECONDS,
  STRATA,
  type Find,
  type RunPlan,
  type Stratum,
  bankableScore,
  buildRun,
  createRng,
  findValue,
  isChamber,
  multiplierFor,
  stratumAt,
} from "./blockrun";
import { ORE_PER_BLACK, PLAY_PRICE_SATS, fmtSats } from "../../../econ/tokenomics";
import type { PracticeLedger } from "../../session/ledger";
import { showReveal } from "../reveal";
import { h } from "../../util/dom";

/** How far ahead of the mite the passage is visible, in seconds of travel. */
const LOOKAHEAD_SECONDS = 3.2;
/**
 * The mite rides this far down the view. It sits high because you are going
 * *down*: everything still ahead of you is deeper, so it lives below the mite
 * and rises to meet you. Putting the lookahead above instead reads as climbing.
 */
const MITE_Y_FRACTION = 0.28;
/** Shaft-widths per second of steering. Crossing the full shaft takes ~1s. */
const STEER_SPEED = 1.0;
/** A find is collected within this fraction of the shaft. */
const CATCH_RADIUS = 0.062;
/** Seconds before scraping the same wall can cost a streak again. */
const SCRAPE_GRACE = 0.7;
/** Vertical spacing of wall strata bands, in seconds of travel. */
const BAND_SECONDS = 0.5;
/** Screen rows used to trace each passage wall. Lower = cheaper, blockier. */
const WALL_STEP_PX = 7;
/**
 * Widest the shaft is ever drawn, in CSS pixels. The model works in fractions
 * of the shaft, so without this a maximised window renders the same passage as
 * an enormous cavern — the same difficulty, but it stops reading as a shaft and
 * the catch radius looks absurd. Rock simply fills whatever is left over.
 */
const SHAFT_MAX_PX = 560;
/**
 * Widest the canvas itself is ever made, in CSS pixels: the shaft plus enough
 * rock either side to frame it. Everything past that is vignetted to near-black
 * anyway, so on a wide window it was costing several full-width fills a frame
 * to paint pixels nobody can see. Capping the bitmap instead of clipping inside
 * it keeps the cost flat no matter how big the window gets — which is what
 * makes this hold framerate with hardware acceleration off.
 */
const CANVAS_MAX_PX = SHAFT_MAX_PX + 360;

type Phase = "ready" | "playing" | "done";

interface Live {
  plan: RunPlan;
  elapsed: number;
  /** Where the player is steering, 0..1 across the shaft. */
  targetX: number;
  /** Eased actual position, clamped to the passage. */
  x: number;
  score: number;
  streak: number;
  found: number;
  nonces: number;
  scrapes: number;
  /** Indices already resolved, so a find can only pay once. */
  taken: Set<number>;
  pops: Array<{ x: number; y: number; text: string; age: number; kind: "hash" | "nonce" | "bad" }>;
  scrapeFlash: number;
  scrapeCooldown: number;
  /** The white-out as the mite latches onto the block. 1 -> 0. */
  landFlash: number;
  /** The stratum last announced, so each title card shows once. */
  announced: string;
  cardAge: number;
  cardName: string;
}

export interface BlockHuntOptions {
  /** Called when a run ends with the ore banked. Wiring for the paid flow later. */
  onRunEnd?: (ore: number) => void;
  /**
   * Where runs accumulate. Given one, ore carries between runs and a claim
   * becomes reachable; without one each run stands alone.
   */
  ledger?: PracticeLedger;
  /** Force the run's seed. `?gameseed=` fills this in for support and QA. */
  seed?: number;
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

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function mountBlockHunt(host: HTMLElement, opts: BlockHuntOptions = {}): () => void {
  host.classList.add("ph-game");

  // ── DOM ──────────────────────────────────────────────────────────────────
  const canvas = h("canvas", { class: "ph-game-canvas", tabindex: "0", "aria-label": "Block hunt. Left and right arrows to steer down the passage." });
  const ctx = canvas.getContext("2d");

  const depthFill = h("i", { class: "ph-game-air-fill" });
  const depthBar = h("div", { class: "ph-game-air", role: "progressbar", "aria-label": "Depth", "aria-valuemin": "0", "aria-valuemax": "100" }, depthFill);
  const stratumOut = h("span", { class: "ph-game-stratum" }, STRATA[0].name);
  const scoreOut = h("span", { class: "ph-game-ore-v" }, "0");
  const multOut = h("span", { class: "ph-game-mult" }, "");
  const hud = h("div", { class: "ph-game-hud" },
    h("div", { class: "ph-game-hud-item" }, h("span", { class: "ph-game-hud-l" }, "Depth"), depthBar, stratumOut),
    h("div", { class: "ph-game-hud-item ph-game-hud-ore" }, h("span", { class: "ph-game-hud-l" }, "Hashes"), scoreOut, multOut));

  const overlay = h("div", { class: "ph-game-overlay" });
  const stage = h("div", { class: "ph-game-stage" }, canvas, overlay);

  const padBtn = (glyph: string, delta: -1 | 1, cls: string) => {
    const b = h("button", { class: `ph-game-pad-b ${cls}`, type: "button", "aria-label": delta < 0 ? "Steer left" : "Steer right" }, glyph);
    const down = (ev: Event) => { ev.preventDefault(); held = delta; };
    const up = (ev: Event) => { ev.preventDefault(); if (held === delta) held = 0; };
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
  let live: Live | null = null;
  let held: -1 | 0 | 1 = 0;
  let pointerX: number | null = null;
  let raf = 0;
  let lastMs = 0;
  let dpr = 1;
  let tallyTimer: number | null = null;
  let closeReveal: (() => void) | null = null;
  let seed = opts.seed ?? seedFromUrl() ?? ((Date.now() ^ (performance.now() * 1000)) >>> 0);

  /**
   * Speckled rock, rendered once to a tile and repeated. A pattern fill is one
   * draw call per frame however big the view gets, which is what keeps the
   * walls textured on a machine with hardware acceleration off.
   */
  let rockPattern: CanvasPattern | null = null;
  // A big tile with fine, low-contrast grain. Small tiles or heavy blobs make
  // the repeat obvious across a wide window.
  const ROCK_TILE = 224;
  const buildRockTexture = () => {
    if (!ctx) return;
    const tile = document.createElement("canvas");
    tile.width = ROCK_TILE;
    tile.height = ROCK_TILE;
    const g = tile.getContext("2d");
    if (!g) return;
    const rng = createRng(0x9e3779b9);
    // Grit catching the light: many specks, each barely there.
    for (let i = 0; i < 5200; i++) {
      g.fillStyle = `rgba(255,240,214,${(rng() * 0.035).toFixed(3)})`;
      g.fillRect(rng() * ROCK_TILE, rng() * ROCK_TILE, rng() * 1.4 + 0.4, rng() * 1.4 + 0.4);
    }
    // Shadow in the grain, kept shallow so no blob anchors the eye to the tile.
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(0,0,0,${(rng() * 0.1).toFixed(3)})`;
      g.fillRect(rng() * ROCK_TILE, rng() * ROCK_TILE, rng() * 2.2 + 0.5, rng() * 2.2 + 0.5);
    }
    rockPattern = ctx.createPattern(tile, "repeat");
  };

  /** The mite silhouette. Optional — a fallback shape draws if it never loads. */
  const mite = new Image();
  let miteReady = false;
  mite.onload = () => { miteReady = true; };
  mite.src = "/assets/brand/parasite-white-512.png";

  const viewW = () => canvas.width / dpr;
  const viewH = () => canvas.height / dpr;
  /** Drawn width of the shaft, and where its left edge sits in the view. */
  const shaftW = () => Math.min(viewW(), SHAFT_MAX_PX);
  const shaftLeft = () => (viewW() - shaftW()) / 2;
  /** Map a model position (0..1 across the shaft) to a screen x. */
  const shaftX = (f: number) => shaftLeft() + f * shaftW();
  const miteY = () => viewH() * MITE_Y_FRACTION;
  /** The view below the mite is what is still to come, so it sets the pace. */
  const pxPerSecond = () => (viewH() - miteY()) / LOOKAHEAD_SECONDS;
  /** Run-time of whatever sits at screen row y. Deeper is further down. */
  const timeAtY = (y: number, elapsed: number) => elapsed + (y - miteY()) / pxPerSecond();
  const yAtTime = (t: number, elapsed: number) => miteY() + (t - elapsed) * pxPerSecond();

  const sizeCanvas = () => {
    const box = stage.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    const cssW = Math.max(240, Math.min(Math.floor(box.width), CANVAS_MAX_PX));
    const cssH = Math.max(240, Math.floor(box.height));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!rockPattern) buildRockTexture();
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const drawPassage = (w: number, hgt: number, elapsed: number, stratum: Stratum) => {
    if (!ctx || !live) return;
    const { passage } = live.plan;

    // 1. Rock everywhere. The passage gets carved out of it in step 3.
    ctx.fillStyle = "#191611";
    ctx.fillRect(0, 0, w, hgt);

    // 2. Speckle, scrolling upward as you descend past it.
    if (rockPattern) {
      const off = -((elapsed * pxPerSecond()) % ROCK_TILE);
      ctx.save();
      ctx.translate(0, off);
      ctx.fillStyle = rockPattern;
      ctx.fillRect(0, -off, w, hgt + ROCK_TILE);
      ctx.restore();
    }

    // 3. Strata banding, so the walls visibly scroll past and depth reads.
    //    Every fourth line is heavier, which gives the rock a bedded look
    //    rather than even stripes.
    const firstBand = Math.ceil(timeAtY(hgt, elapsed) / BAND_SECONDS) * BAND_SECONDS;
    const lastBand = timeAtY(0, elapsed);
    for (let t = firstBand; t > lastBand; t -= BAND_SECONDS) {
      const y = Math.round(yAtTime(t, elapsed)) + 0.5;
      const major = Math.round(t / BAND_SECONDS) % 4 === 0;
      ctx.strokeStyle = major ? "rgba(0,0,0,.5)" : "rgba(0,0,0,.26)";
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      if (major) {
        ctx.strokeStyle = "rgba(255,240,214,.05)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + 2);
        ctx.lineTo(w, y + 2);
        ctx.stroke();
      }
    }

    // 4. The layer's own colour, washed over the rock very faintly, so the
    //    strata you descend through actually change hue.
    ctx.fillStyle = stratum.accent;
    ctx.globalAlpha = 0.05;
    ctx.fillRect(0, 0, w, hgt);
    ctx.globalAlpha = 1;

    // 5. Darken the rock away from the shaft. On a wide window the margins are
    //    mostly dead space, and letting them fall off keeps the eye down the
    //    passage. Kept gentle: the canvas is already capped to the shaft plus a
    //    frame, so this only has to soften the edges, not hide a whole window.
    const sl = shaftLeft(), sw = shaftW();
    if (sl > 1) {
      const leftFade = ctx.createLinearGradient(0, 0, sl, 0);
      leftFade.addColorStop(0, "rgba(0,0,0,.72)");
      leftFade.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = leftFade;
      ctx.fillRect(0, 0, sl, hgt);
      const rightFade = ctx.createLinearGradient(w, 0, sl + sw, 0);
      rightFade.addColorStop(0, "rgba(0,0,0,.72)");
      rightFade.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rightFade;
      ctx.fillRect(sl + sw, 0, w - sl - sw, hgt);
    }

    // 6. Carve the passage out as a single dark shape.
    ctx.beginPath();
    const t0 = timeAtY(-WALL_STEP_PX, elapsed);
    ctx.moveTo(shaftX(passage.centreAt(t0) - passage.halfWidthAt(t0)), -WALL_STEP_PX);
    for (let y = -WALL_STEP_PX; y <= hgt + WALL_STEP_PX; y += WALL_STEP_PX) {
      const t = timeAtY(y, elapsed);
      ctx.lineTo(shaftX(passage.centreAt(t) - passage.halfWidthAt(t)), y);
    }
    for (let y = hgt + WALL_STEP_PX; y >= -WALL_STEP_PX; y -= WALL_STEP_PX) {
      const t = timeAtY(y, elapsed);
      ctx.lineTo(shaftX(passage.centreAt(t) + passage.halfWidthAt(t)), y);
    }
    ctx.closePath();
    ctx.fillStyle = "#000";
    ctx.fill();
    // A dark lip, then a lit rim in the layer's colour: the cut face reads as
    // having thickness rather than being a flat cutout.
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = stratum.accent;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  const drawLamp = (hgt: number) => {
    if (!ctx || !live) return;
    const cx = shaftX(live.x), cy = miteY();
    const r = Math.min(shaftW(), hgt) * 0.4;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "rgba(143,209,79,.13)");
    g.addColorStop(1, "rgba(143,209,79,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };

  const drawFinds = (hgt: number, elapsed: number) => {
    if (!ctx || !live) return;
    const now = performance.now();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < live.plan.finds.length; i++) {
      if (live.taken.has(i)) continue;
      const f: Find = live.plan.finds[i]!;
      const y = yAtTime(f.t, elapsed);
      if (y < -30 || y > hgt + 30) continue;
      const x = shaftX(f.x);
      // Finds fade in as they come into the lamp's reach rather than popping.
      const dist = Math.abs(y - miteY()) / (hgt * 0.9);
      ctx.globalAlpha = clamp(1.15 - dist, 0.22, 1);

      if (f.kind === "nonce") {
        const pulse = 0.75 + Math.sin(now / 260) * 0.25;
        ctx.strokeStyle = "#ffd24a";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha *= pulse;
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = clamp(1.15 - dist, 0.22, 1);
        ctx.fillStyle = "#ffd24a";
        ctx.font = "700 20px ui-monospace,Consolas,monospace";
        ctx.fillText("◆", x, y);
      } else {
        ctx.fillStyle = "#8fd14f";
        ctx.font = "600 17px ui-monospace,Consolas,monospace";
        ctx.fillText(f.glyph, x, y);
      }
    }
    ctx.globalAlpha = 1;
  };

  /** The grail: the vault opens and the block is simply there, waiting. */
  const drawBlock = (elapsed: number) => {
    if (!ctx || !live) return;
    const secondsLeft = RUN_SECONDS - elapsed;
    if (secondsLeft > LOOKAHEAD_SECONDS) return;
    const y = yAtTime(RUN_SECONDS, elapsed);
    const size = Math.min(shaftW() * 0.5, 190);
    const now = performance.now();

    // Glow around it, so it reads as the thing you came for.
    const cx = shaftX(0.5);
    const g = ctx.createRadialGradient(cx, y, 0, cx, y, size * 1.5);
    g.addColorStop(0, "rgba(255,210,74,.34)");
    g.addColorStop(1, "rgba(255,210,74,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - size * 1.5, y - size * 1.5, size * 3, size * 3);

    ctx.save();
    ctx.translate(cx, y);
    ctx.rotate(Math.sin(now / 1400) * 0.05);
    ctx.fillStyle = "#ffd24a";
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.fillStyle = "rgba(0,0,0,.18)";
    for (let i = 1; i < 5; i++) ctx.fillRect(-size / 2, -size / 2 + (size / 5) * i, size, 2);
    ctx.fillStyle = "#0a0900";
    ctx.font = `700 ${Math.round(size * 0.15)}px ui-monospace,Consolas,monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("BLOCK", 0, 0);
    ctx.restore();

    // Leading zeros resolving as you close in — the same idea as the boot intro.
    const closeness = clamp(1 - secondsLeft / LOOKAHEAD_SECONDS, 0, 1);
    const zeros = Math.floor(closeness * 8);
    ctx.fillStyle = "rgba(255,233,163,.9)";
    ctx.font = `700 ${Math.round(size * 0.17)}px ui-monospace,Consolas,monospace`;
    ctx.textAlign = "center";
    ctx.fillText("0".repeat(zeros) + (zeros < 8 ? "…" : ""), cx, y - size * 0.78);
  };

  const draw = () => {
    if (!ctx) return;
    const w = viewW(), hgt = viewH();
    if (!live) { ctx.fillStyle = "#0d0d0c"; ctx.fillRect(0, 0, w, hgt); return; }
    const elapsed = live.elapsed;
    const stratum = stratumAt(elapsed / RUN_SECONDS);

    drawPassage(w, hgt, elapsed, stratum);
    drawLamp(hgt);
    drawBlock(elapsed);
    drawFinds(hgt, elapsed);

    // The mite.
    const mx = shaftX(live.x), my = miteY();
    const size = Math.min(shaftW() * 0.11, 44);
    if (miteReady) {
      ctx.drawImage(mite, mx - size / 2, my - size / 2, size, size);
    } else {
      ctx.fillStyle = "#e6e6e6";
      ctx.beginPath();
      ctx.arc(mx, my, size * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Floating markers.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of live.pops) {
      ctx.globalAlpha = Math.max(0, 1 - p.age);
      ctx.fillStyle = p.kind === "nonce" ? "#ffd24a" : p.kind === "bad" ? "#ff5c5c" : "#8fd14f";
      ctx.font = `600 ${p.kind === "nonce" ? 16 : 13}px ui-monospace,Consolas,monospace`;
      ctx.fillText(p.text, shaftX(p.x), p.y - p.age * 24);
    }
    ctx.globalAlpha = 1;

    // A brief wash when you scrape, so a mistake is felt without stopping play.
    if (live.scrapeFlash > 0) {
      ctx.fillStyle = `rgba(255,92,92,${live.scrapeFlash * 0.2})`;
      ctx.fillRect(0, 0, w, hgt);
    }

    // Latching on: the chamber whites out for a beat.
    if (live.landFlash > 0) {
      const f = live.landFlash;
      ctx.fillStyle = `rgba(255,226,140,${(f * 0.85).toFixed(3)})`;
      ctx.fillRect(0, 0, w, hgt);
      ctx.globalAlpha = Math.min(1, f * 1.6);
      ctx.fillStyle = "#2a1d00";
      ctx.font = "900 34px Impact,'Arial Narrow',sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("BLOCK FOUND", shaftX(0.5), hgt * 0.46);
      ctx.globalAlpha = 1;
    }

    // Stratum title card — you have arrived somewhere new.
    if (live.cardAge < 1) {
      const a = live.cardAge < 0.25 ? live.cardAge / 0.25 : Math.max(0, 1 - (live.cardAge - 0.25) / 0.75);
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(0,0,0,.75)";
      ctx.font = "900 28px Impact,'Arial Narrow',sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(live.cardName.toUpperCase(), shaftX(0.5) + 2, hgt * 0.42 + 2);
      ctx.fillStyle = stratum.accent;
      ctx.textAlign = "center";
      ctx.fillText(live.cardName.toUpperCase(), shaftX(0.5), hgt * 0.42);
      ctx.globalAlpha = a * 0.6;
      ctx.fillStyle = "#e6e6e6";
      ctx.font = "600 11px ui-monospace,Consolas,monospace";
      ctx.fillText(isChamber(live.plan.passage, elapsed) ? "A CHAMBER OPENS" : "", shaftX(0.5), hgt * 0.42 + 22);
      ctx.globalAlpha = 1;
    }
  };

  // ── Loop ─────────────────────────────────────────────────────────────────
  const resolveFinds = () => {
    if (!live) return;
    for (let i = 0; i < live.plan.finds.length; i++) {
      const f = live.plan.finds[i]!;
      if (f.t > live.elapsed) break;
      if (live.taken.has(i)) continue;
      live.taken.add(i);
      if (Math.abs(live.x - f.x) > CATCH_RADIUS) continue;

      const gain = findValue(f, live.streak);
      live.score += gain;
      live.streak++;
      live.found++;
      if (f.kind === "nonce") live.nonces++;
      live.pops.push({
        x: f.x,
        y: miteY(),
        text: f.kind === "nonce" ? `NONCE +${Math.round(gain)}` : `+${gain % 1 === 0 ? gain : gain.toFixed(2)}`,
        age: 0,
        kind: f.kind,
      });
    }
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!live) return;
    // The landing flash keeps animating after the run has ended, so breaking
    // into the block gets its own beat before the tally covers the view.
    if (phase === "done") {
      if (live.landFlash > 0) {
        live.landFlash = Math.max(0, live.landFlash - (now - lastMs) / 620);
        lastMs = now;
        draw();
      }
      return;
    }
    if (phase !== "playing") return;
    const dt = Math.min(now - lastMs, 100);
    lastMs = now;
    const secs = dt / 1000;

    // Steering: keys nudge the target, a pointer sets it outright.
    if (pointerX != null) live.targetX = pointerX;
    else if (held !== 0) live.targetX = clamp(live.targetX + held * STEER_SPEED * secs, 0, 1);
    live.x += (live.targetX - live.x) * Math.min(1, secs * 14);

    live.elapsed += secs;
    const t = live.elapsed;

    // You cannot enter rock: the passage clamps you, and scraping along it costs
    // the streak. A grace window stops one long scrape draining it repeatedly.
    const centre = live.plan.passage.centreAt(t);
    const hw = live.plan.passage.halfWidthAt(t);
    live.scrapeCooldown = Math.max(0, live.scrapeCooldown - secs);
    if (Math.abs(live.x - centre) > hw) {
      live.x = clamp(live.x, centre - hw, centre + hw);
      live.targetX = clamp(live.targetX, centre - hw, centre + hw);
      if (live.scrapeCooldown === 0) {
        live.scrapeCooldown = SCRAPE_GRACE;
        live.scrapes++;
        live.streak = 0;
        live.scrapeFlash = 1;
        live.pops.push({ x: live.x, y: miteY(), text: "scrape", age: 0, kind: "bad" });
      }
    }

    resolveFinds();

    // Announce a new layer once, as you cross into it.
    const stratum = stratumAt(t / RUN_SECONDS);
    if (stratum.name !== live.announced) {
      live.announced = stratum.name;
      live.cardName = stratum.name;
      live.cardAge = 0;
      stratumOut.textContent = stratum.name;
      stratumOut.style.color = stratum.accent;
    }
    live.cardAge += secs / 2.2;

    for (const p of live.pops) p.age += secs / 0.85;
    live.pops = live.pops.filter((p) => p.age < 1);
    if (live.scrapeFlash > 0) live.scrapeFlash = Math.max(0, live.scrapeFlash - secs / 0.32);

    const pct = Math.min(100, (t / RUN_SECONDS) * 100);
    depthFill.style.width = `${pct}%`;
    depthBar.setAttribute("aria-valuenow", String(Math.round(pct)));
    depthBar.classList.toggle("is-window", t >= RUN_SECONDS - BLOCK_WINDOW_SECONDS);
    scoreOut.textContent = String(Math.round(live.score));
    const m = multiplierFor(live.streak);
    multOut.textContent = m > 1 ? `×${m}` : "";

    if (t >= RUN_SECONDS) { finish(); return; }
    draw();
  };

  // ── Phases ───────────────────────────────────────────────────────────────
  const showReady = () => {
    phase = "ready";
    overlay.replaceChildren(
      h("div", { class: "ph-game-card" },
        h("h2", {}, "Block Hunt"),
        h("p", {}, "You are the parasite. Burrow down through the rock for ", h("b", {}, `${RUN_SECONDS} seconds`),
          " and latch onto the block at the bottom."),
        h("ul", { class: "ph-game-rules" },
          h("li", {}, h("b", {}, "Steer"), " — left and right. That is the whole control."),
          h("li", {}, h("b", {}, "Hashes"), " — catch them as the passage winds. Catch them cleanly and your multiplier climbs."),
          h("li", {}, h("b", { style: "color:#ffd24a" }, "◆ Nonces"), ` — ${MAX_NONCES} a run, hidden in chambers off the easy line. Worth ${NONCE_VALUE} each.`),
          h("li", {}, h("b", {}, "Walls"), " — scraping costs your streak, nothing else."),
          h("li", {}, h("b", {}, "You always find the block"), ` — breaking in pays ${BLOCK_BONUS} on its own.`)),
        h("button", { class: "ph-game-btn", type: "button", onclick: start }, "Descend"),
        h("p", { class: "ph-game-free" },
          h("span", { class: "ph-game-badge" }, "PRACTICE"),
          ` Free, and nothing is claimed. When runs go live they cost ${fmtSats(PLAY_PRICE_SATS)}.`)),
    );
    overlay.classList.add("is-on");
  };

  /** Ore banked toward the next Black, with what is still to go. */
  const progressBlock = (ore: number, runs: number): HTMLElement => {
    const pct = Math.min(100, (ore / ORE_PER_BLACK) * 100);
    const short = Math.max(0, ORE_PER_BLACK - ore);
    return h("div", { class: "ph-game-progress" },
      short === 0
        ? h("span", {}, h("b", {}, "Enough ore for a Black."), ` ${ore.toLocaleString("en-US")} banked over ${runs} ${runs === 1 ? "run" : "runs"}.`)
        : h("span", {}, `${ore.toLocaleString("en-US")} / ${ORE_PER_BLACK.toLocaleString("en-US")} ore toward a Black — ${short.toLocaleString("en-US")} to go.`),
      h("div", { class: "ph-game-progress-bar" }, h("i", { style: `width:${pct.toFixed(1)}%` })));
  };

  /** Spend the ore and play the reveal. */
  const doClaim = () => {
    const ledger = opts.ledger;
    if (!ledger) return;
    const black = ledger.claim();
    if (!black) return;
    overlay.classList.remove("is-on");
    closeReveal = showReveal(stage, {
      black,
      runs: ledger.state().runs,
      onClose: () => { closeReveal = null; overlay.classList.add("is-on"); },
    });
  };

  const finish = () => {
    if (!live || phase === "done") return;
    phase = "done";
    const hashes = Math.round(live.score);
    const total = bankableScore(live.score + BLOCK_BONUS);
    opts.onRunEnd?.(total);
    const ledger = opts.ledger;
    const banked = ledger?.addRun(total) ?? null;
    live.elapsed = RUN_SECONDS;
    live.landFlash = 1;
    lastMs = performance.now();
    draw();

    const row = (label: string, value: string, cls = "") =>
      h("div", { class: `ph-game-row${cls}` }, h("span", {}, label), h("b", {}, value));

    overlay.replaceChildren(
      h("div", { class: "ph-game-card" },
        h("h2", {}, "Block found"),
        h("div", { class: "ph-game-tally" },
          row(`Hashes (${live.found} finds)`, String(hashes)),
          row(`Nonces ◆`, `${live.nonces} of ${MAX_NONCES}`, live.nonces > 0 ? " is-gold" : " is-dim"),
          row("Wall scrapes", String(live.scrapes), live.scrapes === 0 ? "" : " is-dim"),
          row("Block bonus", `+${BLOCK_BONUS}`),
          h("div", { class: "ph-game-row is-total" }, h("span", {}, "Banked"), h("b", {}, String(total)))),
        banked ? progressBlock(banked.ore, banked.runs) : h("p", { class: "ph-game-worth" },
          `That is ${((total / ORE_PER_BLACK) * 100).toFixed(0)}% of a Black. `,
          h("span", { class: "ph-game-dim" }, `${ORE_PER_BLACK.toLocaleString("en-US")} claims one.`)),
        ledger?.canClaim()
          ? h("button", { class: "ph-game-btn", type: "button", onclick: () => doClaim() }, "Claim your Black")
          : h("button", { class: "ph-game-btn", type: "button", onclick: () => { seed = (seed * 1664525 + 1013904223) >>> 0; reset(seed); start(); } }, "Descend again"),
        h("p", { class: "ph-game-free" },
          h("span", { class: "ph-game-badge" }, "PRACTICE"),
          " Nothing was claimed — the game is not live yet, so this run cost nothing and earned nothing.")),
    );
    // Let the white-out play before the tally lands on top of it.
    tallyTimer = window.setTimeout(() => overlay.classList.add("is-on"), 620);
  };

  function reset(nextSeed: number) {
    const plan = buildRun(nextSeed);
    const startX = plan.passage.centreAt(0);
    live = {
      plan,
      elapsed: 0,
      targetX: startX,
      x: startX,
      score: 0,
      streak: 0,
      found: 0,
      nonces: 0,
      scrapes: 0,
      taken: new Set(),
      pops: [],
      scrapeFlash: 0,
      scrapeCooldown: 0,
      landFlash: 0,
      announced: "",
      cardAge: 2,
      cardName: "",
    };
    sizeCanvas();
    scoreOut.textContent = "0";
    multOut.textContent = "";
    depthFill.style.width = "0%";
    depthBar.classList.remove("is-window");
    stratumOut.textContent = STRATA[0].name;
    stratumOut.style.color = STRATA[0].accent;
    draw();
    showReady();
  }

  function start() {
    if (!live) return;
    if (tallyTimer != null) { clearTimeout(tallyTimer); tallyTimer = null; }
    phase = "playing";
    held = 0;
    pointerX = null;
    lastMs = performance.now();
    overlay.classList.remove("is-on");
    overlay.replaceChildren();
    canvas.focus();
  }

  // ── Input ────────────────────────────────────────────────────────────────
  const DIR: Record<string, -1 | 1> = { ArrowLeft: -1, ArrowRight: 1, a: -1, d: 1, A: -1, D: 1 };
  const onKeyDown = (ev: KeyboardEvent) => {
    if (phase !== "playing" && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      if (phase === "ready") start();
      return;
    }
    const dir = DIR[ev.key];
    if (dir == null) return;
    ev.preventDefault();
    held = dir;
    pointerX = null;
  };
  const onKeyUp = (ev: KeyboardEvent) => {
    const dir = DIR[ev.key];
    if (dir != null && held === dir) held = 0;
  };
  const onBlur = () => { held = 0; pointerX = null; };

  // Drag anywhere on the shaft to steer straight there. The natural touch
  // control, and it makes the on-screen pad optional rather than the only way.
  const trackPointer = (ev: PointerEvent) => {
    if (phase !== "playing") return;
    const r = canvas.getBoundingClientRect();
    if (r.width <= 0) return;
    // The shaft may be narrower than the canvas, so map through it, not the box.
    const cssScale = r.width / viewW();
    const left = r.left + shaftLeft() * cssScale;
    pointerX = clamp((ev.clientX - left) / (shaftW() * cssScale), 0, 1);
  };
  const onPointerDown = (ev: PointerEvent) => {
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    trackPointer(ev);
  };
  const onPointerMove = (ev: PointerEvent) => { if (pointerX != null) trackPointer(ev); };
  const onPointerUp = (ev: PointerEvent) => {
    pointerX = null;
    try { canvas.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
  };

  host.addEventListener("keydown", onKeyDown);
  host.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  const ro = new ResizeObserver(() => { sizeCanvas(); draw(); });
  ro.observe(stage);

  /**
   * Read-only handle for the headless checks: play a known seed, steer to a
   * known place, assert what was banked. The same shape a server needs to
   * verify a replayed run.
   */
  (host as unknown as { blockHunt?: unknown }).blockHunt = {
    phase: () => phase,
    state: () => (live ? {
      seed: live.plan.seed, elapsed: +live.elapsed.toFixed(2), x: +live.x.toFixed(4),
      score: Math.round(live.score), found: live.found, nonces: live.nonces,
      scrapes: live.scrapes, streak: live.streak, finds: live.plan.finds.length,
    } : null),
    /** Steer instantly to a position across the shaft, 0..1. */
    goTo: (x: number) => { if (live) { live.targetX = clamp(x, 0, 1); live.x = live.targetX; } },
    /** Where the next unclaimed find is, so a check can chase it. */
    nextFind: () => {
      if (!live) return null;
      for (let i = 0; i < live.plan.finds.length; i++) {
        if (live.taken.has(i)) continue;
        const f = live.plan.finds[i]!;
        if (f.t <= live.elapsed) continue;
        return { t: f.t, x: f.x, kind: f.kind };
      }
      return null;
    },
  };

  reset(seed);
  raf = requestAnimationFrame(frame);

  // ?win=1 — jump straight to the reward moment without grinding out the ore.
  // A preview only: it spends nothing and banks nothing, and the reveal says so
  // on its face. Same support-link convention as ?perf=1 / ?boot=1 / ?gameseed=.
  try {
    if (new URLSearchParams(location.search).get("win") === "1") {
      const at = Date.now();
      overlay.classList.remove("is-on");
      closeReveal = showReveal(stage, {
        black: { id: "#" + ((at >>> 0) * 2654435761 >>> 0).toString(16).padStart(8, "0").slice(0, 8), at, ore: ORE_PER_BLACK },
        runs: opts.ledger?.state().runs || 8,
        onClose: () => { closeReveal = null; overlay.classList.add("is-on"); },
      });
    }
  } catch { /* no URL access — skip the preview */ }

  return () => {
    cancelAnimationFrame(raf);
    closeReveal?.();
    if (tallyTimer != null) clearTimeout(tallyTimer);
    ro.disconnect();
    host.removeEventListener("keydown", onKeyDown);
    host.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    host.classList.remove("ph-game");
    host.replaceChildren();
  };
}
