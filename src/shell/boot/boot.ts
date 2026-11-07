/**
 * Boot cinematic — procedural Canvas 2D: no video, image files or web fonts
 * (the wordmark is SVG generated in code), brief §6.
 *
 * Everything is a pure function of one timeline `t` (seconds). The shot list is
 * a beat table; the 3s "short" cut is the same shots on a compressed table.
 *
 *   rain    → hex glyph columns resolve out of black, accelerating
 *   flight  → the camera pushes in through a starfield of hashes (white, gold,
 *             Bitcoin orange) and the circuit-trace canyon, and flies through
 *             two titles: GMB ("good morning Bitcoin", the Discord's greeting),
 *             then BLOCK N IMMINENT, where N = the blocks Parasite has found + 1,
 *             read live as that title starts, so it counts itself up
 *   hero    → PARAHAWK, the site's own wordmark (src/web/logo.ts), comes in the
 *             same way but brakes and stops at hero size, then holds ~4 s: smoke
 *             and fire swirl inside the letters, a shine sweeps across them, the
 *             glow breathes, and the hashes drift slowly behind
 *   out     → a warm flare off the logo washes the frame to warm white, then the
 *             overlay fades away into the site
 *
 * Palette (2026-11-06): the wallpaper's Bitcoin orange and gold on white
 * (desktop/horizon-core.ts); the shell green is no longer in the film.
 *
 * Contract: onComplete() fires exactly once, at the start of the way out.
 * skip() = short warm flash → onComplete → 300ms fade → remove.
 */
import { createLogoFx, LOGO_ASPECT, LOGO_INK_DROP } from "../brand/logo-fx";

export interface BootOptions {
  /** 3-second cut (mobile / slow first frames) instead of the full ~10s. */
  short: boolean;
  /** Play even when prefers-reduced-motion is set (the ?boot=1 replay link). */
  ignoreReducedMotion?: boolean;
  /**
   * Blocks Parasite has found so far (the live tick's blocksFound), for the
   * "BLOCK N IMMINENT" fly-through, N = found + 1. Ask when that shot starts:
   * the first tick usually lands during the intro. null = not known (yet).
   */
  poolBlocks?: () => number | null;
  onComplete: () => void;
}

export interface BootHandle {
  /** Jump to the end now (Skip button, Escape). Idempotent. */
  skip(): void;
}

/**
 * Beat table (seconds). The titles fly through on their own [start, end]
 * windows, which may overlap (each is far and small at its start, gone behind
 * the camera at its end); PARAHAWK comes in over `hero` and stops instead.
 */
interface Beats {
  /** End of the hash rain. */
  rain: number;
  /** End of the push-in: the rain's acceleration and the circuit canyon are cut to it. */
  flight: number;
  /** The hash starfield's flight curve: it starts at [0] and is still accelerating at [1]. */
  stars: readonly [number, number];
  gmb: readonly [number, number];
  /** null: the cut has no BLOCK title. */
  block: readonly [number, number] | null;
  /** PARAHAWK: far and small at [0], landed at hero size at [1]. The camera brakes into it. */
  hero: readonly [number, number];
  /** End of the hold: onComplete fires and the warm flare starts. */
  complete: number;
  /** The frame is warm white; the overlay starts fading into the site. */
  flare: number;
  /** The overlay is gone. */
  end: number;
}
const FULL: Beats = {
  rain: 1.2, flight: 6.4, stars: [0.72, 6.73],
  gmb: [0.85, 3.75], block: [3.35, 6.6],
  // PARAHAWK lands at 7.1 and holds 4 s (the owner asked for 2 more than the first cut's 2 s)
  hero: [6.0, 7.1], complete: 11.1, flare: 11.36, end: 11.95,
};
const SHORT: Beats = {
  rain: 0.3, flight: 1.65, stars: [0.18, 1.7325],
  gmb: [0.15, 1.75], block: null,
  hero: [1.2, 1.9], complete: 2.7, flare: 2.8, end: 3.05,
};

const HEX = "0123456789abcdef";
const ATLAS_CELL = 48; // device px per glyph cell in the atlas (the nearest flying hashes get big)
const STARS = 320; // flying hash fragments at quality 1
const NEAR = 0.88; // fragments deeper than this pass in front of the titles
/** PARAHAWK's raster is capped (device px wide); bigger screens scale it up a little. */
const HERO_MAX_PX = 1800;
/** The starfield's drift while PARAHAWK holds, in depth cycles per second (the flight peaks near 0.8). */
const DRIFT = 0.05;
/** The shine crosses the letters in SHINE_SWEEP s, once every SHINE_EVERY s. */
const SHINE_EVERY = 1.3, SHINE_SWEEP = 0.6;
const WARM_WHITE = "#fff4e4";
/** The flare's light, out from the logo: [offset, r, g, b, alpha]. */
const FLARE_STOPS: readonly (readonly [number, number, number, number, number])[] = [
  [0, 255, 242, 222, 0.92], [0.35, 255, 180, 88, 0.5], [0.7, 247, 128, 30, 0.16], [1, 247, 128, 30, 0],
];

// ── tiny deterministic helpers (no allocation) ────────────────────────────
function hsh(a: number, b: number): number {
  let x = (a * 374761393 + b * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return (x ^ (x >>> 16)) >>> 0;
}
const frac = (x: number): number => x - Math.floor(x);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number): number => { const c = clamp01(x); return c * c * (3 - 2 * c); };
const easeIn = (x: number): number => { const c = clamp01(x); return c * c; };
const easeOut = (x: number): number => { const c = 1 - clamp01(x); return 1 - c * c * c; };

function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

/** A title rendered once into its own canvas; `textW` = the lettering's width inside the padding, canvas px. */
interface Title { c: HTMLCanvasElement; w: number; h: number; textW: number }
interface TitleLine { text: string; rel: number; track: number; fill: "fire" | "white" }

export function playBoot(root: HTMLElement, opts: BootOptions): BootHandle {
  const mono = cssVar("--ph-mono", "Consolas,Menlo,monospace");
  const head = cssVar("--ph-head", "Impact,'Arial Black',sans-serif");
  const FG = cssVar("--ph-fg", "#e6e6e6");
  const DIM = cssVar("--ph-dim", "#8a8a8a");
  // The wallpaper's palette (BTC in desktop/horizon-core.ts): Bitcoin orange, gold, white.
  const ORANGE = "#f7931a", GOLD = "#ffc83d", WHITE = "#ffffff";

  let done = false;         // onComplete fired
  let out = false;          // the overlay is fading out
  let removed = false;
  let raf = 0;
  // Declared up-front (assigned below) so teardown() is safe to call from the
  // reduced-motion / no-context early-return path, where the real handlers
  // are never created.
  let resize: () => void = () => { /* set below */ };
  let onVis: () => void = () => { /* set below */ };

  // ── DOM ───────────────────────────────────────────────────────────────
  const canvas = document.createElement("canvas");
  canvas.className = "ph-boot-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const skipBtn = document.createElement("button");
  skipBtn.type = "button";
  skipBtn.className = "ph-boot-skip";
  skipBtn.textContent = "SKIP ›";
  skipBtn.setAttribute("aria-label", "Skip intro");
  root.setAttribute("role", "presentation");
  root.append(canvas, skipBtn);

  const ctx = canvas.getContext("2d", { alpha: false });

  // ── finish / skip ─────────────────────────────────────────────────────
  const teardown = (): void => {
    if (removed) return;
    removed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", onVis);
    root.remove();
  };
  /** onComplete, exactly once: the desktop starts underneath while the overlay still covers it. */
  const fireComplete = (): void => {
    if (done) return;
    done = true;
    try { opts.onComplete(); } catch (e) { console.error("[boot] onComplete threw", e); }
  };
  /** Stop drawing (the last frame stays up), fade the overlay out over `fadeMs`, then remove it. */
  const fadeOut = (fadeMs: number): void => {
    if (out) return;
    out = true;
    cancelAnimationFrame(raf);
    root.style.setProperty("--ph-boot-fade", `${fadeMs}ms`);
    skipBtn.classList.remove("is-on");
    // Two frames so the desktop paints under the overlay before the fade starts.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.add("ph-boot-out");
      setTimeout(teardown, fadeMs + 80);
    }));
  };
  let skipping = false;
  const skip = (): void => {
    if (out || skipping) return;
    skipping = true;
    cancelAnimationFrame(raf);
    if (done) { fadeOut(300); return; } // already on the way out
    root.classList.add("ph-boot-white"); // ≤150ms warm flash, then into the site
    setTimeout(() => { fireComplete(); fadeOut(300); }, 120);
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" || ev.key === "Enter") { ev.preventDefault(); skip(); }
  };
  skipBtn.addEventListener("click", (ev) => { ev.stopPropagation(); skip(); });
  window.addEventListener("keydown", onKey);

  // Reduced motion (main.ts never calls us then, but be safe) / no 2D context.
  const reduced = !opts.ignoreReducedMotion && typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !ctx) {
    setTimeout(() => { root.classList.add("ph-boot-white"); fireComplete(); fadeOut(500); }, 60);
    return { skip };
  }

  // ── canvas / resize ───────────────────────────────────────────────────
  let W = 1, H = 1, dpr = 1;
  let cols = 0, cell = 14, glyphPx = 13;
  let colSpeed = new Float32Array(0), colOff = new Float32Array(0), colLen = new Float32Array(0);
  resize = (): void => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = root.clientWidth || window.innerWidth;
    H = root.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = W < 600 ? 12 : 14;
    glyphPx = cell - 1;
    cols = Math.ceil(W / cell) + 1;
    if (colSpeed.length !== cols) {
      colSpeed = new Float32Array(cols); colOff = new Float32Array(cols); colLen = new Float32Array(cols);
      for (let i = 0; i < cols; i++) {
        const r = hsh(i, 7);
        colSpeed[i] = 0.6 + (r & 255) / 255 * 1.1;            // relative fall speed
        colOff[i] = ((r >>> 8) & 1023) / 1023;                 // phase
        colLen[i] = 6 + ((r >>> 18) & 31);                     // trail length (glyphs)
      }
    }
  };
  window.addEventListener("resize", resize);
  resize();

  // ── glyph atlas: 16 hex glyphs × 5 tints, rendered once ──────────────
  const T_FG = 0, T_DIM = 1, T_ACC = 2, T_GOLD = 3, T_WHITE = 4;
  const TINTS = [FG, DIM, ORANGE, GOLD, WHITE];
  const atlas = document.createElement("canvas");
  atlas.width = ATLAS_CELL * 16; atlas.height = ATLAS_CELL * TINTS.length;
  {
    const a = atlas.getContext("2d");
    if (a) {
      a.font = `${ATLAS_CELL * 0.86}px ${mono}`;
      a.textAlign = "center"; a.textBaseline = "middle";
      for (let row = 0; row < TINTS.length; row++) {
        a.fillStyle = TINTS[row] ?? FG;
        for (let i = 0; i < 16; i++) a.fillText(HEX[i] ?? "0", i * ATLAS_CELL + ATLAS_CELL / 2, row * ATLAS_CELL + ATLAS_CELL / 2 + 1);
      }
    }
  }
  /** Draw glyph `g` (0–15) with tint row at css (x,y) top-left, size `s` css px. */
  const glyph = (g: number, tint: number, x: number, y: number, s: number): void => {
    ctx.drawImage(atlas, (g & 15) * ATLAS_CELL, tint * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL, x, y, s, s);
  };

  // ── canyon geometry: 3 parallax layers of circuit traces (unit space) ────
  const LAYERS = 3, PER_LAYER = 96;
  const trX = new Float32Array(LAYERS * PER_LAYER), trY = new Float32Array(LAYERS * PER_LAYER);
  const trL1 = new Float32Array(LAYERS * PER_LAYER), trL2 = new Float32Array(LAYERS * PER_LAYER);
  const trSeed = new Uint32Array(LAYERS * PER_LAYER);
  for (let i = 0; i < LAYERS * PER_LAYER; i++) {
    const r = hsh(i, 99), r2 = hsh(i, 1234);
    // keep a hole in the middle so the "canyon" reads: traces sit off-axis
    const ang = (r & 4095) / 4096 * Math.PI * 2, rad = 0.12 + ((r >>> 12) & 1023) / 1023 * 0.55;
    trX[i] = Math.cos(ang) * rad; trY[i] = Math.sin(ang) * rad;
    trL1[i] = 0.03 + (r2 & 255) / 255 * 0.16;
    trL2[i] = 0.02 + ((r2 >>> 8) & 255) / 255 * 0.09;
    trSeed[i] = r2;
  }

  // ── hash starfield: fragments at random directions/depths, flying at the camera ─
  const stA = new Float32Array(STARS), stR = new Float32Array(STARS), stPh = new Float32Array(STARS), stSp = new Float32Array(STARS);
  const stLen = new Uint8Array(STARS), stTint = new Uint8Array(STARS);
  for (let i = 0; i < STARS; i++) {
    const r = hsh(i, 4242), r2 = hsh(i, 777);
    stA[i] = (r & 4095) / 4096 * Math.PI * 2;
    stR[i] = 0.07 + ((r >>> 12) & 1023) / 1023 * 0.93;       // radial offset: off the dead centre
    stPh[i] = (r2 & 65535) / 65536;                         // depth phase
    stSp[i] = 0.7 + ((r2 >>> 16) & 255) / 255 * 0.6;         // relative speed
    const l = (r2 >>> 24) & 7;
    stLen[i] = l < 4 ? 1 : l < 6 ? 2 : l < 7 ? 3 : 4;        // glyphs per fragment
    const c = (r >>> 22) & 15;
    stTint[i] = c < 7 ? T_WHITE : c < 12 ? T_GOLD : T_ACC;   // white, gold, orange
  }

  // ── the hold's hashes: drifting out round the edges and corners while PARAHAWK holds ─
  // (owner: "at the end where we pause at parahawk… theres just some gaps… slap some more around").
  // The starfield only reaches the edges right at the camera, and it crawls while the logo holds, so
  // the corners went empty. Half of these aim into the corners; all of them start just outside the
  // logo and drift out to the frame's edge, growing a little, like a slow push in.
  const EDGE = 84;
  const edA = new Float32Array(EDGE), edJit = new Float32Array(EDGE), edPh = new Float32Array(EDGE);
  const edRate = new Float32Array(EDGE), edS = new Float32Array(EDGE), edB = new Float32Array(EDGE);
  const edKind = new Uint8Array(EDGE), edLen = new Uint8Array(EDGE), edTint = new Uint8Array(EDGE);
  for (let i = 0; i < EDGE; i++) {
    const r = hsh(i, 9091), r2 = hsh(i, 5150);
    edKind[i] = i % 2 === 0 ? 4 : (r >>> 20) & 3;               // 4 = any direction, 0..3 = towards a corner
    edA[i] = ((r & 4095) / 4096) * Math.PI * 2;
    edJit[i] = (((r >>> 8) & 1023) / 1023 - 0.5) * 0.55;        // spread round the corner's diagonal
    edPh[i] = (r2 & 65535) / 65536;
    edRate[i] = 0.06 + ((r2 >>> 16) & 255) / 255 * 0.1;         // slow: a few seconds to the edge
    edS[i] = 0.55 + ((r2 >>> 24) & 15) / 15 * 0.75;             // size: near ones bigger
    edB[i] = 0.45 + ((r >>> 22) & 3) / 3 * 0.45;                // brightness
    const l = (r2 >>> 28) & 7;
    edLen[i] = l < 3 ? 1 : l < 5 ? 2 : l < 7 ? 3 : 4;
    const c = (r >>> 24) & 15;
    edTint[i] = c < 7 ? T_WHITE : c < 12 ? T_GOLD : T_ACC;
  }

  // ── titles: rendered once, flown through by scaling ──────────────────────
  /**
   * Render a title once, wide enough to stay crisp at the size it reads at,
   * with its glow and a thin dark keyline baked in (fillText at full-screen
   * sizes every frame is far too slow on a software rasteriser).
   */
  const makeTitle = (lines: TitleLine[]): Title | null => {
    const c = document.createElement("canvas"), x = c.getContext("2d");
    if (!x) return null;
    const charsW = (ln: TitleLine, px: number): number[] => {
      x.font = `${Math.round(px * ln.rel)}px ${head}`;
      return Array.from(ln.text, (ch) => x.measureText(ch).width);
    };
    const lineW = (ln: TitleLine, px: number): number => {
      const ws = charsW(ln, px);
      return ws.reduce((s, w) => s + w, 0) + ln.track * px * ln.rel * (ws.length - 1);
    };
    const target = Math.min(2400, Math.max(820, W * 0.68 * dpr));
    let widest = 1;
    for (const ln of lines) widest = Math.max(widest, lineW(ln, 100));
    const px = (100 * target) / widest, pad = Math.round(px * 0.34), gap = px * 0.12;
    const boxes = lines.map((ln) => {
      x.font = `${Math.round(px * ln.rel)}px ${head}`;
      const m = x.measureText(ln.text);
      return { asc: m.actualBoundingBoxAscent || px * ln.rel * 0.8, desc: m.actualBoundingBoxDescent || 0 };
    });
    const textH = boxes.reduce((s, b) => s + b.asc + b.desc, 0) + gap * (lines.length - 1);
    c.width = Math.ceil(target + pad * 2); c.height = Math.ceil(textH + pad * 2);
    let y = pad;
    lines.forEach((ln, k) => {
      const box = boxes[k]!, lp = px * ln.rel, ws = charsW(ln, px); // charsW also sets the font
      const base = y + box.asc, w = lineW(ln, px), x0 = (c.width - w) / 2;
      x.font = `${Math.round(lp)}px ${head}`;
      const g = x.createLinearGradient(0, y, 0, base + box.desc);
      if (ln.fill === "fire") {
        g.addColorStop(0, "#fff3c2"); g.addColorStop(0.3, GOLD); g.addColorStop(0.75, ORANGE); g.addColorStop(1, "#d8600a");
      } else {
        g.addColorStop(0, WHITE); g.addColorStop(0.55, "#fff2d2"); g.addColorStop(1, GOLD);
      }
      const each = (draw: (ch: string, cx: number) => void): void => {
        let cx = x0, i = 0;
        for (const ch of ln.text) { draw(ch, cx); cx += ws[i++]! + ln.track * lp; }
      };
      x.textBaseline = "alphabetic"; x.textAlign = "left";
      // warm glow, then a dark keyline so it holds over the hashes, then the crisp face
      x.shadowColor = "rgba(247,147,26,0.9)"; x.shadowBlur = lp * 0.16; x.fillStyle = g;
      each((ch, cx) => x.fillText(ch, cx, base));
      x.shadowBlur = 0; x.lineJoin = "round";
      x.strokeStyle = "rgba(28,8,0,0.55)"; x.lineWidth = Math.max(2, lp * 0.02);
      each((ch, cx) => x.strokeText(ch, cx, base));
      x.fillStyle = g;
      each((ch, cx) => x.fillText(ch, cx, base));
      y = base + box.desc + gap;
    });
    return { c, w: c.width, h: c.height, textW: target };
  };
  /** A soft warm light, scaled behind each title as it comes in. */
  const halo = document.createElement("canvas");
  halo.width = halo.height = 128;
  {
    const a = halo.getContext("2d");
    if (a) {
      const g = a.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(255,186,80,0.55)"); g.addColorStop(0.4, "rgba(247,147,26,0.2)"); g.addColorStop(1, "rgba(247,147,26,0)");
      a.fillStyle = g; a.fillRect(0, 0, 128, 128);
    }
  }
  const gmbTitle = makeTitle([{ text: "GMB", rel: 1, track: 0.05, fill: "fire" }]);
  let blockTitle: Title | null = null, blockAsked = false;
  /** BLOCK N IMMINENT, N = found + 1 — asked when its shot starts, so a block found today reads right tonight. */
  const makeBlockTitle = (): Title | null => {
    let found: number | null = null;
    try { const v = opts.poolBlocks?.(); found = typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null; } catch { /* no count */ }
    const top = found == null ? "NEXT BLOCK" : `BLOCK ${(found + 1).toLocaleString("en-US")}`;
    return makeTitle([
      { text: top, rel: 1, track: 0.03, fill: "white" },
      { text: "IMMINENT", rel: 0.36, track: 0.42, fill: "fire" },
    ]);
  };

  // ── timeline / performance ─────────────────────────────────────────────
  // ?bootshort=1 forces the 3s cut (dev/QA aid).
  let forceShort = false;
  // ?bootq=0.3..1 pins the detail level (QA aid, like the wallpaper's ?wallq).
  let pinnedQ: number | null = null;
  try {
    const q = new URLSearchParams(location.search);
    forceShort = q.get("bootshort") === "1";
    const bq = Number(q.get("bootq"));
    if (q.get("bootq") && bq >= 0.3 && bq <= 1) pinnedQ = bq;
  } catch { /* ignore */ }
  let beats: Beats = opts.short || forceShort ? SHORT : FULL;
  let t = 0;
  let last = performance.now();
  let paused = document.hidden;
  let quality = pinnedQ ?? 1; // 0.3–1 scales glyph/trace counts
  let frames = 0, accum = 0;  // frame-time stats
  const shotMs = [0, 0, 0], shotN = [0, 0, 0]; // per stretch: flight, hold, out
  let calib = 0, calibN = 0, calibrated = beats === SHORT;
  let ema = 16;

  onVis = (): void => {
    if (document.hidden) paused = true;
    else { paused = false; last = performance.now(); }
  };
  document.addEventListener("visibilitychange", onVis);

  // ── shots ──────────────────────────────────────────────────────────────

  /** Hashrain. `alpha` global, `accel` speed multiplier, `density` 0–1 columns used. */
  const drawRain = (alpha: number, accel: number, density: number): void => {
    if (alpha <= 0.002) return;
    const step = quality < 0.6 ? 2 : 1;
    const rows = Math.ceil(H / cell) + 1;
    for (let c = 0; c < cols; c += step) {
      const on = (hsh(c, 3) & 255) / 255; // per-column "resolves" threshold
      if (on > density) continue;
      const sp = (colSpeed[c] ?? 1) * 260 * accel;               // px/s
      const len = colLen[c] ?? 12;
      const headY = frac((colOff[c] ?? 0) + (t * sp) / ((rows + len) * cell)) * (rows + len) * cell - len * cell;
      const headRow = Math.floor(headY / cell);
      const colA = alpha * (0.55 + 0.45 * on);
      // a few columns run white, gold or orange at the head
      const hk = hsh(c, 11) & 15, headTint = hk < 2 ? T_GOLD : hk < 3 ? T_ACC : hk < 5 ? T_WHITE : T_FG;
      for (let k = 0; k < len; k++) {
        const r = headRow - k;
        if (r < 0 || r >= rows) continue;
        const fade = 1 - k / len;
        ctx.globalAlpha = colA * (k === 0 ? 1 : fade * fade * 0.8);
        const g = hsh(c, r + Math.floor(t * (k === 0 ? 24 : 6) + c)) & 15;
        glyph(g, k === 0 ? headTint : T_DIM, c * cell, r * cell, glyphPx);
      }
    }
    ctx.globalAlpha = 1;
  };

  /** Silicon canyon: traces fly outward from centre in 3 depth layers. */
  const drawCanyon = (p: number, alpha: number): void => {
    if (alpha <= 0.002) return;
    const cx = W / 2, cy = H / 2, R = Math.max(W, H) * 0.9;
    const n = Math.max(20, Math.floor(PER_LAYER * 0.7 * quality));
    const push = 0.12 + p * 0.55; // camera velocity ramps
    const tl = t - beats.rain;
    ctx.lineCap = "square";
    for (let l = 0; l < LAYERS; l++) {
      const layerA = (0.28 + l * 0.32) * alpha;
      const speed = push * (0.6 + l * 0.35);
      for (let i = 0; i < n; i++) {
        const idx = l * PER_LAYER + i;
        const d = frac((trSeed[idx] ?? 0) / 4294967296 + tl * speed);     // depth 0 (far) → 1 (near)
        const sc = 0.08 * Math.exp(d * 3.6);                              // 0.08 → ~2.9
        const a = layerA * smooth(d / 0.25) * (1 - smooth((d - 0.8) / 0.2));
        if (a < 0.01) continue;
        const x = cx + (trX[idx] ?? 0) * sc * R, y = cy + (trY[idx] ?? 0) * sc * R;
        if (x < -R || x > W + R || y < -R || y > H + R) continue;
        const seed = trSeed[idx] ?? 0;
        const dx = (seed & 1 ? 1 : -1) * (trL1[idx] ?? 0.1) * sc * R;
        const dy = (seed & 2 ? 1 : -1) * (trL2[idx] ?? 0.05) * sc * R;
        const tag = seed & 63;
        ctx.globalAlpha = a;
        ctx.strokeStyle = tag === 0 ? ORANGE : tag === 1 ? GOLD : l === 2 ? FG : DIM;
        ctx.lineWidth = Math.max(1, Math.min(2.5, sc * (0.5 + l * 0.35)));
        ctx.beginPath();
        ctx.moveTo(x, y);
        if (seed & 4) { ctx.lineTo(x + dx, y); ctx.lineTo(x + dx, y + dy); }
        else { ctx.lineTo(x, y + dy); ctx.lineTo(x + dx, y + dy); }
        ctx.stroke();
        // pad / via at the end, and a die outline for some
        const pad = Math.max(2, sc * 3);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillRect(x + dx - pad / 2, y + dy - pad / 2, pad, pad);
        if ((seed & 56) === 56) {
          const bw = (trL1[idx] ?? 0.1) * sc * R * 0.8, bh = (trL2[idx] ?? 0.05) * sc * R * 1.6;
          ctx.strokeRect(x - bw / 2, y - bh / 2, bw, bh);
        }
        // a hex tag near the pad ties the structure back to the rain
        if ((seed & 7) === 5 && sc > 0.5) {
          const gs = Math.min(28, 6 + sc * 5);
          glyph((seed >>> 5) & 15, (seed >>> 9) % 5 === 0 ? T_GOLD : l === 2 ? T_FG : T_DIM, x + dx + pad, y + dy - gs / 2, gs);
        }
      }
    }
    ctx.globalAlpha = 1;
  };

  /**
   * The hash starfield. `D` = distance flown (in depth cycles; each fragment
   * comes from far and passes the camera about once per cycle), `v` = speed
   * (stretches the trails). Drawn in two passes around the titles: `near`
   * fragments pass in front of them.
   */
  const drawStars = (D: number, v: number, alpha: number, near: boolean): void => {
    if (alpha <= 0.002) return;
    const cx = W / 2, cy = H / 2, R = Math.max(W, H) * 0.62;
    const n = Math.max(80, Math.floor(STARS * quality));
    const base = Math.max(14, Math.min(W, H) / 1440 * 30);       // glyph px at scale 1
    const trail = Math.min(0.12, 0.022 * v);                     // depth behind each fragment its trail reaches
    const kt = Math.floor(t * 10);                               // characters re-roll, like nonces
    // trails first, one path per tint
    ctx.lineCap = "round";
    for (let tint = T_ACC; tint <= T_WHITE; tint++) {
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < n; i++) {
        if (stTint[i] !== tint) continue;
        const d = frac(stPh[i]! + D * stSp[i]!);
        if ((d >= NEAR) !== near || d < 0.45) continue;
        const sc = 0.045 * Math.exp(d * 4), sc0 = 0.045 * Math.exp(Math.max(0, d - trail) * 4);
        const ux = Math.cos(stA[i]!) * stR[i]! * R, uy = Math.sin(stA[i]!) * stR[i]! * R;
        const x = cx + ux * sc, y = cy + uy * sc;
        if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
        ctx.moveTo(cx + ux * sc0, cy + uy * sc0); ctx.lineTo(x, y); any = true;
      }
      if (!any) continue;
      ctx.globalAlpha = alpha * 0.32;
      ctx.strokeStyle = TINTS[tint] ?? FG;
      ctx.lineWidth = near ? 2 : 1;
      ctx.stroke();
    }
    for (let i = 0; i < n; i++) {
      const d = frac(stPh[i]! + D * stSp[i]!);
      if ((d >= NEAR) !== near) continue;
      const sc = 0.045 * Math.exp(d * 4), s = base * sc;          // 0.045 → ~2.5
      if (s < 2) continue;
      const a = alpha * smooth(d / 0.22) * (1 - smooth((d - 0.86) / 0.14));
      if (a < 0.02) continue;
      const len = stLen[i]!, gw = s * 0.62;
      const x = cx + Math.cos(stA[i]!) * stR[i]! * R * sc - (len * gw) / 2, y = cy + Math.sin(stA[i]!) * stR[i]! * R * sc - s / 2;
      if (x > W + 10 || x + len * gw < -10 || y > H + 10 || y + s < -10) continue;
      ctx.globalAlpha = a;
      for (let k = 0; k < len; k++) glyph(hsh(i * 7 + k, kt + i) & 15, stTint[i]!, x + k * gw, y, s);
    }
    ctx.globalAlpha = 1;
  };

  /**
   * Fly through a title over its window: far and small at the centre, closing
   * in, readable across the middle (the camera eases off there), then filling
   * the screen and fading as it passes behind us. Fainter, smaller copies trail
   * it as the speed rises (a zoom blur), over a warm light.
   */
  const drawTitle = (tt: Title | null, win: readonly [number, number] | null): void => {
    if (!tt || !win) return;
    const p = (t - win[0]) / (win[1] - win[0]);
    if (p <= 0 || p >= 1) return;
    const q = 2 * p - 1;
    const f = 0.55 * p + 0.45 * (0.5 + 0.5 * Math.sign(q) * Math.pow(Math.abs(q), 2.2));
    const fit = Math.min((W * 0.68) / tt.textW, (H * 0.62) / tt.h);
    const sc = fit * 0.03 * Math.exp(f * 5.2);                    // f ≈ 0.67 → reads at full size
    const a = smooth(f / 0.16) * (1 - smooth((f - 0.8) / 0.15));
    if (a < 0.005) return;
    const cx = W / 2, cy = H * 0.48;
    const hw = tt.textW * sc * 1.25, hh = tt.h * sc * 1.6;
    if (hw < W * 2) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = a * 0.55;
      ctx.drawImage(halo, cx - hw / 2, cy - hh / 2, hw, hh);
      ctx.globalCompositeOperation = "source-over";
    }
    const blur = 0.02 + 0.06 * smooth((f - 0.55) / 0.35);
    const copies = f > 0.86 || quality < 0.45 ? 0 : quality < 0.75 ? 1 : 2;
    for (let k = copies; k >= 1; k--) {
      const s = sc * (1 - blur * k);
      ctx.globalAlpha = (a * 0.24) / k;
      ctx.drawImage(tt.c, cx - (tt.w * s) / 2, cy - (tt.h * s) / 2, tt.w * s, tt.h * s);
    }
    ctx.globalAlpha = a;
    ctx.drawImage(tt.c, cx - (tt.w * sc) / 2, cy - (tt.h * sc) / 2, tt.w * sc, tt.h * sc);
    ctx.globalAlpha = 1;
  };
  const drawTitles = (): void => {
    drawTitle(gmbTitle, beats.gmb);
    drawTitle(blockTitle, beats.block);
  };

  // ── PARAHAWK: the site's own wordmark on fire (brand/logo-fx.ts, shared with the desktop's corner logo) ──
  /** The wordmark's width on screen once it has landed, css px: ~62% of a desktop, most of a phone. */
  const heroCssW = (): number => Math.min(W * (W < 700 ? 0.86 : 0.62), H * 0.56 * LOGO_ASPECT);
  /** Where its middle goes: the letters sit high in the wordmark's box, so the box drops a little to centre the ink. */
  const heroCy = (s: number): number => H * 0.48 + (heroCssW() / LOGO_ASPECT) * s * LOGO_INK_DROP;
  const logo = createLogoFx({
    devW: Math.max(240, Math.min(HERO_MAX_PX, Math.round(heroCssW() * dpr))), id: "ph-boot-rough", head, orange: ORANGE, label: "boot",
  });
  /**
   * PARAHAWK at scale `s` of its landed size: halo (breathing; brighter as the shine passes), the crisp
   * base, then the smoke. `copies` trail it as it rushes in (a zoom blur, like the titles').
   */
  const drawHero = (s: number, a: number, shine: number, glowBoost: number, blur: number, copies: number): void => {
    // the smoke only once it's big enough to see; less of it when frames run slow
    const level = s < 0.2 ? 0 : quality >= 0.8 ? 3 : quality >= 0.55 ? 2 : quality >= 0.38 ? 1 : 0;
    logo.draw(ctx, W / 2, heroCy(s), heroCssW() * s, t, { alpha: a, shine, glowBoost, blur, copies, level });
  };
  /** The hold's hashes (see EDGE): from just outside the logo out to the frame's edge, then round again. */
  const drawEdgeHashes = (alpha: number): void => {
    if (alpha <= 0.01) return;
    const cx = W / 2, cy = heroCy(1), hw = heroCssW() * 0.56, hh = (heroCssW() / LOGO_ASPECT) * 0.95;
    const corner = Math.atan2(H, W), corners = [corner, Math.PI - corner, Math.PI + corner, -corner];
    const n = Math.max(36, Math.floor(EDGE * quality)), base = Math.max(12, (Math.min(W, H) / 1440) * 26);
    const kt = Math.floor(t * 8);                                  // characters re-roll, like nonces
    for (let i = 0; i < n; i++) {
      const k = edKind[i]!, a = k < 4 ? corners[k]! + edJit[i]! : edA[i]!;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rIn = 1.04 / Math.sqrt((ca / hw) * (ca / hw) + (sa / hh) * (sa / hh));
      const rOut = Math.min(Math.abs(ca) > 1e-4 ? (W / 2 + 40) / Math.abs(ca) : 1e9,
        sa < -1e-4 ? (cy + 40) / -sa : sa > 1e-4 ? (H - cy + 40) / sa : 1e9);
      if (rOut <= rIn * 1.05) continue;
      const span = Math.log(rOut / rIn), ph = frac(edPh[i]! + (t * edRate[i]!) / span);
      const a2 = alpha * edB[i]! * smooth(ph / 0.18) * (1 - smooth((ph - 0.82) / 0.18));
      if (a2 < 0.02) continue;
      const r = rIn * Math.exp(span * ph), s = base * edS[i]! * (0.75 + 0.5 * ph);
      const len = edLen[i]!, gw = s * 0.62, x = cx + ca * r - (len * gw) / 2, y = cy + sa * r - s / 2;
      ctx.globalAlpha = a2;
      for (let q = 0; q < len; q++) glyph(hsh(i * 13 + q, kt + i) & 15, edTint[i]!, x + q * gw, y, s);
    }
    ctx.globalAlpha = 1;
  };
  /** Where the shine is: sweeps every SHINE_EVERY s from just before it lands; one fast one into the flare. */
  const shineAt = (): number => {
    const b = beats;
    if (t >= b.complete) return clamp01((t - b.complete) / Math.max(0.05, b.flare - b.complete));
    const s0 = b.hero[1] - 0.22;
    if (t < s0) return -1;
    const k = (t - s0) % SHINE_EVERY;
    return k < SHINE_SWEEP ? k / SHINE_SWEEP : -1;
  };

  // ── the flight's speed: up through GMB and BLOCK, braking into PARAHAWK, drifting while it holds ──
  let fD = 0, fV = 0;
  /** The flight curve the titles were cut to: distance over the stars window, accelerating. */
  const curveD = (x: number): number => { const fl = clamp01((x - beats.stars[0]) / (beats.stars[1] - beats.stars[0])); return fl * 1.1 + fl * fl * 1.8; };
  const curveV = (x: number): number => {
    const L = beats.stars[1] - beats.stars[0], fl = (x - beats.stars[0]) / L;
    return fl <= 0 || fl >= 1 ? 0 : (1.1 + 3.6 * fl) / L;
  };
  /** Distance flown (fD, depth cycles) and speed (fV, cycles/s) at `x`, in closed form, so every frame is a function of t. */
  const flightAt = (x: number): void => {
    const b0 = beats.hero[0] + (beats.hero[1] - beats.hero[0]) * 0.35, b1 = beats.hero[1], Tb = b1 - b0;
    if (x <= b0) { fD = curveD(x); fV = curveV(x); return; }
    const D0 = curveD(b0), v0 = curveV(b0);
    if (x <= b1) {
      const w = 1 - (x - b0) / Tb;
      fD = D0 + DRIFT * (x - b0) + ((v0 - DRIFT) * Tb * (1 - w * w * w)) / 3;
      fV = DRIFT + (v0 - DRIFT) * w * w;
    } else {
      fD = D0 + DRIFT * Tb + ((v0 - DRIFT) * Tb) / 3 + DRIFT * (x - b1);
      fV = DRIFT;
    }
  };

  // ── frame ──────────────────────────────────────────────────────────────
  const frame = (now: number): void => {
    if (out || skipping) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (paused) return;
    t += dt;

    // frame-time stats → quality + short-cut decision
    const ms = dt * 1000;
    frames++; accum += ms;
    { const k = t < beats.hero[1] ? 0 : t < beats.complete ? 1 : 2; shotMs[k]! += ms; shotN[k]! += 1; }
    ema += (ms - ema) * 0.15;
    if (!calibrated && frames > 1) { // frame 1 includes setup time; not representative
      calib += ms; calibN++;
      if (t >= 0.5) {
        calibrated = true;
        if (calibN > 0 && calib / calibN > 22) { beats = SHORT; console.debug("[boot] slow frames → short"); }
      }
    }
    // Drop detail when frames run long; win it back while they hold ~60 fps. (Recovery used to need
    // < 13 ms, which a 60 Hz screen never reports, so one hitch cost the rest of the film its detail.)
    if (pinnedQ == null) {
      if (ema > 20) quality = Math.max(0.3, quality * 0.9);
      else if (ema < 17.5) quality = Math.min(1, quality * 1.02);
    }

    if (t >= 0.5) skipBtn.classList.add("is-on");

    // PARAHAWK's pieces, a step a frame once the cut is settled (so the build can't tip the
    // slow-frames check); everything left at once if it's due and still isn't ready.
    if (calibrated && !logo.done) logo.build(t >= beats.hero[0] - 0.05, t >= beats.hero[0] - 0.5);

    const b = beats;
    // the way out: a warm flare off the logo, then the whole frame washes to warm white
    const fp = t >= b.complete ? clamp01((t - b.complete) / Math.max(0.05, b.flare - b.complete)) : 0;
    const wash = smooth((fp - 0.4) / 0.6);
    if (t >= b.complete) fireComplete();
    if (wash >= 0.985) {
      // fully washed: nothing under it shows, so don't draw it
      ctx.globalAlpha = 1; ctx.fillStyle = WARM_WHITE; ctx.fillRect(0, 0, W, H);
      if (t >= b.flare) finish();
      return;
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    flightAt(t);
    const v = fV * (b.stars[1] - b.stars[0]);
    const landed = smooth((t - b.hero[1] + 0.2) / 0.6);
    const starA = smooth((t - b.stars[0]) / Math.max(0.05, (b.flight - b.stars[0]) * 0.12)) * (1 - 0.25 * landed);
    if (b.block && !blockAsked && t >= b.block[0] - 0.1) { blockAsked = true; blockTitle = makeBlockTitle(); }

    // rain resolving; the flight pushes in from the middle of the rain shot
    const pc = clamp01((t - b.rain) / (b.flight - b.rain));
    if (t < b.flight) {
      const pr = clamp01(t / b.rain);
      drawRain(smooth(pr * 1.5) * (1 - smooth((pc - 0.1) / 0.3)), 0.7 + easeIn(t / b.flight) * 3, smooth(pr * 1.3));
    }
    // the circuit canyon: in with the flight, gone as the camera brakes
    if (t > b.rain * 0.7) {
      drawCanyon(pc, 0.5 * smooth((t - b.rain * 0.7) / ((b.flight - b.rain) * 0.3))
        * (1 - smooth((t - b.flight) / Math.max(0.05, (b.hero[1] - b.flight) * 0.75))));
    }
    drawStars(fD, v, starA, false);
    drawEdgeHashes(smooth((t - (b.hero[1] - 0.6)) / 0.9) * (1 - smooth(fp / 0.5)));
    // PARAHAWK rushes in from the depth like the titles, brakes (ease-out) and stops at hero size
    if (t >= b.hero[0]) {
      const p = clamp01((t - b.hero[0]) / (b.hero[1] - b.hero[0]));
      const e = 1 - (1 - p) * (1 - p) * (1 - p);
      const shine = shineAt();
      const boost = (shine >= 0 ? 0.22 * Math.sin(Math.PI * shine) : 0) + 0.5 * fp;
      const copies = p < 0.8 && quality >= 0.45 ? (quality < 0.75 ? 1 : 2) : 0;
      drawHero(Math.exp(-4.2 * (1 - e)) * (1 + 0.06 * easeIn(fp)), smooth(p / 0.25), shine, boost, 0.07 * (1 - e), copies);
    }
    drawTitles();
    drawStars(fD, v, starA * (1 - 0.6 * landed), true);

    // The flare: light blooms out of the logo, and the warm-white wash rides the same gradient
    // (one full-frame fill — software canvas pays per pixel for every one of those).
    if (fp > 0) {
      const cy = heroCy(1), r = heroCssW() * 0.3 + Math.hypot(W, H) * 0.75 * easeOut(fp), bloom = smooth(fp / 0.55);
      const g = ctx.createRadialGradient(W / 2, cy, 0, W / 2, cy, r);
      // Light adds ("lighter"): each stop is the bloom's light plus the wash's warm white, as one colour.
      for (const [o, cr, cg, cb, a] of FLARE_STOPS) {
        const lb = a * bloom, al = Math.min(1, lb + wash);
        const ch = (c: number, w: number): number => Math.min(255, Math.round((c * lb + w * wash) / Math.max(al, 1e-3)));
        g.addColorStop(o, `rgba(${ch(cr, 255)},${ch(cg, 244)},${ch(cb, 228)},${al.toFixed(3)})`);
      }
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H); // past r the last stop carries on: the wash, everywhere
      ctx.globalCompositeOperation = "source-over";
    }
    if (t >= b.flare) finish();
  };
  /** The film is done: log its frame times, and fade into the site. */
  const finish = (): void => {
    const per = shotMs.map((m, k) => (shotN[k] ? (m / shotN[k]!).toFixed(1) : "-")).join("/");
    console.debug(`[boot] avg frame ${(accum / frames).toFixed(1)}ms over ${frames} frames (flight/hold/out ${per}), quality ${quality.toFixed(2)}`);
    fadeOut(Math.max(200, (beats.end - beats.flare) * 1000));
  };
  raf = requestAnimationFrame(frame);

  return { skip };
}
