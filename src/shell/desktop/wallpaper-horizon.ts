/**
 * The live wallpaper: the Hash Globe. A planet of hex characters
 * (horizon-core.ts) turns at the centre of a disk of hashes seen nearly
 * edge-on. Hex fragments are born at the viewport edges and drift in; at the
 * disk they shred into single characters that orbit faster and hotter the
 * deeper they fall (and keep re-rolling, like a nonce) until they cross the
 * inner edge and spark out. The far half of the disk passes behind the globe,
 * the near half in front. PH/s sits on the globe; now and then a star glints. The globe beats with the pool.
 * Block found: it flares, jets fire from the poles, the disk is thrown out and
 * refills.
 *
 * History: "Event Horizon" (a black hole) replaced "The Core" speedometer on
 * 2026-10-22; on 2026-11-06 the owner turned it Bitcoin orange, doubled the
 * centre, made the stats far larger, and picked the Hash Globe over a sun, a
 * plasma orb and the black hole. All of those are in git history.
 * ?wallq=0..5 pins the quality level for QA (a throttled background tab
 * otherwise sinks to 5).
 *
 * Cost model (the owner's Edge rasterises in software):
 *  - the sky, the disk glow (a polar mesh with ring striations,
 *    rotation-invariant, so a still glow is honest about a spinning disk), the
 *    globe's halo and the HUD are offscreen canvases built on resize / data
 *    change. The sky and the far glow are baked into one scene layer; per
 *    frame it goes far characters → the globe → near glow → near characters
 *  - glyphs are drawImage calls from a pre-rendered atlas, state in typed arrays
 *  - streaks, sparks, twinkles and glows are capped pools, dropped level by level
 *  - adaptive quality levels (frame cost + pacing)
 */
import type { Wallpaper, WallpaperDebug, WallpaperOptions, WallpaperStats } from "./wallpaper";
import {
  BTC, Heartbeat, TAU, clamp, createHashGlobe, easeOut, fbm, mkCanvas, mulberry32, rgba, smooth, vnoise,
  type CoreFrame,
} from "./horizon-core";
import { createLogoFx, LOGO_ASPECT, LOGO_INK_DROP, type LogoFx } from "../brand/logo-fx";

/* ── constants ─────────────────────────────────────────────────────────── */
/**
 * Disk geometry, in globe radii (Rc = the globe's radius on screen): seen
 * nearly edge-on (the ellipse is about a sixth as tall as it is wide);
 * characters plunge at the inner edge; the glow ends at the outer one; field
 * glyphs entering the cap ellipse shred into the disk.
 */
const TILT = 0.17, R_IN = 1.1, R_OUT = 2.4, CAP_X = 2.65, CAP_Y = 1.55;
const W_OUT = 0.36; // orbital speed at the outer edge, rad/s; Keplerian (r^-1.5) inward
const VR_OUT = 0.09, VR_IN = 0.3; // inward drift through the disk, Rc/s, outer → inner
const SETTLE_S = 0.9; // a shredded character's fall from its glyph into its orbit
const EJECT_S = 1.8, BURST_S = 3.4, DIM = 0.4, BLOCK_MSG_MS = 8000, SPARK_S = 0.45;
const FIELD_DENSITY = 95 / (1920 * 1080), FIELD_MIN = 30, FIELD_MAX = 150, FIELD_CAP = 170;
const FIELD_SPEED = 0.42, FIELD_ALPHA = 0.55, ACCENT_SHARE = 0.08, TRAIL = 26;
/** Motes for a ~110px horizon; bigger holes get more (up to MOTE_CAP) so the disk reads as dense on big screens. */
const MOTE_BASE = 420, MOTE_CAP = 1100;
const STREAK_CAP = 44, SPARK_CAP = 64, TWINKLE_CAP = 18, GLINT_CAP = 5, GLINT_POOL = 160;
const BAND_GAIN = 0.95;
/** Character re-rolls per second, per mote / per field glyph: the hashes are still being hashed. */
const NONCE_RATE = 0.7, FIELD_NONCE_RATE = 0.25;
const SIZES = [14, 11, 9] as const, NBUCKET = 6, DOT = 32;
const LEVEL_MULT = [1, 0.75, 0.5, 0.32, 0.28, 0.2] as const;
/** Canvas render scale per level: 4 and 5 draw at 0.75× / 0.5× and let the browser upscale — the big lever when the GPU is off. */
const RENDER_SCALE = [1, 1, 1, 1, 0.75, 0.5] as const;
const LEVEL_MAX = LEVEL_MULT.length - 1;
/** Frame pacing above this (ms between rAF callbacks) means the browser can't keep up, whatever our own JS cost says. */
const SLOW_GAP_MS = 34;
/**
 * Gaps longer than this are the browser throttling us (a background or occluded
 * tab runs rAF at ~1-5 fps), not a slow renderer — which shows as 20-60 ms. Left
 * in, they sank a throttled tab to the lowest level, and it took ~100 s of good
 * frames to climb back once the tab was in front again.
 */
const THROTTLED_GAP_MS = 120;
/**
 * Behind an open window (dimmed) the wallpaper runs at ~24 fps: the window's
 * page is a same-origin iframe on this same thread, and a dimmed backdrop
 * doesn't need 60 (owner, 2026-11-06: lag switching pages).
 */
const DIM_FRAME_MS = 1000 / 24 - 4;
const HEX = "0123456789abcdef";

/** Software rendering (GPU acceleration off, SwiftShader, RDP…) — start low instead of discovering it over the first seconds. */
function softwareRenderer(): { software: boolean; renderer: string } {
  try {
    const gl = document.createElement("canvas").getContext("webgl") as WebGLRenderingContext | null;
    if (!gl) return { software: true, renderer: "no-webgl" };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    return { software: /swiftshader|software|llvmpipe|basic render|mesa offscreen/i.test(r), renderer: r };
  } catch {
    return { software: true, renderer: "unknown" };
  }
}

/** The profile button beside the corner logo (corner-profile.ts), css px. */
export const CORNER_BUTTON_PX = 40;
/**
 * The corner logo's box on a W-wide desktop, css px, with room at its right
 * for the profile button. corner-profile.ts uses it too, so the two line up.
 */
export function cornerLogoBox(W: number): { cx: number; cy: number; w: number; h: number; edge: number; inkCy: number } {
  const w = clamp(W * 0.15, 220, 420), h = w / LOGO_ASPECT, edge = clamp(W * 0.012, 18, 34);
  const cx = W - edge - CORNER_BUTTON_PX - 14 - w / 2, cy = edge * 0.8 + h * 0.5;
  return { cx, cy, w, h, edge, inkCy: cy - h * LOGO_INK_DROP };
}

/* ── helpers (the shared ones live in horizon-core.ts) ── */
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rgb = (r: number, g: number, b: number): string =>
  `rgb(${Math.min(255, Math.round(r))},${Math.min(255, Math.round(g))},${Math.min(255, Math.round(b))})`;
/** Letter-spaced text (canvas letterSpacing isn't everywhere yet); build-time only. */
function spaced(x: CanvasRenderingContext2D, s: string, px: number, py: number, track: number, align: "left" | "right" | "center"): void {
  const ws: number[] = [];
  let w = -track;
  for (const ch of s) { const cw = x.measureText(ch).width; ws.push(cw); w += cw + track; }
  let p = align === "left" ? px : align === "right" ? px - w : px - w / 2;
  x.textAlign = "left";
  let i = 0;
  for (const ch of s) { x.fillText(ch, p, py); p += ws[i++]! + track; }
}

/** Time-based tween: value eases from `a` to `b` over `dur` ms. */
class Tween {
  a = 0; b = 0; t0 = 0; dur = 400; v = 0;
  set(target: number, now: number, dur: number): void {
    if (target === this.b) return;
    this.a = this.v; this.b = target; this.t0 = now; this.dur = dur;
  }
  snap(target: number): void { this.a = this.b = this.v = target; }
  step(now: number): boolean {
    const t = Math.min(1, (now - this.t0) / this.dur);
    this.v = this.a + (this.b - this.a) * easeOut(t);
    return t < 1;
  }
}

export function createHorizonWallpaper(canvas: HTMLCanvasElement, opts: WallpaperOptions = {}): Wallpaper & WallpaperDebug {
  const ctx = canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D | null;
  const reduced = !!opts.reducedMotion;
  const quietLeft = opts.quietLeftPx ?? 140, quietBottom = opts.quietBottomPx ?? 40;

  const core = createHashGlobe();
  const beat = new Heartbeat();
  const frame: CoreFrame = { clock: 0, dt: 0, beat: 0, since: 1e9, pulse: 0, heat: 0.5, burst: 0 };

  // Palette: Bitcoin orange (horizon-core.ts) on the shell's greys; "hot" is the disk's white-hot inner edge.
  const cs = getComputedStyle(canvas);
  const tok = (n: string, fb: string) => (cs.getPropertyValue(n) || "").trim() || fb;
  const C = {
    fg: tok("--ph-fg", "#e6e6e6"), dim: tok("--ph-dim", "#8a8a8a"), accent: BTC.orange,
    amber: tok("--ph-amber", "#f5c451"), hot: BTC.hot, red: BTC.red,
  };
  const MONO = tok("--ph-mono", '"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace');
  const HEAD = tok("--ph-head", 'Impact,"Arial Narrow","Arial Black",sans-serif');

  /* ── state ── */
  const stats: WallpaperStats = {
    poolHashratePhs: 0, avg1dPhs: null, networkDifficulty: 0, potAgeBlocks: 0, potAgeHours: 0,
    potVerdict: "", btcPriceUsd: 0, phdBanked: 0, chainHeight: 0, blocksFound: null,
  };
  const twPh = new Tween(), twDim = new Tween();
  twDim.snap(1);
  let W = 0, H = 0, DPR = 1, mobile = false, qL = 0;
  let cx = 0, cy = 0, Rc = 100;
  let lastTs = 0, raf = 0, running = false, wantRun = false, destroyed = false, clock = 0;
  let burstOn = false, burstT = 0, blockMsgUntil = 0;
  /** Pool hashrate against its 24h average, 0..1 (0 = half the average or less, 1 = double or more). */
  let heat = 0.5;
  let gain = 1, bakedGain = -1, refill = 0;
  /** 0..1, kicked by each data update: the photon ring breathes when fresh numbers land. */
  let pulse = 0;
  const gpu = softwareRenderer();
  let level = gpu.software ? 4 : 0, ema = 8, gapEma = 16, hiSince = -1, loSince = -1;
  let pinned = false;
  try {
    const q = new URLSearchParams(location.search).get("wallq");
    if (q && /^[0-5]$/.test(q)) { level = Number(q); pinned = true; }
  } catch { /* ignore */ }
  if (gpu.software && !pinned) console.debug("[wallpaper] software renderer detected (" + gpu.renderer + ") → level 4");
  let readingKey = "";
  /** The hex characters' scale. */
  let glyphScale = 1;
  /** Px per "Rc" for the stream's speed: the newer cores are twice the size, but the glyphs shouldn't fly twice as fast. */
  let fieldUnit = 100;
  let dimmed = false;
  /**
   * The intro's PARAHAWK, small, top right (owner, 2026-11-06: "reduce the size and put a copy of that in
   * the top right of our desktop"). brand/logo-fx.ts; the smoke textures are shared with the intro.
   */
  let logo: LogoFx | null = null, logoDevW = 0, lgW = 0, lgX = 0, lgY = 0;
  let resizeTimer = 0, resizePending = false;
  const RESIZE_MS = 80;

  /* ── field glyphs: hex fragments drifting in from the edges (typed arrays; no per-frame allocation) ── */
  const fr = new Float32Array(FIELD_CAP), fa = new Float32Array(FIELD_CAP), fborn = new Float32Array(FIELD_CAP);
  const fw = new Float32Array(FIELD_CAP), fspd = new Float32Array(FIELD_CAP), flife = new Float32Array(FIELD_CAP);
  const fx = new Float32Array(FIELD_CAP), fy = new Float32Array(FIELD_CAP), fpx = new Float32Array(FIELD_CAP), fpy = new Float32Array(FIELD_CAP);
  const fdelay = new Float32Array(FIELD_CAP), fal = new Float32Array(FIELD_CAP);
  const falive = new Uint8Array(FIELD_CAP), faccent = new Uint8Array(FIELD_CAP), flen = new Uint8Array(FIELD_CAP);
  const fbk = new Uint8Array(FIELD_CAP), fsz = new Uint8Array(FIELD_CAP), fch = new Uint8Array(FIELD_CAP * 6);
  let fieldN = 0;

  /* ── motes: single characters orbiting in the disk ── */
  const mr = new Float32Array(MOTE_CAP), mth = new Float32Array(MOTE_CAP), mvr = new Float32Array(MOTE_CAP);
  const mage = new Float32Array(MOTE_CAP), msx0 = new Float32Array(MOTE_CAP), msy0 = new Float32Array(MOTE_CAP);
  const mx = new Float32Array(MOTE_CAP), my = new Float32Array(MOTE_CAP), mpx = new Float32Array(MOTE_CAP), mpy = new Float32Array(MOTE_CAP);
  const mtl = new Float32Array(MOTE_CAP);
  const malive = new Uint8Array(MOTE_CAP), mch = new Uint8Array(MOTE_CAP), mbk = new Uint8Array(MOTE_CAP);
  const msz = new Uint8Array(MOTE_CAP), mcol = new Uint8Array(MOTE_CAP), mlay = new Uint8Array(MOTE_CAP);
  const mfree = new Int16Array(MOTE_CAP);
  let moteCap = 0, moteCount = 0, mfreeN = 0;

  /* ── streaks (glowing filaments orbiting with the disk), sparks (a hash crossing the inner edge), twinkles ── */
  const skR = new Float32Array(STREAK_CAP), skTh = new Float32Array(STREAK_CAP), skLen = new Float32Array(STREAK_CAP);
  const skI = new Float32Array(STREAK_CAP), skW = new Float32Array(STREAK_CAP);
  let streakN = 0;
  const spX = new Float32Array(SPARK_CAP), spY = new Float32Array(SPARK_CAP), spT = new Float32Array(SPARK_CAP), spS = new Float32Array(SPARK_CAP);
  let spHead = 0;
  const tkX = new Float32Array(TWINKLE_CAP), tkY = new Float32Array(TWINKLE_CAP), tkA = new Float32Array(TWINKLE_CAP);
  const tkP = new Float32Array(TWINKLE_CAP), tkR = new Float32Array(TWINKLE_CAP);
  let twinkleN = 0;
  /* glints: now and then a star flares into a four-point sparkle (candidates picked in buildBg) */
  const gcX = new Float32Array(GLINT_POOL), gcY = new Float32Array(GLINT_POOL), gcB = new Float32Array(GLINT_POOL);
  let glintPool = 0, glintIn = 1.2;
  const gtX = new Float32Array(GLINT_CAP), gtY = new Float32Array(GLINT_CAP), gtAge = new Float32Array(GLINT_CAP);
  const gtDur = new Float32Array(GLINT_CAP), gtS = new Float32Array(GLINT_CAP), gtWarm = new Uint8Array(GLINT_CAP);

  function resetMotes(): void {
    malive.fill(0); mbk.fill(255);
    mfreeN = 0; moteCount = 0;
    for (let j = moteCap - 1; j >= 0; j--) mfree[mfreeN++] = j;
  }
  function allocMote(): number {
    if (mfreeN === 0) return -1;
    moteCount++;
    return mfree[--mfreeN]!;
  }
  function killMote(j: number): void {
    malive[j] = 0; mbk[j] = 255;
    mfree[mfreeN++] = j; moteCount--;
  }
  function killAllMotes(): void {
    for (let j = 0; j < moteCap; j++) if (malive[j]) killMote(j);
  }

  /* ── projection ── */
  let LX = 0, LY = 0;
  /** Disk point (r px, θ) → screen offset from the globe's centre, in LX/LY: a flat disk seen nearly edge-on. */
  function project(r: number, th: number): void {
    LX = r * Math.cos(th); LY = r * Math.sin(th) * TILT;
  }
  /** Angular speed at r (px): Keplerian, faster when the pool runs hot. */
  const omega = (r: number): number => W_OUT * Math.pow(R_OUT / Math.max(r / Rc, R_IN), 1.5) * (0.85 + 0.25 * heat);

  /* ── field glyph motion ── */
  function spawnField(i: number, initial: boolean): void {
    const e = Math.random();
    let x: number, y: number;
    const bottom = H - quietBottom;
    if (e < 0.3) { x = qL + Math.random() * (W - qL); y = -12; }
    else if (e < 0.6) { x = qL + Math.random() * (W - qL); y = bottom + 12; }
    else if (e < 0.85) { x = W + 12; y = Math.random() * bottom; }
    else { x = qL - 4; y = Math.random() * bottom; }
    const dx = x - cx, dy = y - cy, a = Math.atan2(dy, dx);
    const ca = Math.cos(a) / (CAP_X * Rc), sa = Math.sin(a) / (CAP_Y * Rc);
    const cap = 1 / Math.sqrt(ca * ca + sa * sa);
    const born = Math.max(cap * 1.05, Math.sqrt(dx * dx + dy * dy));
    fborn[i] = born; fa[i] = a;
    fr[i] = initial ? cap + Math.random() * (born - cap) : born;
    // Clockwise on screen, the same way the disk turns, so the stream reads as one vortex.
    fw[i] = 0.04 + Math.random() * 0.22;
    fspd[i] = FIELD_SPEED * fieldUnit * (0.7 + Math.random() * 0.8);
    faccent[i] = Math.random() < ACCENT_SHARE ? 1 : 0;
    const n = Math.random(), len = n < 0.5 ? 2 : n < 0.85 ? 4 : 6;
    flen[i] = len;
    for (let k = 0; k < len; k++) fch[i * 6 + k] = (Math.random() * 16) | 0;
    flife[i] = Math.random(); falive[i] = 1; fdelay[i] = 0; fal[i] = 0;
    const r = fr[i]!;
    fx[i] = fpx[i] = cx + Math.cos(a) * r; fy[i] = fpy[i] = cy + Math.sin(a) * r;
  }
  /** A glyph reached the disk: its characters peel off and fall into orbit, where it was heading. */
  function shred(i: number, x: number, y: number, dx: number, dy: number): void {
    const n = flen[i]!;
    const take = Math.min(n, 1 + (Math.random() < 0.6 ? 1 : 0) + (n >= 4 && Math.random() < 0.3 ? 1 : 0));
    const th0 = Math.atan2(dy / TILT, dx), rr = R_OUT * (0.84 + 0.16 * Math.random()) * Rc;
    const cw = cellW[fsz[i]!]!;
    for (let k = 0; k < take; k++) {
      const j = allocMote();
      if (j < 0) return;
      const kk = Math.min(n - 1, Math.floor((k * n) / take));
      mch[j] = fch[i * 6 + kk]!;
      mr[j] = rr * (1 + (Math.random() - 0.5) * 0.05);
      mth[j] = th0 + k * 0.035;
      mvr[j] = 0.8 + Math.random() * 0.4;
      mage[j] = 0;
      const sx = x + kk * cw + cw / 2;
      msx0[j] = sx; msy0[j] = y;
      mx[j] = mpx[j] = sx; my[j] = mpy[j] = y;
      malive[j] = 1;
    }
  }
  /** Matter already in the disk: keeps it full on big screens and refills it after a block. Fades in at the outer edge. */
  function feedDisk(): void {
    const j = allocMote();
    if (j < 0) return;
    mr[j] = R_OUT * (0.82 + 0.18 * Math.random()) * Rc; mth[j] = Math.random() * TAU;
    mvr[j] = 0.8 + Math.random() * 0.4; mage[j] = 0;
    mch[j] = (Math.random() * 16) | 0; malive[j] = 1;
    project(mr[j]!, mth[j]!);
    msx0[j] = mx[j] = mpx[j] = cx + LX; msy0[j] = my[j] = mpy[j] = cy + LY;
  }
  function resizePools(): void {
    const area = (W - qL) * (H - quietBottom);
    const want = Math.round(clamp(area * FIELD_DENSITY, FIELD_MIN, FIELD_MAX) * LEVEL_MULT[level]!);
    fieldN = Math.min(FIELD_CAP, mobile ? Math.min(want, 40) : want);
    for (let i = 0; i < fieldN; i++) spawnField(i, true);
    // The globe is twice the old black hole's size, so its disk has about twice the area on screen: more motes.
    const dens = clamp(Math.pow(Rc / 180, 1.3), 0.6, 2.4);
    moteCap = Math.min(MOTE_CAP, Math.round(MOTE_BASE * dens * LEVEL_MULT[level]! * (mobile ? 0.45 : 1)));
    resetMotes();
    // Start with a lit disk rather than an empty one that takes ten seconds to fill.
    const seed = Math.round(moteCap * 0.72);
    for (let k = 0; k < seed; k++) {
      const j = allocMote();
      if (j < 0) break;
      mr[j] = (R_IN + (R_OUT - R_IN) * Math.random()) * Rc; mth[j] = Math.random() * TAU;
      mvr[j] = 0.8 + Math.random() * 0.4; mage[j] = SETTLE_S + Math.random();
      mch[j] = (Math.random() * 16) | 0; malive[j] = 1;
      project(mr[j]!, mth[j]!);
      mx[j] = mpx[j] = cx + LX; my[j] = mpy[j] = cy + LY;
    }
    streakN = level < 2 ? STREAK_CAP : level < 3 ? 24 : 0;
    for (let k = 0; k < streakN; k++) {
      const u = Math.random();
      skR[k] = R_IN + 0.05 + (R_OUT * 0.78 - R_IN) * u * u; // crowd the hot inner disk
      skTh[k] = Math.random() * TAU; skLen[k] = 0.25 + Math.random() * 0.75;
      skI[k] = 0.1 + Math.random() * 0.24; skW[k] = 0.6 + Math.random() * 1.1;
    }
    spT.fill(0);
  }
  function stepField(dt: number): void {
    const push = burstOn && burstT < 1.2 ? Rc * 2.2 * (1 - burstT / 1.2) * (1 - burstT / 1.2) : 0;
    const spin = 0.85 + 0.25 * heat, roll = FIELD_NONCE_RATE * dt;
    const fadeX0 = qL - 20, quietEdge = qL + 60, capX = CAP_X * Rc, capY = CAP_Y * Rc;
    for (let i = 0; i < fieldN; i++) {
      if (!falive[i]) {
        const d = fdelay[i]! - dt;
        if (d > 0) { fdelay[i] = d; fbk[i] = 255; continue; }
        spawnField(i, false);
      }
      const born = fborn[i]!;
      let r = fr[i]!, a = fa[i]!;
      const tt = 1 - r / born;
      fpx[i] = fx[i]!; fpy[i] = fy[i]!;
      if (push > 0) r += push * dt;
      else r -= fspd[i]! * (1 + 0.9 * tt) * (0.85 + 0.3 * heat) * dt;
      a += fw[i]! * dt * (0.4 + 0.6 * tt) * spin;
      fr[i] = r; fa[i] = a;
      const ca = Math.cos(a), sa = Math.sin(a);
      const x = cx + ca * r, y = cy + sa * r;
      fx[i] = x; fy[i] = y;
      if (push <= 0) {
        const ex = (ca * r) / capX, ey = (sa * r) / capY;
        if (ex * ex + ey * ey < 1) { shred(i, x, y, ca * r, sa * r); falive[i] = 0; fdelay[i] = 0; fbk[i] = 255; continue; }
      } else if (r > born * 1.5) { falive[i] = 0; fdelay[i] = Math.random() * 1.5; fbk[i] = 255; continue; }
      if (Math.random() < roll) fch[i * 6 + ((Math.random() * flen[i]!) | 0)] = (Math.random() * 16) | 0;
      // visibility + alpha bucket + size, computed once here so the draw pass is pure drawImage
      if (x < fadeX0 || x > W + 10 || y < -10 || y > H) { fbk[i] = 255; continue; }
      let al: number;
      if (push > 0) al = fal[i]! * (1 - burstT / 1.2);
      else {
        const t = Math.min(1, r / born);
        al = FIELD_ALPHA * Math.sin(Math.min(1, (1 - t) * 3) * Math.PI * 0.5) * (0.6 + 0.4 * (1 - t));
        if (!faccent[i]) al *= 0.5 + 0.5 * flife[i]!; else al = Math.min(1, al * 1.6);
        fal[i] = al;
        fsz[i] = t > 0.66 ? 0 : t > 0.33 ? 1 : 2;
      }
      if (x < quietEdge) al *= (x - fadeX0) / 80;
      if (al <= 0.02) { fbk[i] = 255; continue; }
      fbk[i] = Math.min(NBUCKET - 1, (al * NBUCKET) | 0);
    }
  }
  function stepMotes(dt: number): void {
    const eject = burstOn && burstT < EJECT_S, ej = eject ? 1 - burstT / EJECT_S : 0;
    const rin = R_IN * Rc, roll = NONCE_RATE * dt, sparks = level < 4 && !eject;
    // keep the disk fed (and refill it after a block), outside the ejection itself
    if (!burstOn && dt > 0) {
      const want = moteCap * 0.72;
      if (moteCount < want) {
        refill += (want - moteCount) * 0.3 * dt;
        while (refill >= 1) { feedDisk(); refill -= 1; }
      } else refill = 0;
    }
    for (let j = 0; j < moteCap; j++) {
      if (!malive[j]) continue;
      let r = mr[j]!, th = mth[j]!;
      const rc = r / Rc;
      const hv = clamp((R_OUT - rc) / (R_OUT - R_IN), 0, 1); // heat: 0 at the outer edge, 1 at the inner
      if (eject) r += Rc * 2.8 * ej * ej * mvr[j]! * dt;
      else r -= Rc * (VR_OUT + (VR_IN - VR_OUT) * hv * Math.sqrt(hv)) * mvr[j]! * dt;
      th += omega(r) * dt;
      if (th > TAU) th -= TAU;
      mr[j] = r; mth[j] = th;
      const age = mage[j]! + dt;
      mage[j] = age;
      if (r < rin) {
        // The globe hides the far half's sparks.
        const hidden = Math.sin(th) < 0 && Math.hypot(mx[j]! - cx, my[j]! - cy) < Rc * 0.98;
        if (sparks && !hidden && Math.random() < 0.55) spark(mx[j]!, my[j]!, Rc * (0.07 + 0.06 * Math.random()));
        killMote(j); continue;
      }
      if (Math.random() < roll) mch[j] = (Math.random() * 16) | 0;
      project(r, th);
      let x = cx + LX, y = cy + LY;
      const st = age / SETTLE_S;
      if (st < 1) {
        const e = easeInOut(st);
        x = msx0[j]! + (x - msx0[j]!) * e; y = msy0[j]! + (y - msy0[j]!) * e;
      }
      mpx[j] = mx[j]!; mpy[j] = my[j]!; mx[j] = x; my[j] = y;
      const sn = Math.sin(th);
      mlay[j] = sn < 0 ? 0 : 1;
      // Hotter inward; the side turning towards us is brighter (Doppler beaming).
      let al = (0.34 + 0.64 * Math.pow(hv, 1.1)) * (0.72 + 0.28 * Math.cos(th));
      if (st < 1) al *= 0.45 + 0.55 * st;
      const edge = (rc - R_IN) / 0.12;
      if (edge < 1) al *= Math.max(0, edge);
      if (eject) al *= ej;
      mcol[j] = hv < 0.38 ? 0 : hv < 0.78 ? 1 : 2;
      msz[j] = Math.max(0, (hv > 0.55 ? 2 : 1) - (sn > 0.35 ? 1 : 0));
      mtl[j] = 5 + 22 * hv;
      mbk[j] = al <= 0.03 ? 255 : Math.min(NBUCKET - 1, (al * NBUCKET) | 0);
    }
  }
  function stepStreaks(dt: number): void {
    for (let k = 0; k < streakN; k++) {
      let th = skTh[k]! + omega(skR[k]! * Rc) * dt;
      if (th > TAU) th -= TAU;
      skTh[k] = th;
    }
  }
  function spark(x: number, y: number, size: number): void {
    spX[spHead] = x; spY[spHead] = y; spT[spHead] = SPARK_S; spS[spHead] = size;
    spHead = (spHead + 1) % SPARK_CAP;
  }

  /* ── caches ── */
  let atlas: HTMLCanvasElement | null = null;
  const cellW = [0, 0, 0], cellH = [0, 0, 0];
  let atlasCol = 0, atlasRow = 0;
  /** 16 hex chars × 3 sizes × 3 colours (fg, orange, hot). */
  function buildAtlas(): void {
    let mw = 0, mh = 0;
    const tmp = mkCanvas(4, 4)[1];
    const px = (s: number): number => Math.round(SIZES[s]! * glyphScale);
    for (let s = 0; s < 3; s++) {
      tmp.font = `${px(s)}px ${MONO}`;
      cellW[s] = Math.ceil(tmp.measureText("0").width) + 1; cellH[s] = Math.ceil(px(s) * 1.3);
      mw = Math.max(mw, cellW[s]!); mh = Math.max(mh, cellH[s]!);
    }
    atlasCol = mw; atlasRow = mh;
    const [c, x] = mkCanvas(16 * mw * DPR, 9 * mh * DPR);
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
    x.textBaseline = "middle"; x.textAlign = "left";
    const cols = [C.fg, C.accent, C.hot];
    for (let col = 0; col < 3; col++) {
      x.fillStyle = cols[col]!;
      for (let s = 0; s < 3; s++) {
        x.font = `${px(s)}px ${MONO}`;
        const row = col * 3 + s;
        for (let k = 0; k < 16; k++) x.fillText(HEX[k]!, k * mw, row * mh + mh / 2);
      }
    }
    atlas = c;
  }

  /** A soft round light (sparks, twinkles, hot-mote glows). */
  let dot: HTMLCanvasElement | null = null;
  function buildDot(): void {
    const [c, x] = mkCanvas(DOT, DOT);
    const g = x.createRadialGradient(DOT / 2, DOT / 2, 0, DOT / 2, DOT / 2, DOT / 2);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.22, "rgba(255,226,190,0.6)");
    g.addColorStop(0.55, rgba(C.accent, 0.14)); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, DOT, DOT);
    dot = c;
  }

  /**
   * The sky: a galaxy band and a faint warm nebula, both procedural; stars,
   * denser along the band; diffraction spikes on the brightest; vignette; grain.
   */
  let bg: HTMLCanvasElement | null = null;
  function buildBg(): void {
    const gd = Math.min(DPR, 1.25);
    const [c, x] = mkCanvas(W * gd, H * gd);
    x.setTransform(gd, 0, 0, gd, 0, 0);
    x.fillStyle = "#000"; x.fillRect(0, 0, W, H);
    const fadeX0 = qL - 20;
    const leftFade = (X: number): number => (X < qL + 60 ? 0.3 + 0.7 * clamp((X - fadeX0) / 80, 0, 1) : 1);
    // galaxy band: through (0.3W, 0.8H), rising to the right
    const ang = (-21 * Math.PI) / 180, ax = Math.cos(ang), ay = Math.sin(ang);
    const gx0 = W * 0.3, gy0 = H * 0.8, bandW = Math.max(H, W * 0.5) * 0.15;
    const bandAt = (sx: number, sy: number): number => {
      const v = -(sx - gx0) * ay + (sy - gy0) * ax;
      return Math.exp(-(v * v) / (bandW * bandW));
    };
    {
      const f = level >= 4 ? 0.2 : 0.3;
      const bw = Math.max(8, Math.ceil(W * f)), bh = Math.max(8, Math.ceil(H * f));
      const [nb, nx] = mkCanvas(bw, bh);
      const img = nx.createImageData(bw, bh), px = img.data;
      const sc = 1 / Math.max(W, H);
      for (let j = 0; j < bh; j++) {
        for (let i = 0; i < bw; i++) {
          const o = (j * bw + i) * 4;
          px[o + 3] = 255;
          const sx = (i + 0.5) / f, sy = (j + 0.5) / f;
          const band = bandAt(sx, sy);
          let g = 0;
          if (band > 0.012) {
            const u = (sx - gx0) * ax + (sy - gy0) * ay;
            // star clouds (fine fBm) × grain (unresolved stars) − thin dark dust lanes, swelling along the band
            const n1 = fbm(sx * sc * 13, sy * sc * 13, 5, 11);
            const grain = 0.55 + 0.45 * vnoise(sx * sc * 260, sy * sc * 260, 3);
            const dust = fbm(sx * sc * 22 + 3.1, sy * sc * 22, 4, 29);
            const lane = 1 - 0.9 * smooth(0.5, 0.66, dust) * smooth(0.25, 0.8, band);
            g = band * band * smooth(0.3, 0.75, n1) * grain * lane * (0.6 + 0.4 * Math.cos(u * sc * 3.2));
          }
          const neb = smooth(0.55, 0.9, fbm(sx * sc * 2.6 + 7.7, sy * sc * 2.6, 4, 47));
          const lf = leftFade(sx);
          px[o] = (g * 36 + neb * 11) * lf;
          px[o + 1] = (g * 34 + neb * 5) * lf;
          px[o + 2] = (g * 31 + neb * 2) * lf;
        }
      }
      nx.putImageData(img, 0, 0);
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
      x.drawImage(nb, 0, 0, W, H);
    }
    // a faint orange breath around the core, and a dust lane along the disk plane
    let g = x.createRadialGradient(cx, cy, 0, cx, cy, Rc * 7);
    g.addColorStop(0, rgba(C.accent, 0.05)); g.addColorStop(0.35, rgba(C.accent, 0.016)); g.addColorStop(1, rgba(C.accent, 0));
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.save(); x.translate(cx, cy); x.scale(1, 0.24);
    g = x.createRadialGradient(0, 0, 0, 0, 0, Rc * 9);
    g.addColorStop(0, rgba(C.accent, 0.035)); g.addColorStop(1, rgba(C.accent, 0));
    x.fillStyle = g; x.fillRect(-Rc * 9, -Rc * 9, Rc * 18, Rc * 18);
    x.restore();
    // Stars, denser along the galaxy band, none behind the globe. Same stars every load.
    const rnd = mulberry32(0x5eed);
    const nUniform = Math.round(W * H * 0.0002), nBand = Math.round(W * H * 0.00042);
    twinkleN = 0; glintPool = 0;
    const spikes: [number, number, number][] = [];
    for (let k = 0; k < nUniform + nBand; k++) {
      let sx = rnd() * W, sy = rnd() * H;
      if (k >= nUniform) { // rejection-sample into the band
        let tries = 0;
        while (rnd() > bandAt(sx, sy) && tries++ < 12) { sx = rnd() * W; sy = rnd() * H; }
      }
      const d = Math.hypot(sx - cx, sy - cy);
      const r0 = rnd(), b = (k >= nUniform ? 0.035 : 0.06) + (k >= nUniform ? 0.45 : 0.62) * r0 * r0 * r0, big = r0 > 0.95;
      const tint = rnd();
      const col = tint < 0.8 ? "#ffffff" : tint < 0.94 ? "#ffe0bc" : "#ffe9b8";
      const px = sx, py = sy, lf = px < qL + 60 ? clamp((px - fadeX0) / 80, 0, 1) : 1;
      if (lf > 0 && d > Rc * 1.02) {
        x.globalAlpha = Math.min(1, b * lf); x.fillStyle = col;
        const sz = big ? 1.6 : 1;
        x.fillRect(px, py, sz, sz);
        if (big && b > 0.42 && lf > 0.9) spikes.push([px + sz / 2, py + sz / 2, b]);
        const ex = (px - cx) / (R_OUT * Rc), ey = (py - cy) / (1.45 * Rc);
        if (b > 0.18 && lf > 0.95 && ex * ex + ey * ey > 1 && glintPool < GLINT_POOL && rnd() < 0.6) {
          gcX[glintPool] = px + sz / 2; gcY[glintPool] = py + sz / 2; gcB[glintPool] = b; glintPool++;
        }
        if (b > 0.3 && lf > 0.9 && twinkleN < TWINKLE_CAP && rnd() < 0.5) {
          tkX[twinkleN] = px + sz / 2; tkY[twinkleN] = py + sz / 2; tkA[twinkleN] = b;
          tkP[twinkleN] = rnd() * TAU; tkR[twinkleN] = 0.6 + rnd() * 1.8; twinkleN++;
        }
      }
    }
    // diffraction spikes on the few brightest
    x.lineWidth = 1;
    for (const [sx, sy, b] of spikes.slice(0, 9)) {
      const L = 5 + 7 * b;
      for (const [ux, uy] of [[1, 0], [0, 1]] as const) {
        const gr = x.createLinearGradient(sx - ux * L, sy - uy * L, sx + ux * L, sy + uy * L);
        gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, `rgba(255,255,255,${(0.55 * b).toFixed(3)})`); gr.addColorStop(1, "rgba(255,255,255,0)");
        x.globalAlpha = 1; x.strokeStyle = gr;
        x.beginPath(); x.moveTo(sx - ux * L, sy - uy * L); x.lineTo(sx + ux * L, sy + uy * L); x.stroke();
      }
    }
    x.globalAlpha = 1;
    const diag = Math.sqrt(W * W + H * H);
    g = x.createRadialGradient(cx, cy, Math.min(W, H) * 0.35, cx, cy, diag * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.6)");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // grain: a fixed noise tile, so the blacks have a little texture and the gradients don't band
    const [t, tx] = mkCanvas(96, 96);
    const img = tx.createImageData(96, 96), gp = img.data;
    for (let i = 0; i < gp.length; i += 4) {
      const v = (rnd() * 255) | 0;
      gp[i] = v; gp[i + 1] = v; gp[i + 2] = v; gp[i + 3] = (rnd() * 7) | 0;
    }
    tx.putImageData(img, 0, 0);
    const pat = x.createPattern(t, "repeat");
    if (pat) { x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = pat; x.fillRect(0, 0, c.width, c.height); }
    bg = c;
  }

  /**
   * The disk's glow, as two layers: the far half baked under the globe, the
   * near half blitted over it each frame. Built from a polar mesh of small quads pushed through
   * project(), the same mapping the characters use, each quad nudged outward a
   * hair so neighbours overlap instead of leaving seams. Brightness: a hot inner
   * edge, ring striations and two gaps — all functions of radius only. Painted
   * opaque on black and composited with "lighter" (additive).
   */
  let backGlow: HTMLCanvasElement | null = null, frontGlow: HTMLCanvasElement | null = null;
  let glX = 0, glW = 0, bY0 = 0, bH = 0, fY0 = 0, fH = 0;
  /**
   * Brightness across the disk, worked in the proportions it was tuned in (the
   * old black hole's disk, u = 1.3 … 3.8 of its radius) so the rings and gaps
   * keep their look.
   */
  const ringProfile = (rc: number): number => {
    const t = (rc - R_IN) / (R_OUT - R_IN), u = 1.3 + 2.5 * t;
    const base = Math.pow(1.3 / u, 1.4) * smooth(0, 0.035, t) * (1 - smooth(0.55, 1, t)) * (1 + 0.6 * (1 - smooth(0, 0.22, t)));
    const stri = 0.55 * vnoise(u * 9, 3.3, 5) + 0.3 * vnoise(u * 23, 7.1, 6) + 0.15 * vnoise(u * 47, 1.7, 7);
    const gaps = 1 - 0.55 * Math.exp(-Math.pow((u - 2.42) / 0.045, 2)) - 0.35 * Math.exp(-Math.pow((u - 3.05) / 0.035, 2));
    return base * (0.6 + 0.8 * stri) * gaps;
  };
  function renderBand(y0: number, h: number, back: boolean): HTMLCanvasElement {
    const gd = Math.min(DPR, 1.25), hiQ = level < 2, loQ = level >= 4;
    const [raw, rx] = mkCanvas(glW * gd, h * gd);
    rx.fillStyle = "#000"; rx.fillRect(0, 0, raw.width, raw.height);
    rx.setTransform(gd, 0, 0, gd, (cx - glX) * gd, (cy - y0) * gd);
    const NR = hiQ ? 110 : loQ ? 44 : 72, NT = hiQ ? 180 : loQ ? 96 : 140, n1 = NT + 1, th0 = back ? Math.PI : 0;
    const P = new Float32Array((NR + 1) * n1 * 2);
    for (let i = 0; i <= NR; i++) {
      const r = (R_IN + ((R_OUT - R_IN) * i) / NR) * Rc;
      for (let j = 0; j <= NT; j++) {
        project(r, th0 + (Math.PI * j) / NT);
        const o = (i * n1 + j) * 2;
        P[o] = LX; P[o + 1] = LY;
      }
    }
    const grow = 0.6 / gd; // CSS px each vertex moves away from its quad's centre
    const vx = [0, 0, 0, 0], vy = [0, 0, 0, 0], idx = [0, 0, 0, 0];
    for (let i = 0; i < NR; i++) {
      const rc = R_IN + ((R_OUT - R_IN) * (i + 0.5)) / NR, t = (rc - R_IN) / (R_OUT - R_IN);
      const I = ringProfile(rc);
      if (I < 0.003) continue;
      // white-hot at the inner edge → Bitcoin orange → a little deeper towards the outside
      const k = Math.min(1, t * 2.4), deep = smooth(0.42, 1, t);
      const cr = 255 + (247 - 255) * k - 22 * deep, cg = 236 + (147 - 236) * k - 47 * deep, cb = 206 + (26 - 206) * k - 11 * deep;
      for (let j = 0; j < NT; j++) {
        const cth = Math.cos(th0 + (Math.PI * (j + 0.5)) / NT);
        // the side turning towards us: brighter and a touch whiter
        const v = I * (0.76 + 0.24 * cth) * BAND_GAIN, wh = 0.14 * Math.max(0, cth);
        if (v < 0.004) continue;
        const a = (i * n1 + j) * 2;
        idx[0] = a; idx[1] = a + 2; idx[2] = a + n1 * 2 + 2; idx[3] = a + n1 * 2;
        let mxq = 0, myq = 0;
        for (let q = 0; q < 4; q++) { vx[q] = P[idx[q]!]!; vy[q] = P[idx[q]! + 1]!; mxq += vx[q]!; myq += vy[q]!; }
        mxq /= 4; myq /= 4;
        rx.beginPath();
        for (let q = 0; q < 4; q++) {
          const ex = vx[q]! - mxq, ey = vy[q]! - myq, el = Math.sqrt(ex * ex + ey * ey) || 1;
          const px = vx[q]! + (ex / el) * grow, py = vy[q]! + (ey / el) * grow;
          if (q === 0) rx.moveTo(px, py); else rx.lineTo(px, py);
        }
        rx.closePath();
        rx.fillStyle = rgb((cr + (255 - cr) * wh) * v, (cg + (255 - cg) * wh) * v, (cb + (255 - cb) * wh) * v);
        rx.fill();
      }
    }
    // soften the mesh into light, plus a wide bloom when there's GPU to spare
    const [out, ox] = mkCanvas(raw.width, raw.height);
    if (typeof ox.filter === "string") {
      ox.globalCompositeOperation = "lighter";
      ox.filter = `blur(${(0.9 * gd).toFixed(2)}px)`; ox.drawImage(raw, 0, 0);
      if (!loQ) { ox.filter = `blur(${(11 * gd).toFixed(1)}px)`; ox.globalAlpha = 0.55; ox.drawImage(raw, 0, 0); }
      if (hiQ) { ox.filter = `blur(${(28 * gd).toFixed(1)}px)`; ox.globalAlpha = 0.3; ox.drawImage(raw, 0, 0); }
      ox.filter = "none"; ox.globalAlpha = 1;
    } else ox.drawImage(raw, 0, 0);
    return out;
  }
  function buildGlow(): void {
    // Each half is a thin crescent, so the bands hug it (the near one is blitted every frame).
    const half = R_OUT * TILT * Rc, pad = Math.max(0.16 * Rc, 36);
    glX = cx - R_OUT * Rc - pad; glW = 2 * (R_OUT * Rc + pad);
    bY0 = cy - half - pad; bH = half + pad * 2;
    fY0 = cy - pad; fH = half + pad * 2;
    backGlow = renderBand(bY0, bH, true);
    frontGlow = renderBand(fY0, fH, false);
  }

  /** Burst sprites: the flash, the jets, the anamorphic streak. */
  let flash: HTMLCanvasElement | null = null, jet: HTMLCanvasElement | null = null, flare: HTMLCanvasElement | null = null;
  function buildBurstSprites(): void {
    const f = Rc * 2.4;
    let [c, x] = mkCanvas(f * 2, f * 2);
    let g = x.createRadialGradient(f, f, 0, f, f, f);
    g.addColorStop(0, "rgba(255,255,255,0.9)"); g.addColorStop(0.3, rgba(C.accent, 0.3)); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, f * 2, f * 2);
    flash = c;
    // jet: base at the bottom (at the pole), tapering and fading upward
    [c, x] = mkCanvas(96, 512);
    x.beginPath(); x.moveTo(0, 512); x.lineTo(96, 512); x.lineTo(56, 0); x.lineTo(40, 0); x.closePath(); x.clip();
    g = x.createLinearGradient(0, 512, 0, 0);
    g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(0.18, "rgba(255,226,190,0.6)");
    g.addColorStop(0.6, rgba(C.accent, 0.18)); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 96, 512);
    x.globalCompositeOperation = "destination-in";
    g = x.createLinearGradient(0, 0, 96, 0);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.5, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 96, 512);
    jet = c;
    // anamorphic streak: a thin horizontal line of light through the core
    [c, x] = mkCanvas(1024, 32);
    g = x.createLinearGradient(0, 0, 1024, 0);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.5, "rgba(255,226,190,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 15, 1024, 2);
    x.globalAlpha = 0.25; x.fillRect(0, 12, 1024, 8);
    x.globalAlpha = 0.08; x.fillRect(0, 4, 1024, 24);
    flare = c;
  }

  /** The static layers baked into one: per frame that is a single blit. */
  let scene: HTMLCanvasElement | null = null, sceneCtx: CanvasRenderingContext2D | null = null;
  function bakeScene(): void {
    if (!scene || !sceneCtx) return;
    const x = sceneCtx;
    bakedGain = gain;
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
    x.globalCompositeOperation = "source-over"; x.globalAlpha = 1;
    if (bg) x.drawImage(bg, 0, 0, W, H);
    core.bake?.(x);
    x.globalCompositeOperation = "lighter"; x.globalAlpha = gain;
    if (backGlow) x.drawImage(backGlow, glX, bY0, glW, bH);
    // a faint anamorphic streak along the disk plane, like the lens that films it (behind the globe)
    x.globalCompositeOperation = "lighter";
    if (flare) { x.globalAlpha = 0.16 * gain; x.drawImage(flare, cx - (R_OUT + 4) * Rc, cy - 16, (R_OUT + 4) * Rc * 2, 32); }
    x.globalCompositeOperation = "source-over"; x.globalAlpha = 1;
  }

  /**
   * The reading on the core (caption, PH/s, unit) as one cached sprite,
   * re-rendered only when the number or the caption changes, so a core that
   * inks it with a shadow pays for the blur once, not every frame.
   */
  let reading: HTMLCanvasElement | null = null, rdW = 0, rdH = 0, rdTop = 0, labelFs = 10;
  function renderReading(value: number, block: boolean): void {
    if (!reading) return;
    const ink = core.ink;
    const x = reading.getContext("2d") as CanvasRenderingContext2D;
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
    x.clearRect(0, 0, rdW, rdH);
    if (ink.shadow) { x.shadowColor = ink.shadow; x.shadowBlur = Math.max(6, Rc * 0.05); }
    x.textBaseline = "middle";
    x.font = `${labelFs}px ${MONO}`; x.fillStyle = block ? C.accent : ink.label;
    spaced(x, block ? "BLOCK FOUND" : "POOL HASHRATE", rdW / 2, rdTop - 0.42 * Rc, labelFs * 0.28, "center");
    const num = value.toFixed(1);
    x.font = fontBig; const nw = x.measureText(num).width;
    x.font = fontUnit; const uw = x.measureText(" PH/s").width;
    const x0 = rdW / 2 - (nw + uw) / 2, base = rdTop + 0.1 * Rc;
    x.textBaseline = "alphabetic"; x.textAlign = "left";
    x.font = fontBig; x.fillStyle = ink.value; x.fillText(num, x0, base);
    x.font = fontUnit; x.fillStyle = ink.unit; x.fillText(" PH/s", x0 + nw, base);
  }

  /* ── layout ── */
  let fontBig = "", fontUnit = "";
  function layout(): void {
    if (!ctx) return;
    DPR = Math.min(level >= 1 ? 1.5 : 2, window.devicePixelRatio || 1) * RENDER_SCALE[level]!;
    W = canvas.clientWidth || 1; H = canvas.clientHeight || 1;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    mobile = W < 768;
    qL = mobile ? 0 : quietLeft;
    const availH = H - quietBottom;
    if (mobile) {
      // phones: the icon grid fills the top of the screen, so the globe sits in the free part below it
      Rc = clamp(Math.min(W / (2 * (R_OUT + 0.35)), availH * 0.11), 36, 170);
      cx = W / 2; cy = availH * 0.74;
    } else {
      // As big as the screen allows ("make our hash globe like even bigger"), centred right of the icons and
      // above the taskbar: `above` covers the caption and halo, `below` the halo under it, in globe radii.
      const room = availH - 44, above = 1.32, below = 1.32;
      Rc = clamp(Math.min(room / (above + below), (W - qL - 40) / (2 * (R_OUT + 0.25))), 48, 640);
      cy = (room - (above + below) * Rc) / 2 + above * Rc;
      const half = (R_OUT + 0.25) * Rc, lo = qL + half, hi = W - half;
      cx = lo <= hi ? clamp(W * 0.56, lo, hi) : qL + (W - qL) / 2;
    }
    glyphScale = mobile ? 1 : clamp(Rc / 260, 1, 1.35);
    fieldUnit = Rc * 0.5;
    fontBig = `bold ${Math.round(Rc * 0.34)}px ${MONO}`;
    fontUnit = `${Math.max(10, Math.round(Rc * 0.12))}px ${MONO}`;
    // the caption: as large as fits across the core
    {
      const tmp = mkCanvas(4, 4)[1], maxW = Rc * 1.6;
      const widthAt = (f: number): number => {
        tmp.font = `${f}px ${MONO}`;
        let w = -f * 0.28;
        for (const ch of "POOL HASHRATE") w += tmp.measureText(ch).width + f * 0.28;
        return w;
      };
      labelFs = Math.max(9, Math.round(Rc * 0.085));
      while (labelFs > 7 && widthAt(labelFs) > maxW) labelFs--;
    }
    rdW = Rc * 2; rdTop = 0.7 * Rc; rdH = rdTop + 0.36 * Rc;
    reading = mkCanvas(rdW * DPR, rdH * DPR)[0]; readingKey = "";
    if (!mobile) {
      const box = cornerLogoBox(W);
      lgW = box.w; lgX = box.cx; lgY = box.cy;
      const want = Math.round(lgW * Math.max(1, DPR));
      if (!logo || want > logoDevW * 1.25) {
        logoDevW = want;
        logo = createLogoFx({ devW: want, id: "ph-desk-rough", head: HEAD, orange: C.accent, label: "wallpaper" });
        if (reduced) buildLogoStill(0);
      }
    }
    buildAtlas(); buildDot(); buildBg(); buildGlow(); buildBurstSprites();
    core.layout({ cx, cy, R: Rc, DPR, level, mobile, mono: MONO });
    [scene, sceneCtx] = mkCanvas(W * DPR, H * DPR);
    resizePools();
    gain = glowTarget(); bakeScene();
  }

  /* ── drawing ── */
  function drawField(): void {
    if (!ctx || !atlas) return;
    const trails = level < 2;
    for (let b = 0; b < NBUCKET; b++) {
      const ba = (b + 0.5) / NBUCKET;
      if (trails) {
        ctx.globalAlpha = ba * 0.45; ctx.strokeStyle = C.accent; ctx.lineWidth = 1; ctx.beginPath();
        let any = false;
        for (let i = 0; i < fieldN; i++) {
          if (fbk[i] !== b || !faccent[i]) continue;
          const x = fx[i]!, y = fy[i]!, dx = x - fpx[i]!, dy = y - fpy[i]!;
          const L = Math.sqrt(dx * dx + dy * dy) || 1, tl = TRAIL * (0.5 + 0.5 * (1 - fr[i]! / fborn[i]!));
          ctx.moveTo(x, y); ctx.lineTo(x - (dx / L) * tl, y - (dy / L) * tl); any = true;
        }
        if (any) ctx.stroke();
      }
      ctx.globalAlpha = ba;
      for (let i = 0; i < fieldN; i++) {
        if (fbk[i] !== b) continue;
        const s = fsz[i]!, cw = cellW[s]!, ch = cellH[s]!, row = (faccent[i]! * 3 + s) * atlasRow * DPR;
        const x = fx[i]!, y = fy[i]! - ch / 2, n = flen[i]!, base = i * 6;
        for (let k = 0; k < n; k++)
          ctx.drawImage(atlas, fch[base + k]! * atlasCol * DPR, row, cw * DPR, ch * DPR, x + k * cw, y, cw, ch);
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawMotes(layer: number): void {
    if (!ctx || !atlas) return;
    if (level === 0 && dot) {
      // the white-hot ones glow
      ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.11;
      const s = Rc * 0.08;
      for (let j = 0; j < moteCap; j++) {
        if (mlay[j] !== layer || mcol[j] !== 2 || mbk[j]! < 2 || mbk[j] === 255) continue;
        ctx.drawImage(dot, mx[j]! - s / 2, my[j]! - s / 2, s, s);
      }
      ctx.globalCompositeOperation = "source-over";
    }
    const trails = level < 2;
    for (let b = 0; b < NBUCKET; b++) {
      const ba = (b + 0.5) / NBUCKET;
      if (trails) {
        ctx.globalAlpha = ba * 0.4; ctx.strokeStyle = C.accent; ctx.lineWidth = 1; ctx.beginPath();
        let any = false;
        for (let j = 0; j < moteCap; j++) {
          if (mbk[j] !== b || mlay[j] !== layer || mcol[j] === 0) continue;
          const x = mx[j]!, y = my[j]!, dx = x - mpx[j]!, dy = y - mpy[j]!, L = Math.sqrt(dx * dx + dy * dy);
          if (L < 0.2) continue;
          const k = mtl[j]! / L;
          ctx.moveTo(x, y); ctx.lineTo(x - dx * k, y - dy * k); any = true;
        }
        if (any) ctx.stroke();
      }
      ctx.globalAlpha = ba;
      for (let j = 0; j < moteCap; j++) {
        if (mbk[j] !== b || mlay[j] !== layer) continue;
        const s = msz[j]!, cw = cellW[s]!, ch = cellH[s]!, row = (mcol[j]! * 3 + s) * atlasRow * DPR;
        ctx.drawImage(atlas, mch[j]! * atlasCol * DPR, row, cw * DPR, ch * DPR, mx[j]! - cw / 2, my[j]! - ch / 2, cw, ch);
      }
    }
    ctx.globalAlpha = 1;
  }
  /**
   * Glowing filaments riding the disk, so the glow itself is seen to turn.
   * layer 0: the far half (drawn before the globe), 1: the near half.
   */
  function drawStreaks(layer: 0 | 1): void {
    if (!ctx || streakN === 0) return;
    const fade = burstOn ? Math.max(0, 1 - burstT / 0.6) : 1;
    const fill = clamp(moteCount / Math.max(1, moteCap * 0.6), 0, 1);
    const k0 = gain * fade * (0.35 + 0.65 * fill);
    if (k0 < 0.02) return;
    ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const wk = clamp(Rc / 260, 1, 1.6);
    for (let k = 0; k < streakN; k++) {
      const r = skR[k]! * Rc, th = skTh[k]!, len = skLen[k]!, hv = (R_OUT - skR[k]!) / (R_OUT - R_IN);
      ctx.strokeStyle = hv > 0.62 ? C.hot : C.accent; ctx.lineWidth = skW[k]! * wk;
      for (let seg = 0; seg < 3; seg++) {
        const a0 = th - (len * seg) / 3, a1 = th - (len * (seg + 1)) / 3;
        if ((Math.sin((a0 + a1) / 2) < 0 ? 0 : 1) !== layer) continue;
        ctx.globalAlpha = skI[k]! * k0 * (1 - seg / 3) * (0.7 + 0.3 * Math.cos(a0));
        ctx.beginPath();
        for (let p = 0; p <= 7; p++) {
          project(r, a0 + ((a1 - a0) * p) / 7);
          if (p === 0) ctx.moveTo(cx + LX, cy + LY); else ctx.lineTo(cx + LX, cy + LY);
        }
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.lineCap = "butt";
  }
  function drawSparks(dt: number): void {
    if (!ctx || !dot) return;
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < SPARK_CAP; k++) {
      const t = spT[k]!;
      if (t <= 0) continue;
      spT[k] = t - dt;
      const f = t / SPARK_S, s = spS[k]! * (0.6 + 0.6 * f);
      ctx.globalAlpha = f * f;
      ctx.drawImage(dot, spX[k]! - s / 2, spY[k]! - s / 2, s, s);
    }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  }
  function drawTwinkles(dt: number): void {
    if (!ctx || !dot) return;
    ctx.globalCompositeOperation = "lighter";
    if (twinkleN > 0 && level < 3) {
      for (let k = 0; k < twinkleN; k++) {
        const w = 0.5 + 0.5 * Math.sin(clock * tkR[k]! + tkP[k]!);
        const a = tkA[k]! * w * w * w * 0.9;
        if (a < 0.02) continue;
        const s = 5 + 5 * w;
        ctx.globalAlpha = a;
        ctx.drawImage(dot, tkX[k]! - s / 2, tkY[k]! - s / 2, s, s);
      }
    }
    // Glints, at every quality level (they're a handful of small blits): every second or two a star
    // flares into a four-point sparkle and fades.
    glintIn -= dt;
    if (glintIn <= 0 && glintPool > 0 && !reduced) {
      glintIn = 0.6 + Math.random() * 1.8;
      for (let g = 0; g < GLINT_CAP; g++) {
        if (gtDur[g]! > 0) continue;
        const c = (Math.random() * glintPool) | 0;
        gtX[g] = gcX[c]!; gtY[g] = gcY[c]!; gtAge[g] = 0; gtDur[g] = 0.9 + Math.random() * 0.9;
        gtS[g] = (5 + 9 * Math.random()) * (0.7 + 0.6 * gcB[c]!); gtWarm[g] = Math.random() < 0.35 ? 1 : 0;
        break;
      }
    }
    for (let g = 0; g < GLINT_CAP; g++) {
      const dur = gtDur[g]!;
      if (dur <= 0) continue;
      const age = gtAge[g]! + dt;
      if (age >= dur) { gtDur[g] = 0; continue; }
      gtAge[g] = age;
      const e = Math.sin(Math.PI * (age / dur)), env = e * e, s = gtS[g]!, x = gtX[g]!, y = gtY[g]!;
      ctx.globalAlpha = env;
      ctx.drawImage(dot, x - s * 0.7, y - s * 0.7, s * 1.4, s * 1.4);
      if (flare) {
        // the arms: the tapered streak sprite, long across and down, short on the diagonals
        const L = s * 3.2 * (0.6 + 0.4 * env), th = Math.max(3, s * 0.4);
        ctx.globalAlpha = env * (gtWarm[g] ? 0.75 : 0.9);
        ctx.drawImage(flare, x - L, y - th / 2, L * 2, th);
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 2);
        ctx.drawImage(flare, -L, -th / 2, L * 2, th);
        ctx.rotate(Math.PI / 4); ctx.globalAlpha = env * 0.35;
        ctx.drawImage(flare, -L * 0.45, -th / 2, L * 0.9, th);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(flare, -L * 0.45, -th / 2, L * 0.9, th);
        ctx.restore();
      }
    }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  }
  function drawCoreText(now: number): void {
    if (!ctx || !reading) return;
    const tenths = Math.round(twPh.v * 10), block = now < blockMsgUntil, key = tenths + (block ? "b" : "p");
    if (key !== readingKey) { readingKey = key; renderReading(tenths / 10, block); }
    ctx.drawImage(reading, cx - rdW / 2, cy - rdTop, rdW, rdH);
  }
  /** A shine every LOGO_SHINE_EVERY s, crossing in LOGO_SHINE_SWEEP s; quieter than the intro's. */
  const LOGO_SHINE_EVERY = 4.5, LOGO_SHINE_SWEEP = 0.8;
  function drawLogo(dt: number): void {
    if (!ctx || !logo || mobile) return;
    if (!logo.done && dt > 0) logo.build(false, clock > 3);
    const k = clock % LOGO_SHINE_EVERY, shine = reduced || k >= LOGO_SHINE_SWEEP ? -1 : k / LOGO_SHINE_SWEEP;
    const boost = (shine >= 0 ? 0.22 * Math.sin(Math.PI * shine) : 0) + frame.burst * 0.6;
    logo.draw(ctx, lgX, lgY, lgW, clock, { shine, glowBoost: boost, level: level < 5 ? 3 : 1 });
  }
  /** Motion off: no frames to build it on, so build it in a few timed steps and paint a still. */
  function buildLogoStill(tries: number): void {
    if (!logo || destroyed) return;
    logo.build(true, tries >= 8);
    if (!logo.done) { window.setTimeout(() => buildLogoStill(tries + 1), 250); return; }
    staticFrame();
  }
  function drawBurst(): void {
    if (!ctx || !burstOn) return;
    const t = burstT, fl = Math.max(0, 1 - t / 0.9);
    ctx.globalCompositeOperation = "lighter";
    if (fl > 0 && flash) {
      const f = Rc * 2.4;
      ctx.globalAlpha = fl * fl; ctx.drawImage(flash, cx - f, cy - f, f * 2, f * 2);
    }
    // jets: the pot pays out, straight up and down from the poles
    const jf = Math.max(0, 1 - t / 2.4);
    if (jf > 0 && jet) {
      const L = H * 0.8 * easeOut(Math.min(1, t / 0.45)), w = Rc * 0.55;
      ctx.globalAlpha = jf * jf;
      ctx.drawImage(jet, cx - w / 2, cy - Rc * 0.95 - L, w, L);
      ctx.save(); ctx.translate(cx, cy + Rc * 0.95); ctx.scale(1, -1);
      ctx.drawImage(jet, -w / 2, -L, w, L);
      ctx.restore();
    }
    if (fl > 0 && flare) {
      const fw2 = W * 1.4;
      ctx.globalAlpha = fl; ctx.drawImage(flare, cx - fw2 / 2, cy - 24, fw2, 48);
    }
    ctx.globalCompositeOperation = "source-over";
    // shockwaves: one along the disk plane, one spherical
    const p = Math.min(1, t / 2.2), sa = 1 - p, maxR = Math.sqrt(W * W + H * H);
    const sr = Rc * 1.1 + (maxR - Rc) * Math.pow(p, 0.6);
    ctx.globalAlpha = 0.55 * sa; ctx.lineWidth = 1.5 + 5 * sa; ctx.strokeStyle = "#fff";
    ctx.beginPath(); ctx.ellipse(cx, cy, sr, sr * TILT, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.35 * sa; ctx.lineWidth = 1; ctx.strokeStyle = C.accent;
    ctx.beginPath(); ctx.arc(cx, cy, sr * 0.8, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  /** The disk's brightness follows how full it is (so it dims after a block and fills back up) and the hashrate. */
  function glowTarget(): number {
    const fill = moteCap > 0 ? clamp(moteCount / (moteCap * 0.55), 0, 1) : 1;
    return (0.42 + 0.58 * fill) * (0.86 + 0.14 * heat);
  }

  function drawFrame(dt: number, now: number): void {
    if (!ctx) return;
    twPh.step(now); twDim.step(now);
    clock += dt;
    if (burstOn) {
      const prev = burstT;
      burstT += dt;
      if (prev < EJECT_S && burstT >= EJECT_S) killAllMotes();
      if (burstT > BURST_S) burstOn = false;
    }
    stepField(dt); stepMotes(dt); stepStreaks(dt);
    const target = glowTarget();
    gain = reduced ? target : gain + (target - gain) * Math.min(1, dt / 1.5);
    if (Math.abs(gain - bakedGain) > 0.03) bakeScene();

    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    if (scene) ctx.drawImage(scene, 0, 0, W, H);
    else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); }
    drawTwinkles(dt);
    // far half of the disk → the globe → near glow → near half
    drawStreaks(0);
    drawField();
    drawMotes(0);
    beat.step(reduced ? 0 : dt, heat);
    frame.clock = clock; frame.dt = dt; frame.beat = reduced ? 0 : beat.level; frame.since = reduced ? 1e9 : beat.since;
    pulse = Math.max(0, pulse - dt * 0.6);
    frame.pulse = pulse; frame.heat = heat; frame.burst = burstOn ? Math.max(0, 1 - burstT / 1.4) : 0;
    core.draw(ctx, frame);
    if (frontGlow) {
      ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = gain;
      ctx.drawImage(frontGlow, glX, fY0, glW, fH);
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    }
    drawStreaks(1);
    drawMotes(1);
    drawSparks(dt);
    drawCoreText(now);
    drawLogo(dt);
    drawBurst();
    const inten = twDim.v;
    if (inten < 0.995) { ctx.globalAlpha = 1 - inten; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }

  /* ── loop + adaptive quality ── */
  function setLevel(n: number): void {
    if (n === level) return;
    level = n; hiSince = loSince = -1; gapEma = 16; ema = 8;
    console.debug("[wallpaper] level", n);
    layout();
  }
  function loop(ts: number): void {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (dimmed && lastTs && ts - lastTs < DIM_FRAME_MS) return;
    const gapMs = lastTs ? Math.min(200, ts - lastTs) : 16;
    const dt = lastTs ? Math.min(0.1, gapMs / 1000) : 0.016;
    lastTs = ts;
    const t0 = performance.now();
    drawFrame(dt, t0);
    const cost = performance.now() - t0;
    ema += (cost - ema) * 0.1;
    // Pacing (time between frames) catches what our own timer can't: raster/present cost when the GPU is off.
    const throttled = gapMs > THROTTLED_GAP_MS;
    if (!throttled) gapEma += (gapMs - gapEma) * 0.1;
    if (pinned || throttled || dimmed) return; // capped frames would read as slow ones
    const slow = ema > 14 || gapEma > SLOW_GAP_MS;
    const fast = ema < 8 && gapEma < 20;
    if (slow) { loSince = -1; if (hiSince < 0) hiSince = ts; else if (ts - hiSince > 1000 && level < LEVEL_MAX) setLevel(level + 1); }
    else if (fast) { hiSince = -1; if (loSince < 0) loSince = ts; else if (ts - loSince > 20000 && level > 0) setLevel(level - 1); }
    else hiSince = loSince = -1;
  }
  function start(): void {
    if (running || reduced || destroyed || !ctx) return;
    running = true; lastTs = 0; raf = requestAnimationFrame(loop);
  }
  function stop(): void {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  const staticFrame = (): void => { if (reduced) drawFrame(0, performance.now()); };
  const onVis = (): void => { if (document.hidden) stop(); else if (wantRun) start(); };
  document.addEventListener("visibilitychange", onVis);

  layout();
  if (reduced) staticFrame();

  return {
    update(s) {
      const now = performance.now();
      for (const k of Object.keys(s) as (keyof WallpaperStats)[]) {
        const v = s[k];
        if (k === "potVerdict") { if (typeof v === "string") stats.potVerdict = v; }
        else if (k === "avg1dPhs") { if (v === null || typeof v === "number") stats.avg1dPhs = v as number | null; }
        else if (k === "blocksFound") { if (v === null || typeof v === "number") stats.blocksFound = v as number | null; }
        else if (typeof v === "number" && isFinite(v)) (stats as unknown as Record<string, number>)[k] = v;
      }
      const ph = stats.poolHashratePhs, avg = stats.avg1dPhs;
      heat = avg && avg > 0 && ph > 0 ? (clamp(ph / avg, 0.5, 2) - 0.5) / 1.5 : 0.5;
      if (reduced) twPh.snap(ph); else { twPh.set(ph, now, 600); pulse = 1; }
      staticFrame();
    },
    setDimmed(d) {
      if (d === dimmed) return;
      dimmed = d;
      if (reduced) { twDim.snap(d ? DIM : 1); staticFrame(); }
      else twDim.set(d ? DIM : 1, performance.now(), 300);
    },
    pause() { wantRun = false; stop(); },
    resume() { wantRun = true; if (!document.hidden) start(); },
    blockFound() {
      burstOn = true; burstT = 0;
      blockMsgUntil = performance.now() + BLOCK_MSG_MS;
      if (reduced) { burstT = 0.15; staticFrame(); burstOn = false; }
    },
    resize() {
      // Coalesce: main.ts calls this from an unthrottled window.resize handler and
      // layout() rebuilds every offscreen layer. Leading call runs now; a burst
      // of further calls collapses into one trailing rebuild ~80ms later.
      if (destroyed) return;
      if (resizeTimer) { resizePending = true; return; }
      layout(); staticFrame();
      resizePending = false;
      resizeTimer = window.setTimeout(function flush() {
        resizeTimer = 0;
        if (resizePending && !destroyed) { resizePending = false; layout(); staticFrame(); resizeTimer = window.setTimeout(flush, RESIZE_MS); }
      }, RESIZE_MS);
    },
    destroy() {
      destroyed = true; stop();
      if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = 0; }
      document.removeEventListener("visibilitychange", onVis);
    },
    debug() {
      return { frameMs: Math.round(ema * 100) / 100, gapMs: Math.round(gapEma * 10) / 10, glyphs: fieldN + moteCount, level, scale: RENDER_SCALE[level]!, renderer: gpu.renderer };
    },
  };
}
