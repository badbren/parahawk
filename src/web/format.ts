/** Human formatters for the terminal-styled UI. */

export function fmtHashrate(phs: number): string {
  if (phs >= 1000) return `${(phs / 1000).toFixed(2)} EH/s`;
  return `${phs.toFixed(1)} PH/s`;
}

/** Difficulty in T / P / E units. */
export function fmtDiff(d: number): string {
  if (d >= 1e18) return `${(d / 1e18).toFixed(2)}E`;
  if (d >= 1e15) return `${(d / 1e15).toFixed(2)}P`;
  if (d >= 1e12) return `${(d / 1e12).toFixed(2)}T`;
  if (d >= 1e9) return `${(d / 1e9).toFixed(2)}G`;
  return d.toFixed(0);
}

export function fmtSats(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} sats`;
}

export function fmtUsd(n: number, digits = 2): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function fmtUsd0(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

export function fmtPhd(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k PHd`;
  return `${n.toFixed(0)} PHd`;
}

/** Duration from hours → "1d 4h" / "18h" / "45m". */
export function fmtDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

export function potEmoji(verdict: "fresh" | "aging" | "stale"): string {
  return verdict === "fresh" ? "🟢" : verdict === "aging" ? "🟡" : "🔴";
}

export function hashpriceEmoji(verdict: "good" | "normal" | "expensive"): string {
  return verdict === "good" ? "🟢" : verdict === "normal" ? "🟡" : "🔴";
}

/** Escape untrusted text for HTML output. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function timeAgo(ms: number | null): string {
  if (ms === null) return "never";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
