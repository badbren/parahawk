// @ts-nocheck — ported verbatim from RH Sniper (pfp.js); see the note below.
/**
 * figure.ts — the Sniper figure: projection, silhouette, tracer, palette.
 *
 * Ported from RH Sniper's pfp.js (2026-10-22), where it was the shipping
 * generator. Kept as close to the original as possible so the two can be
 * diffed: only the module syntax changed, and the parts that stopped being
 * drawn there (the rain backdrops, pfp.build(), the stepped laser, the
 * ASCII dump and the CLI) were left behind. Type-checking is off for this
 * file on purpose — it is a numeric generator written as plain JS, and
 * catalog.ts is the typed surface the rest of Parahawk talks to.
 *
 * Original header:
 *
 *
 * One design, 3,333 identical copies. The art is a pixel figure defined as a
 * list of grid rectangles, not a hand-drawn path, so it stays editable: change
 * a rect, regenerate, and every derived line moves with it.
 *
 * v3 works on a 56x56 grid. The rifle is gone and the figure is centred, which
 * hands the whole frame to the head: graffiti X eyes firing gold lasers up to
 * the right, over a hood with folds, mask vents, a chest rig and a rim line.
 *
 * How the look is built:
 *   1. Every part rasterises into the grid; the union is the figure.
 *   2. A contour tracer walks the boundary between filled and empty cells and
 *      stitches the unit edges into closed loops. Because it follows cell edges
 *      the result is exactly stair-stepped — pixel art, drawn as line art.
 *   3. The union's loops are stroked THICK. That is the silhouette.
 *   4. Each part is traced again on its own and stroked THIN, clipped to the
 *      union. Overlapping parts leave their seams behind as interior detail,
 *      so the rig and the hood read without drawing them twice.
 *   5. Eroding the union by one cell and tracing that gives an inner rim line,
 *      which is what stops the figure reading as a flat sticker.
 *   6. The thick outline carries a gradient that travels around it, and the
 *      thin lines march via stroke-dashoffset. That is the moving-line look.
 *
 */

import { tokenRng, weighted, FIGURE_TRAITS as TRAITS, traitsOf } from "./catalog.js";

export { tokenRng, weighted, TRAITS, traitsOf };

const W = 56, H = 56;            // grid cells
const VB = 1000;                 // svg viewBox, square

/**
 * The frame is fitted to the ART, not to the grid.
 *
 * The grid is 56x56 but the figure has never filled it: the hood starts a few
 * rows down, the shoulders stop a row short of the bottom, and the widest part
 * is 40 cells of a 56-cell row. Mapping the whole grid to the whole viewBox
 * therefore spent a band of empty canvas under the shoulders and a wider one
 * over the hood, and shrank the figure to pay for them.
 *
 * So the projection is derived from the box the art actually occupies. The
 * bust is BOTTOM-ANCHORED — the last row lands exactly on the bottom edge, the
 * way a portrait is cropped rather than floated — and the only deliberate
 * margin left is a thin one over the hood, so a Peaked crown has somewhere to
 * go. Everything downstream (the weave, the contour, the eyes, the laser) reads
 * its coordinates from here, so the whole picture rescales together.
 */
const BOX = { x0: 7, x1: 48, y0: 1, y1: 56 };   // cols 7..47, rows 1..55, inclusive
const TOP = 18;                                  // headroom over a Peaked hood

const CELL = (VB - TOP) / (BOX.y1 - BOX.y0);
const OX = (VB - (BOX.x1 - BOX.x0) * CELL) / 2 - BOX.x0 * CELL;
const OY = TOP - BOX.y0 * CELL;

const ATX = i => OX + i * CELL;  // grid column -> user units
const ATY = j => OY + j * CELL;  // grid row    -> user units

// ------------------------------------------------------------------- art ---
// Front on, centred bust. Graffiti X eyes, gold lasers angled up to the right.
// Rects are [x, y, width, height] in grid cells, y down.

const PARTS = {
  // --- head, centred on x=28 ---
  hood: [
    [22, 4, 12, 3],      // crown
    [19, 7, 18, 4],
    [16, 11, 24, 18],    // the hood at its widest
    [18, 29, 20, 4],     // narrowing to the jaw
    [21, 33, 14, 4]
  ],
  hoodFold: [
    [16, 24, 24, 3]      // a fold across the hood; overlap leaves the crease
  ],
  brow: [
    [16, 15, 24, 3]      // ridge over the eyes
  ],
  socket: [
    [19, 16, 18, 7]      // bezel the eyes sit in
  ],
  faceplate: [
    [19, 23, 18, 10]     // mask below the eyes
  ],
  cheek: [
    [21, 26, 14, 7]      // inner plate, so the mask is not one flat field
  ],
  chinStrap: [
    [23, 34, 10, 2]
  ],

  // --- body ---
  neck: [
    [24, 36, 8, 4]
  ],
  shoulders: [
    [18, 38, 20, 3],     // short steps: the slope reads as a slope, not a slab
    [15, 41, 26, 3],
    [12, 44, 32, 3],
    [10, 47, 36, 3],
    [8, 50, 40, 6]
  ],
  collar: [
    [19, 38, 18, 4]
  ],
  chest: [
    [19, 46, 18, 10]     // plate
  ],
  strapLeft: [
    [22, 46, 4, 10]      // rig webbing
  ],
  strapRight: [
    [30, 46, 4, 10]
  ],
  belt: [
    [19, 52, 18, 3]
  ]
};

// The per-token trait roll (tokenRng, weighted, TRAITS, traitsOf) lives in
// catalog.ts now, so the shell can roll a token without loading the drawing.

// Cut back out of the silhouette. A hole gets its own traced loop, so each one
// is outlined like everything else. Every hole must be walled on all four
// sides — a cut-out reaching an edge severs the shape instead of piercing it.
const HOLES = [
  [23, 29, 2, 2],        // mask vents
  [27, 29, 2, 2],
  [31, 29, 2, 2]
];

/**
 * The rig, cut rather than drawn. Nothing inside the figure is stroked any
 * more, so the only way to put detail on the chest is to take material away:
 * a hole is a wall, the strands bounce off it, and the shape appears in the
 * traffic it creates. Which is also why every one has to stay fully enclosed.
 */
const RIG_HOLES = {
  'Webbing':  [[21, 47, 2, 4], [33, 47, 2, 4]],
  'Plated':   [[21, 47, 2, 2], [21, 50, 2, 2], [33, 47, 2, 2], [33, 50, 2, 2]],
  'Stripped': []
};

const holesFor = t => HOLES.concat(RIG_HOLES[t.rig] || []);

/**
 * Graffiti X eyes. Built cell by cell rather than from rectangles, because an
 * X is two diagonals and a diagonal has no rectangle in it. Carved out of the
 * mask so each X becomes a hole with its own traced outline, then lit from
 * behind — the shape reads as sprayed on, not as a component.
 */
function xCells(x0, y0, n, th) {
  const cells = [];
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < th; t++) {
      cells.push([x0 + i + t, y0 + i]);          // top-left to bottom-right
      cells.push([x0 + i + t, y0 + n - 1 - i]);  // bottom-left to top-right
    }
  }
  return cells;
}

/**
 * Eye placement, and why these numbers are what they are.
 *
 * The figure is centred on grid edge 28: the hood spans 16..40, the shoulders
 * 8..48, the chest 19..37 — every one of them straddles 28. The mouth vents
 * (23..33) do too.
 *
 * The eyes did NOT. An X of size n at thickness th is n + th - 1 cells wide,
 * so EYE_N 7 at EYE_TH 2 spans EIGHT cells, not seven. The old pair sat at
 * 20..27 and 30..37, centred on 28.5 — a full cell right of everything else,
 * which is exactly the drift you can see in the face. Starting them one cell
 * earlier puts the pair at 19..26 and 29..36, centred on 28, and leaves the
 * 2-cell bridge between the eyes untouched.
 *
 * EYE_W is the width all three eye styles must fill. The slit and the
 * crosshair are drawn from a plain n and would otherwise come out 7 wide and
 * land back off-centre by half a cell, so they are built at EYE_W instead.
 */
const EYE_N = 7, EYE_TH = 2;
const EYE_W = EYE_N + EYE_TH - 1;   // 8 — the real footprint of an X
const EYE_L = { x: 19, y: 17 };
const EYE_R = { x: 29, y: 17 };

/** A horizontal slit, for the visor variant. */
function slitCells(x0, y0, n) {
  const cells = [];
  for (let i = 0; i < n; i++) { cells.push([x0 + i, y0 + 2]); cells.push([x0 + i, y0 + 3]); }
  return cells;
}

/** A plus, for the crosshair variant. */
function crossCells(x0, y0, n) {
  const cells = [];
  const mid = Math.floor(n / 2);
  for (let i = 0; i < n; i++) {
    cells.push([x0 + i, y0 + mid]); cells.push([x0 + i, y0 + mid + 1]);
    cells.push([x0 + mid, y0 + i]); cells.push([x0 + mid + 1, y0 + i]);
  }
  return cells;
}

function eyeCellsFor(style) {
  // Each style is handed the width it must fill so all three share one
  // footprint: the X gets EYE_N because thickness widens it to EYE_W on its
  // own, the other two are drawn at EYE_W directly.
  const build = style === 'Visor Slit' ? (x, y) => slitCells(x, y, EYE_W)
              : style === 'Crosshair' ? (x, y) => crossCells(x, y, EYE_W)
              : (x, y) => xCells(x, y, EYE_N, EYE_TH);
  return [
    ...build(EYE_L.x, EYE_L.y),
    ...build(EYE_R.x, EYE_R.y)
  ];
}

// ------------------------------------------------------------------ grid ---

const blank = () => Array.from({ length: H }, () => new Uint8Array(W));

function paint(grid, rects) {
  for (const [x, y, w, h] of rects) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        if (i >= 0 && i < W && j >= 0 && j < H) grid[j][i] = 1;
      }
    }
  }
  return grid;
}

function carve(grid, rects) {
  for (const [x, y, w, h] of rects) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        if (i >= 0 && i < W && j >= 0 && j < H) grid[j][i] = 0;
      }
    }
  }
  return grid;
}

function carveCells(grid, cells) {
  for (const [x, y] of cells) {
    if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = 0;
  }
  return grid;
}

/** Everything cut out of the figure: the vents plus this token's eyes. */
const cutAll = (grid, eyeCells, holes) => carveCells(carve(grid, holes || HOLES), eyeCells);

/**
 * Apply a token's traits to the base part list. Traits are edits to the
 * drawing, not a second drawing — so every derived line (seams, rim, clip)
 * follows automatically without any of them knowing traits exist.
 */
function partsFor(t) {
  const parts = {};
  for (const [k, v] of Object.entries(PARTS)) parts[k] = v.map(r => r.slice());

  if (t.hood === 'Peaked') {
    parts.hood[0] = [24, 1, 8, 5];          // a tall narrow point
    parts.hood[1] = [20, 6, 16, 5];
  } else if (t.hood === 'Heavy') {
    parts.hood[2] = [14, 10, 28, 18];       // a wider, deeper cowl
    parts.hood[3] = [16, 28, 24, 4];
  }

  return parts;
}

/** Shrink by one cell. Tracing the result gives the inner rim line. */
function erode(grid) {
  const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && grid[y][x] === 1;
  const out = blank();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (on(x, y) && on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1)) {
        out[y][x] = 1;
      }
    }
  }
  return out;
}

// --------------------------------------------------------------- contour ---

/**
 * Trace the boundary of a filled grid into closed loops.
 *
 * Each filled cell contributes the sides that face an empty cell, emitted in a
 * fixed rotational order so every edge runs with the fill on one consistent
 * side. Shared edges between two filled cells are never emitted, so what is
 * left chains head-to-tail into closed loops — outer boundaries and holes
 * alike, with no special case for either.
 */
function trace(grid) {
  const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && grid[y][x] === 1;
  const key = (x, y) => x + ',' + y;
  const edges = new Map();          // start point -> [end points]

  const add = (ax, ay, bx, by) => {
    const k = key(ax, ay);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push([bx, by]);
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) add(x, y, x + 1, y);
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!on(x - 1, y)) add(x, y + 1, x, y);
    }
  }

  const loops = [];
  for (const [start] of edges) {
    while (edges.get(start) && edges.get(start).length) {
      const pts = [];
      let [cx, cy] = start.split(',').map(Number);
      for (;;) {
        const outs = edges.get(key(cx, cy));
        if (!outs || !outs.length) break;              // shape closed
        const [nx, ny] = outs.pop();
        if (!outs.length) edges.delete(key(cx, cy));
        pts.push([cx, cy]);
        cx = nx; cy = ny;
        if (key(cx, cy) === start) break;
      }
      if (pts.length > 3) loops.push(pts);
    }
  }
  return loops;
}

/** Drop mid-points of straight runs — the path is stair-stepped, not jagged. */
function simplify(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i - 1 + pts.length) % pts.length];
    const c = pts[i];
    const n = pts[(i + 1) % pts.length];
    const collinear = (c[0] - p[0]) * (n[1] - c[1]) === (c[1] - p[1]) * (n[0] - c[0]);
    if (!collinear) out.push(c);
  }
  return out.length ? out : pts;
}

const toPath = loops => loops
  .map(simplify)
  .map(l => 'M' + l.map(([x, y]) => ATX(x).toFixed(1) + ' ' + ATY(y).toFixed(1)).join('L') + 'Z')
  .join('');

/** The silhouette is the loop enclosing the most area; the rest are holes. */
function biggest(loops) {
  let best = loops[0], bestArea = -1;
  for (const l of loops) {
    let a = 0;
    for (let i = 0; i < l.length; i++) {
      const p = l[i], q = l[(i + 1) % l.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = l; }
  }
  return best;
}

/** Total edge length, so each path can carry a dash pattern scaled to itself. */
const pathLen = loops => loops.reduce((sum, l) => {
  let d = 0;
  for (let i = 0; i < l.length; i++) {
    const a = l[i], b = l[(i + 1) % l.length];
    d += (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])) * CELL;
  }
  return sum + d;
}, 0);

// ------------------------------------------------------------------- svg ---

/** Deterministic noise: the art must be byte-identical on every run. */
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Grow by one cell. Dilate minus erode is the band that hugs the silhouette. */
function dilate(grid) {
  const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && grid[y][x] === 1;
  const out = blank();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (on(x, y) || on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) {
        out[y][x] = 1;
      }
    }
  }
  return out;
}

/**
 * The tier palette. Three stops each, and all three matter: dim is the mass of
 * the weave, mid is the colour you actually name when you see it, hot is the
 * flare. A dull tier is almost always a dim that has gone muddy — the fix is to
 * raise and saturate the shadow, not to brighten the highlight, which only
 * washes the whole thing out.
 *
 * White is a cool silver rather than grey. Orange stays orange under the flare
 * instead of sliding to brown. Green is emerald, not lime — the hue is held off
 * yellow and the saturation does the work. Blue is a daylight blue with a
 * shadow that still reads blue. Red is pulled off crimson toward true red so it
 * stops looking purple. Gold is the one that is not a single colour at all:
 * bronze shadow, gold body, near-white specular, which is what plated metal
 * does and what yellow never will.
 */
const TIER_STRANDS = {
  'White':  { hot: '#ffffff', mid: '#f2f6ff', dim: '#aab6d6' },
  'Orange': { hot: '#fff2dc', mid: '#ffa02e', dim: '#d96a00' },
  'Green':  { hot: '#e2fff2', mid: '#19e894', dim: '#0bb072' },
  'Red':    { hot: '#ffe4de', mid: '#ff3f33', dim: '#c4201a' },
  'Blue':   { hot: '#dceaff', mid: '#2b7bff', dim: '#0a48cf' },
  'Gold':   { hot: '#fff6d5', mid: '#f0c14b', dim: '#a8741a' }
};

/**
 * The weave: strands trapped inside the figure.
 *
 * There is no background field any more, and nothing spins. A strand starts on
 * a random filled cell, travels in a straight line, and reflects when the next
 * step would land outside the silhouette — a billiard shot that can never leave
 * the body. Because only the contact points are recorded, each strand is a
 * polyline of taut straight runs, which is the look: line art, not scribble.
 *
 * Two things fall out of this for free, and they are the whole reason for it:
 *   - the lines pile up against the walls, so the boundary draws itself. The
 *     outline is not stroked anywhere; it is where the strands run out of room.
 *   - the eye cut-outs and vents are walls too, so the X eyes are carved by
 *     the same lines that fill the face.
 */
const STEP = 0.34;               // cell units per march; small enough to touch

function bounceStrands(seed, count, grid, bounces) {
  const rand = lcg(seed);
  const on = (x, y) => {
    const i = Math.floor(x), j = Math.floor(y);
    return i >= 0 && j >= 0 && i < W && j < H && grid[j][i] === 1;
  };

  const start = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (grid[y][x]) start.push([x + 0.5, y + 0.5]);
  }
  if (!start.length) return [];

  const strands = [];
  for (let i = 0; i < count; i++) {
    const [sx, sy] = start[Math.floor(rand() * start.length)];
    let px = sx, py = sy;
    let a = rand() * Math.PI * 2;
    let vx = Math.cos(a) * STEP, vy = Math.sin(a) * STEP;

    const pts = [[px, py]];
    let hits = 0, guard = 0;
    while (hits < bounces && guard++ < bounces * 500) {
      const nx = px + vx, ny = py + vy;
      if (on(nx, ny)) { px = nx; py = ny; continue; }

      pts.push([px, py]);                       // the contact — a corner of the run
      hits++;
      const freeX = on(px + vx, py);            // which axis the wall blocks
      const freeY = on(px, py + vy);
      if (freeX && !freeY) vy = -vy;
      else if (freeY && !freeX) vx = -vx;
      else { vx = -vx; vy = -vy; }
      if (!on(px + vx, py + vy)) {              // wedged in a corner: pick anew
        a = rand() * Math.PI * 2;
        vx = Math.cos(a) * STEP; vy = Math.sin(a) * STEP;
      }
    }
    pts.push([px, py]);
    strands.push(pts);
  }
  return strands;
}

/** Grid-space polyline -> svg path, in user units. */
const strandPath = pts =>
  'M' + pts.map(([x, y]) => ATX(x).toFixed(1) + ' ' + ATY(y).toFixed(1)).join('L');

const strandLen = pts => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) * CELL;
  }
  return d;
};

/**
 * The silhouette, drawn as strands rather than as a stroke.
 *
 * A few jittered passes over the traced contour. Each pass misses the true
 * edge by a fraction of a cell in a different direction, so the boundary reads
 * as a bundle of lines that happen to agree — the same material as the weave —
 * instead of the blocky outline it used to be.
 */
function sketchSvg(loops, seed, passes, jitter) {
  const rand = lcg(seed);
  const out = [];
  for (const loop of loops) {
    const l = simplify(loop);
    if (l.length < 4) continue;
    for (let p = 0; p < passes; p++) {
      const pts = l.map(([x, y]) =>
        (ATX(x) + (rand() - 0.5) * jitter).toFixed(1) + ' ' +
        (ATY(y) + (rand() - 0.5) * jitter).toFixed(1));
      out.push('<path d="M' + pts.join('L') + 'Z"/>');
    }
  }
  return out.join('');
}

export { trace, simplify, toPath, erode, dilate, TIER_STRANDS, PARTS, HOLES, W, H,
         ATX, ATY, CELL, VB, BOX, TOP,
         blank, paint, carve, carveCells, cutAll, partsFor, biggest, pathLen,
         eyeCellsFor, holesFor, xCells, lcg,
         bounceStrands, strandPath, strandLen, sketchSvg,
         EYE_L, EYE_R, EYE_N, EYE_W, EYE_TH };
