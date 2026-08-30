/**
 * Live wallpaper — concept C "The Core". Hashpower flows INTO the pot: a large
 * PH/s speedometer at centre-right wrapped in slow reactor rings, hex fragments
 * born at the viewport edges drifting inward and being consumed, a giant faint
 * Parasite mite drifting behind everything. Block found: rush, flash, shockwave.
 *
 * Cost model (the prototype lagged; this is the same look, much cheaper):
 *  - glyphs are drawImage calls from a pre-rendered atlas (16 hex chars × 3
 *    sizes × 2 colours), batched per alpha bucket; state lives in typed arrays
 *  - static layers (mite, gauge face, tick ring, readout block, glow sprites)
 *    are offscreen canvases rebuilt only on resize / scale / update()
 *  - no shadowBlur, no per-frame gradients, no per-frame string building
 *  - adaptive quality: frame-time EMA steps the level down/up
 */
import { MITE_D, MITE_W, MITE_H } from "./wallpaper-mite";

export interface WallpaperStats {
  poolHashratePhs: number;
  avg1dPhs: number | null;
  networkDifficulty: number;
  potAgeBlocks: number;
  potAgeHours: number;
  potVerdict: string;
  btcPriceUsd: number;
  phdBanked: number;
  chainHeight: number;
}

export interface Wallpaper {
  /** Partial update; readings ease to the new values. */
  update(stats: Partial<WallpaperStats>): void;
  /** Called by the shell when a window is open/focused: drop to ~40% intensity, smoothly. */
  setDimmed(dimmed: boolean): void;
  pause(): void;
  resume(): void;
  /** One-off celebration (≤3s), then back to idle. */
  blockFound(): void;
  /** Re-measure the canvas (the shell calls this on resize). */
  resize(): void;
  destroy(): void;
}

export interface WallpaperOptions {
  /** Left area to keep quiet, px (the icon column). Default 140. */
  quietLeftPx?: number;
  /** Bottom area to keep clear, px (the taskbar). Default 40. */
  quietBottomPx?: number;
  reducedMotion?: boolean;
}

export interface WallpaperDebug {
  debug(): { frameMs: number; gapMs: number; glyphs: number; level: number; scale: number; renderer: string };
}

/* ── constants ─────────────────────────────────────────────────────────── */
const TAU = Math.PI * 2, RAD = Math.PI / 180;
const START = 150 * RAD, END = 390 * RAD, SWEEP = END - START;
const RING_R = [1.22, 1.36, 1.52, 1.7] as const;
const RING_V = [0.06, -0.035, 0.05, -0.02] as const;
const POT_RING = 1.1, POT_FULL_BLOCKS = 100, RADAR_DEG = 55;
const GLYPH_DENSITY = 90 / (1920 * 1080), GLYPH_MIN = 30, GLYPH_MAX = 140, GLYPH_CAP = 160;
const GLYPH_SPEED = 38, GLYPH_SPIN = 0.22, GREEN_SHARE = 0.08, GLYPH_ALPHA = 0.55, TRAIL = 26;
const SIZES = [14, 11, 8] as const, NBUCKET = 5;
const LEVEL_MULT = [1, 0.7, 0.45, 0.28, 0.28, 0.2] as const;
/** Canvas render scale per level: 4 and 5 draw at 0.75× / 0.5× and let the browser upscale — the big lever when the GPU is off. */
const RENDER_SCALE = [1, 1, 1, 1, 0.75, 0.5] as const;
const LEVEL_MAX = LEVEL_MULT.length - 1;
/** Frame pacing above this (ms between rAF callbacks) means the browser can't keep up, whatever our own JS cost says. */
const SLOW_GAP_MS = 34;
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
const BURST_S = 2.8, DIM = 0.4;
const HEX = "0123456789abcdef";

const GAUGE_BAND_RATIO = 5 / 3;
function round2sig(x: number): number {
  if (x <= 0) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.round(x / mag) * mag;
}
/** Sticky "nice" full-scale, ported from src/web/gauge.ts (do not import server code). */
function gaugeScaleFor(value: number): number {
  if (!(value > 0)) return 100;
  const k = Math.floor(Math.log(value / 75) / Math.log(GAUGE_BAND_RATIO));
  return round2sig(500 * Math.pow(GAUGE_BAND_RATIO, k));
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
const fmtInt = (n: number): string => Math.round(n).toLocaleString("en-US");
function fmtDiff(d: number): string {
  if (!(d > 0)) return "—";
  if (d >= 1e15) return (d / 1e15).toFixed(2) + "P";
  if (d >= 1e12) return (d / 1e12).toFixed(1) + "T";
  return (d / 1e9).toFixed(1) + "G";
}
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}
function mkCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return [c, c.getContext("2d") as CanvasRenderingContext2D];
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

export function createWallpaper(canvas: HTMLCanvasElement, opts: WallpaperOptions = {}): Wallpaper & WallpaperDebug {
  const ctx = canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D | null;
  const reduced = !!opts.reducedMotion;
  const quietLeft = opts.quietLeftPx ?? 140, quietBottom = opts.quietBottomPx ?? 40;

  // Palette from the shell tokens (fallbacks = shell.css values).
  const cs = getComputedStyle(canvas);
  const tok = (n: string, fb: string) => (cs.getPropertyValue(n) || "").trim() || fb;
  const C = {
    fg: tok("--ph-fg", "#e6e6e6"), dim: tok("--ph-dim", "#8a8a8a"), green: tok("--ph-accent", "#8fd14f"),
    amber: tok("--ph-amber", "#f5c451"), track: "#1c1c1c", tick: "#666",
  };
  const MONO = tok("--ph-mono", '"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace');

  /* ── state ── */
  const stats: WallpaperStats = {
    poolHashratePhs: 0, avg1dPhs: null, networkDifficulty: 0, potAgeBlocks: 0, potAgeHours: 0,
    potVerdict: "", btcPriceUsd: 0, phdBanked: 0, chainHeight: 0,
  };
  const twPh = new Tween(), twPot = new Tween(), twPrice = new Tween(), twPhd = new Tween(), twDim = new Tween();
  twDim.snap(1);
  let fullScale = 100, faceScale = -1;
  let W = 0, H = 0, DPR = 1, mobile = false;
  let cx = 0, cy = 0, S = 1, R = 104, qL = 0;
  let T = 0, lastTs = 0, raf = 0, running = false, wantRun = false, destroyed = false;
  let burstOn = false, burstT = 0, ringKick = 0;
  const ringPhase = [0, 0, 0, 0];
  const gpu = softwareRenderer();
  let level = gpu.software ? 4 : 0, ema = 8, gapEma = 16, hiSince = -1, loSince = -1;
  if (gpu.software) console.debug("[wallpaper] software renderer detected (" + gpu.renderer + ") → level 4");
  let readingNum = "0.0", readingKey = -1, potLine = "", potKey = -1;
  let readoutDirty = true, dimmed = false;
  let resizeTimer = 0, resizePending = false;
  const RESIZE_MS = 80;

  /* ── glyph pool (typed arrays; no per-frame allocation) ── */
  const gr = new Float32Array(GLYPH_CAP), ga = new Float32Array(GLYPH_CAP), gborn = new Float32Array(GLYPH_CAP);
  const gw = new Float32Array(GLYPH_CAP), gspd = new Float32Array(GLYPH_CAP), glife = new Float32Array(GLYPH_CAP);
  const gx = new Float32Array(GLYPH_CAP), gy = new Float32Array(GLYPH_CAP), gpx = new Float32Array(GLYPH_CAP), gpy = new Float32Array(GLYPH_CAP);
  const gdelay = new Float32Array(GLYPH_CAP);
  const galive = new Uint8Array(GLYPH_CAP), ggreen = new Uint8Array(GLYPH_CAP), glen = new Uint8Array(GLYPH_CAP);
  const gbk = new Uint8Array(GLYPH_CAP), gsz = new Uint8Array(GLYPH_CAP), gch = new Uint8Array(GLYPH_CAP * 6);
  let glyphN = 0;

  function spawn(i: number, initial: boolean): void {
    const e = Math.random();
    let x: number, y: number;
    const bottom = H - quietBottom;
    if (e < 0.3) { x = qL + Math.random() * (W - qL); y = -12; }
    else if (e < 0.6) { x = qL + Math.random() * (W - qL); y = bottom + 12; }
    else if (e < 0.85) { x = W + 12; y = Math.random() * bottom; }
    else { x = qL - 4; y = Math.random() * bottom; }
    const dx = x - cx, dy = y - cy;
    const born = Math.max(R * 1.5, Math.sqrt(dx * dx + dy * dy));
    gborn[i] = born; ga[i] = Math.atan2(dy, dx);
    gr[i] = initial ? R * 1.3 + Math.random() * (born - R * 1.3) : born;
    gw[i] = (Math.random() * 2 - 1) * GLYPH_SPIN;
    gspd[i] = GLYPH_SPEED * (0.7 + Math.random() * 0.8);
    ggreen[i] = Math.random() < GREEN_SHARE ? 1 : 0;
    const n = Math.random(); const len = n < 0.5 ? 2 : n < 0.85 ? 4 : 6; glen[i] = len;
    for (let k = 0; k < len; k++) gch[i * 6 + k] = (Math.random() * 16) | 0;
    glife[i] = Math.random(); galive[i] = 1; gdelay[i] = 0;
    const r = gr[i]!, a = ga[i]!;
    gx[i] = gpx[i] = cx + Math.cos(a) * r; gy[i] = gpy[i] = cy + Math.sin(a) * r;
  }
  function resizePool(): void {
    const area = (W - qL) * (H - quietBottom);
    const want = Math.round(Math.min(GLYPH_MAX, Math.max(GLYPH_MIN, area * GLYPH_DENSITY)) * LEVEL_MULT[level]!);
    const n = Math.min(GLYPH_CAP, mobile ? Math.min(want, 40) : want);
    for (let i = glyphN; i < n; i++) spawn(i, true);
    glyphN = n;
  }
  function stepGlyphs(dt: number): void {
    const rush = burstOn && burstT < 1.2 ? 1 + 24 * Math.min(1, burstT / 0.35) : 1;
    const minR = R * 1.12, fadeX0 = qL - 20, quietEdge = qL + 60;
    for (let i = 0; i < glyphN; i++) {
      if (!galive[i]) {
        const d = gdelay[i]! - dt;
        if (d > 0) { gdelay[i] = d; gbk[i] = 255; continue; }
        spawn(i, false);
      }
      const born = gborn[i]!;
      let r = gr[i]!, a = ga[i]!;
      const tt = 1 - r / born;
      gpx[i] = gx[i]!; gpy[i] = gy[i]!;
      r -= gspd[i]! * (1 + 0.9 * tt) * rush * dt;
      a += gw[i]! * dt * (0.4 + 0.6 * tt);
      gr[i] = r; ga[i] = a;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      gx[i] = x; gy[i] = y;
      if (r < minR) { galive[i] = 0; gdelay[i] = burstOn ? 0.4 + Math.random() * 2.6 : 0; gbk[i] = 255; continue; }
      // visibility + alpha bucket + size, computed once here so the draw pass is pure drawImage
      if (x < fadeX0 || x > W + 10 || y < -10 || y > H) { gbk[i] = 255; continue; }
      const t = r / born;
      let al = GLYPH_ALPHA * Math.sin(Math.min(1, (1 - t) * 3) * Math.PI * 0.5) * (0.35 + 0.65 * t);
      if (x < quietEdge) al *= (x - fadeX0) / 80;
      if (!ggreen[i]) al *= 0.5 + 0.5 * glife[i]!; else al = Math.min(1, al * 1.6);
      if (al <= 0.02) { gbk[i] = 255; continue; }
      gbk[i] = Math.min(NBUCKET - 1, (al * NBUCKET) | 0);
      gsz[i] = t > 0.66 ? 0 : t > 0.33 ? 1 : 2;
    }
  }

  /* ── caches ── */
  let atlas: HTMLCanvasElement | null = null;
  const cellW = [0, 0, 0], cellH = [0, 0, 0];
  let atlasCol = 0, atlasRow = 0;
  function buildAtlas(): void {
    let mw = 0, mh = 0;
    const tmp = mkCanvas(4, 4)[1];
    for (let s = 0; s < 3; s++) {
      tmp.font = `${SIZES[s]!}px ${MONO}`;
      cellW[s] = Math.ceil(tmp.measureText("0").width) + 1; cellH[s] = Math.ceil(SIZES[s]! * 1.3);
      mw = Math.max(mw, cellW[s]!); mh = Math.max(mh, cellH[s]!);
    }
    atlasCol = mw; atlasRow = mh;
    const [c, x] = mkCanvas(16 * mw * DPR, 6 * mh * DPR);
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
    x.textBaseline = "middle"; x.textAlign = "left";
    for (let col = 0; col < 2; col++) {
      x.fillStyle = col ? C.green : C.fg;
      for (let s = 0; s < 3; s++) {
        x.font = `${SIZES[s]!}px ${MONO}`;
        const row = col * 3 + s;
        for (let k = 0; k < 16; k++) x.fillText(HEX[k]!, k * mw, row * mh + mh / 2);
      }
    }
    atlas = c;
  }

  let mite: HTMLCanvasElement | null = null, miteS = 1;
  let mitePath: Path2D | null = null;
  try { mitePath = new Path2D(MITE_D); } catch { mitePath = null; }
  function buildMite(): void {
    if (!mitePath) return;
    miteS = (H * 0.95) / MITE_H;
    const [c, x] = mkCanvas(MITE_W * miteS, MITE_H * miteS); // DPR 1: it's a 2%-alpha silhouette
    x.scale(miteS, miteS);
    x.fillStyle = rgba("#ffffff", 0.018);
    x.fill(mitePath, "evenodd");
    mite = c;
  }

  let face: HTMLCanvasElement | null = null, faceHalf = 0;
  function buildFace(): void {
    faceScale = fullScale;
    faceHalf = R + 42 * S;
    const [c, x] = mkCanvas(faceHalf * 2 * DPR, faceHalf * 2 * DPR);
    x.setTransform(DPR, 0, 0, DPR, faceHalf * DPR, faceHalf * DPR);
    x.lineCap = "butt"; x.lineWidth = 14 * S; x.strokeStyle = C.track;
    x.beginPath(); x.arc(0, 0, R, START, END); x.stroke();
    const Ro = R + 9 * S;
    x.strokeStyle = C.tick; x.lineWidth = Math.max(1, 1.2 * S); x.beginPath();
    for (let i = 0; i <= 8; i++) {
      const a = START + (SWEEP * i) / 8, cs = Math.cos(a), sn = Math.sin(a), Ri = R + 16 * S;
      x.moveTo(cs * Ro, sn * Ro); x.lineTo(cs * Ri, sn * Ri);
      if (i < 8) for (let m = 1; m < 4; m++) {
        const am = START + (SWEEP * (i + m / 4)) / 8, cm = Math.cos(am), sm = Math.sin(am), Rm = R + 12 * S;
        x.moveTo(cm * Ro, sm * Ro); x.lineTo(cm * Rm, sm * Rm);
      }
    }
    x.stroke();
    x.fillStyle = "#fff"; x.font = `${Math.round(11 * S)}px ${MONO}`; x.textAlign = "center"; x.textBaseline = "middle";
    const step = fullScale / 8;
    for (let i = 0; i <= 8; i++) {
      const a = START + (SWEEP * i) / 8, v = step * i, Rl = R + 30 * S;
      const lab = v >= 1000 ? v / 1000 + "k" : step >= 1 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
      x.fillText(lab, Math.cos(a) * Rl, Math.sin(a) * Rl);
    }
    face = c;
  }

  let tickRing: HTMLCanvasElement | null = null, tickHalf = 0;
  function buildTickRing(): void {
    const r = R * RING_R[1];
    tickHalf = r + 12;
    const [c, x] = mkCanvas(tickHalf * 2 * DPR, tickHalf * 2 * DPR);
    x.setTransform(DPR, 0, 0, DPR, tickHalf * DPR, tickHalf * DPR);
    x.strokeStyle = "#3a3a3a"; x.lineWidth = 1; x.beginPath();
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU, L = i % 6 === 0 ? 9 : 4, cs = Math.cos(a), sn = Math.sin(a);
      x.moveTo(cs * r, sn * r); x.lineTo(cs * (r + L), sn * (r + L));
    }
    x.stroke();
    x.strokeStyle = "#202020"; x.beginPath(); x.arc(0, 0, r, 0, TAU); x.stroke();
    tickRing = c;
  }

  let glowSprite: HTMLCanvasElement | null = null, flashSprite: HTMLCanvasElement | null = null;
  function buildSprites(): void {
    const g = 22 * S;
    let [c, x] = mkCanvas(g * 2, g * 2);
    let grad = x.createRadialGradient(g, g, 0, g, g, g);
    grad.addColorStop(0, "rgba(255,255,255,0.55)"); grad.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = grad; x.fillRect(0, 0, g * 2, g * 2); glowSprite = c;
    const f = R * 1.4;
    [c, x] = mkCanvas(f * 2, f * 2);
    grad = x.createRadialGradient(f, f, 0, f, f, f);
    grad.addColorStop(0, "rgba(255,255,255,0.85)"); grad.addColorStop(0.5, rgba(C.green, 0.18)); grad.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = grad; x.fillRect(0, 0, f * 2, f * 2); flashSprite = c;
  }

  let readout: HTMLCanvasElement | null = null;
  let roX = 0, roY = 0, roBelow = false;
  const RO_W = 170, RO_H = 82;
  function buildReadout(): void {
    readoutDirty = false;
    if (!readout) readout = mkCanvas(RO_W * DPR, RO_H * DPR)[0];
    const x = readout.getContext("2d") as CanvasRenderingContext2D;
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
    x.clearRect(0, 0, RO_W, RO_H);
    x.textAlign = "left"; x.textBaseline = "middle"; x.font = `11px ${MONO}`;
    const rows: [string, string][] = [
      ["HEIGHT", fmtInt(stats.chainHeight)], ["DIFF", fmtDiff(stats.networkDifficulty)],
      ["BTC", "$" + fmtInt(twPrice.v)], ["BANKED", fmtInt(twPhd.v) + " PH·D"],
    ];
    x.strokeStyle = "#222"; x.beginPath(); x.moveTo(0.5, 0); x.lineTo(0.5, RO_H); x.stroke();
    for (let i = 0; i < rows.length; i++) {
      x.fillStyle = C.dim; x.fillText(rows[i]![0], 12, 10 + i * 18);
      x.fillStyle = C.fg; x.fillText(rows[i]![1], 70, 10 + i * 18);
    }
  }

  /* ── layout ── */
  let vignette: CanvasGradient | null = null;
  const dash0 = [3, 9], dash3 = [0, 0];
  const sweepCol: string[] = [], sweepColHot: string[] = [];
  for (let k = 0; k < 12; k++) {
    const f = k / 12, al = 0.05 + 0.75 * f * f;
    sweepCol.push(rgba(C.green, al)); sweepColHot.push(rgba(C.green, Math.min(1, al * 1.6)));
  }
  let fontBig = "", fontUnit = "", fontPot = "";
  let arcGrad: CanvasGradient | string = "#fff", arcGradV = -1;

  function layout(): void {
    if (!ctx) return;
    DPR = Math.min(level >= 1 ? 1.5 : 2, window.devicePixelRatio || 1) * RENDER_SCALE[level]!;
    W = canvas.clientWidth || 1; H = canvas.clientHeight || 1;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    mobile = W < 768;
    qL = mobile ? 0 : quietLeft;
    const availH = H - quietBottom;
    S = Math.max(0.5, Math.min((availH * 0.5) / 228, (W - qL) / (2 * RING_R[3] * 104 * 1.08)));
    R = 104 * S;
    const outer = R * RING_R[3];
    cx = mobile ? qL + (W - qL) / 2 : Math.max(qL + outer * 0.55, Math.min(W - outer * 0.55, W * 0.6));
    cy = availH * 0.47;
    vignette = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 2.6);
    vignette.addColorStop(0, "#0c0c0c"); vignette.addColorStop(0.55, "#060606"); vignette.addColorStop(1, "rgba(0,0,0,0)");
    dash3[0] = outer * 0.6; dash3[1] = outer * 0.9;
    fontBig = `bold ${Math.round(28 * S)}px ${MONO}`; fontUnit = `${Math.round(14 * S)}px ${MONO}`; fontPot = `${Math.max(9, Math.round(6.5 * S))}px ${MONO}`;
    roX = cx + outer + 34; roY = cy - 30; roBelow = roX > W - RO_W - 10;
    if (roBelow) { roX = cx - 80; roY = cy + outer + 28; }
    arcGradV = -1;
    buildAtlas(); buildMite(); buildFace(); buildTickRing(); buildSprites(); readoutDirty = true;
    resizePool();
  }

  /* ── drawing ── */
  function drawGlyphs(): void {
    if (!ctx || !atlas) return;
    const trails = level < 2;
    for (let b = 0; b < NBUCKET; b++) {
      const ba = (b + 0.5) / NBUCKET;
      if (trails) {
        ctx.globalAlpha = ba * 0.45; ctx.strokeStyle = C.green; ctx.lineWidth = 1; ctx.beginPath();
        let any = false;
        for (let i = 0; i < glyphN; i++) {
          if (gbk[i] !== b || !ggreen[i]) continue;
          const x = gx[i]!, y = gy[i]!, dx = x - gpx[i]!, dy = y - gpy[i]!;
          const L = Math.sqrt(dx * dx + dy * dy) || 1, tl = TRAIL * (0.5 + 0.5 * (1 - gr[i]! / gborn[i]!));
          ctx.moveTo(x, y); ctx.lineTo(x - (dx / L) * tl, y - (dy / L) * tl); any = true;
        }
        if (any) ctx.stroke();
      }
      ctx.globalAlpha = ba;
      for (let i = 0; i < glyphN; i++) {
        if (gbk[i] !== b) continue;
        const s = gsz[i]!, cw = cellW[s]!, ch = cellH[s]!, row = (ggreen[i]! * 3 + s) * atlasRow * DPR;
        const x = gx[i]!, y = gy[i]! - ch / 2, n = glen[i]!, base = i * 6;
        for (let k = 0; k < n; k++)
          ctx.drawImage(atlas, gch[base + k]! * atlasCol * DPR, row, cw * DPR, ch * DPR, x + k * cw, y, cw, ch);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawRings(): void {
    if (!ctx) return;
    const solidOnly = level >= 3;
    let r = R * RING_R[0];
    ctx.lineCap = "butt"; ctx.lineWidth = 1;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ringPhase[0]!);
    if (!solidOnly) ctx.setLineDash(dash0);
    ctx.strokeStyle = "#2c2c2c"; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    if (!solidOnly) ctx.setLineDash([]);
    ctx.restore();
    if (tickRing) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ringPhase[1]!);
      ctx.drawImage(tickRing, -tickHalf, -tickHalf, tickHalf * 2, tickHalf * 2); ctx.restore();
    }
    r = R * RING_R[2];
    ctx.strokeStyle = "#262626"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    const sw = RADAR_DEG * RAD, a1 = ringPhase[2]!, N = level >= 2 ? 6 : 12, stepK = 12 / N;
    const cols = burstOn ? sweepColHot : sweepCol;
    ctx.lineWidth = 2;
    for (let k = 0; k < N; k++) {
      const f = k / N;
      ctx.strokeStyle = cols[(k * stepK) | 0]!;
      ctx.beginPath(); ctx.arc(cx, cy, r, a1 - sw * (1 - f), a1 - sw * (1 - (k + 1) / N) + 0.004); ctx.stroke();
    }
    ctx.fillStyle = C.green; ctx.beginPath(); ctx.arc(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, 2.2, 0, TAU); ctx.fill();
    r = R * RING_R[3];
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ringPhase[3]!);
    if (!solidOnly) ctx.setLineDash(dash3);
    ctx.lineWidth = 1; ctx.strokeStyle = "#222"; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    if (!solidOnly) ctx.setLineDash([]);
    ctx.restore();
    // pot-age ring
    r = R * POT_RING;
    const frac = Math.max(0, Math.min(1, twPot.v / POT_FULL_BLOCKS)), stale = stats.potVerdict === "stale";
    ctx.lineWidth = 2; ctx.strokeStyle = "#181818"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    if (frac > 0) {
      const ae = -Math.PI / 2 + TAU * frac;
      ctx.strokeStyle = stale ? C.amber : "#4a4a4a";
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, ae); ctx.stroke();
      ctx.fillStyle = stale ? C.amber : C.fg; ctx.beginPath(); ctx.arc(cx + Math.cos(ae) * r, cy + Math.sin(ae) * r, 2, 0, TAU); ctx.fill();
    }
  }

  function drawGauge(): void {
    if (!ctx) return;
    if (face) ctx.drawImage(face, cx - faceHalf, cy - faceHalf, faceHalf * 2, faceHalf * 2);
    const v = Math.max(0, Math.min(1, twPh.v / fullScale)), aN = START + SWEEP * v;
    ctx.lineCap = "butt";
    if (v > 0.002) {
      // glow: one wide low-alpha stroke (no shadowBlur)
      ctx.globalAlpha = burstOn ? 0.22 : 0.11; ctx.lineWidth = 30 * S; ctx.strokeStyle = C.green;
      ctx.beginPath(); ctx.arc(cx, cy, R, START, aN); ctx.stroke(); ctx.globalAlpha = 1;
      if (Math.abs(v - arcGradV) > 0.004) {
        arcGradV = v;
        if (typeof ctx.createConicGradient === "function") {
          const g = ctx.createConicGradient(START, cx, cy), span = (SWEEP / TAU) * v;
          g.addColorStop(0, "#6a6a6a"); g.addColorStop(span * 0.7, "#ffffff"); g.addColorStop(Math.min(0.999, span), C.green); g.addColorStop(1, C.green);
          arcGrad = g;
        } else arcGrad = "#ffffff";
      }
      ctx.lineWidth = 14 * S; ctx.strokeStyle = arcGrad; ctx.beginPath(); ctx.arc(cx, cy, R, START, aN); ctx.stroke();
    }
    // needle (slim kite) + hub
    const nc = Math.cos(aN), ns = Math.sin(aN), px = -ns, py = nc, tipR = R - 6 * S, tailR = 16 * S, hw = 4.5 * S;
    if (glowSprite) { const g = 22 * S; ctx.drawImage(glowSprite, cx - g, cy - g, g * 2, g * 2); }
    ctx.fillStyle = "#fff"; ctx.beginPath();
    ctx.moveTo(cx + nc * tipR, cy + ns * tipR); ctx.lineTo(cx + px * hw, cy + py * hw);
    ctx.lineTo(cx - nc * tailR, cy - ns * tailR); ctx.lineTo(cx - px * hw, cy - py * hw); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, 7 * S, 0, TAU); ctx.fill();
    ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(cx, cy, 3 * S, 0, TAU); ctx.fill();
    // reading (strings rebuilt only when the rounded value changes)
    const key = Math.round(twPh.v * 10);
    if (key !== readingKey) { readingKey = key; readingNum = (key / 10).toFixed(1); }
    const pk = Math.round(twPot.v) * 1000 + Math.round(stats.potAgeHours * 10);
    if (pk !== potKey) { potKey = pk; potLine = `POT AGE ${Math.round(twPot.v)} BLOCKS · ${stats.potAgeHours.toFixed(1)} H`; }
    const ty = cy + 44 * S;
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "right"; ctx.fillStyle = "#fff"; ctx.font = fontBig;
    ctx.fillText(readingNum, cx + 8 * S, ty);
    ctx.textAlign = "left"; ctx.fillStyle = C.dim; ctx.font = fontUnit; ctx.fillText(" PH/s", cx + 8 * S, ty);
    ctx.textAlign = "center"; ctx.font = fontPot; ctx.fillStyle = stats.potVerdict === "stale" ? C.amber : C.dim;
    ctx.fillText(potLine, cx, cy + 62 * S);
  }

  function drawBurst(): void {
    if (!ctx || !burstOn) return;
    const fl = Math.max(0, 1 - burstT / 0.7);
    if (fl > 0 && flashSprite) {
      const f = R * 1.4;
      ctx.globalAlpha = fl * fl; ctx.drawImage(flashSprite, cx - f, cy - f, f * 2, f * 2);
    }
    const maxR = Math.sqrt(W * W + H * H), p = Math.min(1, burstT / 2);
    const sr = R + (maxR - R) * Math.pow(p, 0.6), sa = 1 - p;
    ctx.globalAlpha = 0.55 * sa; ctx.lineWidth = 2 + 6 * sa; ctx.strokeStyle = "#fff";
    ctx.beginPath(); ctx.arc(cx, cy, sr, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.5 * sa; ctx.lineWidth = 1; ctx.strokeStyle = C.green;
    ctx.beginPath(); ctx.arc(cx, cy, sr * 0.92, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawFrame(dt: number, now: number): void {
    if (!ctx) return;
    twPh.step(now); twPot.step(now); twDim.step(now);
    const e1 = twPrice.step(now), e2 = twPhd.step(now), easing = e1 || e2;
    if (easing || readoutDirty) buildReadout();
    const kick = 1 + ringKick * 6; ringKick = Math.max(0, ringKick - dt * 0.6);
    for (let i = 0; i < 4; i++) ringPhase[i]! += RING_V[i]! * kick * dt;
    ringPhase[2]! += 0.35 * dt;
    if (burstOn) { burstT += dt; if (burstT > BURST_S) burstOn = false; }

    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    if (vignette && level < 4) { ctx.fillStyle = vignette; ctx.fillRect(cx - R * 2.6, cy - R * 2.6, R * 5.2, R * 5.2); }
    if (mite && level < 4) {
      const mx = W * 0.34 + Math.sin(T * 0.05) * H * 0.03 - MITE_W * miteS * 0.5;
      const my = H * 0.55 + Math.cos(T * 0.037) * H * 0.02 - MITE_H * miteS * 0.5;
      ctx.drawImage(mite, mx, my);
    }
    stepGlyphs(dt); drawGlyphs();
    drawRings();
    drawGauge();
    if (readout) ctx.drawImage(readout, roX, roY, RO_W, RO_H);
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
    const gapMs = lastTs ? Math.min(200, ts - lastTs) : 16;
    const dt = lastTs ? Math.min(0.1, gapMs / 1000) : 0.016;
    lastTs = ts; T += dt;
    const t0 = performance.now();
    drawFrame(dt, t0);
    const cost = performance.now() - t0;
    ema += (cost - ema) * 0.1;
    // Pacing (time between frames) catches what our own timer can't: raster/present cost when the GPU is off.
    gapEma += (gapMs - gapEma) * 0.1;
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
  const staticFrame = (): void => { if (reduced) drawFrame(0.016, performance.now() + 1e6); };
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
        else if (typeof v === "number" && isFinite(v)) (stats as unknown as Record<string, number>)[k] = v;
      }
      const ph = stats.poolHashratePhs;
      if (ph > fullScale * 0.9 || ph < fullScale * 0.15) fullScale = gaugeScaleFor(ph);
      if (fullScale !== faceScale) buildFace();
      if (reduced) { twPh.snap(ph); twPot.snap(stats.potAgeBlocks); twPrice.snap(stats.btcPriceUsd); twPhd.snap(stats.phdBanked); }
      else { twPh.set(ph, now, 600); twPot.set(stats.potAgeBlocks, now, 400); twPrice.set(stats.btcPriceUsd, now, 400); twPhd.set(stats.phdBanked, now, 400); }
      readoutDirty = true;
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
      burstOn = true; burstT = 0; ringKick = 1;
      if (reduced) { burstT = 0.15; staticFrame(); burstOn = false; }
    },
    resize() {
      // Coalesce: main.ts calls this from an unthrottled window.resize handler and
      // layout() rebuilds five offscreen caches. Leading call runs now; a burst
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
    debug() { return { frameMs: Math.round(ema * 100) / 100, gapMs: Math.round(gapEma * 10) / 10, glyphs: glyphN, level, scale: RENDER_SCALE[level]!, renderer: gpu.renderer }; },
  };
}
