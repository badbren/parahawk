/**
 * The centre of the Event Horizon wallpaper: the Hash Globe, a planet of hex
 * characters. The owner picked it on 2026-11-06 over a sun ("The Furnace"), a
 * plasma orb and the black hole it replaced ("kinda boring and basic"); those
 * live in git history. The brief was "a pulsing Bitcoin or something", the
 * green glow orange like BTC, twice as big.
 *
 * The globe draws itself between the far and near halves of the hash disk;
 * wallpaper-horizon.ts owns the disk, the stream, the reading and the HUD.
 * Same cost rules as the rest of the wallpaper (the owner's Edge rasterises in
 * software): what doesn't move is an offscreen sprite built in layout(),
 * static glow is baked into the scene layer through bake(), and per-frame work
 * drops as the quality level rises.
 */

/* ── palette ────────────────────────────────────────────────────────────── */
/** The wallpaper's accent since 2026-11-06: Bitcoin orange (it was the shell green). */
export const BTC = {
  orange: "#f7931a",
  /** White-hot: the disk's inner edge, sparks, the hottest characters. */
  hot: "#ffe4c0",
  /** Effort past 1× an average block. */
  red: "#ff4d2a",
} as const;

/* ── the contract with wallpaper-horizon.ts ─────────────────────────────── */
export interface CoreLayout {
  cx: number;
  cy: number;
  /** The core's radius on screen, CSS px. */
  R: number;
  /** Canvas pixels per CSS px — build sprites at this density (or lower, for soft ones). */
  DPR: number;
  /** 0 (best) … 5 (cheapest). */
  level: number;
  mobile: boolean;
  mono: string;
}
export interface CoreFrame {
  /** Seconds since the wallpaper started; stands still while it is paused. */
  clock: number;
  /** Seconds since the last frame; 0 for a still frame (motion off). */
  dt: number;
  /** 0..1 heartbeat envelope ("lub-dub"); the tempo follows the hashrate. */
  beat: number;
  /** Seconds since the last "lub" — for rings and ripples thrown off by a beat. */
  since: number;
  /** 0..1, kicked to 1 when fresh pool numbers land, then fades. */
  pulse: number;
  /** 0..1, pool hashrate against its 24h average (0.5 = on average). */
  heat: number;
  /** 0..1, the block-found flash (1 when the block lands, then fades). */
  burst: number;
}
export interface CoreRenderer {
  /** Rebuild sprites; called on every resize and quality change. */
  layout(l: CoreLayout): void;
  /** Static glow baked into the scene layer, under the disk. ctx is in CSS px. */
  bake?(x: CanvasRenderingContext2D): void;
  /** Per frame, after the far half of the disk and before the near half. ctx is in CSS px. */
  draw(ctx: CanvasRenderingContext2D, f: CoreFrame): void;
  /** How the PH/s reading on top of the core is inked. */
  readonly ink: { value: string; unit: string; label: string; shadow: string | null };
}

/* ── shared helpers (wallpaper-horizon.ts uses them too) ───────────────── */
export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const smooth = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}
export function mkCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return [c, c.getContext("2d") as CanvasRenderingContext2D];
}
/** Deterministic value noise (+ fBm), so the same textures come back on every load. */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number, oct: number, seed: number): number {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) { s += amp * vnoise(x * f, y * f, seed + o * 17); norm += amp; amp *= 0.5; f *= 2.03; }
  return s / norm;
}
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A radial-gradient disc sprite: stops are [offset 0..1 of the radius, css colour]. */
function radialSprite(radius: number, density: number, stops: [number, string][]): HTMLCanvasElement {
  const [c, x] = mkCanvas(radius * 2 * density, radius * 2 * density);
  x.setTransform(density, 0, 0, density, radius * density, radius * density);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, radius);
  for (const [o, col] of stops) g.addColorStop(clamp(o, 0, 1), col);
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, radius, 0, TAU); x.fill();
  return c;
}

/**
 * The pool's heartbeat: a sharp "lub" and a softer "dub" just after it, 48 bpm
 * when the pool is slow and 72 when it runs hot. The phase is integrated, so a
 * change of tempo never jumps.
 */
export class Heartbeat {
  private phase = 0;
  /** Seconds since the last "lub" (huge until the first one). */
  since = 1e9;
  /** 0..1 envelope. */
  level = 0;
  step(dt: number, heat: number): void {
    const before = this.phase;
    this.phase += (dt * (48 + 24 * heat)) / 60;
    if (Math.floor(this.phase) !== Math.floor(before)) this.since = 0;
    else this.since += dt;
    const p = this.phase - Math.floor(this.phase);
    const lub = smooth(0, 0.035, p) * Math.exp(-Math.max(0, p - 0.035) / 0.085);
    const dub = p > 0.2 ? 0.55 * smooth(0.2, 0.235, p) * Math.exp(-Math.max(0, p - 0.235) / 0.07) : 0;
    this.level = Math.min(1, lub + dub);
  }
}

/* ══ Hash Globe ════════════════════════════════════════════════════════════
 * A planet of hex characters on a Fibonacci lattice, turning on a tilted
 * axis: the near side bright orange, the far side seen dimly through a dark
 * glassy body, a faint graticule for shape. Characters keep re-rolling (the
 * nonce never stops) and every beat sends a white ripple out from the middle
 * of the face to the limb. */
export function createHashGlobe(): CoreRenderer {
  let R = 100, cx = 0, cy = 0, lvl = 0, dpr = 1;
  let N = 0, rot = 0;
  let ux = new Float32Array(0), uy = new Float32Array(0), uz = new Float32Array(0), gph = new Float32Array(0);
  let gx = new Float32Array(0), gy = new Float32Array(0);
  let gch = new Uint8Array(0), gbk = new Uint8Array(0), gcol = new Uint8Array(0), gsz = new Uint8Array(0), glay = new Uint8Array(0);
  let atlas: HTMLCanvasElement | null = null, shade: HTMLCanvasElement | null = null;
  let heart: HTMLCanvasElement | null = null, rim: HTMLCanvasElement | null = null, halo: HTMLCanvasElement | null = null;
  const cw = [0, 0, 0], chh = [0, 0, 0];
  let acol = 0, arow = 0, rimR = 0, haloR = 0;
  // Axis: tipped towards us a little, leaning right.
  const AX = 0.22, AZ = -0.36;
  const cax = Math.cos(AX), sax = Math.sin(AX), caz = Math.cos(AZ), saz = Math.sin(AZ);
  /** far side, face, bright, the ripple */
  const GCOL = ["#8a3a0c", BTC.orange, "#ffcf8a", "#fff7ec"] as const;
  const HEXS = "0123456789abcdef";
  // Graticule: 8 meridians and 5 parallels as unit-sphere polylines.
  const grat: Float32Array[] = [];
  for (let m = 0; m < 8; m++) {
    const lam = (m / 8) * Math.PI, pts = new Float32Array(49 * 3);
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * TAU;
      pts[i * 3] = Math.cos(t) * Math.cos(lam); pts[i * 3 + 1] = Math.sin(t); pts[i * 3 + 2] = Math.cos(t) * Math.sin(lam);
    }
    grat.push(pts);
  }
  for (const lat of [-0.95, -0.5, 0, 0.5, 0.95]) {
    const pts = new Float32Array(49 * 3), cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * TAU;
      pts[i * 3] = cl * Math.cos(t); pts[i * 3 + 1] = sl; pts[i * 3 + 2] = cl * Math.sin(t);
    }
    grat.push(pts);
  }
  let RX = 0, RY = 0, RZ = 0;
  /** Unit-sphere point → rotated about the axis by `rot`, then tipped: result in RX/RY/RZ (RZ > 0 faces us). */
  function turn(x: number, y: number, z: number, cr: number, sr: number): void {
    const x1 = x * cr + z * sr, z1 = -x * sr + z * cr;
    const y2 = y * cax - z1 * sax, z2 = y * sax + z1 * cax;
    RX = x1 * caz - y2 * saz; RY = x1 * saz + y2 * caz; RZ = z2;
  }
  function buildAtlas(mono: string): void {
    const s0 = Math.round(clamp(R * 0.05, 10, 24)), sizes = [s0, Math.round(s0 * 0.8), Math.round(s0 * 0.62)];
    const tmp = mkCanvas(4, 4)[1];
    let mw = 0, mh = 0;
    for (let s = 0; s < 3; s++) {
      tmp.font = `bold ${sizes[s]!}px ${mono}`;
      cw[s] = Math.ceil(tmp.measureText("0").width) + 1; chh[s] = Math.ceil(sizes[s]! * 1.3);
      mw = Math.max(mw, cw[s]!); mh = Math.max(mh, chh[s]!);
    }
    acol = mw; arow = mh;
    const [c, x] = mkCanvas(16 * mw * dpr, 12 * mh * dpr);
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.textBaseline = "middle";
    for (let col = 0; col < 4; col++) {
      x.fillStyle = GCOL[col]!;
      for (let s = 0; s < 3; s++) {
        x.font = `bold ${sizes[s]!}px ${mono}`;
        for (let k = 0; k < 16; k++) x.fillText(HEXS[k]!, k * mw, (col * 3 + s) * mh + mh / 2);
      }
    }
    atlas = c;
  }
  function drawGraticule(ctx: CanvasRenderingContext2D, cr: number, sr: number, front: boolean, alpha: number): void {
    ctx.beginPath();
    for (const pts of grat) {
      let pen = false;
      for (let i = 0; i < pts.length / 3; i++) {
        turn(pts[i * 3]!, pts[i * 3 + 1]!, pts[i * 3 + 2]!, cr, sr);
        const on = front ? RZ >= 0 : RZ < 0, X = cx + RX * R, Y = cy + RY * R;
        if (on) { if (pen) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); pen = true; } else pen = false;
      }
    }
    ctx.globalAlpha = alpha; ctx.stroke();
  }
  function drawGlyphs(ctx: CanvasRenderingContext2D, layer: number): void {
    if (!atlas) return;
    for (let b = 0; b < 6; b++) {
      ctx.globalAlpha = (b + 0.5) / 6;
      for (let i = 0; i < N; i++) {
        if (gbk[i] !== b || glay[i] !== layer) continue;
        const s = gsz[i]!, w = cw[s]!, h = chh[s]!;
        ctx.drawImage(atlas, gch[i]! * acol * dpr, (gcol[i]! * 3 + s) * arow * dpr, w * dpr, h * dpr, gx[i]! - w / 2, gy[i]! - h / 2, w, h);
      }
    }
  }

  return {
    ink: { value: "#ffffff", unit: "rgba(255,214,170,0.85)", label: "rgba(255,196,130,0.9)", shadow: "rgba(0,0,0,0.95)" },
    layout(l) {
      R = l.R; cx = l.cx; cy = l.cy; lvl = l.level; dpr = l.DPR;
      // Glyphs are cheap even in software (small atlas blits; the big blits are what cost), so thin them gently.
      N = Math.round(clamp(760 * (R / 360) * (R / 360), 220, 950) * ([1, 0.9, 0.8, 0.7, 0.62, 0.5][lvl] ?? 0.5) * (l.mobile ? 0.6 : 1));
      ux = new Float32Array(N); uy = new Float32Array(N); uz = new Float32Array(N); gph = new Float32Array(N);
      gx = new Float32Array(N); gy = new Float32Array(N);
      gch = new Uint8Array(N); gbk = new Uint8Array(N); gcol = new Uint8Array(N); gsz = new Uint8Array(N); glay = new Uint8Array(N);
      const golden = Math.PI * (3 - Math.sqrt(5)), r2 = mulberry32(0x910be);
      for (let i = 0; i < N; i++) {
        const y = 1 - ((i + 0.5) / N) * 2, r = Math.sqrt(1 - y * y), t = i * golden;
        ux[i] = Math.cos(t) * r; uy[i] = y; uz[i] = Math.sin(t) * r;
        gch[i] = (r2() * 16) | 0; gph[i] = r2() * TAU;
      }
      buildAtlas(l.mono);
      shade = radialSprite(R * 1.02, Math.min(dpr, 1), [[0, "rgba(5,2,0,0.97)"], [0.86, "rgba(9,3,0,0.96)"], [0.97, "rgba(24,8,0,0.94)"], [1, "rgba(0,0,0,0)"]]);
      heart = radialSprite(R * 0.9, 0.5, [[0, "rgba(255,160,60,0.24)"], [0.55, "rgba(247,147,26,0.08)"], [1, "rgba(247,147,26,0)"]]);
      rimR = R * 1.3;
      const rr = (r: number) => r / rimR;
      rim = radialSprite(rimR, 0.5, [[rr(R * 0.84), "rgba(255,160,60,0)"], [rr(R * 0.97), "rgba(255,170,70,0.26)"],
        [rr(R * 1.0), "rgba(255,196,120,0.55)"], [rr(R * 1.04), "rgba(247,147,26,0.2)"], [1, "rgba(247,120,20,0)"]]);
      haloR = R * 2.2;
      const hr = (r: number) => r / haloR;
      halo = radialSprite(haloR, 0.4, [[hr(R * 0.95), "rgba(247,147,26,0)"], [hr(R * 1.03), "rgba(247,147,26,0.16)"],
        [hr(R * 1.4), "rgba(230,110,20,0.05)"], [1, "rgba(200,80,10,0)"]]);
    },
    bake(x) {
      if (!halo) return;
      x.globalCompositeOperation = "lighter";
      x.drawImage(halo, cx - haloR, cy - haloR, haloR * 2, haloR * 2);
      x.globalCompositeOperation = "source-over";
    },
    draw(ctx, f) {
      if (!atlas || !shade) return;
      rot += f.dt * (0.1 + 0.12 * f.heat);
      const cr = Math.cos(rot), sr = Math.sin(rot);
      if (f.dt > 0) {
        const n = Math.round(N * 0.5 * f.dt) + (Math.random() < (N * 0.5 * f.dt) % 1 ? 1 : 0);
        for (let k = 0; k < n; k++) gch[(Math.random() * N) | 0] = (Math.random() * 16) | 0;
      }
      const rip = f.since < 1.25, front = f.since * 2.3, fade = Math.max(0, 1 - f.since / 1.25);
      for (let i = 0; i < N; i++) {
        turn(ux[i]!, uy[i]!, uz[i]!, cr, sr);
        const z = RZ;
        gx[i] = cx + RX * R; gy[i] = cy + RY * R;
        let a: number;
        if (z < 0) {
          a = 0.06 + 0.2 * (1 + z); gcol[i] = 0; gsz[i] = 2; glay[i] = 0;
        } else {
          const w = rip ? Math.exp(-Math.pow((Math.acos(Math.min(1, z)) - front) / 0.17, 2)) * fade : 0;
          a = Math.min(1, 0.26 + 0.74 * Math.pow(z, 0.65) + 0.45 * w + 0.12 * f.beat);
          gcol[i] = w > 0.35 ? 3 : z > 0.8 ? 2 : 1;
          gsz[i] = w > 0.5 || z > 0.55 ? 0 : 1; glay[i] = 1;
        }
        a *= 0.8 + 0.2 * Math.sin(f.clock * 1.7 + gph[i]!);
        // Quieter behind the reading (caption + PH/s) so the numbers stay crisp.
        const ex = RX / 0.86, ey = (RY + 0.14) / 0.44, e = ex * ex + ey * ey;
        if (e < 1) a *= 0.3 + 0.7 * smooth(0.55, 1, e);
        gbk[i] = a <= 0.03 ? 255 : Math.min(5, (a * 6) | 0);
      }
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      ctx.drawImage(shade, cx - R * 1.02, cy - R * 1.02, R * 2.04, R * 2.04);
      ctx.strokeStyle = BTC.orange; ctx.lineWidth = 1;
      if (lvl < 3) drawGraticule(ctx, cr, sr, false, 0.06);
      drawGlyphs(ctx, 0);
      ctx.globalCompositeOperation = "lighter";
      if (heart) {
        const s = 1 + 0.06 * f.beat;
        ctx.globalAlpha = Math.min(1, 0.55 + 0.6 * f.beat + 0.4 * f.pulse + f.burst);
        ctx.drawImage(heart, cx - R * 0.9 * s, cy - R * 0.9 * s, R * 1.8 * s, R * 1.8 * s);
      }
      ctx.globalCompositeOperation = "source-over";
      if (lvl < 3) drawGraticule(ctx, cr, sr, true, 0.13);
      drawGlyphs(ctx, 1);
      ctx.globalCompositeOperation = "lighter";
      if (rim) {
        ctx.globalAlpha = Math.min(1, 0.7 + 0.35 * f.beat + 0.3 * f.pulse + f.burst);
        ctx.drawImage(rim, cx - rimR, cy - rimR, rimR * 2, rimR * 2);
      }
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    },
  };
}
