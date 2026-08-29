/**
 * Boot cinematic — procedural Canvas 2D, no video/images/fonts (brief §6).
 *
 * Everything is a pure function of one timeline `t` (seconds). The shot list is
 * a beat table; the 3s "short" cut is the same shots on a compressed table.
 *
 *   rain    → hex glyph columns resolve out of black, accelerating
 *   canyon  → camera pushes in; circuit traces / die geometry in 3 parallax layers
 *   compute → nonce counter, candidate hashes failing, leading-zero best climbing
 *   lock    → one hash resolves: leading zeros lock left→right, rest falls away
 *   flash   → white, hold (onComplete fires here), overlay fades out and removes
 *
 * Contract: onComplete() fires exactly once, at the start of the white hold.
 * skip() = short flash → onComplete → 300ms fade → remove.
 */

export interface BootOptions {
  /** 3-second cut (mobile / slow first frames) instead of the full 10s. */
  short: boolean;
  /** Play even when prefers-reduced-motion is set (the ?boot=1 replay link). */
  ignoreReducedMotion?: boolean;
  onComplete: () => void;
}

export interface BootHandle {
  /** Jump to the end now (Skip button, Escape). Idempotent. */
  skip(): void;
}

/** Beat table: end time (s) of each shot; `complete` = onComplete moment. */
interface Beats { rain: number; canyon: number; compute: number; lock: number; complete: number; end: number }
const FULL: Beats = { rain: 1.5, canyon: 4.5, compute: 7.5, lock: 9.0, complete: 9.2, end: 10.0 };
const SHORT: Beats = { rain: 0.6, canyon: 1.6, compute: 2.3, lock: 2.7, complete: 2.75, end: 3.0 };

const HEX = "0123456789abcdef";
const ZEROS = 16; // leading zeros that lock in the final shot
const ATLAS_CELL = 32; // device px per glyph cell in the atlas

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

function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

export function playBoot(root: HTMLElement, opts: BootOptions): BootHandle {
  const mono = cssVar("--ph-mono", "Consolas,Menlo,monospace");
  const head = cssVar("--ph-head", "Impact,'Arial Black',sans-serif");
  const FG = cssVar("--ph-fg", "#e6e6e6");
  const DIM = cssVar("--ph-dim", "#8a8a8a");
  const ACCENT = cssVar("--ph-accent", "#8fd14f");

  let done = false;         // onComplete fired
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
  /** Fire onComplete (once) and fade the white overlay out over `fadeMs`. */
  const complete = (fadeMs: number): void => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    root.style.setProperty("--ph-boot-fade", `${fadeMs}ms`);
    root.classList.add("ph-boot-white");
    skipBtn.classList.remove("is-on");
    try { opts.onComplete(); } catch (e) { console.error("[boot] onComplete threw", e); }
    // Two frames so the desktop paints under the white before the fade starts.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.add("ph-boot-out");
      setTimeout(teardown, fadeMs + 80);
    }));
  };
  let skipping = false;
  const skip = (): void => {
    if (done || skipping) return;
    skipping = true;
    root.classList.add("ph-boot-white"); // ≤150ms white flash, then complete
    cancelAnimationFrame(raf);
    setTimeout(() => complete(300), 120);
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" || ev.key === "Enter") { ev.preventDefault(); skip(); }
  };
  skipBtn.addEventListener("click", (ev) => { ev.stopPropagation(); skip(); });
  window.addEventListener("keydown", onKey);

  // Reduced motion (main.ts never calls us then, but be safe) / no 2D context.
  const reduced = !opts.ignoreReducedMotion && typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !ctx) {
    setTimeout(() => complete(500), 60);
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

  // ── glyph atlas: 16 hex glyphs × 3 tints (fg, dim, accent), rendered once ─
  const atlas = document.createElement("canvas");
  atlas.width = ATLAS_CELL * 16; atlas.height = ATLAS_CELL * 3;
  {
    const a = atlas.getContext("2d");
    if (a) {
      a.font = `${ATLAS_CELL * 0.86}px ${mono}`;
      a.textAlign = "center"; a.textBaseline = "middle";
      const tints = [FG, DIM, ACCENT];
      for (let row = 0; row < 3; row++) {
        a.fillStyle = tints[row] ?? FG;
        for (let i = 0; i < 16; i++) a.fillText(HEX[i] ?? "0", i * ATLAS_CELL + ATLAS_CELL / 2, row * ATLAS_CELL + ATLAS_CELL / 2 + 1);
      }
    }
  }
  const T_FG = 0, T_DIM = 1, T_ACC = 2;
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

  // ── timeline / performance ─────────────────────────────────────────────
  // ?bootshort=1 forces the 3s cut (dev/QA aid).
  let forceShort = false;
  try { forceShort = new URLSearchParams(location.search).get("bootshort") === "1"; } catch { /* ignore */ }
  let beats: Beats = opts.short || forceShort ? SHORT : FULL;
  let t = 0;
  let last = performance.now();
  let paused = document.hidden;
  let quality = 1;            // 0.3–1 scales glyph/trace counts
  let frames = 0, accum = 0;  // frame-time stats
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
      for (let k = 0; k < len; k++) {
        const r = headRow - k;
        if (r < 0 || r >= rows) continue;
        const fade = 1 - k / len;
        ctx.globalAlpha = colA * (k === 0 ? 1 : fade * fade * 0.8);
        const g = hsh(c, r + Math.floor(t * (k === 0 ? 24 : 6) + c)) & 15;
        glyph(g, k === 0 ? T_FG : T_DIM, c * cell, r * cell, glyphPx);
      }
    }
    ctx.globalAlpha = 1;
  };

  /** Silicon canyon: traces fly outward from centre in 3 depth layers. */
  const drawCanyon = (p: number, alpha: number): void => {
    if (alpha <= 0.002) return;
    const cx = W / 2, cy = H / 2, R = Math.max(W, H) * 0.9;
    const n = Math.max(24, Math.floor(PER_LAYER * quality));
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
        const accent = (seed & 63) === 0;
        ctx.globalAlpha = a;
        ctx.strokeStyle = accent ? ACCENT : l === 2 ? FG : DIM;
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
          glyph((seed >>> 5) & 15, l === 2 ? T_FG : T_DIM, x + dx + pad, y + dy - gs / 2, gs);
        }
      }
    }
    ctx.globalAlpha = 1;
  };

  /** Draw a 64-hex candidate row from seed at (x,y); `zeros` leading zeros highlighted. */
  const drawHashRow = (seed: number, zeros: number, x: number, y: number, s: number, a: number, flickerT: number, wrap: boolean): void => {
    const perLine = wrap ? 32 : 64;
    for (let i = 0; i < 64; i++) {
      const line = Math.floor(i / perLine), col = i % perLine;
      const gx = x + col * s, gy = y + line * s * 1.25;
      if (i < zeros) { ctx.globalAlpha = a; glyph(0, T_ACC, gx, gy, s); }
      else { ctx.globalAlpha = a * 0.8; glyph(hsh(seed, i + flickerT) & 15, T_DIM, gx, gy, s); }
    }
  };

  /** Compute: nonce counter, candidate hashes streaming/failing, best-zeros climbing. */
  const drawCompute = (p: number, alpha: number): void => {
    if (alpha <= 0.002) return;
    const tl = t - beats.canyon;
    const dur = beats.compute - beats.canyon;
    const n = 4 * tl + (60 / dur) * tl * tl;            // rows emitted so far (accelerating)
    const wrap = W < 900;
    const s = wrap ? Math.min(14, (W * 0.92) / 32) : Math.min(15, (W * 0.9) / 64);
    const rowH = s * (wrap ? 2.9 : 1.6);
    const rows = Math.min(wrap ? 7 : 14, Math.max(4, Math.floor((H * 0.42) / rowH * quality)));
    const hashX = (W - s * (wrap ? 32 : 64)) / 2;
    const bigPx = Math.min(W * 0.085, 88);
    const cy = H * 0.36;

    // stream of failing candidates, scrolling up
    const base = Math.floor(n);
    for (let k = 0; k < rows; k++) {
      const id = base - k;
      if (id < 0) break;
      const y = cy + bigPx * 0.9 + (k + 1 - frac(n)) * rowH;
      if (y > H - 40) break;
      const seed = hsh(id, 77);
      const z = (seed & 15) < 9 ? 0 : (seed & 15) < 13 ? 1 : (seed & 15) < 15 ? 2 : 3 + ((seed >>> 4) & 1);
      const a = alpha * (k === 0 ? 1 : 0.6 * (1 - k / rows));
      drawHashRow(seed, z, hashX, y, s, a, k === 0 ? Math.floor(t * 40) : 0, wrap);
    }
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    // labels
    ctx.font = `${Math.max(10, s * 0.8)}px ${mono}`;
    ctx.fillStyle = DIM;
    ctx.fillText("NONCE", W / 2, cy - bigPx * 0.95);
    // big nonce counter
    const nonce = Math.floor(n * 7919 + tl * 61803) % 4294967296;
    ctx.font = `${bigPx}px ${mono}`;
    ctx.fillStyle = FG;
    ctx.fillText(nonce.toString(10).padStart(10, "0"), W / 2, cy);
    // best leading zeros climbing; ticks accent on increment
    const best = Math.min(ZEROS - 1, Math.floor(easeIn(p) * (ZEROS - 1) + 1));
    ctx.font = `${Math.max(10, s * 0.8)}px ${mono}`;
    ctx.textAlign = "left";
    ctx.fillStyle = DIM;
    ctx.fillText("LEADING ZEROS", hashX, cy + bigPx * 0.55);
    ctx.textAlign = "right";
    ctx.fillStyle = ACCENT;
    ctx.fillText(`${best} / ${ZEROS}`, hashX + s * (wrap ? 32 : 64), cy + bigPx * 0.55);
    ctx.globalAlpha = 1;
  };

  /** Lock: the winning hash, zeros locking left→right; everything else has fallen away. */
  const drawLock = (p: number): void => {
    const wrap = W < 900;
    const s = wrap ? Math.min(22, (W * 0.92) / 32) : Math.min(24, (W * 0.9) / 64);
    const x = (W - s * (wrap ? 32 : 64)) / 2;
    const y = H / 2 - (wrap ? s * 1.25 : s * 0.5);
    const lockEnd = 0.8;                                  // all zeros locked at 80% of the shot
    const kFlick = Math.floor(t * 30);
    const winner = 0x5eed;
    for (let i = 0; i < 64; i++) {
      const line = Math.floor(i / (wrap ? 32 : 64)), col = i % (wrap ? 32 : 64);
      const gx = x + col * s, gy = y + line * s * 1.25;
      if (i < ZEROS) {
        const li = (i / ZEROS) * lockEnd;                 // this zero's lock moment
        if (p >= li) {
          const since = (p - li) * (beats.lock - beats.compute); // seconds since lock
          const pop = Math.exp(-since * 9);
          ctx.globalAlpha = 1;
          glyph(0, T_ACC, gx, gy, s);
          if (pop > 0.02) {                                // brightness pop + tick mark
            ctx.globalAlpha = pop * 0.9;
            glyph(0, T_FG, gx, gy, s);
            ctx.fillStyle = ACCENT;
            ctx.fillRect(gx + s * 0.15, gy + s * 1.1, s * 0.7, Math.max(1, s * 0.08));
          }
        } else {
          ctx.globalAlpha = 0.5;
          glyph(hsh(i, kFlick) & 15, T_DIM, gx, gy, s);
        }
      } else {
        // the tail keeps flickering until the last zero locks, then settles to the winner
        const settled = p >= lockEnd;
        ctx.globalAlpha = settled ? 0.9 : 0.35;
        glyph(hsh(settled ? winner : i, settled ? i : kFlick + i) & 15, settled ? T_FG : T_DIM, gx, gy, s);
      }
    }
    ctx.globalAlpha = 1;
    // the one big word, earned: resolves above the hash once the hash has
    const wp = smooth((p - lockEnd) / (1 - lockEnd));
    if (wp > 0) {
      ctx.globalAlpha = wp;
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      const px = Math.min(W * 0.14, 128);
      ctx.font = `${px}px ${head}`;
      ctx.fillStyle = FG;
      ctx.fillText("PARAHAWK", W / 2, y - px * 0.45);
      ctx.globalAlpha = 1;
    }
  };

  // ── frame ──────────────────────────────────────────────────────────────
  const frame = (now: number): void => {
    if (done || skipping) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (paused) return;
    t += dt;

    // frame-time stats → quality + short-cut decision
    const ms = dt * 1000;
    frames++; accum += ms;
    ema += (ms - ema) * 0.15;
    if (!calibrated && frames > 1) { // frame 1 includes setup time; not representative
      calib += ms; calibN++;
      if (t >= 0.5) {
        calibrated = true;
        if (calibN > 0 && calib / calibN > 22) { beats = SHORT; console.debug("[boot] slow frames → short"); }
      }
    }
    if (ema > 18) quality = Math.max(0.3, quality * 0.9);
    else if (ema < 13) quality = Math.min(1, quality * 1.03);

    if (t >= 0.5) skipBtn.classList.add("is-on");

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    const b = beats;
    if (t < b.canyon) {
      // rain resolving; canyon pushes in from the middle of the rain shot
      const pr = clamp01(t / b.rain);
      const density = smooth(pr * 1.3);
      const accel = 0.7 + easeIn(t / b.canyon) * 3;
      const pc = clamp01((t - b.rain) / (b.canyon - b.rain));
      drawRain(smooth(pr * 1.5) * (1 - smooth((pc - 0.3) / 0.6)), accel, density);
      if (t > b.rain * 0.7) drawCanyon(pc, smooth((t - b.rain * 0.7) / ((b.canyon - b.rain) * 0.4)));
    } else if (t < b.compute) {
      const pk = clamp01((t - b.canyon) / (b.compute - b.canyon));
      drawCanyon(1, 1 - smooth(pk / 0.25));
      drawCompute(pk, smooth(pk / 0.18));
    } else if (t < b.lock) {
      const pl = clamp01((t - b.compute) / (b.lock - b.compute));
      if (pl < 0.3) drawCompute(1, 1 - smooth(pl / 0.3));
      drawLock(pl);
    } else {
      drawLock(1);
      const pf = clamp01((t - b.lock) / 0.18);
      ctx.globalAlpha = pf;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      if (t >= b.complete) {
        console.debug(`[boot] avg frame ${(accum / frames).toFixed(1)}ms over ${frames} frames, quality ${quality.toFixed(2)}`);
        complete(700);
      }
    }
  };
  raf = requestAnimationFrame(frame);

  return { skip };
}
