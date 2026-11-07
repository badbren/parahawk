/**
 * Run tickets — the server's half of a ranked run.
 *
 * POST /api/game/start deals a ticket: a fresh, crypto-random seed bound to the
 * signed-in address and the time it was dealt, HMAC-signed so the client
 * cannot change any of it. The game draws its shaft from that seed; the run is
 * submitted with the ticket and replayed on the ticket's seed (replay.ts). A
 * ticket is good once (store.ts records spent nonces) and for TICKET_TTL_MS.
 *
 * Token: `gt1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`, payload
 * { v, seed, address, issuedAt, nonce }.
 *
 * The key comes from the same secret as the session cookie (KEYS_SECRET, with
 * the same loud dev fallback — src/services/auth.ts does not export its
 * secret(), so the rule is repeated here), run through HMAC with a label of
 * its own. A ticket therefore never verifies as a session or sign-in token,
 * and a session token never verifies as a ticket.
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export const TICKET_VERSION = 1 as const;
/** A run has to be submitted within this long of its ticket. */
export const TICKET_TTL_MS = 15 * 60_000;

const PREFIX = "gt1";
const KEY_LABEL = "parahawk/game-ticket/v1";
const DEV_SECRET = "dev-insecure-session-secret-do-not-use-in-prod";

/** Seeds are 32-bit (the game's xorshift); 0 is skipped because xorshift treats it specially. */
export const SEED_MIN = 1;
export const SEED_MAX = 0xffff_ffff;

export interface TicketPayload {
  v: typeof TICKET_VERSION;
  seed: number;
  address: string;
  issuedAt: number;
  nonce: string;
}

/** True when tickets would be signed with the public dev fallback. */
export const usingDevSecret = (): boolean => config.keysSecret.length < 16;

/**
 * A deployed site must not deal tickets signed with the public dev string —
 * anyone could forge them. (Sessions have the same dependency on KEYS_SECRET.)
 */
export const ticketsBlocked = (env: { VERCEL?: string }, devSecret: boolean): boolean => Boolean(env.VERCEL) && devSecret;

function key(): Buffer {
  const base = usingDevSecret() ? DEV_SECRET : config.keysSecret;
  return createHmac("sha256", base).update(KEY_LABEL).digest();
}

const mac = (body: string): string => createHmac("sha256", key()).update(`${PREFIX}.${body}`).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function signTicket(p: TicketPayload): string {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${PREFIX}.${body}.${mac(body)}`;
}

export type TicketCheck =
  | { ok: true; payload: TicketPayload; expiresAt: number }
  | { ok: false; reason: "forged" | "expired" };

const FORGED = { ok: false, reason: "forged" } as const;

/** Check a ticket's signature, shape and age. Says nothing about whether it has been spent. */
export function verifyTicket(token: unknown, now: number): TicketCheck {
  if (typeof token !== "string" || token.length > 1024) return FORGED;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return FORGED;
  const [, body, sig] = parts as [string, string, string];
  if (!safeEqual(sig, mac(body))) return FORGED;
  let p: Partial<TicketPayload>;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<TicketPayload>;
  } catch {
    return FORGED;
  }
  const valid = p.v === TICKET_VERSION
    && typeof p.seed === "number" && Number.isInteger(p.seed) && p.seed >= SEED_MIN && p.seed <= SEED_MAX
    && typeof p.address === "string" && p.address.length > 0 && p.address.length <= 128
    && typeof p.issuedAt === "number" && Number.isFinite(p.issuedAt)
    && typeof p.nonce === "string" && p.nonce.length >= 8 && p.nonce.length <= 64;
  if (!valid) return FORGED;
  // Signed by us but dated in the future: our clock never does that.
  if (p.issuedAt! > now + 5_000) return FORGED;
  const expiresAt = p.issuedAt! + TICKET_TTL_MS;
  if (now > expiresAt) return { ok: false, reason: "expired" };
  return { ok: true, payload: p as TicketPayload, expiresAt };
}

/**
 * Deals seeds. Every seed is a fresh draw from node:crypto — never derived
 * from a previous run, the time, or anything the client sent — and a seed
 * dealt recently is redrawn, so no two of the last `remember` tickets this
 * process dealt share a seed. (Across serverless instances the odds of two
 * live tickets sharing a seed are about one in four billion per pair.)
 */
export function createSeedDealer(remember = 50_000, draw: () => number = () => randomInt(SEED_MIN, SEED_MAX + 1)): () => number {
  const recent = new Set<number>();
  const ring: number[] = new Array(remember);
  let at = 0;
  return () => {
    let seed = draw();
    while (recent.has(seed)) seed = draw();
    const old = ring[at];
    if (old !== undefined) recent.delete(old);
    ring[at] = seed;
    at = (at + 1) % remember;
    recent.add(seed);
    return seed;
  };
}

export interface IssuedTicket {
  ticket: string;
  seed: number;
  issuedAt: number;
  expiresAt: number;
}

export function issueTicket(address: string, now: number, dealSeed: () => number): IssuedTicket {
  const seed = dealSeed();
  const payload: TicketPayload = { v: TICKET_VERSION, seed, address, issuedAt: now, nonce: randomBytes(12).toString("base64url") };
  return { ticket: signTicket(payload), seed, issuedAt: now, expiresAt: now + TICKET_TTL_MS };
}
