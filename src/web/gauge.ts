/**
 * Speedometer-style hashrate gauge — a pure inline SVG string builder that
 * mimics the "Pool Hashrate" dial on parasite.space: a ~240° semicircular
 * dial with tick marks, numeric labels around the arc, a needle pointing at
 * the current reading, and the big value + unit printed in the lower gap.
 *
 * Self-contained — no external fonts, images, or scripts. Just returns an
 * `<svg>…</svg>` string you can drop straight into a page.
 */

export interface GaugeOpts {
  /** current reading, e.g. 99 (PH/s). */
  value: number;
  /**
   * full-scale value at the end of the dial. Default: a "nice" round number
   * comfortably above `value` (roughly `value * 1.6` rounded up to a
   * 1/2/2.5/5 ×10ⁿ step). If `value` is 0, defaults to 100.
   */
  max?: number;
  /** unit printed after the value (default "PH/s"). */
  unit?: string;
  /** rendered px width of the SVG (default 340). Height scales with it. */
  size?: number;
  /** unique id prefix for the gradient — differ if two gauges share a page. */
  id?: string;
}

// ── dial geometry, in viewBox units ────────────────────────────────────────
const VBW = 300; // viewBox width
const VBH = 228; // viewBox height (wider than tall, like a speedo)
const CX = 150; // dial centre x
const CY = 146; // dial centre y
const R = 104; // track centreline radius
const TRACK_W = 14; // track stroke width
const START = 150; // start angle (bottom-left)
const SWEEP = 240; // total arc span in degrees
const END = START + SWEEP; // end angle (bottom-right) = 390°
const TICKS = 9; // major tick/label count → 8 intervals

/** Polar → cartesian in screen space (y grows downward), angle in degrees. */
function pol(r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}

/** Trim a number to 2 dp for compact, clean path data. */
function f(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/** SVG arc path from `a0` to `a1` (both degrees), swept clockwise. */
function arc(r: number, a0: number, a1: number): string {
  const s = pol(r, a0);
  const e = pol(r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${f(s.x)} ${f(s.y)} A ${r} ${r} 0 ${large} 1 ${f(e.x)} ${f(e.y)}`;
}

/** Round `x` up to the next 1/2/2.5/5 ×10ⁿ "nice" number. */
function niceCeil(x: number): number {
  const exp = Math.floor(Math.log10(x));
  const base = Math.pow(10, exp);
  const frac = x / base; // in [1, 10)
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return step * base;
}

/**
 * The "nice" full-scale value the dial auto-scales to for a given reading:
 * a round 1/2/2.5/5 ×10ⁿ number ~1.6× the value, so the needle sits mid-dial
 * with headroom and the scale grows in clean steps as hashrate climbs.
 */
export function niceGaugeMax(value: number): number {
  return value > 0 ? niceCeil(value * 1.6) : 100;
}

/** Format a scale label: whole numbers when the step is >= 1, else 1 dp. */
function fmtTick(v: number, step: number): string {
  if (Math.abs(v) < 1e-9) return "0";
  return step >= 1 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
}

/**
 * Build a speedometer gauge as a self-contained inline SVG string.
 *
 * The needle points at `value` along a 240° arc (0 lower-left → `max`
 * lower-right); a lighter-grey→white progress arc fills the track up to the
 * value, and the reading is printed as "`value` `unit`" in the lower gap.
 * The needle is clamped to [0, max]; the printed value shows the real number.
 *
 * @returns an `<svg>…</svg>` string (width = `size`, height auto via viewBox).
 */
export function hashrateGauge(opts: GaugeOpts): string {
  const value = opts.value;
  const max = opts.max ?? niceGaugeMax(value);
  const unit = opts.unit ?? "PH/s";
  const size = opts.size ?? 340;
  const id = opts.id ?? "gauge";
  const gradId = `${id}-prog`;

  // needle position — clamp to the dial even if the reading overshoots.
  const clamped = Math.min(Math.max(value, 0), max > 0 ? max : 1);
  const frac = max > 0 ? clamped / max : 0;
  const needleAng = START + frac * SWEEP;

  const trackHalf = TRACK_W / 2;
  const tickBase = R + trackHalf; // ticks start just outside the track
  const step = max / (TICKS - 1);

  // ── ticks + numeric labels ───────────────────────────────────────────────
  const parts: string[] = [];
  const labelR = tickBase + 18;
  for (let i = 0; i < TICKS; i++) {
    const ang = START + (i / (TICKS - 1)) * SWEEP;
    const p0 = pol(tickBase, ang);
    const p1 = pol(tickBase + 10, ang);
    parts.push(
      `<line x1="${f(p0.x)}" y1="${f(p0.y)}" x2="${f(p1.x)}" y2="${f(p1.y)}" stroke="#666" stroke-width="2"/>`,
    );
    // minor ticks between this major and the next
    if (i < TICKS - 1) {
      for (let m = 1; m < 4; m++) {
        const ma = ang + (m / 4) * (SWEEP / (TICKS - 1));
        const mp0 = pol(tickBase, ma);
        const mp1 = pol(tickBase + 6, ma);
        parts.push(
          `<line x1="${f(mp0.x)}" y1="${f(mp0.y)}" x2="${f(mp1.x)}" y2="${f(mp1.y)}" stroke="#666" stroke-width="1"/>`,
        );
      }
    }
    const lp = pol(labelR, ang);
    parts.push(
      `<text x="${f(lp.x)}" y="${f(lp.y + 4)}" text-anchor="middle" font-size="12" fill="#fff">${fmtTick(step * i, step)}</text>`,
    );
  }

  // ── progress arc (only when there's something to show) ───────────────────
  const progress =
    frac > 0.001
      ? `<path d="${arc(R, START, needleAng)}" fill="none" stroke="url(#${gradId})" stroke-width="${TRACK_W}" stroke-linecap="round"/>`
      : "";

  // ── needle: a slim kite from a small tail through the hub to the tip ──────
  const tip = pol(R - 12, needleAng);
  const tail = pol(-16, needleAng);
  const bl = pol(6, needleAng + 90);
  const br = pol(6, needleAng - 90);
  const needle = `<polygon points="${f(tip.x)},${f(tip.y)} ${f(bl.x)},${f(bl.y)} ${f(tail.x)},${f(tail.y)} ${f(br.x)},${f(br.y)}" fill="#fff"/>`;

  // ── readout ──────────────────────────────────────────────────────────────
  const valueText = value.toFixed(1);
  const readout =
    `<text x="${CX}" y="${CY + 44}" text-anchor="middle" font-size="28" font-weight="700" fill="#fff">` +
    `${valueText}<tspan font-size="14" font-weight="400" fill="#8a8a8a" dx="6">${unit}</tspan>` +
    `</text>`;

  const gs = pol(R, START);
  const ge = pol(R, END);

  return `<svg class="hrgauge" viewBox="0 0 ${VBW} ${VBH}" width="${size}" height="${f((size * VBH) / VBW)}" role="img" aria-label="${valueText} ${unit}" font-family="Consolas,'SFMono-Regular',monospace" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${gradId}" x1="${f(gs.x)}" y1="${f(gs.y)}" x2="${f(ge.x)}" y2="${f(ge.y)}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#6a6a6a"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <path d="${arc(R, START, END)}" fill="none" stroke="#1c1c1c" stroke-width="${TRACK_W}" stroke-linecap="round"/>
  ${progress}
  ${parts.join("\n  ")}
  ${needle}
  <circle cx="${CX}" cy="${CY}" r="7" fill="#fff"/>
  <circle cx="${CX}" cy="${CY}" r="3" fill="#1c1c1c"/>
  ${readout}
</svg>`;
}
