/**
 * PARAHAWK on fire: the site's own wordmark with smoke and fire swirling inside
 * the letters, a shine that sweeps across them and a breathing orange halo.
 * The intro's hero card (boot/boot.ts) and the desktop's corner logo
 * (desktop/wallpaper-horizon.ts) are this one object at two sizes (owner,
 * 2026-11-06: "take that, reduce the size and put a copy of that in the top
 * right of our desktop").
 *
 * The letters are the header wordmark (src/web/logo.ts: Impact, hand-set
 * letters, roughened with feTurbulence), rasterised once from a data: SVG (the
 * CSP allows data: images). Everything is built in small steps (build()), so
 * no single frame pays for it; Impact text stands in if the SVG can't be had.
 * Per frame: the halo, a crisp base (a dark keyline under letters filled with
 * fire), then the smoke and shine, composed at half resolution (they're soft)
 * and masked to the letters, so the edges stay sharp whatever the smoke does.
 * No canvas filters anywhere: software rendering (the owner's Edge) pays dearly
 * for those.
 */
import { parahawkLogo } from "../../web/logo";

const TAU = Math.PI * 2;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number): number => { const c = clamp01(x); return c * c * (3 - 2 * c); };

const svgOf = (h: number, id: string): string => parahawkLogo({ height: h, id, fill: "#fff" });
const VB = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svgOf(132, "ph-aspect"));
/** The wordmark's width ÷ height. */
export const LOGO_ASPECT = VB ? Number(VB[1]) / Number(VB[2]) : 540 / 132;
/** The letters sit high in logo.ts's viewBox: drop the box by this × its height to centre the ink. */
export const LOGO_INK_DROP = 0.1;

/** The shine's bands: [offset behind the lead, in band widths; width; brightness]. */
const SHINE_BANDS: readonly (readonly [number, number, number])[] = [[0, 1, 0.95], [-2.3, 0.45, 0.55]];

/* ── tileable noise for the smoke ── */
function hsh(a: number, b: number): number {
  let x = (a * 374761393 + b * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return (x ^ (x >>> 16)) >>> 0;
}
/** Value noise on a lattice that wraps every P cells, and its fbm (octave o wraps every P·2^o): tileable textures. */
const lat = (x: number, y: number, s: number): number => hsh(x * 7919 + s * 104729, y * 6997 + s * 31) / 4294967296;
function pnoise(x: number, y: number, P: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
  const a = lat(x0, y0, s), b = lat(x1, y0, s), c = lat(x0, y1, s), d = lat(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function pfbm(x: number, y: number, P: number, oct: number, s: number): number {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) { sum += amp * pnoise(x * f, y * f, P * f, s + o * 17); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}
/** Domain-warped fbm on a P-cell periodic lattice (u, v in 0..1), so the warp stays tileable too. */
const warped = (u: number, v: number, P: number, oct: number, warp: number, seed: number): number => {
  const x = u * P, y = v * P;
  const wx = pfbm(x + 1.7, y + 9.2, P, 3, seed + 1), wy = pfbm(x + 8.3, y + 2.8, P, 3, seed + 2);
  return pfbm(x + warp * (wx - 0.5), y + warp * (wy - 0.5), P, oct, seed);
};
const ridge = (n: number): number => 1 - Math.abs(2 * n - 1);

const mk = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return [c, c.getContext("2d")];
};

type Step = () => boolean; // true = finished

/**
 * The three smoke layers (dark smoke, flame licks, white-hot wisps), shared by
 * every logo on the page: the intro builds them and the desktop's logo reuses
 * them. Built a band of rows per step.
 */
const TILES: { smoke: HTMLCanvasElement | null; flame: HTMLCanvasElement | null; wisp: HTMLCanvasElement | null } = { smoke: null, flame: null, wisp: null };
function tileJob(key: keyof typeof TILES, size: number, rgb: readonly [number, number, number], shade: (u: number, v: number) => number): Step {
  let row = 0, c: HTMLCanvasElement | null = null, x: CanvasRenderingContext2D | null = null, img: ImageData | null = null;
  return () => {
    if (TILES[key]) return true; // another logo already made it
    if (!c) { [c, x] = mk(size, size); img = x ? x.createImageData(size, size) : null; }
    if (!x || !img) return true;
    const px = img.data, band = Math.max(8, Math.ceil(size / 3));
    for (const r1 = Math.min(size, row + band); row < r1; row++) {
      for (let i = 0; i < size; i++) {
        const o = (row * size + i) * 4;
        px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2];
        px[o + 3] = Math.round(255 * clamp01(shade((i + 0.5) / size, (row + 0.5) / size)));
      }
    }
    if (row < size) return false;
    x.putImageData(img, 0, 0);
    TILES[key] = c;
    return true;
  };
}

export interface LogoDrawOpts {
  /** 0..1, default 1. */
  alpha?: number;
  /** The shine band's position across the logo (0..1), or < 0 between sweeps. Default -1. */
  shine?: number;
  /** Extra halo, e.g. while the shine passes. */
  glowBoost?: number;
  /** Smoke layers to draw, 0..3 (fewer when frames run slow). Default 3. */
  level?: number;
  /** A zoom-blur trail as it rushes in: how many copies, and how much smaller each one is. */
  copies?: number;
  blur?: number;
}

export interface LogoFx {
  /** True once everything is built; draw() works before that, showing what's ready. */
  readonly done: boolean;
  /**
   * Build one step, or everything left when `all`. The letters wait for the
   * SVG to load unless `fallBack`, which puts Impact text in its place.
   */
  build(all: boolean, fallBack: boolean): void;
  /** Draw it centred at (cx, cy), `w` css px wide, at time `t` (seconds; moves the smoke and the halo). */
  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, t: number, o?: LogoDrawOpts): void;
}

/**
 * `devW`: device pixels across at the biggest it will be drawn. `id`: the SVG
 * filter id (unique per logo). `head`: the font for the text stand-in.
 */
export function createLogoFx(opts: { devW: number; id: string; head: string; orange?: string; label?: string }): LogoFx {
  const ORANGE = opts.orange ?? "#f7931a";
  const devW = Math.max(120, Math.round(opts.devW)), devH = Math.max(30, Math.round(devW / LOGO_ASPECT));
  const img = new Image();
  img.decoding = "async";
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgOf(devH, opts.id));

  let mask: HTMLCanvasElement | null = null; // white letters, full resolution
  let base: HTMLCanvasElement | null = null; // dark keyline + fire-gradient letters, full resolution
  let glow: HTMLCanvasElement | null = null; // soft orange halo, quarter resolution
  let half: HTMLCanvasElement | null = null; // the letters at compose resolution (the smoke's mask)
  let basePad = 0, glowPad = 0, fromSvg = false, fallBack = false;
  const [comp, compX] = mk(devW * 0.5, devH * 0.5);
  let patSmoke: CanvasPattern | null = null, patFlame: CanvasPattern | null = null, patWisp: CanvasPattern | null = null;

  /** Text stands in for the SVG wordmark if it can't be used (a broken image, or not loaded in time). */
  const maskFromText = (x: CanvasRenderingContext2D): void => {
    let px = devH * 0.82;
    x.font = `${Math.round(px)}px ${opts.head}`;
    const w = x.measureText("PARAHAWK").width;
    if (w > devW * 0.94) { px *= (devW * 0.94) / w; x.font = `${Math.round(px)}px ${opts.head}`; }
    x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText("PARAHAWK", devW / 2, devH / 2);
  };

  /** The letters step; it can wait on the SVG, so build(all) gives up on it rather than spin. */
  function letters(): boolean {
    const ok = img.complete && img.naturalWidth > 0, broken = img.complete && img.naturalWidth === 0;
    if (!ok && !broken && !fallBack) return false;
    const [c, x] = mk(devW, devH);
    if (!x) return true;
    fromSvg = false;
    if (ok) { try { x.drawImage(img, 0, 0, devW, devH); fromSvg = true; } catch { /* broken after all */ } }
    if (!fromSvg) maskFromText(x);
    mask = c;
    return true;
  }
  const steps: Step[] = [
    tileJob("smoke", 128, [58, 17, 3], (u, v) => 0.72 * smooth((warped(u, v, 4, 5, 2.4, 101) - 0.45) / 0.28)),
    tileJob("flame", 192, [255, 196, 96], (u, v) => 0.85 * smooth((warped(u, v, 5, 4, 2.6, 201) - 0.5) / 0.22)),
    tileJob("wisp", 192, [255, 244, 228], (u, v) => 0.75 * Math.pow(ridge(warped(u, v, 6, 5, 2.4, 301)), 6)),
    () => {
      if (compX) {
        patSmoke = TILES.smoke && compX.createPattern(TILES.smoke, "repeat");
        patFlame = TILES.flame && compX.createPattern(TILES.flame, "repeat");
        patWisp = TILES.wisp && compX.createPattern(TILES.wisp, "repeat");
      }
      return true;
    },
    // the letters: the SVG wordmark once it has loaded (text if it can't be had in time)
    letters,
    // the crisp base: a dark keyline (the letters dilated) under letters filled with fire
    () => {
      if (!mask) return true;
      const k = Math.max(1.5, devH * 0.011);
      basePad = Math.ceil(k + 2);
      const [c, x] = mk(devW + 2 * basePad, devH + 2 * basePad), [f, fx] = mk(devW, devH);
      if (!x || !fx) return true;
      for (let i = 0; i < 8; i++) x.drawImage(mask, basePad + Math.cos((i / 8) * TAU) * k, basePad + Math.sin((i / 8) * TAU) * k);
      x.globalCompositeOperation = "source-in";
      x.fillStyle = "rgba(26,7,0,0.96)"; x.fillRect(0, 0, c.width, c.height);
      fx.drawImage(mask, 0, 0);
      fx.globalCompositeOperation = "source-in";
      const g = fx.createLinearGradient(0, devH * 0.08, 0, devH * 0.86);
      g.addColorStop(0, "#ffd36a"); g.addColorStop(0.42, ORANGE); g.addColorStop(1, "#b14a07");
      fx.fillStyle = g; fx.fillRect(0, 0, devW, devH);
      x.globalCompositeOperation = "source-over";
      x.drawImage(f, basePad, basePad);
      base = c;
      return true;
    },
    // the halo (blurred by shrinking and growing back) and the letters at compose resolution
    () => {
      if (!mask) return true;
      glowPad = Math.round(devH * 0.5);
      const gw = (devW + 2 * glowPad) / 4, gh = (devH + 2 * glowPad) / 4;
      const [g, gx] = mk(gw, gh), [w1, w1x] = mk(gw / 7, gh / 7), [w2, w2x] = mk(gw / 2.5, gh / 2.5);
      const [hf, hfx] = mk(comp.width, comp.height);
      if (!gx || !w1x || !w2x || !hfx) return true;
      gx.imageSmoothingQuality = w1x.imageSmoothingQuality = w2x.imageSmoothingQuality = "high";
      gx.drawImage(mask, glowPad / 4, glowPad / 4, devW / 4, devH / 4);
      w1x.drawImage(g, 0, 0, w1.width, w1.height);   // wide and soft
      w2x.drawImage(g, 0, 0, w2.width, w2.height);   // close and tight
      gx.clearRect(0, 0, g.width, g.height);
      gx.drawImage(w1, 0, 0, g.width, g.height);
      gx.globalAlpha = 0.8; gx.drawImage(w2, 0, 0, g.width, g.height); gx.globalAlpha = 1;
      gx.globalCompositeOperation = "source-in";
      gx.fillStyle = "#ff9a26"; gx.fillRect(0, 0, g.width, g.height);
      glow = g;
      hfx.imageSmoothingQuality = "high";
      hfx.drawImage(mask, 0, 0, hf.width, hf.height);
      half = hf;
      console.debug(`[${opts.label ?? "logo"}] PARAHAWK ready: ${fromSvg ? "svg wordmark" : "text fallback"} at ${devW}x${devH}`);
      return true;
    },
  ];

  /** Lay one smoke layer: a pattern drifting by (ox, oy), turned about the middle, at scale s (compose px). */
  const layer = (p: CanvasPattern, ox: number, oy: number, rot: number, s: number): void => {
    if (!compX) return;
    const w = comp.width, h = comp.height;
    p.setTransform(new DOMMatrix().translateSelf(w / 2, h / 2).rotateSelf((rot * 180) / Math.PI).translateSelf(-w / 2 + ox, -h / 2 + oy).scaleSelf(s, s));
    compX.fillStyle = p;
    compX.fillRect(0, 0, w, h);
  };
  /** This frame's smoke and shine, masked to the letters. */
  const compose = (t: number, level: number, shine: number): boolean => {
    const x = compX;
    if (!x || !half || (level <= 0 && shine < 0)) return false;
    const w = comp.width, h = comp.height;
    x.globalCompositeOperation = "source-over"; x.globalAlpha = 1;
    x.clearRect(0, 0, w, h);
    // smoke rises and swirls; each layer drifts its own way, at its own speed
    if (level >= 1 && patSmoke) layer(patSmoke, -t * w * 0.013, -t * h * 0.1, t * 0.05, (w / 128) * 0.4);
    x.globalCompositeOperation = "lighter";
    if (level >= 2 && patFlame) {
      x.globalAlpha = 0.8 + 0.2 * Math.sin(t * 3.1);
      layer(patFlame, t * w * 0.021, -t * h * 0.17, -t * 0.08, (w / 192) * 0.3);
    }
    if (level >= 3 && patWisp) {
      x.globalAlpha = 0.6 + 0.25 * Math.sin(t * 4.3 + 1.3);
      layer(patWisp, -t * w * 0.016, -t * h * 0.26, t * 0.11, (w / 192) * 0.22);
    }
    // the shine: a diagonal band of white-hot light sweeping left to right
    if (shine >= 0) {
      const bw = w * 0.065, sx = -bw * 4 + (w + bw * 8) * shine;
      x.globalAlpha = 1;
      for (const [off, k, gain] of SHINE_BANDS) {
        x.save();
        x.translate(sx + off * bw, h / 2); x.rotate(0.38);
        const hb = bw * k, g = x.createLinearGradient(-hb, 0, hb, 0);
        g.addColorStop(0, "rgba(255,190,90,0)"); g.addColorStop(0.4, `rgba(255,210,130,${(0.3 * gain).toFixed(3)})`);
        g.addColorStop(0.5, `rgba(255,252,245,${gain.toFixed(3)})`); g.addColorStop(0.6, `rgba(255,210,130,${(0.3 * gain).toFixed(3)})`);
        g.addColorStop(1, "rgba(255,190,90,0)");
        x.fillStyle = g; x.fillRect(-hb, -h * 1.5, hb * 2, h * 3);
        x.restore();
      }
    }
    x.globalAlpha = 1;
    x.globalCompositeOperation = "destination-in";
    x.drawImage(half, 0, 0);
    x.globalCompositeOperation = "source-over";
    return true;
  };

  return {
    get done() { return steps.length === 0; },
    build(all, fb) {
      fallBack = fallBack || fb;
      while (steps.length > 0) {
        const step = steps[0]!;
        if (!step()) { if (all && step !== letters) continue; return; }
        steps.shift();
        if (!all) return;
      }
    },
    draw(ctx, cx, cy, w, t, o = {}) {
      const a = o.alpha ?? 1, shine = o.shine ?? -1;
      if (!base || a < 0.01) return;
      const f = w / devW;
      if (glow) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = Math.min(1, a * (0.8 + 0.18 * Math.sin(t * 2.2) + (o.glowBoost ?? 0)));
        const gw = devW + 2 * glowPad, gh = devH + 2 * glowPad;
        ctx.drawImage(glow, cx - (gw / 2) * f, cy - (gh / 2) * f, gw * f, gh * f);
        ctx.globalCompositeOperation = "source-over";
      }
      const bw = devW + 2 * basePad, bh = devH + 2 * basePad, copies = o.copies ?? 0, blur = o.blur ?? 0;
      for (let k = copies; k >= 1; k--) {
        const fk = f * (1 - blur * k);
        ctx.globalAlpha = (a * 0.22) / k;
        ctx.drawImage(base, cx - (bw / 2) * fk, cy - (bh / 2) * fk, bw * fk, bh * fk);
      }
      ctx.globalAlpha = a;
      ctx.drawImage(base, cx - (bw / 2) * f, cy - (bh / 2) * f, bw * f, bh * f);
      if (compose(t, o.level ?? 3, shine)) ctx.drawImage(comp, cx - (devW / 2) * f, cy - (devH / 2) * f, devW * f, devH * f);
      ctx.globalAlpha = 1;
    },
  };
}
