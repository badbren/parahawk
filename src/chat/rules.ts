/**
 * Chat rules — what a message may contain, and how fast one wallet may post.
 *
 * Pure and dependency-free on purpose: the server (src/web/chat-routes.ts)
 * enforces these, and the Chat window (src/shell/apps/chat.ts) imports the same
 * file for its character counter and its link rendering, so the two can never
 * disagree about what fits.
 */

/** Longest message, in characters (code points — an emoji counts once, like Postgres's char_length). */
export const CHAT_MAX_CHARS = 500;
/** Longest message, in lines, so one post can't push the whole room off screen. */
export const CHAT_MAX_LINES = 20;
/** Default and largest page of messages one read returns. */
export const CHAT_PAGE = 50;
export const CHAT_MAX_PAGE = 100;
/** One message per wallet per this long… */
export const CHAT_COOLDOWN_MS = 2_000;
/** …and at most CHAT_BURST_MAX in any CHAT_BURST_WINDOW_MS. */
export const CHAT_BURST_MAX = 30;
export const CHAT_BURST_WINDOW_MS = 10 * 60_000;
/** How far back (in message ids) a read reports deletions, so open windows drop removed messages. */
export const CHAT_REMOVED_WINDOW = 300;

export type CleanBody = { ok: true; body: string } | { ok: false; error: string };

/** Characters as people count them (code points), not UTF-16 units. */
export function charCount(s: string): number {
  return s.length - (s.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0);
}

// C0/C1 controls (newline and tab are handled first), the bidi overrides that
// can make text read backwards, and invisible spaces. Zero-width (non-)joiners
// stay: emoji sequences and several scripts need them.
const STRIP = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩​⁠﻿]/g;

/**
 * Tidy a message the way the server stores it: newlines normalised, control
 * characters gone, trailing spaces trimmed, runs of blank lines collapsed to
 * one, the whole thing trimmed — then checked against the limits.
 */
export function cleanBody(raw: unknown): CleanBody {
  if (typeof raw !== "string") return { ok: false, error: "Type a message first." };
  const body = raw
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(STRIP, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (body.length === 0) return { ok: false, error: "Type a message first." };
  const chars = charCount(body);
  if (chars > CHAT_MAX_CHARS) return { ok: false, error: `That's ${chars} characters — keep it to ${CHAT_MAX_CHARS}.` };
  if (body.split("\n").length > CHAT_MAX_LINES) return { ok: false, error: `Keep it to ${CHAT_MAX_LINES} lines.` };
  return { ok: true, body };
}

export type ChatPiece = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;

/** Trailing punctuation that belongs to the sentence, not the link ("see https://x.y/z."). */
function trimTail(url: string): string {
  let u = url;
  for (;;) {
    const last = u.slice(-1);
    if (/[.,;:!?'"*]/.test(last)) { u = u.slice(0, -1); continue; }
    // A closing bracket is the link's own only when the link opened one.
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    const open = pairs[last];
    if (open && u.split(open).length <= u.split(last).length - 1) { u = u.slice(0, -1); continue; }
    return u;
  }
}

/**
 * Split a message into plain text and http(s) links, for rendering as text
 * nodes and <a> elements — never as HTML. Anything that doesn't parse as an
 * http(s) URL stays text.
 */
export function splitLinks(text: string): ChatPiece[] {
  const out: ChatPiece[] = [];
  let at = 0;
  const push = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && prev.kind === "text") prev.text += t; else out.push({ kind: "text", text: t });
  };
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const url = trimTail(m[0]);
    push(text.slice(at, start));
    let href: string | null = null;
    try {
      const u = new URL(url);
      if (u.protocol === "http:" || u.protocol === "https:") href = u.href;
    } catch {
      href = null;
    }
    if (href) out.push({ kind: "link", text: url, href }); else push(url);
    at = start + url.length;
  }
  push(text.slice(at));
  return out;
}
