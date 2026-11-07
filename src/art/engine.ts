// @ts-nocheck — ported verbatim from RH Sniper (pfplab.js); see the note below.
/**
 * engine.ts — composes one Sniper as an SVG string.
 *
 * Ported from RH Sniper's pfplab.js (2026-10-22). It started life there as the
 * art bench and became the art the site actually drew; here it is simply the
 * generator. The drawing code is carried over verbatim so the two can be
 * diffed. What moved: every table a viewer needs to SEE (tiers, fills, odds,
 * the trait rolls) now lives in catalog.ts, so the desktop can show the odds
 * without shipping the renderer. What was left behind: the contact-sheet
 * pages and the CLI that wrote them.
 *
 * The art is a pure function of its inputs — same token, same tier, same
 * picture, byte for byte, forever. Nothing is stored anywhere. Keep it that
 * way: art.test.ts pins it.
 *
 * Original header:
 *
 * pfplab.js — the art bench.
 *
 * pfp.js is the shipping generator and stays stable. This file draws in its
 * EXACT coordinate space (it imports the projection rather than copying it) and
 * swaps out the three layers we are still arguing about:
 *
 *   FILLS   what the body is made of, instead of straight billiard strands
 *   MOUTHS  the jaw, instead of three square vents
 *   FIELDS  what is behind the figure, instead of hash rain
 *
 * Plus PRISMATIC: the top of the ladder rebuilt as every tier at once.
 *
 */

import * as P from "./figure.js";
import {
  COLLECTION_ITEM, TIER_FILLS, COMPOSITE_FILL, UNIVERSAL_FIELD,
  isUniversal, isComposite, fillWeightOf,
} from "./catalog.js";

const { ATX, ATY, CELL, VB, W, H, lcg } = P;

const f1 = n => Number(n).toFixed(1);
const rnd = (r, a, b) => a + r() * (b - a);

// ---------------------------------------------------------------- palette ---
/**
 * PRISMATIC — the top rung, rebuilt.
 *
 * Gold is currently plated metal: bronze shadow, gold body, near-white
 * specular. Replacing it with "a mixture of the other colours" cannot be a
 * literal mix — average five hues and you get grey, every time, and a muddy
 * grey is a terrible reward for 62 burned tokens.
 *
 * So nothing is blended. The five colours stay separate and are dealt out
 * across SEPARATE STRANDS. The eye reads "all of them" at a glance while every
 * individual line is still a pure, saturated tier colour. Same trick stained
 * glass uses, and the reason it survives being looked at closely.
 */
const LADDER = ['White', 'Orange', 'Green', 'Blue', 'Red'];
const PRISM_HUES = LADDER.map(t => P.TIER_STRANDS[t]);

const strandsFor = tier => tier === 'Prismatic'
  ? { hot: '#ffffff', mid: '#f2f6ff', dim: '#8ea0c8', prism: PRISM_HUES }
  : (P.TIER_STRANDS[tier] || P.TIER_STRANDS.White);

/** Per-strand colour. Prismatic cycles the ladder; every other tier is itself. */
const inkOf = (C3, i) => C3.prism ? C3.prism[i % C3.prism.length] : C3;

// ------------------------------------------------------------------ grid ---

/**
 * The body, rebuilt with arms.
 *
 * The old lower half was five stacked rectangles, each wider than the last. It
 * silhouettes as a pyramid, and a pyramid has no arms in it — which is why the
 * figure read as a traffic cone with a head on top.
 *
 * The fix is not more steps, it is a GAP. Arms only read as arms when there is
 * empty space between them and the torso, because that gap is the only thing
 * the eye can use to separate two masses of identical colour. So:
 *
 *   - a YOKE across the shoulders, rows 41-44, spanning the full width. This
 *     is what the arms hang from, and it is why the figure stays one connected
 *     shape rather than three floating pieces.
 *   - a TORSO down the middle, edges 20-36.
 *   - two ARMS at edges 9-17 and 39-47, each tapering at the forearm.
 *   - a three-cell gap either side of the torso, running from under the yoke
 *     to the bottom edge. It is open at the bottom, so it is a notch and not a
 *     hole — nothing has to be enclosed and nothing gets severed.
 *
 * Every rect straddles edge 28, the same axis the head and the eyes use. The
 * right arm is the exact mirror of the left: mirror(a,b) = (56-b, 56-a) about
 * edge 28, which is worth checking by hand on any change here, because a
 * one-cell asymmetry in the body is much harder to see than one in the face
 * and much worse once you do.
 *
 * ELBOW and HEM are cut rather than drawn, for the same reason the rig is: the
 * interior is never stroked, so the only way to put a line on it is to remove
 * material and let the fill crowd the new wall.
 */
const LAB_BODY = {
  collar: [[22, 37, 12, 4]],                       // edges 22-34, rows 37-40

  /* The shoulder, rounded. Four one-row steps whose widths grow by 2, 2, 1, 1
     going down — a DECELERATING expansion, which is what makes the corner read
     as convex. Equal steps give a 45-degree bevel and still look machined; the
     whole difference between a shoulder and a robot is that the steps get
     smaller as they go. */
  yoke:   [[13, 41, 30, 1],                        // edges 13-43
           [11, 42, 34, 1],                        // edges 11-45
           [10, 43, 36, 1],                        // edges 10-46
           [9,  44, 38, 1]],                       // edges  9-47

  /* The torso is chamfered where it meets the yoke, so the waist is not a slab
     butted against a shoulder. One cell in on each side for two rows is enough
     — the eye reads any break in a long straight edge as a curve. */
  torso:  [[20, 45, 16, 2],                        // edges 20-36, rows 45-46
           [19, 47, 18, 9]],                       // edges 19-37, rows 47-55

  /* Arms, tapering one cell at a time so the outer edge curves rather than
     stepping straight down, and pulled in once more at the very bottom so the
     arm does not end on a square corner. Each is the exact mirror of its pair
     about edge 28: mirror(a,b) = (56-b, 56-a). */
  armLU:  [[9,  45, 8, 4]],                        // edges  9-17, rows 45-48
  armLM:  [[10, 49, 7, 4]],                        // edges 10-17, rows 49-52
  armLL:  [[11, 53, 6, 2],                         // edges 11-17, rows 53-54
           [12, 55, 5, 1]],                        // edges 12-17, row  55
  armRU:  [[39, 45, 8, 4]],                        // edges 39-47
  armRM:  [[39, 49, 7, 4]],                        // edges 39-46
  armRL:  [[39, 53, 6, 2],                         // edges 39-45
           [39, 55, 5, 1]]                         // edges 39-44
};

/**
 * Cut into the body: an elbow crease on each arm, and a hem.
 *
 * The arm-to-torso gap is now TWO cells at every row, not three. Three was
 * enough to read as a gap and too much to read as a body — the arms looked
 * detached rather than hanging. Two still separates the masses because the
 * fill crowds both walls, which draws the seam darker than the gap itself is.
 */
const LAB_HOLES = [
  [11, 50, 4, 1],      // left elbow
  [41, 50, 4, 1],      // right elbow, mirrored
  [22, 52, 12, 1]      // hem across the torso
];

function partsLab(t) {
  const base = P.partsFor(t);          // keeps the hood and its Peaked/Heavy variants
  const p = { hood: base.hood, hoodFold: base.hoodFold };
  for (const [k, v] of Object.entries(LAB_BODY)) p[k] = v.map(r => r.slice());
  return p;
}

// Parahawk: `hood` and `rig` let the Collection window show one token wearing
// another silhouette. Left undefined (every real render) they change nothing,
// so a token's own picture is byte-identical to the port.
function unionFor(tokenId, tier, mouthName, eyesName, hood, rig) {
  const t = P.traitsOf(tokenId);
  t.tier = tier;
  if (hood) t.hood = hood;
  if (rig) t.rig = rig;
  const union = P.blank();
  for (const rects of Object.values(partsLab(t))) P.paint(union, rects);
  // The three 2x2 square vents are replaced wholesale by the mouth's own cut.
  const vents = P.holesFor(t).filter(h => !(h[1] === 29 && h[2] === 2 && h[3] === 2));
  const M = MOUTHS[mouthName] || MOUTHS.Grill;
  P.carve(union, vents.concat(M.cut).concat(LAB_HOLES));
  P.carveCells(union, eyeCellsOf(eyesName));
  return { union, t };
}

// ------------------------------------------------------------------ fills ---
/**
 * Every fill returns a list of POLYLINES in grid coordinates. Colour, width,
 * glow and animation are applied once downstream, so adding a fill means
 * writing a generator and nothing else. That is the whole reason they live in
 * one table with one signature.
 */

const inBody = grid => (x, y) => {
  const i = Math.floor(x), j = Math.floor(y);
  return i >= 0 && j >= 0 && i < W && j < H && grid[j][i] === 1;
};

const seedCells = grid => {
  const cells = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y][x]) cells.push([x + 0.5, y + 0.5]);
  return cells;
};

/**
 * CIRCUITRY — traces routed like a board, not shot like a billiard ball.
 *
 * The heading is snapped to eight compass directions and only ever turns by
 * 45 degrees, so every corner is a mitre and every run is axial or diagonal.
 * That single constraint is what separates "PCB" from "scribble": real routing
 * never contains an arbitrary angle. Runs are quantised to whole cells too, so
 * traces from different strands line up instead of near-missing.
 */
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function circuitry(seed, count, grid, legs) {
  const r = lcg(seed), on = inBody(grid), start = seedCells(grid);
  if (!start.length) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    let [x, y] = start[Math.floor(r() * start.length)];
    x = Math.round(x - 0.5) + 0.5; y = Math.round(y - 0.5) + 0.5;
    let d = Math.floor(r() * 8);
    const pts = [[x, y]];
    for (let leg = 0; leg < legs; leg++) {
      const run = 1 + Math.floor(r() * 5);
      let moved = 0;
      for (let s = 0; s < run; s++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        if (!on(nx, ny)) break;
        x = nx; y = ny; moved++;
      }
      if (moved) pts.push([x, y]);
      // turn one or two eighths, whichever way is open
      const turn = r() < 0.5 ? 1 : -1;
      let tries = 0, nd = d;
      do { nd = (nd + turn + 8) % 8; tries++; } while (!on(x + DIRS[nd][0], y + DIRS[nd][1]) && tries < 8);
      if (tries >= 8) break;
      d = nd;
    }
    if (pts.length > 2) out.push(pts);
  }
  return out;
}

/**
 * CONTOUR — the silhouette, over and over, shrinking.
 *
 * Erode the figure a cell at a time and trace what is left. The result is a
 * topographic map of the character: rings hugging every vent, every eye and
 * every strap, bunched tight where the body is narrow. It reads as depth
 * without a single gradient, and unlike the strand fills it is fully
 * deterministic — the same figure always gives the same rings, so it is the
 * one fill where two tokens of a tier look like siblings.
 */
function contour(_seed, _count, grid, rings) {
  const out = [];
  let g = grid;
  for (let k = 0; k < rings; k++) {
    g = P.erode(g);
    for (const loop of P.trace(g)) {
      const l = P.simplify(loop);
      if (l.length > 3) out.push(l.concat([l[0]]));
    }
  }
  return out;
}

/**
 * FILAMENT — the same trapped-strand idea, but the heading drifts.
 *
 * A billiard strand is straight because its velocity never changes between
 * walls. Rotating the heading a little every step turns each run into an arc,
 * and the strands begin to bundle and braid the way hair or smoke does. The
 * wander is deliberately tiny: past about 0.05 radians a step it stops reading
 * as line art and starts reading as noise.
 *
 * Sampled every 8th step rather than every step — at full rate a single strand
 * is thousands of points and the file balloons for detail nobody can see.
 */
function filament(seed, count, grid, bounces) {
  const r = lcg(seed), on = inBody(grid), start = seedCells(grid);
  if (!start.length) return [];
  const STEP = 0.3;
  const out = [];
  for (let i = 0; i < count; i++) {
    let [x, y] = start[Math.floor(r() * start.length)];
    let a = r() * Math.PI * 2;
    const curl = rnd(r, -0.045, 0.045);
    const pts = [[x, y]];
    let hits = 0, guard = 0;
    while (hits < bounces && guard++ < bounces * 400) {
      a += curl;
      const nx = x + Math.cos(a) * STEP, ny = y + Math.sin(a) * STEP;
      if (on(nx, ny)) {
        x = nx; y = ny;
        if (guard % 8 === 0) pts.push([x, y]);
        continue;
      }
      pts.push([x, y]); hits++;
      if (on(x + Math.cos(a) * STEP, y)) a = -a;             // vertical wall
      else if (on(x, y + Math.sin(a) * STEP)) a = Math.PI - a; // horizontal wall
      else a += Math.PI;                                      // corner
    }
    out.push(pts);
  }
  return out;
}

/**
 * LATTICE — a triangular mesh, clipped to the body.
 *
 * Three families of parallel lines at 0, 60 and 120 degrees. No randomness at
 * all, which makes it the calmest fill and the only one where two different
 * tokens look genuinely related. Useful as the common floor the rarer fills
 * get measured against.
 */
function lattice(_seed, _count, grid, pitch) {
  const on = inBody(grid), out = [];
  for (const ang of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const px = -dy, py = dx;                        // the perpendicular
    for (let k = -70; k < 70; k++) {
      const ox = W / 2 + px * k * pitch, oy = H / 2 + py * k * pitch;
      let run = null;
      for (let s = -80; s < 80; s += 0.34) {
        const x = ox + dx * s, y = oy + dy * s;
        if (on(x, y)) (run || (run = [])).push([x, y]);
        else if (run) { if (run.length > 3) out.push([run[0], run[run.length - 1]]); run = null; }
      }
      if (run && run.length > 3) out.push([run[0], run[run.length - 1]]);
    }
  }
  return out;
}

/**
 * SHATTER — long chords across the body, like cracked glass.
 *
 * Each line is one straight run from a wall to the opposite wall, so the figure
 * looks fractured rather than woven. Cheapest fill here and the most
 * aggressive, which makes it the natural home for a high roll.
 */
/**
 * THE JACKPOT FILL, six ways.
 *
 * There was one shatter(): the same 84 chords across the body on every tier,
 * recoloured. One generator, one picture, six names would have been six labels
 * on a single thing — so each tier now breaks in the idiom of its own family,
 * and only then earns its own name.
 *
 *   White      Cleave     axis-aligned splits, no wander. The rigid family
 *                         breaks like a pane, along the grid it is made of.
 *   Orange     Arcflash   axis-aligned, but turning ninety degrees as it runs:
 *                         a trace routing itself across the body and shorting.
 *   Green      Sunder     splits that BRANCH. The growing family cracks the way
 *                         a root does, forking off the main line as it travels.
 *   Blue       Shiver     chords displaced by a sine along their own length, so
 *                         the break oscillates instead of running straight.
 *   Red        Shatter    jagged: the direction resets every few steps. Keeps
 *                         the original name, because fracture is Red's family
 *                         and this is the one tier the word was always right for.
 *   Prismatic  Nova       every chord from a SINGLE origin, so the top rung
 *                         does not crack — it detonates.
 *
 * All six are 1%, all six force the Totality field, and all six walk until
 * they leave the body, so the shape of the figure is what ends every line.
 */
function shatterWalk(seed, count, grid, kind) {
  const r = lcg(seed), on = inBody(grid), start = seedCells(grid);
  if (!start.length) return [];
  const out = [];
  const STEP = 0.34, QTR = Math.PI / 2;

  // Nova fires everything from one point; everything else starts where it likes
  /* Nova detonates from one point, rolled per token. Pinning it to the middle
     made every Nova the same picture; taking it uniformly at random put it out
     by an elbow. originIn() does neither — see there. */
  const origin = kind === 'nova' ? originIn(r, grid, 0.22) : null;

  const snap = a => Math.round(a / QTR) * QTR;

  const ray = (sx, sy, ang0, budget) => {
    const pts = [[sx, sy]];
    let ang = ang0, x = sx, y = sy, g = 0, t = 0;
    while (g++ < budget) {
      if (kind === 'shatter' && g % 16 === 0) ang = ang0 + rnd(r, -0.6, 0.6);
      if (kind === 'arcflash' && g % 20 === 0 && r() < 0.6) ang += (r() < 0.5 ? -1 : 1) * QTR;
      const nx = x + Math.cos(ang) * STEP, ny = y + Math.sin(ang) * STEP;
      if (!on(nx, ny)) break;
      x = nx; y = ny; t += STEP;
      if (g % 4) continue;
      if (kind === 'shiver') {
        // displace the EMITTED point, not the walk: displacing the walk turns
        // a wave into a drift, and the chord stops going where it was aimed
        const off = Math.sin(t * 0.8) * 1.4;
        pts.push([x + Math.cos(ang + QTR) * off, y + Math.sin(ang + QTR) * off]);
      } else {
        pts.push([x, y]);
      }
    }
    pts.push([x, y]);
    return pts;
  };

  for (let i = 0; i < count; i++) {
    const [sx, sy] = origin || start[Math.floor(r() * start.length)];
    let a = r() * Math.PI * 2;
    if (kind === 'cleave' || kind === 'arcflash') a = snap(a);

    [a, a + Math.PI].forEach(dir => {
      const pts = ray(sx, sy, dir, 900);
      if (pts.length > 1) out.push(pts);

      // Sunder alone forks: branches off the line it already drew
      if (kind === 'sunder') {
        pts.forEach((p, k) => {
          if (k === 0 || k % 6 || r() > 0.45) return;
          const b = ray(p[0], p[1], dir + (r() < 0.5 ? -1 : 1) * rnd(r, 0.4, 0.95), 240);
          if (b.length > 2) out.push(b);
        });
      }
    });
  }
  return out;
}

const cleave   = (seed, count, grid) => shatterWalk(seed, count, grid, 'cleave');
const arcflash = (seed, count, grid) => shatterWalk(seed, count, grid, 'arcflash');
const sunder   = (seed, count, grid) => shatterWalk(seed, count, grid, 'sunder');
const shiver   = (seed, count, grid) => shatterWalk(seed, count, grid, 'shiver');
const nova     = (seed, count, grid) => shatterWalk(seed, count, grid, 'nova');

function shatter(seed, count, grid) {
  return shatterWalk(seed, count, grid, 'shatter');
}

/**
 * `lift` multiplies every opacity the fill is drawn at.
 *
 * It exists because brightness is not a property of a colour here, it is a
 * property of how much line is on the canvas. Shatter draws 54 single chords
 * where Circuitry draws 46 many-segment traces, so at equal opacity Shatter
 * comes out visibly dimmer than everything else — there is simply less ink in
 * the frame. Lifting the rarest fill is therefore a correction, not a cheat:
 * it puts Shatter back at the brightness the others get for free.
 */
// ------------------------------------------------- the per-tier fill bank ---
/**
 * Twenty-six more fills, so every tier can own a set nobody else has.
 *
 * Two shortcuts make this tractable rather than 26 bespoke marchers:
 *
 *   1. The body is already a CLIP PATH in the SVG. A fill that draws geometry
 *      over the figure's bounding box gets trimmed to the silhouette for free,
 *      so only the fills whose whole point is wall interaction (Maze, Sprawl,
 *      Tangle) need to know where the walls are.
 *   2. Curves are emitted as polylines. Everything downstream already speaks
 *      polyline, so an arc is just a densely sampled one and no drawing code
 *      changes.
 *
 * Which tier gets which is in TIER_FILLS. The intent is that the set reads as a
 * family: White's are all rigid and rectilinear, Green's all grow, Blue's all
 * oscillate, Red's all fracture. A holder should be able to tell what tier a
 * token is from the STRUCTURE even in a greyscale screenshot — colour says
 * rank, and now so does the geometry.
 */
function bboxOf(grid) {
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y][x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/** A circle or arc, as a polyline. */
function arc(cx, cy, rad, a0, a1, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  return pts;
}

/** Split a polyline into the runs that lie inside the body. */
function insideRuns(on, pts) {
  const out = [];
  let run = null;
  for (const p of pts) {
    if (on(p[0], p[1])) (run || (run = [])).push(p);
    else if (run) { if (run.length > 1) out.push(run); run = null; }
  }
  if (run && run.length > 1) out.push(run);
  return out;
}

// --- White: rigid, rectilinear, industrial ---------------------------------

/** WEFT — horizontal scanlines whose spacing tightens and loosens. */
function weft(seed, _c, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let y = b.y0; y <= b.y1; y += rnd(r, 0.7, 2.2)) out.push([[b.x0 - 1, y], [b.x1 + 1, y]]);
  return out;
}

/** BARCODE — vertical bars, widths drawn from a small set so it scans as code. */
function barcode(seed, _c, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let x = b.x0; x <= b.x1; x += rnd(r, 0.5, 1.9)) out.push([[x, b.y0 - 1], [x, b.y1 + 1]]);
  return out;
}

/** LADDER — two rails with rungs between them, repeated across the body. */
function ladder(seed, _c, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let x = b.x0; x < b.x1; x += 4) {
    const w = rnd(r, 2, 3.4);
    out.push([[x, b.y0 - 1], [x, b.y1 + 1]], [[x + w, b.y0 - 1], [x + w, b.y1 + 1]]);
    for (let y = b.y0; y < b.y1; y += rnd(r, 2, 3.6)) out.push([[x, y], [x + w, y]]);
  }
  return out;
}

/** STITCH — short crossing dashes on a grid: cross-stitch. */
function stitch(seed, _c, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [], s = 1.5;
  for (let y = b.y0; y < b.y1; y += 2.4) {
    for (let x = b.x0; x < b.x1; x += 2.4) {
      if (r() < 0.22) continue;
      out.push([[x, y], [x + s, y + s]]);
      if (r() < 0.6) out.push([[x + s, y], [x, y + s]]);
    }
  }
  return out;
}

/** DRIFT — vertical traces that wander sideways, like a seismograph. */
function drift(seed, _c, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let x = b.x0; x <= b.x1; x += rnd(r, 1.4, 3)) {
    const pts = []; let dx = 0;
    for (let y = b.y0 - 1; y <= b.y1 + 1; y += 0.8) {
      dx += rnd(r, -0.35, 0.35); dx = Math.max(-2.2, Math.min(2.2, dx));
      pts.push([x + dx, y]);
    }
    out.push(pts);
  }
  return out;
}

/** CHEVRON — repeating V bands marching across the body. */
function chevron(seed, _c, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  const w = rnd(r, 4, 7);
  for (let y = b.y0 - 8; y <= b.y1 + 8; y += rnd(r, 1.5, 2.8)) {
    const pts = [];
    for (let x = b.x0 - 1; x <= b.x1 + 1; x += 0.5) {
      const t = (((x - b.x0) % (w * 2)) + w * 2) % (w * 2) / w;   // 0..2 sawtooth
      pts.push([x, y + (t < 1 ? t : 2 - t) * w * 0.5]);
    }
    out.push(pts);
  }
  return out;
}

// --- Green: things that grow ------------------------------------------------

/** SPRAWL — a branching tree from a root at the bottom of the figure. */
function sprawl(seed, count, grid) {
  const r = lcg(seed), on = inBody(grid), b = bboxOf(grid), out = [];
  const grow = (x, y, a, len, depth) => {
    if (depth > 7 || len < 0.8) return;
    const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
    if (!on(nx, ny)) return;
    out.push([[x, y], [nx, ny]]);
    const spread = rnd(r, 0.3, 0.75);
    grow(nx, ny, a - spread, len * rnd(r, 0.66, 0.9), depth + 1);
    grow(nx, ny, a + spread, len * rnd(r, 0.66, 0.9), depth + 1);
    if (r() < 0.25) grow(nx, ny, a, len * 0.8, depth + 1);
  };
  for (let i = 0; i < count; i++) {
    grow(rnd(r, b.x0, b.x1), b.y1, -Math.PI / 2 + rnd(r, -0.5, 0.5), rnd(r, 3.5, 6), 0);
  }

  /* Every seed used to start on the floor and climb, so the growth thinned out
     exactly where the token is actually looked at: by the time a branch had
     climbed into the head it was six levels deep and nearly out of length.
     These seeds start INSIDE the head and grow outward in every direction on
     short segments, which fills the skull the way the name promises. */
  const headTop = b.y0, headBot = b.y0 + b.h * 0.42;
  let placed = 0, tries = 0;
  while (placed < count * 2 && tries < count * 60) {
    tries++;
    const x = rnd(r, b.x0, b.x1), y = rnd(r, headTop, headBot);
    if (!on(x, y)) continue;
    placed++;
    const arms = 2 + Math.floor(r() * 3);
    for (let k = 0; k < arms; k++) {
      grow(x, y, (k / arms) * Math.PI * 2 + rnd(r, 0, 1.2), rnd(r, 2.2, 4), 3);
    }
  }
  return out;
}

/** MAZE — a recursive-backtracker walk on the cell grid. Every path is legal. */
function maze(seed, count, grid) {
  const r = lcg(seed), on = inBody(grid), out = [];
  const seen = new Set();
  const key = (x, y) => x + ',' + y;
  const starts = seedCells(grid);
  if (!starts.length) return [];
  for (let i = 0; i < count; i++) {
    let [x, y] = starts[Math.floor(r() * starts.length)];
    x = Math.round(x - 0.5) + 0.5; y = Math.round(y - 0.5) + 0.5;
    const pts = [[x, y]];
    for (let s = 0; s < 70; s++) {
      const opts = [[2, 0], [-2, 0], [0, 2], [0, -2]]
        .filter(([dx, dy]) => on(x + dx, y + dy) && !seen.has(key(x + dx, y + dy)));
      if (!opts.length) break;
      const [dx, dy] = opts[Math.floor(r() * opts.length)];
      x += dx; y += dy;
      seen.add(key(x, y));
      pts.push([x, y]);
    }
    if (pts.length > 2) out.push(pts);
  }
  return out;
}

/** NEST — the contour rings again, but each one offset and rotated slightly. */
function nest(seed, _c, grid, rings) {
  const r = lcg(seed), out = [];
  let g = grid;
  for (let k = 0; k < rings; k++) {
    g = P.erode(g);
    const ox = rnd(r, -0.6, 0.6), oy = rnd(r, -0.6, 0.6);
    for (const loop of P.trace(g)) {
      const l = P.simplify(loop);
      if (l.length > 3) out.push(l.concat([l[0]]).map(([x, y]) => [x + ox, y + oy]));
    }
  }
  return out;
}

/** RIPPLE — concentric circles from several sources, overlapping. */
function ripple(seed, count, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let i = 0; i < count; i++) {
    const cx = rnd(r, b.x0, b.x1), cy = rnd(r, b.y0, b.y1);
    const n = 4 + Math.floor(r() * 6), gap = rnd(r, 1.6, 3.2);
    for (let k = 1; k <= n; k++) out.push(arc(cx, cy, k * gap, 0, Math.PI * 2, 34));
  }
  return out;
}

/** COIL — tight spirals, each unwinding from its own centre. */
function coil(seed, count, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let i = 0; i < count; i++) {
    const cx = rnd(r, b.x0, b.x1), cy = rnd(r, b.y0, b.y1);
    const turns = rnd(r, 2.5, 5), grow = rnd(r, 0.45, 1.1), pts = [];
    for (let a = 0; a < turns * Math.PI * 2; a += 0.22) {
      const rad = a * grow / (Math.PI * 2);
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
    out.push(pts);
  }
  return out;
}

// --- Blue: oscillation ------------------------------------------------------

/** WAVEFORM — stacked sine waves, each with its own frequency and phase. */
function waveform(seed, _c, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let y = b.y0; y <= b.y1; y += rnd(r, 1.6, 3)) {
    const amp = rnd(r, 0.5, 2.4), freq = rnd(r, 0.15, 0.55), ph = rnd(r, 0, 7);
    const pts = [];
    for (let x = b.x0 - 1; x <= b.x1 + 1; x += 0.5) pts.push([x, y + Math.sin(x * freq + ph) * amp]);
    out.push(pts);
  }
  return out;
}

/** RINGS — concentric circles on one centre. The calmest of the Blue set. */
function rings(_s, _c, grid) {
  const b = bboxOf(grid), out = [];
  for (let k = 1; k < 26; k++) out.push(arc(b.cx, b.cy, k * 1.3, 0, Math.PI * 2, 46));
  return out;
}

/** ORBIT — ellipses at many rotations about one centre. */
function orbit(seed, count, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let i = 0; i < count; i++) {
    const rx = rnd(r, 4, b.w * 0.6), ry = rnd(r, 2, b.h * 0.45), rot = r() * Math.PI;
    const pts = [];
    for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.16) {
      const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
      pts.push([b.cx + x * Math.cos(rot) - y * Math.sin(rot),
                b.cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    out.push(pts);
  }
  return out;
}

/** PULSE — flat traces with occasional spikes. An EKG across the body. */
function pulse(seed, _c, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let y = b.y0; y <= b.y1; y += rnd(r, 1.8, 3.4)) {
    const pts = [];
    for (let x = b.x0 - 1; x <= b.x1 + 1; x += 0.6) {
      pts.push([x, y - (r() < 0.06 ? rnd(r, 1.5, 4) : 0)]);
    }
    out.push(pts);
  }
  return out;
}

/**
 * RUPTURE — impact fracture. Replaces Spiral.
 *
 * Spiral was two logarithmic curves from the middle of the body, which is a
 * decoration rather than damage: Red's family is FRACTURE and a spiral is the
 * one thing in nature that never breaks. This propagates instead. Cracks leave
 * an impact point, wander, split, and die when they run out of body — so the
 * pattern is a consequence of where the hit landed rather than a shape stamped
 * on top of the figure.
 */
function rupture(seed, count, grid) {
  const r = lcg(seed), on = inBody(grid), b = bboxOf(grid), out = [];

  const crack = (x, y, a, len, depth) => {
    if (depth > 7 || len < 0.85) return;
    const na = a + rnd(r, -0.34, 0.34);
    const seg = len * rnd(r, 0.55, 0.95);
    const nx = x + Math.cos(na) * seg, ny = y + Math.sin(na) * seg;
    if (!on(nx, ny)) return;
    out.push([[x, y], [nx, ny]]);
    crack(nx, ny, na, len * rnd(r, 0.74, 0.94), depth + 1);
    // a crack that only ever continues is a line; the splits are the fracture
    if (r() < 0.44) {
      crack(nx, ny, na + (r() < 0.5 ? -1 : 1) * rnd(r, 0.55, 1.15),
        len * rnd(r, 0.42, 0.72), depth + 2);
    }
  };

  let placed = 0, tries = 0;
  while (placed < count && tries < count * 80) {
    tries++;
    const cx = rnd(r, b.x0, b.x1), cy = rnd(r, b.y0, b.y1);
    if (!on(cx, cy)) continue;
    placed++;
    const arms = 5 + Math.floor(r() * 5);
    const base = r() * Math.PI * 2;
    for (let k = 0; k < arms; k++) {
      crack(cx, cy, base + (k / arms) * Math.PI * 2, rnd(r, 4.5, 9.5), 0);
    }
    // stress rings around the impact, broken into arcs
    const rings = 1 + Math.floor(r() * 3);
    for (let q = 1; q <= rings; q++) {
      const rad = q * rnd(r, 1.8, 3.2);
      let a = r() * Math.PI * 2;
      const arcs = 2 + Math.floor(r() * 3);
      for (let k = 0; k < arcs; k++) {
        const span = rnd(r, 0.6, 1.5), pts = [];
        for (let t = 0; t <= span; t += 0.16) {
          const px = cx + Math.cos(a + t) * rad, py = cy + Math.sin(a + t) * rad;
          if (!on(px, py)) break;
          pts.push([px, py]);
        }
        if (pts.length > 1) out.push(pts);
        a += span + rnd(r, 0.4, 1.2);
      }
    }
  }
  return out;
}

/**
 * SHEAR — slip planes, offset. Replaces Cellular.
 *
 * Cellular drew nearest-site boundaries, which come out as soft rounded cells:
 * the most ORGANIC thing in the set, sitting in the tier that is supposed to
 * read as broken. This is the same subject Hatch is near — horizontal bands —
 * but where Hatch rotates each band, this one BREAKS each band: the plane runs
 * flat, steps vertically at a fault, and carries on displaced. The risers that
 * connect the steps are what make it read as slip rather than as a wobble.
 */
function shear(seed, _c, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let y = b.y0; y <= b.y1; y += rnd(r, 1.8, 3.4)) {
    let cur = [], py = y + rnd(r, -0.4, 0.4);
    for (let x = b.x0 - 1; x <= b.x1 + 1; x += rnd(r, 1.1, 2.6)) {
      cur.push([x, py]);
      if (r() < 0.14) {
        // a fault: close this run, jump, and drop a riser across the gap
        const ny = py + rnd(r, -2.6, 2.6);
        if (cur.length > 1) out.push(cur);
        out.push([[x, py], [x, ny]]);
        cur = [[x, ny]];
        py = ny;
      }
    }
    if (cur.length > 1) out.push(cur);
  }
  return out;
}

/**
 * LISSAJOUS — two oscillations at right angles. Replaces Orbit.
 *
 * Blue's family is OSCILLATION and Orbit was the one member that did not
 * oscillate: plain ellipses, which read as static rings no matter how many you
 * stack. A Lissajous figure is literally what you get when you put one
 * oscillation on each axis, so it belongs to the family by construction — and
 * small integer frequency ratios close into knots that look solved rather than
 * drawn.
 */
function lissajous(seed, count, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let i = 0; i < count; i++) {
    const fx = 1 + Math.floor(r() * 5), fy = 1 + Math.floor(r() * 5);
    const ph = r() * Math.PI * 2;
    const ax = b.w * rnd(r, 0.18, 0.46), ay = b.h * rnd(r, 0.16, 0.42);
    const cx = b.cx + rnd(r, -b.w * 0.14, b.w * 0.14);
    const cy = b.cy + rnd(r, -b.h * 0.14, b.h * 0.14);
    const pts = [];
    for (let t = 0; t <= Math.PI * 2 + 0.04; t += 0.035) {
      pts.push([cx + Math.sin(t * fx + ph) * ax, cy + Math.sin(t * fy) * ay]);
    }
    out.push(pts);
  }
  return out;
}

/** CRYSTAL — straight rays from a handful of nucleation points. */
function crystal(seed, count, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let i = 0; i < count; i++) {
    const cx = rnd(r, b.x0, b.x1), cy = rnd(r, b.y0, b.y1);
    const n = 5 + Math.floor(r() * 7), base = r() * Math.PI;
    const tips = [];
    for (let k = 0; k < n; k++) {
      const a = base + (k / n) * Math.PI * 2, len = rnd(r, 4, 16);
      const t = [cx + Math.cos(a) * len, cy + Math.sin(a) * len];
      tips.push(t);
      out.push([[cx, cy], t]);
    }
    /* Spokes alone are a star, and a field of stars is not a crystal. The
       chords between neighbouring tips close the shape into facets, and a
       second chord skipping one tip puts structure INSIDE the facet -- which
       is the difference between a spiky blob and something cut. */
    for (let k = 0; k < n; k++) {
      out.push([tips[k], tips[(k + 1) % n]]);
      if (n > 5 && r() < 0.55) out.push([tips[k], tips[(k + 2) % n]]);
    }
  }
  return out;
}

// --- Red: fracture ----------------------------------------------------------

/** HATCH — parallel hatching whose angle changes band by band. */
function hatch(seed, _c, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let y = b.y0; y < b.y1; y += 6) {
    const a = rnd(r, -1.2, 1.2), dx = Math.cos(a), dy = Math.sin(a);
    for (let k = -40; k < 40; k++) {
      const ox = b.cx + k * 1.5 * -dy, oy = y + 3 + k * 1.5 * dx;
      out.push([[ox - dx * 30, oy - dy * 30], [ox + dx * 30, oy + dy * 30]]);
    }
  }
  return out;
}

/** SPLINTER — short segments, all aligned to one slowly turning flow field. */
function splinter(seed, count, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let i = 0; i < count; i++) {
    const x = rnd(r, b.x0, b.x1), y = rnd(r, b.y0, b.y1);
    const a = (x + y) * 0.09 + rnd(r, -0.35, 0.35), len = rnd(r, 1.5, 4.5);
    out.push([[x - Math.cos(a) * len, y - Math.sin(a) * len],
              [x + Math.cos(a) * len, y + Math.sin(a) * len]]);
  }
  return out;
}

/** TANGLE — a small-step random walk, trapped in the body. Controlled scribble. */
function tangle(seed, count, grid) {
  const r = lcg(seed), on = inBody(grid), starts = seedCells(grid), out = [];
  if (!starts.length) return [];
  for (let i = 0; i < count; i++) {
    let [x, y] = starts[Math.floor(r() * starts.length)];
    let a = r() * Math.PI * 2;
    const pts = [[x, y]];
    for (let s = 0; s < 110; s++) {
      a += rnd(r, -0.9, 0.9);
      const nx = x + Math.cos(a) * 0.75, ny = y + Math.sin(a) * 0.75;
      if (!on(nx, ny)) { a += Math.PI; continue; }
      x = nx; y = ny; pts.push([x, y]);
    }
    out.push(pts);
  }
  return out;
}

/** SPIRAL — one big spiral over the whole figure, plus a counter-rotating one. */
function spiral(seed, _c, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (const dir of [1, -1]) {
    const pts = [], grow = rnd(r, 0.5, 0.8);
    for (let a = 0; a < 15 * Math.PI * 2; a += 0.14) {
      const rad = a * grow / (Math.PI * 2);
      pts.push([b.cx + Math.cos(a * dir) * rad, b.cy + Math.sin(a * dir) * rad * 0.85]);
    }
    out.push(pts);
  }
  return out;
}

/** CELLULAR — nearest-site boundaries. Approximated by sampling, not solved. */
function cellular(seed, count, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  const sites = Array.from({ length: count }, () => [rnd(r, b.x0, b.x1), rnd(r, b.y0, b.y1)]);
  const nearest = (x, y) => {
    let best = 0, bd = Infinity;
    sites.forEach((s, i) => {
      const d = (s[0] - x) ** 2 + (s[1] - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  // walk the box and emit a tick wherever the owning site changes
  for (let y = b.y0; y <= b.y1; y += 0.6) {
    for (let x = b.x0; x <= b.x1; x += 0.6) {
      if (nearest(x, y) !== nearest(x + 0.6, y)) out.push([[x + 0.3, y - 0.3], [x + 0.3, y + 0.3]]);
      if (nearest(x, y) !== nearest(x, y + 0.6)) out.push([[x - 0.3, y + 0.3], [x + 0.3, y + 0.3]]);
    }
  }
  return out;
}

// --- Prismatic: the top rung ------------------------------------------------

/** MESH — every site joined to its near neighbours. A wire frame. */
function mesh(seed, count, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  const pts = Array.from({ length: count }, () => [rnd(r, b.x0, b.x1), rnd(r, b.y0, b.y1)]);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d < 9) out.push([pts[i], pts[j]]);
    }
  }
  return out;
}

/** STARBURST — rays from one centre, every one a different length. */
/**
 * A seeded point inside the figure, biased towards the middle of it.
 *
 * Patterns that fire from a point were picking that point one of two bad ways:
 * hardcoded to the bbox centre, so every token drew the identical burst, or
 * uniformly at random over the silhouette, which put it out on an elbow as
 * often as on the chest. `inset` pulls the sampling window in from the edges,
 * so the origin still moves from token to token but stays on the mass of the
 * figure. Falls back to the centre only if the body is too thin to sample.
 */
function originIn(r, grid, inset) {
  const on = inBody(grid), b = bboxOf(grid);
  const k = inset === undefined ? 0.26 : inset;
  const x0 = b.x0 + b.w * k, x1 = b.x1 - b.w * k;
  const y0 = b.y0 + b.h * k, y1 = b.y1 - b.h * k;
  for (let i = 0; i < 240; i++) {
    const x = rnd(r, x0, x1), y = rnd(r, y0, y1);
    if (on(x, y)) return [x, y];
  }
  return [b.cx, b.cy];
}

function starburst(seed, count, grid) {
  const r = lcg(seed), out = [];
  // Where the rays come FROM is the whole character of a Starburst, so it is
  // rolled per token like everything else rather than pinned to the middle.
  const [ox, oy] = originIn(r, grid);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd(r, -0.04, 0.04);
    const len = rnd(r, 8, 34);
    out.push([[ox, oy], [ox + Math.cos(a) * len, oy + Math.sin(a) * len * 0.9]]);
  }
  return out;
}

/** CASCADE — chevrons nested down the body, each one wider than the last. */
function cascade(seed, _c, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let y = b.y0, k = 0; y <= b.y1 + 10; y += rnd(r, 1.5, 2.6), k++) {
    const w = 3 + k * 1.15;
    out.push([[b.cx - w, y - w * 0.55], [b.cx, y], [b.cx + w, y - w * 0.55]]);
  }
  return out;
}

/** MOIRE — two ring families on offset centres. The interference is the point. */
function moire(seed, _c, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  const off = rnd(r, 3, 7);
  for (const cx of [b.cx - off, b.cx + off]) {
    for (let k = 1; k < 22; k++) out.push(arc(cx, b.cy, k * 1.45, 0, Math.PI * 2, 44));
  }
  return out;
}

/** SHARD — long chords, but every one passes near the centre. Radial fracture. */
function shard(seed, count, grid) {
  const r = lcg(seed), b = bboxOf(grid), out = [];
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, off = rnd(r, -4, 4);
    const px = -Math.sin(a) * off, py = Math.cos(a) * off;
    out.push([[b.cx + px - Math.cos(a) * 40, b.cy + py - Math.sin(a) * 40],
              [b.cx + px + Math.cos(a) * 40, b.cy + py + Math.sin(a) * 40]]);
  }
  return out;
}

const FILLS = {
  'Circuitry': { gen: circuitry, count: 46, arg: 26, width: 1.25, glow: 2.2, pads: true, lift: 1 },
  'Contour':   { gen: contour,   count: 0,  arg: 9,   width: 1.0,  glow: 2.0, lift: 1 },
  'Filament':  { gen: filament,  count: 34, arg: 14,  width: 1.15, glow: 2.4, lift: 1 },
  'Lattice':   { gen: lattice,   count: 0,  arg: 3.1, width: 0.9,  glow: 1.8, lift: 1 },
  'Shatter':   { gen: shatter,   count: 84, arg: 0,   width: 1.7,  glow: 3.9, lift: 1.55 },
  'Cleave':    { gen: cleave,    count: 84, arg: 0,   width: 1.7,  glow: 3.9, lift: 1.55 },
  'Arcflash':  { gen: arcflash,  count: 76, arg: 0,   width: 1.7,  glow: 3.9, lift: 1.55 },
  'Sunder':    { gen: sunder,    count: 52, arg: 0,   width: 1.7,  glow: 3.9, lift: 1.55 },
  'Shiver':    { gen: shiver,    count: 84, arg: 0,   width: 1.7,  glow: 3.9, lift: 1.55 },
  'Nova':      { gen: nova,      count: 96, arg: 0,   width: 1.7,  glow: 3.9, lift: 1.55 },
  'Billiard':  { gen: (s, c, g, b) => P.bounceStrands(s, c, g, b), count: 54, arg: 26, width: 1.3, glow: 2.4, lift: 1 },

  // --- White: rigid, rectilinear -------------------------------------------
  'Weft':      { gen: weft,      count: 0,  arg: 0, width: 1.0,  glow: 1.9, lift: 1 },
  'Barcode':   { gen: barcode,   count: 0,  arg: 0, width: 1.05, glow: 1.9, lift: 1 },
  'Ladder':    { gen: ladder,    count: 0,  arg: 0, width: 1.0,  glow: 1.9, lift: 1 },
  'Stitch':    { gen: stitch,    count: 0,  arg: 0, width: 1.1,  glow: 2.0, lift: 1.1 },
  'Drift':     { gen: drift,     count: 0,  arg: 0, width: 1.05, glow: 2.0, lift: 1 },
  'Chevron':   { gen: chevron,   count: 0,  arg: 0, width: 1.05, glow: 2.1, lift: 1 },

  // --- Green: growth --------------------------------------------------------
  'Sprawl':    { gen: sprawl,    count: 9,  arg: 0, width: 1.15, glow: 2.2, lift: 1.15 },
  'Maze':      { gen: maze,      count: 30, arg: 0, width: 1.2,  glow: 2.1, lift: 1, pads: true },
  'Nest':      { gen: nest,      count: 0,  arg: 9, width: 1.0,  glow: 2.0, lift: 1 },
  'Ripple':    { gen: ripple,    count: 7,  arg: 0, width: 1.0,  glow: 2.0, lift: 1 },
  'Coil':      { gen: coil,      count: 20, arg: 0, width: 1.05, glow: 2.1, lift: 1 },

  // --- Blue: oscillation ----------------------------------------------------
  'Waveform':  { gen: waveform,  count: 0,  arg: 0, width: 1.05, glow: 2.1, lift: 1 },
  'Rings':     { gen: rings,     count: 0,  arg: 0, width: 1.0,  glow: 2.0, lift: 1 },
  'Lissajous': { gen: lissajous, count: 11, arg: 0, width: 1.0,  glow: 2.1, lift: 1 },
  'Pulse':     { gen: pulse,     count: 0,  arg: 0, width: 1.1,  glow: 2.1, lift: 1.1 },
  'Crystal':   { gen: crystal,   count: 19, arg: 0, width: 1.15, glow: 2.3, lift: 1.1 },

  // --- Red: fracture --------------------------------------------------------
  'Hatch':     { gen: hatch,     count: 0,  arg: 0, width: 0.95, glow: 1.9, lift: 1 },
  'Splinter':  { gen: splinter,  count: 150, arg: 0, width: 1.2, glow: 2.3, lift: 1.15 },
  'Tangle':    { gen: tangle,    count: 22, arg: 0, width: 1.0,  glow: 2.1, lift: 1 },
  'Rupture':   { gen: rupture,   count: 5,  arg: 0, width: 1.1,  glow: 2.2, lift: 1.1 },
  'Shear':     { gen: shear,     count: 0,  arg: 0, width: 1.0,  glow: 2.0, lift: 1.2 },

  // --- Prismatic: the top rung ----------------------------------------------
  'Mesh':      { gen: mesh,      count: 46, arg: 0, width: 1.0,  glow: 2.1, lift: 1 },
  'Starburst': { gen: starburst, count: 64, arg: 0, width: 1.05, glow: 2.3, lift: 1.1 },
  'Cascade':   { gen: cascade,   count: 0,  arg: 0, width: 1.15, glow: 2.2, lift: 1.1 },
  'Moire':     { gen: moire,     count: 0,  arg: 0, width: 0.9,  glow: 1.9, lift: 1 },
  'Shard':     { gen: shard,     count: 40, arg: 0, width: 1.3,  glow: 2.8, lift: 1.25 }
};

/**
 * Generate a fill's strands. Composite is the only name that is not a key in
 * FILLS — it resolves to the tier's whole set, so it has to be handled here
 * rather than in the table.
 */
function strandsOf(name, tier, seed, union, mult) {
  const once = (sd) => {
    if (isComposite(name, tier)) {
      return (TIER_FILLS[tier] || TIER_FILLS.Orange).flatMap((n, k) => {
        const f = FILLS[n];
        return f.gen(sd ^ (k * 0x9e37), Math.max(3, Math.round(f.count * 0.5)), union, f.arg);
      });
    }
    const f = FILLS[name] || FILLS.Circuitry;
    return f.gen(sd, f.count, union, f.arg);
  };

  const n = Math.max(1, Math.min(4, mult || 1));
  const first = once(seed ^ 0x51);
  if (n === 1) return first;

  /* Instances after the first are simply RE-SEEDED.
   *
   * An earlier pass translated each instance instead, to force the origins
   * apart. That was a workaround for Starburst firing from a hardcoded centre,
   * and it was the wrong fix twice over: it pushed strands off the silhouette
   * to be clipped away, and it left a 1x Starburst identical on every token.
   * With the origin rolled inside the generator, a fresh sub-seed gives a
   * genuinely different instance — a new origin for the patterns that have
   * one, new angles and spacings for the patterns that do not — and every
   * strand stays where the generator meant to put it.
   */
  const out = first.slice();
  for (let i = 1; i < n; i++) {
    for (const st of once(seed ^ (0x51 + i * 0x9e3779b9))) out.push(st);
  }
  return out;
}

/** Drawing parameters for a fill name, including the synthetic Composite. */
const fillStyle = (name, tier) => isComposite(name, tier)
  ? { width: 1.05, glow: 2.3, lift: 1.1, pads: false }
  : (FILLS[name] || FILLS.Circuitry);

// ----------------------------------------------------------------- mouths ---
/**
 * The mouth.
 *
 * Three 2x2 square vents read as punched holes, not as a face. Every mouth here
 * instead cuts ONE wide slot — so the silhouette still has an obvious opening,
 * which is what makes it read as a mouth at thumbnail size — and then draws
 * glyphs across it in the hot colour. The glyphs give it character; the slot is
 * what makes it legible. It needs both: glyphs alone on solid jaw read as a
 * tattoo, and a slot alone reads as a letterbox.
 */
const MOUTH_ROW = { y: 29.0, h: 3, x0: 22, x1: 34 };

/** One X, as two crossing strokes, rotated about its own centre. */
function xGlyph(cx, cy, s, rot, w) {
  const h = s / 2;
  return '<g transform="rotate(' + f1(rot) + ' ' + f1(cx) + ' ' + f1(cy) + ')">' +
    '<path d="M' + f1(cx - h) + ' ' + f1(cy - h) + 'L' + f1(cx + h) + ' ' + f1(cy + h) +
    'M' + f1(cx - h) + ' ' + f1(cy + h) + 'L' + f1(cx + h) + ' ' + f1(cy - h) +
    '" stroke-width="' + f1(w) + '"/></g>';
}

/**
 * A row of X's across the slot. Every variant is this one function under
 * different jitter: zero jitter is a grill, heavy jitter is static. The size
 * taper is what stops the mouth ending abruptly at its corners.
 */
function xRow(seed, n, opt) {
  const r = lcg(seed), out = [];
  const y = ATY(MOUTH_ROW.y + MOUTH_ROW.h / 2);
  const xa = ATX(MOUTH_ROW.x0 + 0.6), xb = ATX(MOUTH_ROW.x1 - 0.6);
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    const cx = xa + (xb - xa) * f;
    const arch = Math.sin(f * Math.PI) * (opt.arch || 0);
    const taper = opt.taper ? 1 - Math.abs(f - 0.5) * 2 * opt.taper : 1;
    const s = (opt.size || CELL * 1.5) * taper * (1 + rnd(r, -1, 1) * (opt.sizeJit || 0));
    // `alt` flips the lean of every other glyph. Without it a row of X's all
    // tilted the same way reads as one skewed object rather than as teeth —
    // the eye picks up the shared direction before it picks up the shapes.
    const lean = (opt.alt ? (i % 2 ? -opt.alt : opt.alt) : 0);
    const rot = (opt.rot || 0) + lean + rnd(r, -1, 1) * (opt.rotJit || 0);
    out.push(xGlyph(cx, y + arch + rnd(r, -1, 1) * (opt.yJit || 0), s, rot, opt.w || 2.4));
  }
  return out.join('');
}

const HEXG = '0123456789abcdef';

const MOUTHS = {
  /* An even row, no jitter. The cleanest read, and the obvious default.
     Six glyphs across twelve cells: at seven they touch, and a mouth whose
     teeth touch reads as a zip rather than a grill. */
  'Grill':  { cut: [[22, 29, 12, 3]],
              draw: s => xRow(s, 6, { size: CELL * 1.9, w: 3.1, taper: 0.22, alt: 13, rotJit: 7 }) },
  /* Every X at its own angle. Reads as a snarl without drawing teeth. */
  'Static': { cut: [[22, 29, 12, 3]],
              draw: s => xRow(s, 7, { size: CELL * 1.75, w: 2.8, rotJit: 44, sizeJit: 0.28, yJit: 3, taper: 0.18 }) },
  /* Big X at each corner, small ones between: a mouth with fangs. */
  'Fanged': { cut: [[22, 29, 12, 3]],
              draw: s => xRow(s, 5, { size: CELL * 1.8, w: 3.0, taper: -0.5, alt: 22, rotJit: 11, yJit: 2 }) },
  /* X glyphs alternating with hex characters — the hex-dump theme, in the face. */
  'Cipher': { cut: [[22, 29, 12, 3]],
              draw: s => {
                const r = lcg(s), out = [];
                const y = ATY(MOUTH_ROW.y + MOUTH_ROW.h / 2);
                const xa = ATX(MOUTH_ROW.x0 + 0.6), xb = ATX(MOUTH_ROW.x1 - 0.6);
                for (let i = 0; i < 6; i++) {
                  const f = i / 5, cx = xa + (xb - xa) * f;
                  if (i % 2 === 0) out.push(xGlyph(cx, y, CELL * 1.7, rnd(r, -20, 20), 2.9));
                  else out.push('<text x="' + f1(cx) + '" y="' + f1(y + CELL * 0.55) +
                    '" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="' +
                    f1(CELL * 1.5) + '" text-anchor="middle" stroke="none">' +
                    HEXG[Math.floor(r() * 16)] + '</text>');
                }
                return out.join('');
              } },
  /* A dense wall of small X's. Busiest, and the best of them at large sizes. */
  'Weld':   { cut: [[22, 29, 12, 3]],
              draw: s => xRow(s, 11, { size: CELL * 1.25, w: 2.2, rotJit: 30, yJit: 4, taper: 0.28 }) },
  /* No glyphs at all — one bar across the slot. A sealed mask: the rare roll. */
  'Sealed': { cut: [[22, 30, 12, 2]],
              draw: () => '<path d="M' + f1(ATX(22.4)) + ' ' + f1(ATY(31)) +
                          'L' + f1(ATX(33.6)) + ' ' + f1(ATY(31)) + '" stroke-width="5"/>' }
};

// ------------------------------------------------------------------- eyes ---
/**
 * Eyes, as a real trait axis.
 *
 * Three styles already existed in the shipping generator and nobody had ever
 * looked at them side by side, which is why the contact sheets came out with
 * three different faces — that was the `eyes` roll doing its job unannounced,
 * not a bug. Given they are the first thing anyone looks at, the axis deserves
 * more than three entries and deserves to be priced.
 *
 * Every style must fill the SAME 8-cell footprint the X does, or the pair
 * drifts off the figure's centre axis. `EYE_W` is that footprint; a style that
 * wants to look narrower leaves its own margin inside the 8 rather than
 * shrinking the box.
 */
const EW = P.EYE_W, EN = P.EYE_N;

/**
 * Bar thickness for the styles built from bars, and where those bars start.
 *
 * The beam leaves from the centre of the eye box, y0 + EN / 2, and EN is odd --
 * so a bar an EVEN number of cells thick cannot straddle that line. At two
 * cells the slit sat half a cell high and the crosshair's bar sat a cell and a
 * half low, which is why the lasers did not line up across styles. Three cells
 * centre exactly, and read better behind a thicker beam.
 */
const BAR = 3;
const BAR_Y = Math.floor((EN - BAR) / 2);   // vertical placement: centred in EN
const BAR_X = Math.floor((EW - 2) / 2);     // the upright, 2 wide, centred in EW

/**
 * A hollow square ring, ONE cell thick, spanning the whole 8x7 box.
 *
 * The first version used two-cell walls inset by one, which on a box this size
 * left a 2x2 hole — so it rendered as a small solid block with a dot in it and
 * read as neither a ring nor an eye. At one cell the hole is 6x5, which is
 * large enough to read as an aperture rather than a defect. There is not much
 * room to be subtle at eight cells across.
 */
function ringCells(x0, y0) {
  const cells = [];
  for (let i = 0; i < EW; i++) cells.push([x0 + i, y0], [x0 + i, y0 + EN - 1]);
  for (let j = 0; j < EN; j++) cells.push([x0, y0 + j], [x0 + EW - 1, y0 + j]);
  return cells;
}

/**
 * One diagonal instead of two — a slash. Both eyes lean the same way.
 *
 * Thickness is EYE_TH, not 3: a diagonal of EN steps at thickness th spans
 * EN + th - 1 cells, so at 3 it was 9 wide in an 8-wide box and hung half a
 * cell right of the axis. This is the same arithmetic that put the eyes off
 * centre before — see EYE_W.
 */
function slashCells(x0, y0) {
  const cells = [];
  for (let i = 0; i < EN; i++) for (let t = 0; t < P.EYE_TH; t++) cells.push([x0 + i + t, y0 + EN - 1 - i]);
  return cells;
}

/**
 * An X with a two-cell notch knocked out of one arm — a CRACKED X.
 *
 * The first version deleted the whole lower-right quadrant, which does not read
 * as a damaged X, it reads as a Y. Removing a short section from the middle of
 * one arm keeps both diagonals legible while the break stays obvious, which is
 * the difference between "broken" and "a different letter".
 */
function fractureCells(x0, y0) {
  return P.xCells(x0, y0, EN, P.EYE_TH).filter(([x, y]) => {
    const dx = x - x0, dy = y - y0;
    return !(dx >= 4 && dx <= 5 && dy >= 4 && dy <= 5);
  });
}

/** Two stacked bars with a gap: a shuttered visor. */
function shutterCells(x0, y0) {
  const cells = [];
  for (let i = 0; i < EW; i++) {
    cells.push([x0 + i, y0 + 1], [x0 + i, y0 + 2]);
    cells.push([x0 + i, y0 + 4], [x0 + i, y0 + 5]);
  }
  return cells;
}

const EYES = {
  'Graffiti X': (x, y) => P.xCells(x, y, EN, P.EYE_TH),
  'Crosshair':  (x, y) => crossLocal(x, y),
  'Visor Slit': (x, y) => slitLocal(x, y),
  'Fracture':   fractureCells,
  'Shutter':    shutterCells,
  'Ring':       ringCells,
  'Slash':      slashCells
};

// Local copies of the two shipping shapes, drawn at EYE_W so every style in the
// table shares one footprint.
function slitLocal(x0, y0) {
  const cells = [];
  for (let i = 0; i < EW; i++) for (let t = 0; t < BAR; t++) cells.push([x0 + i, y0 + BAR_Y + t]);
  return cells;
}
function crossLocal(x0, y0) {
  const cells = [];
  // The crossbar spans the width and is BAR tall; the upright spans the HEIGHT
  // -- EN, not EW -- and is 2 wide. Deriving each offset from the axis it sits
  // on is what keeps the intersection on the centre the beam leaves from.
  for (let i = 0; i < EW; i++) for (let t = 0; t < BAR; t++) cells.push([x0 + i, y0 + BAR_Y + t]);
  for (let j = 0; j < EN; j++) for (let t = 0; t < 2; t++) cells.push([x0 + BAR_X + t, y0 + j]);
  return cells;
}

/**
 * Every eye style has to sit on the same two lines: the beam leaves from
 * y0 + EN / 2 on every token regardless of style, and the figure's axis is
 * x0 + EW / 2. A style that is not centred on both does not read as "this
 * token has different eyes", it reads as a crooked laser -- which is exactly
 * how Crosshair, Visor Slit and Slash were shipping. Checked rather than
 * commented, because the last three times this drifted it was arithmetic.
 */
function eyeDrift() {
  const out = [];
  for (const name of Object.keys(EYES)) {
    const c = EYES[name](P.EYE_L.x, P.EYE_L.y);
    const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
    const cy = (Math.min(...ys) + Math.max(...ys) + 1) / 2 - P.EYE_L.y;
    const cx = (Math.min(...xs) + Math.max(...xs) + 1) / 2 - P.EYE_L.x;
    const dy = cy - EN / 2, dx = cx - EW / 2;
    if (dy || dx) out.push(name + ' (dy ' + dy + ', dx ' + dx + ')');
  }
  return out;
}

const eyeCellsOf = style => {
  const f = EYES[style] || EYES['Graffiti X'];
  return [...f(P.EYE_L.x, P.EYE_L.y), ...f(P.EYE_R.x, P.EYE_R.y)];
};

/**
 * Drawing the eyes.
 *
 * They were flat #ffffff cells behind a double-merged blur, which at any real
 * size blows out into two white blobs with no structure in them — a sticker on
 * a face rather than light coming through a hole. Three changes:
 *
 *   1. A per-eye RADIAL GRADIENT in user space, white at the centre falling to
 *      the tier colour at the rim. Every cell samples the same gradient, so the
 *      shape holds together while the edges stay coloured and the middle stays
 *      hot. This is the one that does most of the work.
 *   2. A SOCKET behind: a dark disc slightly larger than the eye, so the shape
 *      has something to sit in and the fill does not run straight up to it.
 *   3. A single blur instead of a doubled one, and the cells at 0.94 rather
 *      than 1, so the glow reads as light rather than as bloom.
 *
 * `grade` is the rarity stage — see gradeOf(). At 2 and above the eye gets a
 * charge ring, at 3 it gets orbiting sparks. The rarest tokens should have the
 * best-looking eyes, because the eyes are the first thing anyone looks at.
 */
function eyeSvgFor(cells, C3, hot, uid, grade, animated, seed) {
  const r = lcg(seed ^ 0xe7e5);
  const cx = [ATX(P.EYE_L.x + EW / 2), ATX(P.EYE_R.x + EW / 2)];
  const cy = ATY(P.EYE_L.y + EN / 2);
  const rad = EW * CELL * 0.72;
  const out = [];

  out.push('<defs>');
  cx.forEach((x, i) => {
    out.push('<radialGradient id="eg' + uid + i + '" gradientUnits="userSpaceOnUse" cx="' +
      f1(x) + '" cy="' + f1(cy) + '" r="' + f1(rad) + '">' +
      '<stop offset="0" stop-color="#ffffff"/>' +
      '<stop offset="0.42" stop-color="' + hot + '"/>' +
      '<stop offset="1" stop-color="' + C3.mid + '"/></radialGradient>');
  });
  out.push('</defs>');

  // 2 — the socket
  cx.forEach(x => out.push('<ellipse cx="' + f1(x) + '" cy="' + f1(cy) + '" rx="' + f1(rad * 0.95) +
    '" ry="' + f1(rad * 0.8) + '" fill="#04050a" opacity="0.72" filter="url(#s' + uid + ')"/>'));

  // 1 — the cells, each side sampling its own gradient
  [0, 1].forEach(side => {
    const half = cells.filter(([x]) => (x < P.EYE_R.x) === (side === 0));
    if (!half.length) return;
    out.push('<g fill="url(#eg' + uid + side + ')" opacity="0.94" filter="url(#eglow' + uid + ')">' +
      half.map(([x, y]) => '<rect x="' + f1(ATX(x)) + '" y="' + f1(ATY(y)) + '" width="' +
        f1(CELL) + '" height="' + f1(CELL) + '"/>').join('') + '</g>');
  });

  // the charge ring: Blue and up, so the ring itself is a rank signal
  if (grade >= 2) {
    cx.forEach((x, i) => out.push('<circle cx="' + f1(x) + '" cy="' + f1(cy) + '" r="' + f1(rad * 1.05) +
      '" fill="none" stroke="' + hot + '" stroke-width="1.6" opacity="0.5" stroke-dasharray="6 9">' +
      (animated
        ? '<animateTransform attributeName="transform" type="rotate" from="0 ' + f1(x) + ' ' + f1(cy) +
          '" to="' + (i ? -360 : 360) + ' ' + f1(x) + ' ' + f1(cy) +
          '" dur="14s" repeatCount="indefinite"/>'
        : '') + '</circle>'));
  }

  // orbiting sparks: Red and up. On a four-stage scale this fired at the same
  // place the ring did; over six there is room to separate them.
  if (grade >= 4) {
    cx.forEach((x, i) => {
      for (let k = 0; k < 7; k++) {
        const a = rnd(r, 0, 7), orb = rad * rnd(r, 1.1, 1.5), dur = rnd(r, 3.5, 8);
        out.push('<circle cx="' + f1(x + Math.cos(a) * orb) + '" cy="' + f1(cy + Math.sin(a) * orb * 0.7) +
          '" r="' + f1(rnd(r, 1.4, 3)) + '" fill="#ffffff" opacity="' + f1(rnd(r, 0.4, 0.95)) + '">' +
          (animated
            ? '<animateTransform attributeName="transform" type="rotate" from="0 ' + f1(x) + ' ' + f1(cy) +
              '" to="' + (i ? -360 : 360) + ' ' + f1(x) + ' ' + f1(cy) + '" dur="' + f1(dur) +
              's" repeatCount="indefinite"/>'
            : '') + '</circle>');
      }
    });
  }
  return out.join('');
}

/**
 * The rarity stage of a token, 0 to 5. TIER FIRST, fill second.
 *
 * This used to read only the fill's weight inside its own tier, which meant a
 * White holding its tier's 5% fill and a Red holding ITS tier's 5% fill were
 * staged identically -- a 40,000-supply token wearing the same beam as a
 * 2,500-supply one. Colour is rank, so rank is what has to drive how good a
 * token looks, or the ladder is asking people to burn for a sidegrade.
 *
 * The tier sets a floor and the fill can lift it by one. The floors are spaced
 * so a tier's BEST never beats the next tier up's WORST:
 *
 *   White 0   Orange 0   Green 1   Blue 2   Red 3   Prismatic 4
 *
 * The best Green therefore lands on 2, which TIES a plain Blue and does not
 * pass it. White and Orange share a floor because the two cheapest rungs are
 * where supply is, and separating them costs a stage the top of the ladder
 * needs more.
 *
 * Shatter is the one deliberate exception. At +2 it is the only roll that can
 * carry a low tier past a high one, which is the entire job of a 1% jackpot --
 * and it stays rare enough to be the handful of exceptions rather than a hole
 * in the ladder.
 */
const TIER_GRADE = { White: 0, Orange: 0, Green: 1, Blue: 2, Red: 3, Prismatic: 4 };

const gradeOf = (tier, fill) => {
  const base = TIER_GRADE[tier] === undefined ? 0 : TIER_GRADE[tier];
  const bump = isUniversal(fill, tier) ? 2
             : (isComposite(fill, tier) || fillWeightOf(tier, fill) <= 5) ? 1
             : 0;
  return Math.max(0, Math.min(BEAM_STAGE.length - 1, base + bump));
};

// ------------------------------------------------------------------- beam ---
/**
 * The beam, rebuilt.
 *
 * What was there fired one bar from the LEFT eye across the whole frame, so it
 * crossed the face on its way out and the right eye contributed nothing. Both
 * eyes now fire their own beam, and neither crosses the other.
 *
 * Four layers, outermost first, because a single stroke of any width reads as a
 * bar and not as light:
 *   1. a soft bloom, blurred, to put light in the air around the beam
 *   2. a flare POLYGON, narrow at the eye and wider at the frame edge, so the
 *      beam has perspective instead of being a constant-height rectangle
 *   3. a hot core, thin and near-white
 *   4. scatter — fine lines diverging by a fraction of a degree, plus grit
 *
 * The gradient fading to transparent at the right edge is what stops it looking
 * like a painted stripe: real light falls off, and a beam that reaches the
 * frame edge at full strength reads as a solid object.
 */
/**
 * Beam intensity by rarity stage. Everything scales together — a beam that is
 * only brighter reads as the same beam turned up, while one that is also wider
 * and carries more scatter reads as a different, better beam.
 */
/**
 * Beam intensity by rarity stage. Everything scales together — a beam that is
 * only brighter reads as the same beam turned up, while one that is also wider,
 * arcs harder and throws more debris reads as a different, better beam.
 */
const BEAM_STAGE = [
  { h1: 22, scatter: 8,  grit: 10, core: 4.0, bloom: 0.24, arcs: 1,  rings: 2, packets: 2, embers: 5,  heat: false },
  { h1: 27, scatter: 11, grit: 14, core: 4.6, bloom: 0.30, arcs: 2,  rings: 2, packets: 2, embers: 8,  heat: false },
  { h1: 33, scatter: 15, grit: 19, core: 5.3, bloom: 0.38, arcs: 3,  rings: 3, packets: 3, embers: 13, heat: false },
  { h1: 41, scatter: 21, grit: 26, core: 6.1, bloom: 0.47, arcs: 5,  rings: 4, packets: 4, embers: 19, heat: true },
  { h1: 51, scatter: 29, grit: 35, core: 7.0, bloom: 0.58, arcs: 7,  rings: 5, packets: 5, embers: 27, heat: true },
  { h1: 64, scatter: 40, grit: 48, core: 8.2, bloom: 0.72, arcs: 10, rings: 7, packets: 7, embers: 38, heat: true }
];

/**
 * The beam.
 *
 * The earlier version was a solid rectangle with circles on it, which is why it
 * read as a painted stripe rather than as light. Nothing about a flat bar of
 * uniform colour says "energy": real beams are a CORE that is brighter than its
 * own colour, wrapped in falloff, with the medium reacting around them.
 *
 * So this is built the way a lens actually records one, back to front:
 *
 *   1  HAZE       a wide soft wash — light in the air, not the beam itself
 *   2  CHROMA     two cones offset up and down in different hues. Real optics
 *                 split colour at high-contrast edges; without this the beam
 *                 has one flat hue and immediately reads as a drawing.
 *   3  CONE       the body of the beam, narrow at the eye and flaring out, on
 *                 a gradient that dies before the frame edge. A beam that hits
 *                 the edge at full strength reads as a solid object.
 *   4  SHOCK      elliptical rings travelling outward along the axis
 *   5  ARCS       jagged branches that fork off and decay — the detail that
 *                 does the most work, because straight lines never look
 *                 energetic and crackle always does
 *   6  SCATTER    fine filaments diverging by a fraction of a degree
 *   7  CORE       FOUR nested strokes, widest and dimmest outward, ending in a
 *                 white hairline, each with a slight wobble. The wobble is the
 *                 difference between light and a ruler.
 *   8  PACKETS    bright elongated slugs running the length at speed
 *   9  GRIT       particles riding the beam
 *  10  EMBERS     debris breaking off the far half and drifting
 *  11  MUZZLE     an anamorphic flare at the eye: core, horizontal streak,
 *                 vertical spike, starburst spokes and ghost rings
 *  12  BOUNCE     a warm wash back onto the face, so the beam lights what it
 *                 leaves rather than floating in front of it
 *
 * At grade 2 and up the soft layers run through a turbulence displacement, so
 * the edges shimmer instead of being geometrically clean. It is gated because
 * it is the one genuinely expensive thing here and a contact sheet renders
 * dozens of these at once.
 */
function beam(seed, ink, hot, x0, y0, animated, uid, n, grade, C3, conv) {
  const r = lcg(seed), out = [];
  const g = Math.max(0, Math.min(BEAM_STAGE.length - 1, grade || 0));
  const S = BEAM_STAGE[g];
  const reach = VB - x0 + 60;
  const h0 = 4.2, h1 = S.h1;
  /**
   * Both eyes fire, and both beams travel right — so without help they land on
   * the same line and add up to ONE thick bar, which is the opposite of the
   * point. `conv` offsets a beam vertically AT THE EYE and decays that offset
   * to zero by the far end: two distinct beams leaving the face, converging
   * into one as they go. That convergence is also what real paired emitters
   * look like, so it costs nothing in plausibility.
   */
  const cv = conv || 0;
  const yAt = x => y0 + cv * Math.max(0, 1 - (x - x0) / (reach * 0.75));
  const id = uid + '-' + n;
  const warm = C3 && C3.prism ? C3.prism[1].mid : '#ffb347';
  const cool = C3 && C3.prism ? C3.prism[3].mid : '#4fa8ff';
  const heat = S.heat ? ' filter="url(#heat' + id + ')"' : '';

  // ---------------------------------------------------------------- defs ---
  out.push('<defs>');
  out.push('<linearGradient id="cone' + id + '" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="' + hot + '" stop-opacity="0.95"/>' +
    '<stop offset="0.18" stop-color="' + ink.mid + '" stop-opacity="0.72"/>' +
    '<stop offset="0.62" stop-color="' + ink.mid + '" stop-opacity="0.30"/>' +
    '<stop offset="1" stop-color="' + ink.dim + '" stop-opacity="0"/></linearGradient>');
  out.push('<linearGradient id="core' + id + '" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="#ffffff" stop-opacity="1"/>' +
    '<stop offset="0.5" stop-color="' + hot + '" stop-opacity="0.92"/>' +
    '<stop offset="0.85" stop-color="' + ink.mid + '" stop-opacity="0.45"/>' +
    '<stop offset="1" stop-color="' + ink.mid + '" stop-opacity="0"/></linearGradient>');
  if (S.heat) {
    out.push('<filter id="heat' + id + '" x="-30%" y="-80%" width="160%" height="260%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.016 0.07" numOctaves="2" seed="' +
      (Math.floor(r() * 90) + 1) + '" result="t">' +
      (animated
        ? '<animate attributeName="baseFrequency" values="0.016 0.07;0.022 0.05;0.016 0.07" ' +
          'dur="6s" repeatCount="indefinite"/>'
        : '') + '</feTurbulence>' +
      '<feDisplacementMap in="SourceGraphic" in2="t" scale="' + (7 + g * 3) +
      '" xChannelSelector="R" yChannelSelector="G"/></filter>');
  }
  out.push('</defs>');

  // ------------------------------------------------------------ 1  haze ---
  out.push('<ellipse cx="' + f1(x0 + reach * 0.32) + '" cy="' + f1(y0) +
    '" rx="' + f1(reach * 0.44) + '" ry="' + f1(h1 * 1.25) + '" fill="' + ink.mid +
    '" opacity="' + f1(S.bloom) + '" filter="url(#s' + uid + ')"/>');

  // ---------------------------------------------------------- 2  chroma ---
  // Offset up and down by a couple of units in two different hues. Subtle by
  // design: at any opacity you can consciously see, it stops reading as an
  // optical artefact and starts reading as three beams.
  const yEnd = yAt(x0 + reach);
  const cone = (dy, fill, op) =>
    '<path d="M' + f1(x0) + ' ' + f1(y0 - h0 + dy + cv) + 'L' + f1(x0 + reach) + ' ' + f1(yEnd - h1 + dy) +
    'L' + f1(x0 + reach) + ' ' + f1(yEnd + h1 + dy) + 'L' + f1(x0) + ' ' + f1(y0 + h0 + dy + cv) +
    'Z" fill="' + fill + '" opacity="' + op + '"';
  out.push('<g' + heat + '>');
  out.push(cone(-3.5, warm, 0.20) + '/>');
  out.push(cone(3.5, cool, 0.16) + '/>');

  // ------------------------------------------------------------ 3  cone ---
  out.push(cone(0, 'url(#cone' + id + ')', 0.8) + '/>');
  out.push('</g>');

  // ----------------------------------------------------------- 4  shock ---
  // Rings perpendicular to the axis, travelling out and expanding. They are
  // what make the beam feel like it is being FIRED rather than just existing.
  // Blurred and thin. Hard-stroked they read as bubbles sitting ON the beam
  // rather than as compression travelling through it — the stroke width and
  // the blur are doing more work here than the animation is.
  out.push('<g filter="url(#s' + uid + ')" opacity="0.6">');
  for (let i = 0; i < S.rings; i++) {
    const dur = rnd(r, 1.6, 3.4), begin = -rnd(r, 0, dur);
    const ry0 = h1 * 0.4;
    out.push('<ellipse cx="' + f1(x0) + '" cy="' + f1(yEnd) + '" rx="2" ry="' + f1(ry0) +
      '" fill="none" stroke="' + hot + '" stroke-width="0.9" opacity="0">' +
      (animated
        ? '<animate attributeName="cx" values="' + f1(x0) + ';' + f1(x0 + reach) + '" dur="' +
          f1(dur) + 's" begin="' + f1(begin) + 's" repeatCount="indefinite"/>' +
          '<animate attributeName="ry" values="' + f1(ry0) + ';' + f1(h1 * 1.1) + '" dur="' +
          f1(dur) + 's" begin="' + f1(begin) + 's" repeatCount="indefinite"/>' +
          '<animate attributeName="opacity" values="0;0.8;0" dur="' + f1(dur) +
          's" begin="' + f1(begin) + 's" repeatCount="indefinite"/>'
        : '') + '</ellipse>');
  }
  out.push('</g>');

  // ------------------------------------------------------------ 5  arcs ---
  // A jagged branch leaving the axis and decaying. Each segment is shorter and
  // wanders further than the last, which is what lightning does and what makes
  // the eye accept it as discharge rather than as a squiggle.
  out.push('<g fill="none" stroke="' + hot + '" stroke-linecap="round" opacity="0.85">');
  for (let i = 0; i < S.arcs; i++) {
    const startF = rnd(r, 0.04, 0.55);
    let x = x0 + reach * startF, y = yAt(x0 + reach * startF) + rnd(r, -2, 2);
    // Half the arcs burn steadily and half flicker. All-flicker meant that at
    // any given frame most of them were invisible, so the beam lost exactly the
    // detail the arcs were added to provide.
    const steady = i % 2 === 0;
    const dir = r() < 0.5 ? -1 : 1;
    const pts = [[x, y]];
    let step = rnd(r, 26, 52), spread = rnd(r, 5, 13);
    const segs = 3 + Math.floor(r() * 4);
    for (let k = 0; k < segs; k++) {
      x += step; y += dir * rnd(r, spread * 0.3, spread);
      pts.push([x, y]);
      step *= 0.78; spread *= 1.22;
    }
    const d = 'M' + pts.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L');
    const dur = rnd(r, 0.6, 1.9);
    out.push('<path d="' + d + '" stroke-width="' + f1(rnd(r, 0.9, 2.1)) +
      '" opacity="' + (steady ? '0.6' : '0.85') + '">' +
      (animated
        ? '<animate attributeName="opacity" values="' +
          (steady ? '0.35;0.75;0.45;0.7;0.35' : '0;0.9;0;0;0') + '" dur="' + f1(dur) +
          's" begin="' + f1(-rnd(r, 0, dur)) + 's" repeatCount="indefinite"/>'
        : '') + '</path>');
    // a fork off the last elbow
    if (r() < 0.6 && pts.length > 2) {
      const [bx, by] = pts[pts.length - 2];
      out.push('<path d="M' + f1(bx) + ' ' + f1(by) + 'L' + f1(bx + rnd(r, 14, 40)) + ' ' +
        f1(by + dir * rnd(r, 8, 26)) + '" stroke-width="0.9" opacity="0.5">' +
        (animated
          ? '<animate attributeName="opacity" values="0;0.65;0;0;0" dur="' + f1(dur) +
            's" begin="' + f1(-rnd(r, 0, dur)) + 's" repeatCount="indefinite"/>'
          : '') + '</path>');
    }
  }
  out.push('</g>');

  // --------------------------------------------------------- 6  scatter ---
  out.push('<g fill="none" stroke="' + ink.mid + '" stroke-width="1" opacity="0.5">');
  for (let i = 0; i < S.scatter; i++) {
    const spread = rnd(r, -h1 * 0.9, h1 * 0.9);
    const len = reach * rnd(r, 0.3, 1);
    out.push('<path d="M' + f1(x0) + ' ' + f1(y0 + rnd(r, -1.5, 1.5)) +
      'L' + f1(x0 + len) + ' ' + f1(y0 + spread * (len / reach)) + '"/>');
  }
  out.push('</g>');

  // ------------------------------------------------------------ 7  core ---
  // Four passes. A wobbled polyline rather than a rect, because a perfectly
  // straight edge is the single biggest tell that something was drawn.
  const spine = (amp) => {
    const pts = [];
    for (let x = 0; x <= reach; x += reach / 26) {
      pts.push([x0 + x, yAt(x0 + x) + Math.sin(x * 0.011 + amp * 7) * amp * (0.25 + x / reach)]);
    }
    return 'M' + pts.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L');
  };
  const spineD = spine(1.6);
  // Five passes now, not four. The widest is blurred and sits at low opacity:
  // that is the AURA, light in the air around the beam rather than part of it.
  // Widening the old outermost stroke alone just made a fatter hard-edged bar.
  [[S.core * 5.6, ink.mid, 0.16, true], [S.core * 3.2, ink.mid, 0.34, false],
   [S.core * 1.9, hot, 0.48, false],
   [S.core, 'url(#core' + id + ')', 0.95, false], [S.core * 0.34, '#ffffff', 1, false]]
    .forEach(([w, col, op, soft], i) => {
      out.push('<path d="' + spineD + '" fill="none" stroke="' + col + '" stroke-width="' + f1(w) +
        '" opacity="' + op + '" stroke-linecap="round"' +
        (soft ? ' filter="url(#s' + uid + ')"' : '') + '>' +
        (animated && i > 2
          ? '<animate attributeName="opacity" values="' + op + ';' + Math.min(1, op * 1.15) + ';' +
            (op * 0.82).toFixed(2) + ';' + op + '" dur="' + f1(rnd(r, 0.7, 1.5)) +
            's" repeatCount="indefinite"/>'
          : '') + '</path>');
    });

  // --------------------------------------------------------- 8  packets ---
  for (let i = 0; i < S.packets; i++) {
    const dur = rnd(r, 0.5, 1.3), begin = -rnd(r, 0, dur);
    out.push('<ellipse cx="' + f1(x0) + '" cy="' + f1(y0) + '" rx="' + f1(rnd(r, 18, 46)) +
      '" ry="' + f1(S.core * 0.6) + '" fill="#ffffff" opacity="0">' +
      (animated
        ? '<animate attributeName="cx" values="' + f1(x0) + ';' + f1(x0 + reach) + '" dur="' +
          f1(dur) + 's" begin="' + f1(begin) + 's" repeatCount="indefinite"/>' +
          '<animate attributeName="opacity" values="0;0.9;0.5;0" dur="' + f1(dur) +
          's" begin="' + f1(begin) + 's" repeatCount="indefinite"/>'
        : '') + '</ellipse>');
  }

  // ------------------------------------------------------------ 9  grit ---
  out.push('<g fill="' + hot + '">');
  for (let i = 0; i < S.grit; i++) {
    const y = y0 + rnd(r, -h1 * 0.65, h1 * 0.65), rad = rnd(r, 1, 2.8);
    const dur = rnd(r, 1.2, 4), from = rnd(r, 0, reach);
    out.push('<circle cx="' + f1(x0) + '" cy="' + f1(y) + '" r="' + f1(rad) +
      '" opacity="' + f1(rnd(r, 0.3, 0.9)) + '">' +
      (animated
        ? '<animate attributeName="cx" values="' + f1(x0 + from) + ';' + f1(x0 + reach) +
          '" dur="' + f1(dur) + 's" repeatCount="indefinite"/>' +
          '<animate attributeName="opacity" values="0.9;0" dur="' + f1(dur) +
          's" repeatCount="indefinite"/>'
        : '') + '</circle>');
  }
  out.push('</g>');

  // -------------------------------------------------------- 10  embers ---
  // Debris shedding off the FAR half only, drifting up and out as it dies.
  // It is what stops the beam ending at the frame edge like a cut ribbon.
  out.push('<g fill="' + warm + '">');
  for (let i = 0; i < S.embers; i++) {
    const ex = x0 + reach * rnd(r, 0.45, 1), ey = y0 + rnd(r, -h1, h1);
    const dur = rnd(r, 1.8, 5);
    out.push('<circle cx="' + f1(ex) + '" cy="' + f1(ey) + '" r="' + f1(rnd(r, 0.8, 2.2)) +
      '" opacity="' + f1(rnd(r, 0.3, 0.8)) + '">' +
      (animated
        ? '<animateTransform attributeName="transform" type="translate" values="0 0;' +
          f1(rnd(r, 10, 60)) + ' ' + f1(rnd(r, -46, -12)) + '" dur="' + f1(dur) +
          's" begin="' + f1(-rnd(r, 0, dur)) + 's" repeatCount="indefinite"/>' +
          '<animate attributeName="opacity" values="0.8;0" dur="' + f1(dur) +
          's" begin="' + f1(-rnd(r, 0, dur)) + 's" repeatCount="indefinite"/>'
        : '') + '</circle>');
  }
  out.push('</g>');

  // The muzzle used to be layer 11, here, and was never visible: the eyes are
  // drawn on top of their own beams and the socket behind each eye is a dark
  // ellipse most of 200 units wide, so every bright thing this function put
  // near the pupil was painted over. See muzzle(), which compose() now draws
  // ON TOP of the eyes, at each eye centre.

  // -------------------------------------------------------- 12  bounce ---
  // The beam has to light something. A soft wash back over the face, clipped
  // to nothing so it falls off naturally on the dark ground.
  out.push('<ellipse cx="' + f1(x0 - 26) + '" cy="' + f1(y0) + '" rx="54" ry="30" fill="' +
    hot + '" opacity="0.16" filter="url(#s' + uid + ')"/>');

  return out.join('');
}

// ----------------------------------------------------------------- fields ---
/**
 * The muzzle flare, drawn ON TOP of the eye it belongs to.
 *
 * This is the same flare that used to sit inside beam() as layer 11 - the
 * anamorphic streak, the bloom, the spokes and the ghost rings marching down
 * the barrel. Nothing about it was wrong. It simply could not be seen: the
 * eyes are painted over their own beams so the glyph stays legible, and the
 * socket behind each eye is a dark ellipse nearly 200 units across. Between
 * them they buried everything bright within a full eye-radius of the pupil,
 * so the first part of a beam you could actually see was the point where it
 * cleared the socket - which is why it read as a line starting off to the
 * right of the eye instead of as light leaving it.
 *
 * Centred on the EYE centre, not on the beam origin: the two beams leave
 * +/-conv apart so they converge downrange, but the flare belongs to the eye,
 * and an eye that fires from anywhere other than its middle looks broken.
 */
function muzzle(seed, ink, hot, cx, cy, animated, uid, n, grade, C3) {
  const r = lcg(seed ^ 0x3fa), out = [];
  const g = Math.max(0, Math.min(BEAM_STAGE.length - 1, grade || 0));
  const S = BEAM_STAGE[g];
  const id = 'mz' + uid + '-' + n;
  const reach = VB - cx + 60;
  const warm = C3 && C3.prism ? C3.prism[1].mid : '#ffb347';
  const cool = C3 && C3.prism ? C3.prism[3].mid : '#4fa8ff';
  const mw = 78 + g * 26;
  const arm = 30 + g * 11;      // how far an arm of the X reaches
  const th = S.core * 0.8;      // and how thick it is at the middle

  out.push('<defs><radialGradient id="' + id + '" cx="0.5" cy="0.5" r="0.5">' +
    '<stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>' +
    '<stop offset="0.35" stop-color="' + hot + '" stop-opacity="0.6"/>' +
    '<stop offset="1" stop-color="' + ink.mid + '" stop-opacity="0"/>' +
    '</radialGradient></defs>');

  out.push('<g>');

  // 1  the anamorphic streak: long, thin, horizontal. This one is the BEAM's
  //    own flare rather than anything belonging to the eye, so it stays.
  out.push('<ellipse cx="' + f1(cx) + '" cy="' + f1(cy) + '" rx="' + f1(mw * 1.7) +
    '" ry="' + f1(S.core * 1.5) + '" fill="#ffffff" opacity="0.55" filter="url(#s' + uid + ')"/>');

  // 2  the burst, as an X.
  //    This was a round gradient bloom with eight evenly spaced spokes, which
  //    is a starburst -- and a starburst at this size just reads as a faint
  //    disc sitting on top of the eye. Four arms on the diagonals instead, so
  //    the flare repeats the X the eye is already made of. Three passes per
  //    arm, widest and dimmest underneath, ending near-white in the middle.
  const xArm = (deg, len, thick, col, op, extra) =>
    '<ellipse cx="' + f1(cx) + '" cy="' + f1(cy) + '" rx="' + f1(len) + '" ry="' + f1(thick) +
    '" fill="' + col + '" opacity="' + op + '" transform="rotate(' + deg + ' ' + f1(cx) + ' ' +
    f1(cy) + ')" filter="url(#s' + uid + ')">' + (extra || '') + '</ellipse>';

  const pulse = (a, b) => animated
    ? '<animate attributeName="rx" values="' + f1(a) + ';' + f1(b) + ';' + f1(a) +
      '" dur="1.3s" repeatCount="indefinite"/>'
    : '';

  [45, -45].forEach(deg => {
    out.push(xArm(deg, arm * 1.45, th * 2.2, ink.mid, '0.40', pulse(arm * 1.45, arm * 1.85)));
    out.push(xArm(deg, arm, th * 1.15, hot, '0.75', pulse(arm, arm * 1.3)));
    out.push(xArm(deg, arm * 0.58, th * 0.45, '#ffffff', '0.95', pulse(arm * 0.58, arm * 0.78)));
  });

  // 3  the hot centre. Small and soft enough to read as the point the light
  //    leaves from, not as a disc drawn over the glyph.
  out.push('<ellipse cx="' + f1(cx) + '" cy="' + f1(cy) + '" rx="' + f1(th * 1.5) +
    '" ry="' + f1(th * 1.5) + '" fill="url(#' + id + ')" opacity="0.9" filter="url(#s' + uid + ')"/>');

  // 4  sparks thrown off the X and flying out along its arms. Short segments,
  //    never dots -- a dot at this scale is the circle we just got rid of.
  const DIAG = [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4];
  out.push('<g stroke="#ffffff" stroke-linecap="round" stroke-width="1.6">');
  for (let k = 0; k < 6 + g * 4; k++) {
    const a = DIAG[k % 4] + rnd(r, -0.34, 0.34);
    const d0 = rnd(r, arm * 0.45, arm * 0.95), d1 = rnd(r, arm * 1.9, arm * 3.6);
    const len = rnd(r, 5, 12), dur = rnd(r, 0.9, 2.2), begin = -rnd(r, 0, dur);
    const sx = cx + Math.cos(a) * d0, sy = cy + Math.sin(a) * d0;
    out.push('<line x1="' + f1(sx) + '" y1="' + f1(sy) + '" x2="' + f1(sx + Math.cos(a) * len) +
      '" y2="' + f1(sy + Math.sin(a) * len) + '" opacity="' + (animated ? '0' : '0.5') + '">' +
      (animated
        ? '<animateTransform attributeName="transform" type="translate" values="0 0;' +
          f1(Math.cos(a) * d1) + ' ' + f1(Math.sin(a) * d1) + '" dur="' + f1(dur) +
          's" begin="' + f1(begin) + 's" repeatCount="indefinite"/>' +
          '<animate attributeName="opacity" values="0;0.95;0" dur="' + f1(dur) +
          's" begin="' + f1(begin) + 's" repeatCount="indefinite"/>'
        : '') + '</line>');
  }
  out.push('</g>');

  // 5  ghosts marching down the barrel. Rings before, which for the left eye
  //    landed squarely on the right eye and read as faint circles drawn on the
  //    glyph. X marks instead, same idea, same colours.
  for (let k = 1; k <= 3; k++) {
    const gx = cx + reach * (0.12 * k), gs = 9 + k * 6;
    out.push('<g stroke="' + (k % 2 ? warm : cool) + '" stroke-width="1.2" opacity="' +
      f1(0.3 - k * 0.06) + '" stroke-linecap="round">' +
      '<line x1="' + f1(gx - gs) + '" y1="' + f1(cy - gs) + '" x2="' + f1(gx + gs) + '" y2="' + f1(cy + gs) + '"/>' +
      '<line x1="' + f1(gx - gs) + '" y1="' + f1(cy + gs) + '" x2="' + f1(gx + gs) + '" y2="' + f1(cy - gs) + '"/></g>');
  }
  out.push('</g>');

  return out.join('');
}

/**
 * What sits behind the figure.
 *
 * The old answer was hash rain, everywhere, forever. These follow the same rule
 * it did — generated, not drawn, so a field costs a number rather than an asset
 * — but they are STRUCTURAL rather than weather. A structure behind the head
 * gives the portrait somewhere to be. Falling glyphs only give it texture, and
 * texture is what you notice once and then stop seeing.
 *
 * Each returns { defs, body }, drawn behind the figure and masked off its
 * silhouette by the caller, so the character stays a clean hole in whatever it
 * is standing in.
 */

/**
 * RETICLE — the scope. The obvious one for a collection called Sniper, and the
 * one that makes the figure look aimed at rather than decorated. The rings sit
 * off-centre from the head on purpose: dead-centre would be a bullseye, which
 * is a target, not an instrument.
 */
function fieldReticle(seed, C3, animated) {
  const out = [];
  const cx = ATX(28), cy = ATY(20);
  const ink = inkOf(C3, 0);
  out.push('<g fill="none" stroke="' + ink.mid + '" opacity="0.30">');
  for (const rad of [150, 250, 360, 480, 620]) {
    out.push('<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + rad +
      '" stroke-width="' + (rad === 360 ? 2.2 : 1.1) + '"/>');
  }
  out.push('</g>');
  out.push('<g stroke="' + ink.hot + '" opacity="0.5" stroke-width="2">');
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2, long = i % 4 === 0;
    const r0 = 360, r1 = 360 + (long ? 26 : 12);
    out.push('<path d="M' + f1(cx + Math.cos(a) * r0) + ' ' + f1(cy + Math.sin(a) * r0) +
      'L' + f1(cx + Math.cos(a) * r1) + ' ' + f1(cy + Math.sin(a) * r1) + '"/>');
  }
  if (animated) out.push('<animateTransform attributeName="transform" type="rotate" from="0 ' +
    f1(cx) + ' ' + f1(cy) + '" to="360 ' + f1(cx) + ' ' + f1(cy) +
    '" dur="88s" repeatCount="indefinite"/>');
  out.push('</g>');
  // the crosshair, broken at the centre so it never crosses the face
  out.push('<g stroke="' + ink.mid + '" opacity="0.22" stroke-width="1.6" fill="none">' +
    '<path d="M0 ' + f1(cy) + 'H' + f1(cx - 170) + 'M' + f1(cx + 170) + ' ' + f1(cy) + 'H' + VB + '"/>' +
    '<path d="M' + f1(cx) + ' 0V' + f1(cy - 170) + 'M' + f1(cx) + ' ' + f1(cy + 170) + 'V' + VB + '"/></g>');
  out.push('<g fill="' + ink.mid + '" opacity="0.4" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="15">');
  for (let i = 0; i < 5; i++) {
    out.push('<text x="' + f1(cx + 372) + '" y="' + f1(cy - 200 + i * 100) + '">' + (200 - i * 50) + '</text>');
  }
  out.push('</g>');
  return { defs: '', body: out.join('') };
}

/**
 * MOTES — the drifting lights.
 *
 * These already existed in the art, as sparks around the eyes and grit riding
 * the beam; nobody had ever given them a name or let them off the figure.
 * Moved behind the character and given room, they do the one thing rain never
 * did: imply the figure is somewhere, with air in it. Count is the rarity knob,
 * and it is a knob a buyer can read at thumbnail size.
 */
function fieldMotes(seed, C3, animated, n) {
  const r = lcg(seed), out = [];
  for (let i = 0; i < n; i++) {
    const x = rnd(r, 0, VB), y = rnd(r, 0, VB);
    const rad = rnd(r, 1.6, 5.2), dur = rnd(r, 7, 22);
    const ink = inkOf(C3, i);
    const drift = rnd(r, -46, 46), rise = rnd(r, -70, -22);
    out.push('<circle cx="' + f1(x) + '" cy="' + f1(y) + '" r="' + f1(rad) +
      '" fill="' + (r() < 0.22 ? ink.hot : ink.mid) + '" opacity="' + f1(rnd(r, 0.25, 0.85)) + '">' +
      (animated
        ? '<animateTransform attributeName="transform" type="translate" values="0 0;' +
          f1(drift) + ' ' + f1(rise) + ';0 0" dur="' + f1(dur) + 's" repeatCount="indefinite"/>' +
          '<animate attributeName="opacity" values="0.15;0.9;0.15" dur="' + f1(dur / 2) +
          's" repeatCount="indefinite"/>'
        : '') + '</circle>');
  }
  return { defs: '', body: out.join('') };
}

/**
 * TUNNEL — a floor running to a vanishing point behind the head.
 *
 * The only field with real perspective. Lines converge on a point level with
 * the eyes, so the figure reads as standing in front of something receding
 * rather than pasted onto a pattern. The rings expand outward on staggered
 * clocks, which is what sells the depth — a static version of this is just a
 * spiderweb.
 */
function fieldTunnel(seed, C3, animated) {
  const out = [], ink = inkOf(C3, 0);
  const vx = ATX(28), vy = ATY(20);
  out.push('<g stroke="' + ink.mid + '" fill="none" opacity="0.26" stroke-width="1.2">');
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    out.push('<path d="M' + f1(vx) + ' ' + f1(vy) + 'L' + f1(vx + Math.cos(a) * 1500) +
      ' ' + f1(vy + Math.sin(a) * 1500) + '"/>');
  }
  out.push('</g>');
  out.push('<g stroke="' + ink.hot + '" fill="none" opacity="0.30">');
  for (let k = 1; k <= 11; k++) {
    const rad = Math.pow(k / 11, 2.3) * 980;
    out.push('<circle cx="' + f1(vx) + '" cy="' + f1(vy) + '" r="' + f1(rad) +
      '" stroke-width="' + f1(0.6 + rad / 420) + '">' +
      (animated
        ? '<animate attributeName="r" values="' + f1(rad) + ';' + f1(rad * 1.9) +
          '" dur="9s" begin="' + f1(-k * 0.8) + 's" repeatCount="indefinite"/>' +
          '<animate attributeName="opacity" values="0.55;0" dur="9s" begin="' +
          f1(-k * 0.8) + 's" repeatCount="indefinite"/>'
        : '') + '</circle>');
  }
  out.push('</g>');
  return { defs: '', body: out.join('') };
}

/**
 * SPECTRUM — a level meter across the bottom.
 *
 * Reads as a live readout rather than scenery, which is the one field that ties
 * the portrait back to what the product actually is: a scanner. The bars run on
 * their own clocks so the row never pulses in unison, because a row that pulses
 * together reads as a decoration and a row that does not reads as data.
 */
function fieldSpectrum(seed, C3, animated) {
  const r = lcg(seed), out = [], n = 56, bw = VB / n;
  for (let i = 0; i < n; i++) {
    const ink = inkOf(C3, i);
    const h = rnd(r, 40, 420), dur = rnd(r, 1.1, 3.6);
    out.push('<rect x="' + f1(i * bw + bw * 0.16) + '" y="' + f1(VB - h) +
      '" width="' + f1(bw * 0.68) + '" height="' + f1(h) + '" fill="' + ink.mid + '" opacity="0.62">' +
      (animated
        ? '<animate attributeName="height" values="' + f1(h) + ';' + f1(rnd(r, 30, 520)) + ';' +
          f1(h) + '" dur="' + f1(dur) + 's" repeatCount="indefinite"/>' +
          '<animate attributeName="y" values="' + f1(VB - h) + ';' + f1(rnd(r, 300, 780)) + ';' +
          f1(VB - h) + '" dur="' + f1(dur) + 's" repeatCount="indefinite"/>'
        : '') + '</rect>');
  }
  return { defs: '', body: out.join('') };
}

/**
 * STRATA — horizontal scan bands, drifting upward.
 *
 * The quietest field. Nearly all of the frame stays empty, which is exactly
 * what a very rare token wants: the flex is that nothing is competing with the
 * figure for attention.
 */
function fieldStrata(seed, C3, animated) {
  const r = lcg(seed), out = [], ink = inkOf(C3, 0);
  for (let i = 0; i < 26; i++) {
    const y = rnd(r, 0, VB), h = rnd(r, 1, 7), dur = rnd(r, 14, 40);
    out.push('<rect x="0" y="' + f1(y) + '" width="' + VB + '" height="' + f1(h) +
      '" fill="' + ink.mid + '" opacity="' + f1(rnd(r, 0.08, 0.3)) + '">' +
      (animated
        ? '<animate attributeName="y" values="' + f1(y) + ';' + f1(y - VB) + '" dur="' +
          f1(dur) + 's" repeatCount="indefinite"/>'
        : '') + '</rect>');
  }
  return { defs: '', body: out.join('') };
}

/**
 * RAIN — hash rain, done properly, as the 1% roll.
 *
 * The old version was everywhere, which is exactly what was wrong with it: an
 * effect every token has is wallpaper, and wallpaper is the thing you stop
 * seeing. At one percent it becomes the opposite — the field nobody else has.
 *
 * Three things separate this from the corny version:
 *
 *   1. DROPS, not columns. A column of evenly-lit glyphs running the full
 *      height reads as texture. A drop has a HEAD, and the eye follows heads.
 *   2. The head is near-white and glowing; the tail ramps down to nothing over
 *      its length. That ramp is the whole effect. A tail at constant opacity
 *      is a stripe.
 *   3. Depth. A third of the drops are drawn small and dim on a slower clock,
 *      so the frame has a back and a front instead of one flat plane.
 *
 * Every glyph is re-rolled per token from the seed, so two Rain tokens never
 * spell the same thing — and a few columns spell words instead of counting in
 * hex, which is the detail people screenshot.
 */
const RAIN_GLYPHS = '0123456789abcdef';
const RAIN_WORDS = ['FUCK THE FED', 'RIDE TO ZERO', 'STRAIGHT DEGEN', 'NFT OR BUST', 'SNIPED'];

function fieldRain(seed, C3, animated, drops) {
  const r = lcg(seed), out = [];
  const PITCH = 21, COLS = Math.floor(VB / PITCH);
  const used = new Set();
  const nDrops = drops || 38;

  for (let d = 0; d < nDrops; d++) {
    let col;
    let guard = 0;
    do { col = Math.floor(r() * COLS); } while (used.has(col) && guard++ < 12);
    used.add(col);

    const far = r() < 0.34;                        // the back plane
    const size = far ? rnd(r, 9, 12) : rnd(r, 15, 20);
    const lead = size * 1.12;                      // glyph pitch down the column
    const len = Math.floor(rnd(r, far ? 7 : 10, far ? 13 : 20));
    const dur = (far ? rnd(r, 13, 22) : rnd(r, 5.5, 11));
    const begin = -rnd(r, 0, dur);
    const x = col * PITCH + PITCH / 2;
    const ink = inkOf(C3, d);

    // one column in six spells something instead of counting in hex
    const word = r() < 0.17 ? RAIN_WORDS[Math.floor(r() * RAIN_WORDS.length)].replace(/ /g, '') : null;

    const glyphs = [];
    for (let i = 0; i < len; i++) {
      const y = -len * lead + i * lead;
      const fromHead = len - 1 - i;                // 0 at the head
      const fade = Math.max(0, 1 - fromHead / len);
      const isHead = fromHead === 0;
      const ch = word ? word[(len - 1 - i) % word.length]
                      : RAIN_GLYPHS[Math.floor(r() * 16)];
      // a redacted cell: a solid block over the character
      if (!isHead && r() < 0.09) {
        glyphs.push('<rect x="' + f1(x - size * 0.34) + '" y="' + f1(y - size * 0.72) +
          '" width="' + f1(size * 0.68) + '" height="' + f1(size * 0.78) +
          '" fill="' + ink.mid + '" opacity="' + f1(fade * 0.5) + '"/>');
        continue;
      }
      glyphs.push('<text x="' + f1(x) + '" y="' + f1(y) + '" font-size="' + f1(size) +
        '" fill="' + (isHead ? '#ffffff' : ink.mid) +
        '" opacity="' + f1(isHead ? 0.98 : fade * (far ? 0.42 : 0.72)) + '">' + ch + '</text>');
    }

    out.push('<g font-family="ui-monospace,Menlo,Consolas,monospace" text-anchor="middle"' +
      (far ? '' : ' filter="url(#rainglow)"') + '>' + glyphs.join('') +
      (animated
        ? '<animateTransform attributeName="transform" type="translate" ' +
          'values="0 0;0 ' + f1(VB + len * lead) + '" dur="' + f1(dur) +
          's" begin="' + f1(begin) + 's" repeatCount="indefinite"/>'
        : '<animateTransform attributeName="transform" type="translate" values="0 ' +
          f1(rnd(r, 200, VB)) + '" dur="1s" repeatCount="1" fill="freeze"/>') +
      '</g>');
  }

  const defs = '<filter id="rainglow" x="-60%" y="-20%" width="220%" height="140%">' +
    '<feGaussianBlur stdDeviation="2.2" result="b"/>' +
    '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';

  return { defs, body: out.join('') };
}


/* ===========================================================================
 * SIX NEW FIELDS.
 *
 * What was there: a scope, a tunnel, scan bands, wavelength bars, hash rain,
 * and two densities of DOTS. The dots carry the rarity, which means the axis
 * that is supposed to say "this token is different" is mostly saying "this
 * token has more dots" -- a difference you can only see by counting.
 *
 * All six below are structural. Each one is a different KIND of thing rather
 * than a different amount of the same thing, so any two are told apart in a
 * thumbnail without counting anything. Same contract as the originals:
 * generated from a seed, never an asset, and returning { defs, body }.
 * ======================================================================== */

/**
 * LEDGER -- a candle chart marching across the bottom of the frame.
 *
 * The most on-the-nose field in the set and the only one that says what this
 * collection is about. Bodies and wicks, up in the tier's hot colour and down
 * in its dim one, so the shape of a market is legible without any text.
 */
/**
 * LEDGER -- a candle chart, live.
 *
 * Not a picture of a chart: every body and wick walks to new values on its own
 * clock, so the whole thing is repricing the entire time you look at it. The
 * last-price line drifts with it. Up candles fill, down candles are hollow.
 */
function fieldLedger(seed, C3, animated) {
  const r = lcg(seed), out = [], n = 38, bw = VB / n;
  const clamp = v => Math.max(110, Math.min(890, v));
  let px = rnd(r, 300, 620);

  // grid, scrolling left underneath the candles
  const grid = [];
  for (let k = 0; k < 16; k++) {
    grid.push('<line x1="' + f1(k * (VB / 8)) + '" y1="0" x2="' + f1(k * (VB / 8)) +
      '" y2="' + VB + '" stroke="' + inkOf(C3, 0).dim + '" stroke-width="0.8"/>');
  }
  out.push('<g opacity="0.16">' + grid.join('') +
    (animated
      ? '<animateTransform attributeName="transform" type="translate" values="0 0;' + f1(-VB) +
        ' 0" dur="24s" repeatCount="indefinite"/>'
      : '') + '</g>');

  for (let i = 0; i < n; i++) {
    const ink = inkOf(C3, i);
    const cx = i * bw + bw / 2;
    const o = px, c = clamp(px + rnd(r, -70, 66));
    const up = c < o;
    px = c;

    // three more places this candle will go, and back to where it started
    const a = clamp(c + rnd(r, -110, 110)), b = clamp(c + rnd(r, -110, 110));
    const dur = rnd(r, 2.4, 6.8), begin = -rnd(r, 0, dur);
    const ys = [c, a, b, c].map(v => Math.min(o, v));
    const hs = [c, a, b, c].map(v => Math.max(3, Math.abs(v - o)));
    const wickHi = [c, a, b, c].map(v => Math.min(o, v) - rnd(r, 8, 54));
    const wickLo = [c, a, b, c].map(v => Math.max(o, v) + rnd(r, 8, 54));
    const anim = (attr, vals) => animated
      ? '<animate attributeName="' + attr + '" values="' + vals.map(f1).join(';') + '" dur="' +
        f1(dur) + 's" begin="' + f1(begin) + 's" repeatCount="indefinite"/>'
      : '';

    out.push('<line x1="' + f1(cx) + '" y1="' + f1(wickHi[0]) + '" x2="' + f1(cx) + '" y2="' + f1(wickLo[0]) +
      '" stroke="' + (up ? ink.mid : ink.dim) + '" stroke-width="1.1" opacity="0.5">' +
      anim('y1', wickHi) + anim('y2', wickLo) + '</line>');
    out.push('<rect x="' + f1(cx - bw * 0.3) + '" y="' + f1(ys[0]) + '" width="' + f1(bw * 0.6) +
      '" height="' + f1(hs[0]) + '" fill="' + (up ? ink.mid : 'none') + '" stroke="' + ink.dim +
      '" stroke-width="1" opacity="0.58">' + anim('y', ys) + anim('height', hs) + '</rect>');
  }

  // the last-price line, drifting
  const p0 = rnd(r, 300, 640);
  out.push('<line x1="0" y1="' + f1(p0) + '" x2="' + VB + '" y2="' + f1(p0) + '" stroke="' +
    inkOf(C3, 1).hot + '" stroke-width="1.2" stroke-dasharray="14 10" opacity="0.4">' +
    (animated
      ? '<animate attributeName="y1" values="' + [p0, p0 - 90, p0 + 70, p0].map(f1).join(';') +
        '" dur="17s" repeatCount="indefinite"/>' +
        '<animate attributeName="y2" values="' + [p0, p0 - 90, p0 + 70, p0].map(f1).join(';') +
        '" dur="17s" repeatCount="indefinite"/>'
      : '') + '</line>');
  return { defs: '', body: out.join('') };
}

/**
 * CONTOUR -- topographic lines around an off-centre high point.
 *
 * Each ring turns on its own clock and in its own direction, and breathes in
 * and out on another, so the set never sits still and never moves as a block.
 * The first pass rotated these over two minutes, which is not motion, it is a
 * still image that happens to be different later.
 */
function fieldContour(seed, C3, animated) {
  const r = lcg(seed), out = [];
  // The high point stays near the middle and the rings run past the corners.
  // Letting it wander to 0.2 of the frame left one whole side empty while the
  // other side bunched up -- a map of nothing, badly cropped. The corner of a
  // square frame is 0.71 of its width from the centre, so 17 rings at 0.05
  // each is what it takes to actually reach the edges.
  const hx = VB * rnd(r, 0.44, 0.56), hy = VB * rnd(r, 0.4, 0.52);
  const loops = 17;
  for (let k = 1; k <= loops; k++) {
    const ink = inkOf(C3, k);
    const base = k * (VB * 0.05), amp = base * rnd(r, 0.1, 0.26);
    const ph = rnd(r, 0, 7), lobes = 3 + (k % 4);
    const pts = [];
    for (let a = 0; a < 44; a++) {
      const t = (a / 44) * Math.PI * 2;
      const rr = base + Math.sin(t * lobes + ph) * amp + Math.sin(t * 2 + ph * 1.7) * amp * 0.5;
      pts.push(f1(hx + Math.cos(t) * rr) + ' ' + f1(hy + Math.sin(t) * rr * 0.82));
    }
    const spin = rnd(r, 13, 34), breath = rnd(r, 4.5, 11), sc = rnd(r, 0.06, 0.16);
    // rotate on the outer group, breathe on the inner one: two transforms on
    // one element fight each other, two nested groups do not.
    out.push('<g>' +
      (animated
        ? '<animateTransform attributeName="transform" type="rotate" from="0 ' + f1(hx) + ' ' + f1(hy) +
          '" to="' + (k % 2 ? 360 : -360) + ' ' + f1(hx) + ' ' + f1(hy) + '" dur="' + f1(spin) +
          's" repeatCount="indefinite"/>'
        : '') +
      '<g>' +
      (animated
        ? '<animateTransform attributeName="transform" type="scale" values="1;' + f1(1 + sc) + ';1" ' +
          'dur="' + f1(breath) + 's" begin="' + f1(-rnd(r, 0, breath)) + 's" additive="sum" ' +
          'repeatCount="indefinite"/>'
        : '') +
      '<polygon points="' + pts.join(' ') + '" fill="none" stroke="' +
      (k % 4 === 0 ? ink.mid : ink.dim) + '" stroke-width="' + (k % 4 === 0 ? 1.4 : 0.9) +
      '" opacity="' + f1(0.44 - k * 0.02) + '">' +
      (animated
        ? '<animate attributeName="opacity" values="' + f1(0.44 - k * 0.02) + ';' +
          f1(0.62 - k * 0.02) + ';' + f1(0.44 - k * 0.02) + '" dur="' + f1(breath * 1.3) +
          's" repeatCount="indefinite"/>'
        : '') +
      '</polygon></g></g>');
  }
  return { defs: '', body: out.join('') };
}

/**
 * ECLIPSE -- one enormous disc behind the head, lit only at the rim.
 *
 * The disc is nearly the ground colour, so what you see is the RIM and the
 * head reads as backlit by something huge. The flares turn around it, the rim
 * breathes, and a bright arc runs the circumference on its own clock -- which
 * is the difference between a backlight and a circle someone drew.
 */
function fieldEclipse(seed, C3, animated) {
  const r = lcg(seed);
  const ink = inkOf(C3, 0), ink2 = inkOf(C3, 3);
  // Centred, and only barely jittered. At 0.42-0.58 of the frame the disc sat
  // visibly left of a head that is dead centre, and the halo ran off one edge
  // while leaving a gap at the other -- asymmetric bleed reads as a crop that
  // went wrong. Symmetric bleed reads as a choice, so the disc is allowed to
  // be larger than the frame as long as it is centred in it.
  const cx = VB * rnd(r, 0.49, 0.51), cy = VB * rnd(r, 0.4, 0.44);
  const rad = VB * rnd(r, 0.31, 0.35);
  const id = 'ec' + Math.floor(rnd(r, 1000, 9999));
  const defs =
    '<radialGradient id="' + id + '" cx="0.5" cy="0.5" r="0.5">' +
    '<stop offset="0.74" stop-color="' + ink.dim + '" stop-opacity="0"/>' +
    '<stop offset="0.94" stop-color="' + ink.mid + '" stop-opacity="0.5"/>' +
    '<stop offset="1" stop-color="' + ink.hot + '" stop-opacity="0"/></radialGradient>';
  const out = [];

  // range rings out past the disc, so the corners are not four empty triangles
  for (let k = 1; k <= 4; k++) {
    out.push('<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(rad * (1.25 + k * 0.22)) +
      '" fill="none" stroke="' + ink.dim + '" stroke-width="0.9" opacity="' + f1(0.2 - k * 0.03) +
      '" stroke-dasharray="' + f1(3 + k * 2) + ' ' + f1(16 + k * 5) + '">' +
      (animated
        ? '<animateTransform attributeName="transform" type="rotate" from="0 ' + f1(cx) + ' ' + f1(cy) +
          '" to="' + (k % 2 ? 360 : -360) + ' ' + f1(cx) + ' ' + f1(cy) + '" dur="' + f1(40 + k * 18) +
          's" repeatCount="indefinite"/>'
        : '') + '</circle>');
  }

  // the halo, breathing
  out.push('<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(rad * 1.5) +
    '" fill="url(#' + id + ')" opacity="0.9">' +
    (animated
      ? '<animate attributeName="r" values="' + f1(rad * 1.5) + ';' + f1(rad * 1.72) + ';' +
        f1(rad * 1.5) + '" dur="9s" repeatCount="indefinite"/>' +
        '<animate attributeName="opacity" values="0.7;1;0.7" dur="9s" repeatCount="indefinite"/>'
      : '') + '</circle>');

  out.push('<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(rad) +
    '" fill="#03040a" stroke="' + ink.mid + '" stroke-width="1.6" opacity="0.92"/>');
  out.push('<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(rad * 1.02) +
    '" fill="none" stroke="' + ink.hot + '" stroke-width="0.9" opacity="0.55">' +
    (animated
      ? '<animate attributeName="opacity" values="0.3;0.8;0.3" dur="3.6s" repeatCount="indefinite"/>'
      : '') + '</circle>');

  // a bright arc running the rim
  const circ = 2 * Math.PI * rad;
  out.push('<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(rad * 1.02) +
    '" fill="none" stroke="' + ink.hot + '" stroke-width="2.4" opacity="0.8" stroke-linecap="round" ' +
    'stroke-dasharray="' + f1(circ * 0.12) + ' ' + f1(circ * 0.88) + '">' +
    (animated
      ? '<animate attributeName="stroke-dashoffset" values="0;' + f1(-circ) +
        '" dur="11s" repeatCount="indefinite"/>'
      : '') + '</circle>');

  // flares standing off the rim, turning with it
  const fl = [];
  for (let k = 0; k < 20; k++) {
    const a = rnd(r, 0, Math.PI * 2), len = rnd(r, 14, 84);
    fl.push('<line x1="' + f1(cx + Math.cos(a) * rad) + '" y1="' + f1(cy + Math.sin(a) * rad) +
      '" x2="' + f1(cx + Math.cos(a) * (rad + len)) + '" y2="' + f1(cy + Math.sin(a) * (rad + len)) +
      '" stroke="' + ink2.mid + '" stroke-width="1" opacity="' + f1(rnd(r, 0.18, 0.45)) + '">' +
      (animated
        ? '<animate attributeName="opacity" values="0.1;' + f1(rnd(r, 0.4, 0.75)) +
          ';0.1" dur="' + f1(rnd(r, 2, 6)) + 's" begin="' + f1(-rnd(r, 0, 5)) +
          's" repeatCount="indefinite"/>'
        : '') + '</line>');
  }
  out.push('<g>' +
    (animated
      ? '<animateTransform attributeName="transform" type="rotate" from="0 ' + f1(cx) + ' ' + f1(cy) +
        '" to="360 ' + f1(cx) + ' ' + f1(cy) + '" dur="26s" repeatCount="indefinite"/>'
      : '') + fl.join('') + '</g>');

  return { defs: defs, body: out.join('') };
}

/**
 * INTERFERENCE -- two line gratings at a few degrees to each other.
 *
 * Nothing here is drawn as a pattern: the bands are moire, produced by the two
 * spacings beating against one another. Sliding one grating by exactly one gap
 * loops seamlessly and walks the beat across the whole frame, which is far more
 * motion than the geometry has any right to produce.
 */
function fieldInterference(seed, C3, animated) {
  const r = lcg(seed), out = [];
  const ink = inkOf(C3, 0), ink2 = inkOf(C3, 2);
  const a1 = rnd(r, -8, 8), a2 = a1 + rnd(r, 4, 9);
  const bars = (gap, col) => {
    const g = [];
    for (let y = -VB; y < VB * 2; y += gap) {
      g.push('<line x1="' + f1(-VB) + '" y1="' + f1(y) + '" x2="' + f1(VB * 2) + '" y2="' + f1(y) +
        '" stroke="' + col + '" stroke-width="1.5"/>');
    }
    return g.join('');
  };
  const slide = (gap, dur, dir) => animated
    ? '<animateTransform attributeName="transform" type="translate" values="0 0;0 ' +
      f1(dir * gap) + '" dur="' + f1(dur) + 's" repeatCount="indefinite"/>'
    : '';

  out.push('<g opacity="0.32" transform="rotate(' + f1(a1) + ' ' + f1(VB / 2) + ' ' + f1(VB / 2) + ')">' +
    '<g>' + slide(11, 3.1, 1) + bars(11, ink.dim) + '</g></g>');

  out.push('<g opacity="0.28" transform="rotate(' + f1(a2) + ' ' + f1(VB / 2) + ' ' + f1(VB / 2) + ')">' +
    '<g>' + slide(13, 4.3, -1) + bars(13, ink2.mid) + '</g></g>');

  return { defs: '', body: out.join('') };
}

/**
 * TRUSS -- structural steel, tracking past behind the head.
 *
 * The bay layout is built twice, side by side, and the pair slides left by
 * exactly one frame width before repeating -- so the structure runs forever
 * with no seam. Eight bays, not seven: the diagonals alternate per bay, so an
 * odd count would flip their direction at the wrap and show the join.
 */
function fieldTruss(seed, C3, animated) {
  const r = lcg(seed);
  const bays = 8, bay = VB / bays;
  // Chords near the edges: at 0.12/0.82 the structure floated in the middle
  // with empty bands above and below it, which is the look of a graphic pasted
  // on rather than a frame the figure is standing inside.
  const top = VB * rnd(r, 0.05, 0.1), bot = VB * rnd(r, 0.9, 0.95);
  const ink = inkOf(C3, 0);
  const lit = [];
  for (let k = 0; k < bays * 2 + 2; k++) lit.push(r() < 0.24);

  const bank = (xo) => {
    const g = [];
    g.push('<line x1="' + f1(xo) + '" y1="' + f1(top) + '" x2="' + f1(xo + VB) + '" y2="' + f1(top) + '"/>');
    g.push('<line x1="' + f1(xo) + '" y1="' + f1(bot) + '" x2="' + f1(xo + VB) + '" y2="' + f1(bot) + '"/>');
    for (let i = 0; i < bays; i++) {
      const x = xo + i * bay;
      g.push('<line x1="' + f1(x) + '" y1="' + f1(top) + '" x2="' + f1(x) + '" y2="' + f1(bot) + '"/>');
      const up = i % 2 === 0;
      g.push('<line x1="' + f1(x) + '" y1="' + f1(up ? bot : top) + '" x2="' + f1(x + bay) +
        '" y2="' + f1(up ? top : bot) + '"/>');
    }
    return g.join('');
  };

  const plates = (xo, off) => {
    const g = [];
    for (let i = 0; i < bays; i++) {
      [top, bot].forEach((y, k) => {
        const on = lit[(i + off + k) % lit.length];
        g.push('<rect x="' + f1(xo + i * bay - 4) + '" y="' + f1(y - 4) + '" width="8" height="8" opacity="' +
          f1(on ? 0.8 : 0.3) + '">' +
          (animated && on
            ? '<animate attributeName="opacity" values="0.25;0.9;0.25" dur="' + f1(rnd(r, 1.6, 4.5)) +
              's" begin="' + f1(-rnd(r, 0, 4)) + 's" repeatCount="indefinite"/>'
            : '') + '</rect>');
      });
    }
    return g.join('');
  };

  const scroll = animated
    ? '<animateTransform attributeName="transform" type="translate" values="0 0;' + f1(-VB) +
      ' 0" dur="' + f1(rnd(r, 26, 40)) + 's" repeatCount="indefinite"/>'
    : '';

  const out = [];
  out.push('<g>' + scroll +
    '<g stroke="' + ink.dim + '" stroke-width="1.5" opacity="0.36" fill="none">' +
    bank(0) + bank(VB) + '</g>' +
    '<g fill="' + ink.mid + '">' + plates(0, 0) + plates(VB, 0) + '</g></g>');

  // inspection lights running the chords, against the scroll
  [top, bot].forEach((y, k) => {
    const dur = rnd(r, 5, 9);
    out.push('<rect x="' + f1(-140) + '" y="' + f1(y - 1.5) + '" width="140" height="3" fill="' +
      ink.hot + '" opacity="0.55">' +
      (animated
        ? '<animateTransform attributeName="transform" type="translate" values="0 0;' + f1(VB + 280) +
          ' 0" dur="' + f1(dur) + 's" begin="' + f1(-rnd(r, 0, dur)) + 's" repeatCount="indefinite"/>'
        : '') + '</rect>');
  });

  return { defs: '', body: out.join('') };
}

/**
 * DATASTREAM -- ticker tape, running right across the whole frame.
 *
 * More rows and quicker than the first pass, which crawled. Rain falls and
 * reads as weather; this runs horizontally, which reads as a WIRE -- and it is
 * the one field whose motion agrees with the direction the beams travel.
 */
function fieldDatastream(seed, C3, animated) {
  const r = lcg(seed), out = [], rows = 34;
  for (let i = 0; i < rows; i++) {
    const y = (i + 0.5) * (VB / rows) + rnd(r, -4, 4);
    const ink = inkOf(C3, i);
    const runs = 3 + Math.floor(rnd(r, 0, 3));
    const dur = rnd(r, 2.6, 8), dir = r() < 0.18 ? -1 : 1;
    for (let k = 0; k < runs; k++) {
      const x = rnd(r, -260, VB), len = rnd(r, 26, 210);
      const h = rnd(r, 1.4, 3.6);
      out.push('<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(len) + '" height="' + f1(h) +
        '" fill="' + (r() < 0.22 ? ink.hot : ink.mid) + '" opacity="' + f1(rnd(r, 0.3, 0.78)) + '">' +
        (animated
          ? '<animateTransform attributeName="transform" type="translate" values="' +
            f1(dir * -(VB + 300)) + ' 0;' + f1(dir * (VB + 300)) + ' 0" dur="' + f1(dur) +
            's" begin="' + f1(-rnd(r, 0, dur)) + 's" repeatCount="indefinite"/>'
          : '') + '</rect>');
    }
  }
  return { defs: '', body: out.join('') };
}


/**
 * MONOLITH -- slabs at three depths, tracking past at three speeds.
 *
 * The only field built on PARALLAX rather than on a pattern. Far slabs are
 * dim, narrow and slow; near ones are dark, wide and quick, and pass in front.
 * Depth is what the other fields do not have: every one of them is a flat
 * texture at a single distance, which is why they read as wallpaper. Each
 * layer is drawn twice and slides by exactly one frame width, so it repeats
 * with no seam.
 */
function fieldMonolith(seed, C3, animated) {
  const r = lcg(seed), out = [];
  const LAYERS = [
    { n: 9,  wLo: 46, wHi: 96,  hLo: 0.42, hHi: 0.78, dur: 46, op: 0.3,  lit: 0.5 },
    { n: 7,  wLo: 74, wHi: 150, hLo: 0.55, hHi: 0.9,  dur: 30, op: 0.52, lit: 0.34 },
    { n: 5,  wLo: 110, wHi: 210, hLo: 0.72, hHi: 1.02, dur: 18, op: 0.9, lit: 0.2 }
  ];

  LAYERS.forEach((L, li) => {
    const ink = inkOf(C3, li);
    const slabs = [];
    for (let i = 0; i < L.n; i++) {
      const w = rnd(r, L.wLo, L.wHi);
      const h = VB * rnd(r, L.hLo, L.hHi);
      const x = (i / L.n) * VB + rnd(r, -22, 22);
      const y = VB - h;
      // far slabs are lit shapes, near ones are dark cutouts with a lit edge
      const dark = li === 2;
      slabs.push('<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(w) + '" height="' + f1(h) +
        '" fill="' + (dark ? '#04050a' : ink.dim) + '" opacity="' + f1(dark ? 0.94 : 0.5) + '"/>');
      slabs.push('<line x1="' + f1(x) + '" y1="' + f1(y) + '" x2="' + f1(x + w) + '" y2="' + f1(y) +
        '" stroke="' + ink.mid + '" stroke-width="' + (dark ? 2 : 1.2) + '" opacity="0.8"/>');
      slabs.push('<line x1="' + f1(x) + '" y1="' + f1(y) + '" x2="' + f1(x) + '" y2="' + VB +
        '" stroke="' + ink.dim + '" stroke-width="1" opacity="0.5"/>');
      // windows
      const cols = Math.max(1, Math.floor(w / 26));
      const rows = Math.max(2, Math.floor(h / 46));
      for (let c = 0; c < cols; c++) for (let q = 0; q < rows; q++) {
        if (r() > L.lit) continue;
        const wx = x + 8 + c * 26, wy = y + 14 + q * 46;
        if (wx + 10 > x + w || wy + 16 > VB) continue;
        const dur = rnd(r, 2.5, 9);
        slabs.push('<rect x="' + f1(wx) + '" y="' + f1(wy) + '" width="10" height="16" fill="' +
          (r() < 0.2 ? ink.hot : ink.mid) + '" opacity="' + f1(rnd(r, 0.3, 0.8)) + '">' +
          (animated
            ? '<animate attributeName="opacity" values="0.12;0.85;0.12" dur="' + f1(dur) +
              's" begin="' + f1(-rnd(r, 0, dur)) + 's" repeatCount="indefinite"/>'
            : '') + '</rect>');
      }
    }
    const band = slabs.join('');
    out.push('<g opacity="' + L.op + '">' +
      (animated
        ? '<animateTransform attributeName="transform" type="translate" values="0 0;' + f1(-VB) +
          ' 0" dur="' + L.dur + 's" repeatCount="indefinite"/>'
        : '') +
      '<g>' + band + '</g><g transform="translate(' + VB + ' 0)">' + band + '</g></g>');
  });

  return { defs: '', body: out.join('') };
}

/**
 * DEPTH -- an order book, seen side on.
 *
 * Cumulative bids climbing from the left, asks climbing from the right, and
 * the spread between them held open in the middle -- which is exactly where
 * the figure stands, so the background frames it instead of running behind it.
 * The steps re-fill on their own clocks and the mid price walks, so the book
 * is being worked the whole time. Ledger drew the same subject as a picture of
 * a chart; this one draws it as a mechanism.
 */
function fieldDepth(seed, C3, animated) {
  const r = lcg(seed), out = [];
  const steps = 16, gap = VB * 0.1;
  const half = (VB - gap) / 2;
  const base = VB * 0.97;

  const side = (dir) => {
    const ink = inkOf(C3, dir > 0 ? 1 : 3);
    const x0 = dir > 0 ? VB / 2 + gap / 2 : VB / 2 - gap / 2;
    const pts = ['' + f1(x0) + ' ' + f1(base)];
    const tops = [];
    let cum = 0;
    for (let i = 0; i < steps; i++) {
      cum += rnd(r, 0.02, 0.1);
      const y = base - Math.min(0.82, cum) * VB * 0.8;
      const xa = x0 + dir * (i / steps) * half;
      const xb = x0 + dir * ((i + 1) / steps) * half;
      pts.push(f1(xa) + ' ' + f1(y), f1(xb) + ' ' + f1(y));
      tops.push([xa, xb, y]);
    }
    pts.push(f1(x0 + dir * half) + ' ' + f1(base));
    const g = [];
    g.push('<polygon points="' + pts.join(' ') + '" fill="' + ink.dim + '" opacity="0.22"/>');
    // the lit step edges, each one re-filling on its own clock
    tops.forEach(([xa, xb, y], i) => {
      const dur = rnd(r, 2.8, 7.5), alt = y + rnd(r, -46, 46);
      g.push('<line x1="' + f1(xa) + '" y1="' + f1(y) + '" x2="' + f1(xb) + '" y2="' + f1(y) +
        '" stroke="' + (i % 4 === 0 ? ink.hot : ink.mid) + '" stroke-width="' + (i % 4 === 0 ? 2 : 1.3) +
        '" opacity="0.75">' +
        (animated
          ? '<animate attributeName="y1" values="' + f1(y) + ';' + f1(alt) + ';' + f1(y) + '" dur="' +
            f1(dur) + 's" begin="' + f1(-rnd(r, 0, dur)) + 's" repeatCount="indefinite"/>' +
            '<animate attributeName="y2" values="' + f1(y) + ';' + f1(alt) + ';' + f1(y) + '" dur="' +
            f1(dur) + 's" begin="' + f1(-rnd(r, 0, dur)) + 's" repeatCount="indefinite"/>'
          : '') + '</line>');
    });
    return g.join('');
  };

  // faint price rules behind the book
  for (let k = 1; k < 7; k++) {
    out.push('<line x1="0" y1="' + f1(base - k * (VB * 0.13)) + '" x2="' + VB + '" y2="' +
      f1(base - k * (VB * 0.13)) + '" stroke="' + inkOf(C3, 0).dim +
      '" stroke-width="0.8" opacity="0.14"/>');
  }

  out.push(side(-1));
  out.push(side(1));

  // the mid, walking inside the spread
  const mx = VB / 2;
  out.push('<line x1="' + f1(mx) + '" y1="' + f1(VB * 0.12) + '" x2="' + f1(mx) + '" y2="' + f1(base) +
    '" stroke="' + inkOf(C3, 2).hot + '" stroke-width="1.4" stroke-dasharray="10 12" opacity="0.45">' +
    (animated
      ? '<animateTransform attributeName="transform" type="translate" values="0 0;' + f1(gap * 0.42) +
        ' 0;' + f1(-gap * 0.42) + ' 0;0 0" dur="19s" repeatCount="indefinite"/>'
      : '') + '</line>');

  return { defs: '', body: out.join('') };
}

/**
 * AURORA -- curtains of light, with rays in them.
 *
 * The first pass was soft-edged and nothing else: wide blurred ribbons that
 * read as a gradient someone had smudged. Soft is not the same as detailed,
 * and Blue is the fourth rung of six -- it has to hold up against a Red.
 *
 * So the curtain is built in three passes now. A far bank, heavily blurred and
 * slow, for depth. A near bank of gradient ribbons for the body. And inside
 * every near ribbon, RAYS: a dozen thin bright strokes following the same
 * spline as the ribbon itself, each shimmering on its own clock. The rays are
 * the detail -- a real aurora is not a wash, it is a vertical structure lit
 * from the bottom, and the eye reads those strands immediately.
 *
 * Still the only field in the set with no straight line anywhere in it.
 */
function fieldAurora(seed, C3, animated) {
  const r = lcg(seed), out = [], defs = [];
  const uid = 'au' + Math.floor(rnd(r, 1000, 9999));

  defs.push('<filter id="' + uid + 'far" x="-40%" y="-20%" width="180%" height="140%">' +
    '<feGaussianBlur stdDeviation="26"/></filter>');
  defs.push('<filter id="' + uid + 'near" x="-40%" y="-20%" width="180%" height="140%">' +
    '<feGaussianBlur stdDeviation="11"/></filter>');
  defs.push('<filter id="' + uid + 'ray" x="-40%" y="-20%" width="180%" height="140%">' +
    '<feGaussianBlur stdDeviation="2.2"/></filter>');

  // one gradient per strand index, plus a hotter one for the rays
  for (let i = 0; i < 6; i++) {
    const ink = inkOf(C3, i);
    defs.push('<linearGradient id="' + uid + 'b' + i + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + ink.mid + '" stop-opacity="0"/>' +
      '<stop offset="0.26" stop-color="' + ink.mid + '" stop-opacity="0.8"/>' +
      '<stop offset="0.66" stop-color="' + ink.hot + '" stop-opacity="0.55"/>' +
      '<stop offset="1" stop-color="' + ink.dim + '" stop-opacity="0"/></linearGradient>');
    defs.push('<linearGradient id="' + uid + 'r' + i + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#ffffff" stop-opacity="0"/>' +
      '<stop offset="0.2" stop-color="#ffffff" stop-opacity="0.5"/>' +
      '<stop offset="0.55" stop-color="' + ink.hot + '" stop-opacity="0.95"/>' +
      '<stop offset="1" stop-color="' + ink.mid + '" stop-opacity="0"/></linearGradient>');
  }

  /* The spine every part of one curtain follows. The ribbon body, its lit
     lower edge and all of its rays are offsets of THIS curve, which is what
     keeps a curtain reading as one object instead of as a bundle. */
  const spine = (x, bend, bend2, top, bot) =>
    'M' + f1(x) + ' ' + f1(top) +
    'C' + f1(x + bend) + ' ' + f1(VB * 0.32) + ' ' + f1(x + bend2) + ' ' + f1(VB * 0.66) + ' ' +
    f1(x + bend * 0.3) + ' ' + f1(bot);

  const curtain = (i, x, w, bend, bend2, top, bot, gi, rays, blur, op) => {
    const g = [];
    const d0 = spine(x, bend, bend2, top, bot);
    const d1 = spine(x + w, bend, bend2, top, bot);
    // body: the area between the two edges of the same curve
    const area = d0 + 'L' + d1.slice(1).replace(/^([-\d.]+) ([-\d.]+)C/, '$1 $2C');
    g.push('<path d="' + d0 +
      'L' + f1(x + w + bend * 0.3) + ' ' + f1(bot) +
      'C' + f1(x + w + bend2) + ' ' + f1(VB * 0.66) + ' ' + f1(x + w + bend) + ' ' + f1(VB * 0.32) + ' ' +
      f1(x + w) + ' ' + f1(top) + 'Z" fill="url(#' + uid + 'b' + gi + ')" opacity="' + f1(op) +
      '" filter="url(#' + blur + ')"/>');

    // rays: thin strokes on the same spline, spread across the width
    for (let k = 0; k < rays; k++) {
      const off = w * ((k + 0.5) / rays) + rnd(r, -2.5, 2.5);
      const dur = rnd(r, 2.4, 7.5);
      g.push('<path d="' + spine(x + off, bend, bend2, top, bot) + '" fill="none" stroke="url(#' +
        uid + 'r' + gi + ')" stroke-width="' + f1(rnd(r, 0.9, 2.6)) + '" opacity="' +
        f1(rnd(r, 0.25, 0.7)) + '" filter="url(#' + uid + 'ray)">' +
        (animated
          ? '<animate attributeName="opacity" values="0.08;' + f1(rnd(r, 0.55, 0.95)) +
            ';0.08" dur="' + f1(dur) + 's" begin="' + f1(-rnd(r, 0, dur)) +
            's" repeatCount="indefinite"/>'
          : '') + '</path>');
    }
    return g.join('');
  };

  // --- far bank: depth, slow, very blurred ---------------------------------
  for (let i = 0; i < 5; i++) {
    const x = (i + 0.5) * (VB / 5) + rnd(r, -60, 60);
    const sway = rnd(r, 26, 48);
    out.push('<g opacity="0.5">' +
      (animated
        ? '<animateTransform attributeName="transform" type="translate" values="0 0;' +
          f1(rnd(r, 30, 90) * (r() < 0.5 ? -1 : 1)) + ' 0;0 0" dur="' + f1(sway) +
          's" begin="' + f1(-rnd(r, 0, sway)) + 's" repeatCount="indefinite"/>'
        : '') +
      curtain(i, x, rnd(r, 70, 160), rnd(r, -150, 150), rnd(r, -120, 120),
        rnd(r, -80, 60), VB + rnd(r, -60, 80), i % 6, 0, uid + 'far', rnd(r, 0.25, 0.45)) +
      '</g>');
  }

  // --- near bank: the body, and the rays that carry the detail -------------
  for (let i = 0; i < 9; i++) {
    const x = (i + 0.5) * (VB / 9) + rnd(r, -34, 34);
    const w = rnd(r, 30, 86);
    const sway = rnd(r, 12, 26);
    out.push('<g>' +
      (animated
        ? '<animateTransform attributeName="transform" type="translate" values="0 0;' +
          f1(rnd(r, 22, 70) * (r() < 0.5 ? -1 : 1)) + ' 0;0 0" dur="' + f1(sway) +
          's" begin="' + f1(-rnd(r, 0, sway)) + 's" repeatCount="indefinite"/>'
        : '') +
      curtain(i, x, w, rnd(r, -120, 120), rnd(r, -95, 95),
        rnd(r, -60, 90), VB + rnd(r, -80, 60), i % 6,
        4 + Math.floor(rnd(r, 0, 8)), uid + 'near', rnd(r, 0.4, 0.78)) +
      '</g>');
  }

  // --- the corona: a soft brightening across the top of the curtains -------
  out.push('<rect x="0" y="' + f1(VB * 0.06) + '" width="' + VB + '" height="' + f1(VB * 0.22) +
    '" fill="url(#' + uid + 'b0)" opacity="0.3" filter="url(#' + uid + 'far)">' +
    (animated
      ? '<animate attributeName="opacity" values="0.14;0.42;0.14" dur="13s" repeatCount="indefinite"/>'
      : '') + '</rect>');

  return { defs: defs.join(''), body: out.join('') };
}

/**
 * FOUNDRY -- molten metal, poured.
 *
 * Ledger and Depth were both charts, and a chart is a diagram: it is read
 * rather than looked at, and it never stops being a picture of information.
 * This is the opposite -- no data, no structure, nothing to decode. Bands of
 * melt running the width of the frame, pours falling through them, sparks
 * coming off the splash, and the whole field distorted by its own heat.
 *
 * Orange earns this one. It is the only rung whose colour is already the
 * colour of the subject, so the field and the figure agree without the
 * background having to borrow anything.
 */
function fieldFoundry(seed, C3, animated) {
  const r = lcg(seed), out = [], defs = [];
  const uid = 'fo' + Math.floor(rnd(r, 1000, 9999));
  const ink = inkOf(C3, 0), ink2 = inkOf(C3, 1);

  // heat shimmer over the whole field
  defs.push('<filter id="' + uid + 'h" x="-10%" y="-10%" width="120%" height="120%">' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.009 0.042" numOctaves="2" seed="' +
    Math.floor(rnd(r, 1, 90)) + '" result="t">' +
    (animated
      ? '<animate attributeName="baseFrequency" values="0.009 0.042;0.014 0.03;0.009 0.042" ' +
        'dur="11s" repeatCount="indefinite"/>'
      : '') + '</feTurbulence>' +
    '<feDisplacementMap in="SourceGraphic" in2="t" scale="16" xChannelSelector="R" yChannelSelector="G"/>' +
    '</filter>');

  defs.push('<linearGradient id="' + uid + 'b" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="' + ink.dim + '" stop-opacity="0"/>' +
    '<stop offset="0.3" stop-color="' + ink.mid + '" stop-opacity="0.9"/>' +
    '<stop offset="0.62" stop-color="' + ink.hot + '" stop-opacity="1"/>' +
    '<stop offset="1" stop-color="' + ink.dim + '" stop-opacity="0"/></linearGradient>');

  defs.push('<filter id="' + uid + 'g" x="-30%" y="-200%" width="160%" height="500%">' +
    '<feGaussianBlur stdDeviation="9"/></filter>');

  out.push('<g filter="url(#' + uid + 'h)">');

  // 1  bands of melt, drifting and breathing
  for (let i = 0; i < 6; i++) {
    const y = VB * (0.12 + i * 0.15) + rnd(r, -26, 26);
    const h = rnd(r, 10, 34);
    const dur = rnd(r, 9, 22);
    out.push('<rect x="' + f1(-VB * 0.2) + '" y="' + f1(y) + '" width="' + f1(VB * 1.4) +
      '" height="' + f1(h) + '" fill="url(#' + uid + 'b)" opacity="' + f1(rnd(r, 0.3, 0.6)) +
      '" filter="url(#' + uid + 'g)">' +
      (animated
        ? '<animateTransform attributeName="transform" type="translate" values="0 0;' +
          f1(rnd(r, -80, 80)) + ' ' + f1(rnd(r, -16, 16)) + ';0 0" dur="' + f1(dur) +
          's" begin="' + f1(-rnd(r, 0, dur)) + 's" repeatCount="indefinite"/>' +
          '<animate attributeName="opacity" values="0.22;' + f1(rnd(r, 0.5, 0.8)) + ';0.22" dur="' +
          f1(dur * 0.6) + 's" repeatCount="indefinite"/>'
        : '') + '</rect>');
  }

  // 2  the pours: falling streams, thin and very bright
  for (let i = 0; i < 5; i++) {
    const x = rnd(r, VB * 0.05, VB * 0.95);
    const w = rnd(r, 2.5, 7);
    const top = rnd(r, -40, VB * 0.2), len = rnd(r, VB * 0.45, VB * 0.95);
    const dur = rnd(r, 1.6, 4.2);
    out.push('<rect x="' + f1(x) + '" y="' + f1(top) + '" width="' + f1(w) + '" height="' + f1(len) +
      '" fill="' + (r() < 0.4 ? ink.hot : ink2.mid) + '" opacity="' + f1(rnd(r, 0.35, 0.75)) + '">' +
      (animated
        ? '<animate attributeName="opacity" values="0.15;' + f1(rnd(r, 0.6, 0.95)) + ';0.15" dur="' +
          f1(dur) + 's" begin="' + f1(-rnd(r, 0, dur)) + 's" repeatCount="indefinite"/>' +
          '<animate attributeName="height" values="' + f1(len) + ';' + f1(len * rnd(r, 0.6, 1.25)) +
          ';' + f1(len) + '" dur="' + f1(dur * 1.7) + 's" repeatCount="indefinite"/>'
        : '') + '</rect>');
    // the splash pool where it lands
    out.push('<ellipse cx="' + f1(x + w / 2) + '" cy="' + f1(top + len) + '" rx="' + f1(rnd(r, 22, 60)) +
      '" ry="' + f1(rnd(r, 4, 11)) + '" fill="' + ink.hot + '" opacity="0.5" filter="url(#' + uid + 'g)">' +
      (animated
        ? '<animate attributeName="opacity" values="0.2;0.72;0.2" dur="' + f1(dur) + 's" begin="' +
          f1(-rnd(r, 0, dur)) + 's" repeatCount="indefinite"/>'
        : '') + '</ellipse>');
  }

  out.push('</g>');

  // 3  sparks off the splash, rising and dying. Segments, not dots.
  out.push('<g stroke="' + ink.hot + '" stroke-width="1.5" stroke-linecap="round">');
  for (let i = 0; i < 34; i++) {
    const x = rnd(r, 0, VB), y = rnd(r, VB * 0.45, VB);
    const len = rnd(r, 4, 13), lean = rnd(r, -0.5, 0.5);
    const dur = rnd(r, 2.2, 6), rise = rnd(r, -180, -70), drift = rnd(r, -60, 60);
    out.push('<line x1="' + f1(x) + '" y1="' + f1(y) + '" x2="' + f1(x + lean * len) + '" y2="' +
      f1(y - len) + '" opacity="' + (animated ? '0' : '0.6') + '">' +
      (animated
        ? '<animateTransform attributeName="transform" type="translate" values="0 0;' + f1(drift) +
          ' ' + f1(rise) + '" dur="' + f1(dur) + 's" begin="' + f1(-rnd(r, 0, dur)) +
          's" repeatCount="indefinite"/>' +
          '<animate attributeName="opacity" values="0;0.9;0" dur="' + f1(dur) + 's" begin="' +
          f1(-rnd(r, 0, dur)) + 's" repeatCount="indefinite"/>'
        : '') + '</line>');
  }
  out.push('</g>');

  return { defs: defs.join(''), body: out.join('') };
}

const FIELDS = {
  'Reticle':  { ground: '#050308', gen: (s, c, a) => fieldReticle(s, c, a) },
  'Motes':    { ground: '#050308', gen: (s, c, a) => fieldMotes(s, c, a, 90) },
  'Swarm':    { ground: '#050308', gen: (s, c, a) => fieldMotes(s, c, a, 260) },
  'Tunnel':   { ground: '#04050a', gen: (s, c, a) => fieldTunnel(s, c, a) },
  'Spectrum': { ground: '#050308', gen: (s, c, a) => fieldSpectrum(s, c, a) },
  'Strata':   { ground: '#050308', gen: (s, c, a) => fieldStrata(s, c, a) },

  // the six new ones -- see the block above them
  'Ledger':       { ground: '#050308', gen: (s, c, a) => fieldLedger(s, c, a) },
  'Contour':      { ground: '#050308', gen: (s, c, a) => fieldContour(s, c, a) },
  'Eclipse':      { ground: '#03040a', gen: (s, c, a) => fieldEclipse(s, c, a) },
  'Interference': { ground: '#050308', gen: (s, c, a) => fieldInterference(s, c, a) },
  'Truss':        { ground: '#050308', gen: (s, c, a) => fieldTruss(s, c, a) },
  'Datastream':   { ground: '#050308', gen: (s, c, a) => fieldDatastream(s, c, a) },

  // second pass: replacements for Truss, Ledger and Interference
  'Monolith':     { ground: '#03040a', gen: (s, c, a) => fieldMonolith(s, c, a) },
  'Depth':        { ground: '#050308', gen: (s, c, a) => fieldDepth(s, c, a) },
  'Aurora':       { ground: '#03040a', gen: (s, c, a) => fieldAurora(s, c, a) },
  'Foundry':      { ground: '#07040a', gen: (s, c, a) => fieldFoundry(s, c, a) },
  /* BROADCAST — Swarm and Spectrum, stacked.
     The only field that runs two generators. It is legible as a combination
     rather than as mush because the two occupy different parts of the frame:
     the bars own the bottom edge and the motes own the air above it, so
     neither is competing for the same pixels. Reserved for the rarest roll —
     it is the one field a buyer can name from a thumbnail. */
  'Broadcast': { ground: '#050308', gen: (s, c, a) => {
                  const m = fieldMotes(s ^ 0x11, c, a, 260);
                  const sp = fieldSpectrum(s ^ 0x22, c, a);
                  return { defs: m.defs + sp.defs, body: m.body + sp.body };
                } },
  /* The 1% roll. Not the default any more — the opposite of it. */
  'Rain':     { ground: '#050308', gen: (s, c, a) => fieldRain(s, c, a) },

  /**
   * TOTALITY — every field in the collection, in one frame.
   *
   * The scope, the perspective tunnel, the scan bands, the motes, the
   * wavelength bars AND the hash rain, all at once. It is not rollable on its
   * own: it arrives only with Shatter, so the rarest fill and the rarest field
   * are the same event rather than two things that have to coincide.
   *
   * Densities are tuned DOWN from what each field uses alone — motes at 120
   * instead of 260, rain at 22 drops instead of 38. Seven layers at full
   * strength is not seven times as impressive, it is noise. They survive
   * together because each one owns a different part of the frame: the tunnel
   * owns the vanishing point, the bars own the bottom edge, the rain owns the
   * verticals, the scope owns the middle distance.
   */
  'Totality': { ground: '#04050a', gen: (s, c, a) => {
                  const layers = [
                    fieldTunnel(s ^ 0x101, c, a),
                    fieldReticle(s ^ 0x202, c, a),
                    fieldStrata(s ^ 0x303, c, a),
                    fieldRain(s ^ 0x404, c, a, 22),
                    fieldMotes(s ^ 0x505, c, a, 120),
                    fieldSpectrum(s ^ 0x606, c, a)
                  ];
                  // Held at 0.62. Six layers at full strength out-shout the
                  // figure, and a jackpot you cannot see the character in is a
                  // worse token than a plain one. The field has to stay the
                  // backdrop even when the backdrop is everything at once.
                  return { defs: layers.map(l => l.defs).join(''),
                           body: '<g opacity="0.62">' + layers.map(l => l.body).join('') + '</g>' };
                } },

  'Void':     { ground: '#050308', gen: () => ({ defs: '', body: '' }) }
};

// ------------------------------------------------------------------ build ---

function compose(opts) {
  const tokenId = opts.tokenId === undefined ? 1 : opts.tokenId;
  const tier = opts.tier || 'Orange';
  const animated = opts.animated !== false;
  const fillName = opts.fill || 'Circuitry';
  let fieldName = opts.field || 'Reticle';
  const mouthName = opts.mouth || 'Grill';
  const eyesName = opts.eyes || 'Graffiti X';
  const mult = Math.max(1, Math.min(4, opts.mult || 1));
  // The jackpot fill always brings Totality with it, whatever the tier calls
  // it — see TIER_UNIVERSAL. That coupling is the whole reason the 1% points
  // at something you can see rather than at a product of three weights.
  if (isUniversal(fillName, tier)) fieldName = UNIVERSAL_FIELD;

  const C3 = strandsFor(tier);
  const F = fillStyle(fillName, tier);
  const FD = FIELDS[fieldName] || FIELDS.Reticle;
  const M = MOUTHS[mouthName] || MOUTHS.Grill;
  const uid = tokenId + '-' + fillName + '-' + fieldName + '-' + mouthName + '-' +
    eyesName.replace(/\s/g, '') + '-x' + mult;

  const { union, t } = unionFor(tokenId, tier, mouthName, eyesName, opts.hood, opts.rig);
  const loops = P.trace(union);
  const figureD = P.toPath(loops);
  const outerD = P.toPath(P.trace(P.dilate(union)));
  const innerD = P.toPath(P.trace(P.erode(union)));

  const seed = (tokenId * 2654435761) >>> 0;
  const strands = strandsOf(fillName, tier, seed, union, mult);
  const field = FD.gen(seed ^ 0x7a12, C3, animated);

  // Eye geometry comes straight from the shipping constants, so the face can
  // never drift between the two generators. Both beams leave from their own
  // eye's centre, which is why each needs its own x.
  const eyeY = ATY(P.EYE_L.y + P.EYE_N / 2);
  const eyeLX = ATX(P.EYE_L.x + P.EYE_W / 2);
  const eyeRX = ATX(P.EYE_R.x + P.EYE_W / 2);
  const eyeCells = eyeCellsOf(eyesName);
  const hot = C3.prism ? '#ffffff' : C3.hot;
  // How rare this token is, from its fill's weight within its own tier. Drives
  // both the beam stage and the eye's extra furniture.
  const grade = gradeOf(tier, fillName);
  const pathOf = pts => '<path d="' + P.strandPath(pts) + '"/>';

  const L = [];
  L.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + VB + ' ' + VB +
    '" width="' + VB + '" height="' + VB + '" role="img"');
  L.push('  aria-label="' + COLLECTION_ITEM + ' #' + tokenId + ' — a hooded ' + tier.toLowerCase() +
    ' figure, ' + fillName.toLowerCase() + ' body, ' + fieldName.toLowerCase() + ' field">');
  L.push('<title>' + COLLECTION_ITEM + ' #' + tokenId + ' — ' + tier + '</title>');
  L.push('<desc>tier: ' + tier + ' | fill: ' + fillName + ' | field: ' + fieldName +
    ' | mouth: ' + mouthName + ' | eyes: ' + t.eyes + ' | hood: ' + t.hood + ' | rig: ' + t.rig + '</desc>');

  L.push('<defs>');
  L.push('<filter id="g' + uid + '" x="-40%" y="-40%" width="180%" height="180%">' +
    '<feGaussianBlur stdDeviation="4" result="b"/>' +
    '<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>');
  L.push('<filter id="s' + uid + '" x="-40%" y="-40%" width="180%" height="180%">' +
    '<feGaussianBlur stdDeviation="9"/></filter>');
  // A single blur for the eyes, not the doubled merge the body uses — doubling
  // it is what turned them into white blobs with no shape left in them.
  L.push('<filter id="eglow' + uid + '" x="-60%" y="-60%" width="220%" height="220%">' +
    '<feGaussianBlur stdDeviation="3" result="b"/>' +
    '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>');
  L.push('<clipPath id="b' + uid + '"><path d="' + figureD + '" clip-rule="evenodd"/></clipPath>');
  L.push('<mask id="e' + uid + '"><path d="' + outerD + '" fill="#fff" fill-rule="evenodd"/>' +
    '<path d="' + innerD + '" fill="#000" fill-rule="evenodd"/></mask>');
  L.push('<mask id="o' + uid + '"><rect width="' + VB + '" height="' + VB + '" fill="#fff"/>' +
    '<path d="' + outerD + '" fill="#000" fill-rule="evenodd"/></mask>');
  L.push(field.defs);
  L.push('</defs>');

  L.push('<rect width="' + VB + '" height="' + VB + '" fill="' + FD.ground + '"/>');
  L.push('<g mask="url(#o' + uid + ')">' + field.body + '</g>');

  // --- the body ----------------------------------------------------------
  // Drawn strand by strand rather than as one <use>, because Prismatic needs
  // every line to carry its own colour. Any other tier just repeats one colour
  // through the same loop, which costs nothing and keeps a single code path.
  L.push('<g clip-path="url(#b' + uid + ')" fill="none" stroke-linecap="round" stroke-linejoin="round">');
  const lift = F.lift || 1;
  const op = (base) => f1(Math.min(0.97, base * lift));
  strands.forEach((s, i) => {
    const ink = inkOf(C3, i);
    L.push('<g stroke="' + ink.dim + '" stroke-width="' + f1(F.width * 2.1) + '" opacity="' + op(0.40) + '">' + pathOf(s) + '</g>');
    L.push('<g stroke="' + ink.mid + '" stroke-width="' + f1(F.width * 0.7) + '" opacity="' + op(0.72) + '">' + pathOf(s) + '</g>');
  });
  if (F.pads) {
    L.push('<g fill="' + (C3.prism ? C3.prism[2].hot : C3.hot) + '" opacity="0.55" stroke="none">');
    strands.forEach(s => s.forEach(([x, y], k) => {
      if (k % 3) return;
      L.push('<circle cx="' + f1(ATX(x)) + '" cy="' + f1(ATY(y)) + '" r="2.4"/>');
    }));
    L.push('</g>');
  }
  L.push('</g>');

  // --- the lit edge: where the fill runs out of room ----------------------
  L.push('<g mask="url(#e' + uid + ')" fill="none" stroke-linecap="round" filter="url(#g' + uid + ')">');
  strands.forEach((s, i) => {
    L.push('<g stroke="' + inkOf(C3, i).mid + '" stroke-width="' + f1(F.glow) +
      '" opacity="' + op(0.75) + '">' + pathOf(s) + '</g>');
  });
  L.push('</g>');

  // --- the rim ------------------------------------------------------------
  L.push('<g mask="url(#e' + uid + ')" fill="none" stroke="' + hot +
    '" stroke-width="0.8" opacity="0.5">' + P.sketchSvg(loops, seed ^ 0x3c, 2, CELL * 0.7) + '</g>');

  // --- the mouth ----------------------------------------------------------
  L.push('<g fill="' + hot + '" stroke="' + hot + '" stroke-linecap="round" opacity="0.95"' +
    ' filter="url(#g' + uid + ')">' + M.draw(seed ^ 0x3d0) + '</g>');

  // --- the beams ----------------------------------------------------------
  // One per eye. The left beam is drawn first and slightly dimmer so the two
  // read as parallel light rather than as one thick bar: at equal weight they
  // merge into a slab the moment they overlap past the face.
  const bInk = C3.prism ? C3.prism[3] : C3;
  // Left beam leaves high, right beam leaves low, and both settle onto the same
  // line downrange — so the pair reads as two emitters converging rather than
  // as one bar that happens to be thick.
  L.push('<g opacity="0.82">' +
    beam(seed ^ 0x77, bInk, hot, eyeLX, eyeY, animated, uid, 0, grade, C3, -7) + '</g>');
  L.push(beam(seed ^ 0xa11, C3.prism ? C3.prism[1] : C3, hot, eyeRX, eyeY, animated, uid, 1, grade, C3, 7));

  // --- the eyes, on top of their own output -------------------------------
  L.push(eyeSvgFor(eyeCells, C3, hot, uid, grade, animated, seed));

  // --- the muzzle flare, one per eye, over the top of everything ----------
  // The same flare twice, centred on each eye. Right first so the left is not
  // drawn through it.
  L.push(muzzle(seed ^ 0xa11, C3.prism ? C3.prism[1] : C3, hot, eyeRX, eyeY, animated, uid, 1, grade, C3));
  L.push(muzzle(seed ^ 0x77, bInk, hot, eyeLX, eyeY, animated, uid, 0, grade, C3));

  L.push('</svg>');
  return L.join('\n') + '\n';
}

export { compose, FILLS, FIELDS, MOUTHS, EYES, eyeCellsOf, eyeDrift, gradeOf, strandsFor, LADDER };
