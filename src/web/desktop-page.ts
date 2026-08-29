/**
 * The desktop shell host page. Served for top-level document navigations
 * (see the desktop gate in server.ts); the plain site keeps rendering for
 * frames, fetches and bots. The shell bundle (src/shell → public/shell) reads
 * its boot parameters from #ph-root's data-* attributes.
 */
import { statSync } from "node:fs";
import { esc } from "./format.js";

export interface DesktopPageOpts {
  /** Path to open in the Parahawk window on load, or null for a bare desktop. */
  openPath: string | null;
  /** "full" plays the boot cinematic; "skip" goes straight to the desktop. */
  boot: "full" | "skip";
  /** Cache-buster appended to the shell asset URLs. */
  assetVersion: string;
}

/**
 * Validate a raw request URL for use as the shell's open path. Returns null
 * for anything that is not a plain same-origin path (protocol-relative URLs,
 * oversized strings). Strips a `classic` query param if present.
 */
export function sanitizeOpenPath(raw: string): string | null {
  if (typeof raw !== "string" || raw.length > 512) return null;
  // Reject protocol-relative forms: browsers treat a backslash like a slash
  // (WHATWG URL parsing), so "/\evil.com" would navigate the iframe off-origin.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  // No control characters (attribute / header smuggling).
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  const q = raw.indexOf("?");
  if (q === -1) return raw;
  const path = raw.slice(0, q);
  const params = new URLSearchParams(raw.slice(q + 1));
  params.delete("classic");
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Compute the asset version once at server start. */
export function computeAssetVersion(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 8);
  try {
    return Math.floor(statSync("public/shell/shell.js").mtimeMs).toString(36);
  } catch {
    return Date.now().toString(36);
  }
}

export function renderDesktopPage(opts: DesktopPageOpts): string {
  const v = encodeURIComponent(opts.assetVersion);
  const open = opts.openPath ?? "";
  const classicHref = (opts.openPath ?? "/") + (open.includes("?") ? "&" : "?") + "classic=1";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="theme-color" content="#000"/>
<link rel="icon" type="image/png" href="/assets/community/hawk.png"/>
<link rel="apple-touch-icon" href="/assets/community/hawk.png"/>
<title>Parahawk</title>
<link rel="stylesheet" href="/assets/shell/shell.css?v=${v}"/>
</head>
<body>
<div id="ph-root" data-open="${esc(open)}" data-boot="${opts.boot}"></div>
<noscript><p style="color:#8fd14f;background:#000;font-family:monospace;padding:24px">The Parahawk desktop needs JavaScript. <a href="${esc(classicHref)}" style="color:#8fd14f">Open the classic site &rarr;</a></p></noscript>
<script defer src="/assets/shell/shell.js?v=${v}"></script>
</body>
</html>`;
}
