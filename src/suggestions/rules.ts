/**
 * Suggestions — what a suggestion is, and what makes one acceptable.
 *
 * Shared by the server (src/web/suggestion-routes.ts), which is the real gate,
 * and the desktop window (src/shell/apps/suggestions.ts), which checks the same
 * rules before sending so people see the problem without a round trip. No Node
 * or DOM imports: both sides bundle this file.
 *
 * Lengths are counted the way the browser's `maxlength` counts them (UTF-16
 * code units), so the form and the server never disagree about "too long".
 */

export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const NOTES_MAX = 4000;
/** The window shows a character counter once the notes get this long. */
export const NOTES_COUNTER_FROM = 3500;

export type SuggestionStatus = "new" | "read" | "done";
export const STATUSES: readonly SuggestionStatus[] = ["new", "read", "done"];

export function isStatus(v: unknown): v is SuggestionStatus {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

/** One suggestion, as the server stores it. */
export interface SuggestionRecord {
  /** App-generated uuid. */
  id: string;
  /** When the server accepted it (ms since the epoch). */
  at: number;
  title: string;
  notes: string;
  /** The signed-in sender's address (from the server session), or null for a guest. */
  address: string | null;
  status: SuggestionStatus;
}

/** A suggestion as the owner's inbox receives it: the record plus the sender's display name. */
export interface InboxItem extends SuggestionRecord {
  /** The sender's display name, when they have one. */
  name: string | null;
}

export interface InboxPage {
  items: InboxItem[];
  /** How many are still "new" — across the whole inbox, not just this page. */
  newCount: number;
}

// Control characters except tab / newline, the Unicode line/paragraph separators, and the
// bidi overrides (which can make text in the owner's inbox read differently from what it is).
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;

/** A title: one line, inner whitespace collapsed, trimmed. */
export function cleanTitle(raw: string): string {
  return raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

/** Notes: newlines kept (normalised to \n), tabs to spaces, no runs of more than two blank lines, trimmed. */
export function cleanNotes(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(CONTROL, "")
    .replace(/[  ]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export type SuggestionCheck =
  | { ok: true; value: { title: string; notes: string } }
  | { ok: false; error: string; field: "title" | "notes" | null };

/** Clean and check a submitted suggestion. Anything that isn't `{ title, notes }` strings is refused. */
export function checkSuggestion(body: unknown): SuggestionCheck {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "send a title and some notes", field: null };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.title !== "string") return { ok: false, error: "add a title", field: "title" };
  if (typeof b.notes !== "string") return { ok: false, error: "add some notes", field: "notes" };
  const title = cleanTitle(b.title);
  const notes = cleanNotes(b.notes);
  if (title.length < TITLE_MIN) return { ok: false, error: `the title needs at least ${TITLE_MIN} characters`, field: "title" };
  if (title.length > TITLE_MAX) return { ok: false, error: `keep the title under ${TITLE_MAX} characters`, field: "title" };
  if (notes.length === 0) return { ok: false, error: "add some notes", field: "notes" };
  if (notes.length > NOTES_MAX) return { ok: false, error: `keep the notes under ${NOTES_MAX.toLocaleString("en-US")} characters`, field: "notes" };
  return { ok: true, value: { title, notes } };
}

/** What the Suggestions icon says for `n` new ones: nothing, "1"…"9", or "9+". */
export function badgeText(n: number): string | null {
  if (!(n > 0)) return null;
  return n > 9 ? "9+" : String(Math.floor(n));
}
