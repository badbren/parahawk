/**
 * Display-name rules — one source for the server (the authority, src/web/
 * profile-routes.ts) and the Profile window (instant feedback before a save).
 * Pure: no Node, no DOM, no imports.
 *
 *   3–20 characters; letters, digits, space, _ - . only (ASCII, so nobody can
 *   pose as someone else with look-alike letters); starts and ends with a
 *   letter or digit; runs of spaces collapse to one.
 *
 * Uniqueness ignores case AND spaces/_/-/., so "Bad.Bren" can't pose as
 * "badbren" (nameKey). Brand and role words are reserved for the owner, and a
 * short block-list keeps slurs off the Leaderboard and out of Chat.
 */

export const NAME_MIN = 3;
export const NAME_MAX = 20;
/** Renames allowed per address per UTC day. The owner is exempt. */
export const NAME_CHANGES_PER_DAY = 10;

export type NameCheck =
  | { ok: true; name: string; key: string }
  | { ok: false; error: string };

/** Trimmed, with runs of whitespace collapsed to one space. */
export function tidyName(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** What uniqueness compares: case, spaces and _ - . all ignored. */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/[\s_.-]+/g, "");
}

/** Digits people use for letters, folded back so "4dm1n" reads as "admin". */
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" };
const fold = (s: string) => s.replace(/[0134578]/g, (c) => LEET[c] ?? c);

/** Brand and role words — refused anywhere inside a name. */
const RESERVED_ANYWHERE = ["parahawk", "parasite", "admin", "moderator", "official"];
/** Generic words — refused as a whole word, or as the whole name. */
const RESERVED_WORDS = new Set([
  "owner", "mod", "mods", "system", "support", "staff", "root", "bot",
  "guest", "anon", "anonymous", "null", "undefined",
]);

// The block-list, kept encoded so the source doesn't read as a list of slurs.
// The first is matched anywhere in a name, the second only as a whole word
// (so "peacock" and "Dickens" stay fine).
const decode = (b64: string): string[] => atob(b64).split(",");
const BLOCKED_ANYWHERE = decode("ZnVjayxzaGl0LGN1bnQsbmlnZ2VyLG5pZ2dhLGZhZ2dvdCxyZXRhcmQsd2hvcmUsbmF6aSxoaXRsZXI=");
const BLOCKED_WORDS = new Set(decode(
  "ZmFnLGZhZ3Msa2lrZSxzcGljLGNoaW5rLGdvb2ssY29vbixkeWtlLHRyYW5ueSxyYXBlLHJhcGlzdCxjb2NrLGRpY2sscHVzc3ksYml0Y2gsc2x1dCx0d2F0LHdhbmssd2Fua2VyLGppenoscG9ybixjdW0sYW5hbCxra2s=",
));

/** The name's words, lower-cased and folded: "M0d_Squad" → ["mod", "squad"]. */
const words = (name: string) => fold(name.toLowerCase()).split(/[\s_.-]+/).filter(Boolean);

function isBlocked(name: string): boolean {
  const squashed = fold(nameKey(name));
  return BLOCKED_ANYWHERE.some((w) => squashed.includes(w)) || words(name).some((w) => BLOCKED_WORDS.has(w)) || BLOCKED_WORDS.has(squashed);
}

/** True for names only the owner may take ("Parahawk Admin", "the.owner", "m0d"). */
export function isReservedName(name: string): boolean {
  const squashed = fold(nameKey(name));
  return RESERVED_ANYWHERE.some((w) => squashed.includes(w)) || words(name).some((w) => RESERVED_WORDS.has(w)) || RESERVED_WORDS.has(squashed);
}

/**
 * Check a name someone typed. On success `name` is what to store (tidied) and
 * `key` is what uniqueness compares. Errors are short and meant to be shown as-is.
 */
export function checkName(raw: unknown, opts: { admin?: boolean } = {}): NameCheck {
  if (typeof raw !== "string") return { ok: false, error: "Type a name." };
  const name = tidyName(raw);
  if (name.length < NAME_MIN || name.length > NAME_MAX) return { ok: false, error: `Names are ${NAME_MIN}–${NAME_MAX} characters.` };
  if (!/^[A-Za-z0-9 _.-]+$/.test(name)) return { ok: false, error: "Letters, numbers, spaces and _ - . only." };
  if (!/^[A-Za-z0-9]/.test(name) || !/[A-Za-z0-9]$/.test(name)) return { ok: false, error: "Start and end with a letter or number." };
  if (isBlocked(name)) return { ok: false, error: "Pick a different name." };
  if (!opts.admin && isReservedName(name)) return { ok: false, error: "That name is reserved." };
  return { ok: true, name, key: nameKey(name) };
}

/**
 * One spelling per address: bech32 (bc1…/tb1…) is case-insensitive, so it is
 * lower-cased; base58 (1…/3…) is case-sensitive and kept exactly.
 */
export function canonicalAddress(address: string): string {
  const a = address.trim();
  return /^(bc1|tb1|bcrt1)/i.test(a) ? a.toLowerCase() : a;
}

export const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean =>
  a != null && b != null && canonicalAddress(a) === canonicalAddress(b);

/** Loose on purpose (bech32 and base58 both pass): for lookups and links, never for anything that moves money. */
export const looksLikeAddress = (a: string): boolean => /^[A-Za-z0-9]{8,100}$/.test(a);
