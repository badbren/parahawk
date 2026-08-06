/**
 * PARAHAWK wordmark — a rough, hand-painted brush look in the spirit of the
 * Parasite Pool logo: white letters on black, wonky baseline, distressed edges.
 *
 * It's a pure inline SVG so it needs no font files or external assets. A heavy
 * condensed face (Impact / Arial Black) is roughened with an feTurbulence +
 * feDisplacementMap filter, and each letter is nudged/rotated a little so the
 * baseline wobbles like it was painted by hand.
 */

const WORD = "PARAHAWK";
// deterministic per-letter jitter so the mark is stable across renders
const ROT = [-5, 4, -3, 6, -4, 3, -6, 4];
const DY = [2, -6, 5, -3, 4, -5, 3, -2];

export interface LogoOpts {
  /** rendered height in px (width scales with the viewBox). */
  height?: number;
  /** unique filter id — must differ if two logos share a page. */
  id?: string;
  /** fill colour (default white). */
  fill?: string;
}

export function parahawkLogo(opts: LogoOpts = {}): string {
  const height = opts.height ?? 42;
  const id = opts.id ?? "ph-rough";
  const fill = opts.fill ?? "#fff";

  const stepX = 64;
  const x0 = 22;
  const baseY = 96;

  const letters = WORD.split("")
    .map((ch, i) => {
      const x = x0 + i * stepX;
      const y = baseY + DY[i]!;
      return `<text x="${x}" y="${y}" transform="rotate(${ROT[i]} ${x} ${y})">${ch}</text>`;
    })
    .join("");

  const vbW = x0 + WORD.length * stepX + 6;
  const vbH = 132;

  return `<svg class="phlogo" viewBox="0 0 ${vbW} ${vbH}" height="${height}" width="${(height * vbW) / vbH}" role="img" aria-label="Parahawk" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="${id}" x="-6%" y="-14%" width="112%" height="128%">
      <feTurbulence type="fractalNoise" baseFrequency="0.014 0.05" numOctaves="3" seed="7" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="9" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
  <g filter="url(#${id})" fill="${fill}" font-family="Impact,'Arial Narrow','Arial Black',sans-serif" font-weight="900" font-size="104" letter-spacing="-2" style="text-transform:uppercase">
    ${letters}
  </g>
</svg>`;
}
