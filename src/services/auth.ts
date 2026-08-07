import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type express from "express";
import { config } from "../config.js";

/**
 * Lightweight wallet-identity sessions.
 *
 * Parahawk is anonymous by default — the board and wizard need no account. A
 * session only exists so a user can own their *linked venue keys*: it binds a
 * bitcoin address (the one they mine to) to the browser via a signed,
 * httpOnly cookie. No passwords, no PII.
 *
 * Auth model: the user proves control of the address by signing a one-time
 * nonce with their wallet (Xverse / sats-connect, BIP-322), exactly like
 * parasite.space. In MOCK_DATA/dev we accept a typed address without a
 * signature so the flow is testable credential-free; in production
 * `verifyWalletSignature` MUST validate the signature and fails closed until
 * it does — we never accept an unauthenticated connect on a live deployment.
 */

const COOKIE = "ph_session";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Secret for signing session + CSRF tokens. Reuses KEYS_SECRET; a loud dev
 * fallback keeps local runs working without pretending to be secure. */
function secret(): string {
  if (config.keysSecret.length >= 16) return config.keysSecret;
  return "dev-insecure-session-secret-do-not-use-in-prod";
}

/** Bech32 mainnet address shape — enough to use as a handle, not full validation. */
const BC1_RE = /^bc1[a-z0-9]{20,87}$/;
export function isValidAddress(addr: string): boolean {
  return BC1_RE.test(addr.trim().toLowerCase());
}

/**
 * Addresses a wallet might sign in with — native segwit (bc1q), taproot (bc1p),
 * and legacy/nested (1.../3...). Case is preserved for base58 (they're
 * case-sensitive); the signature verify is the real gate. Used for auth, where
 * the identity is whatever address the wallet controls.
 */
const SIGNABLE_RE = /^(bc1[a-z0-9]{20,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
export function isSignableAddress(addr: string): boolean {
  return SIGNABLE_RE.test(addr.trim());
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface Session {
  address: string;
  issuedAt: number;
  expiresAt: number;
}

function encodeToken(s: Session): string {
  const payload = b64url(JSON.stringify(s));
  return `${payload}.${sign(payload)}`;
}

function decodeToken(token: string): Session | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, sign(payload))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (!s.address || !s.expiresAt || s.expiresAt < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

/** Read + verify the session cookie, or null. */
export function getSession(req: express.Request): Session | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === COOKIE) {
      return decodeToken(decodeURIComponent(part.slice(eq + 1).trim()));
    }
  }
  return null;
}

/** Issue a session cookie for a proven address. */
export function setSession(res: express.Response, address: string): void {
  const now = Date.now();
  const token = encodeToken({ address, issuedAt: now, expiresAt: now + TTL_MS });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicBaseUrl.startsWith("https"),
    maxAge: TTL_MS,
    path: "/",
  });
}

export function clearSession(res: express.Response): void {
  res.clearCookie(COOKIE, { path: "/" });
}

/** Per-session CSRF token (HMAC of the address) for state-changing POSTs. */
export function csrfToken(address: string): string {
  return sign(`csrf:${address}`);
}
export function checkCsrf(address: string, token: string | undefined): boolean {
  return typeof token === "string" && safeEqual(token, csrfToken(address));
}

const NONCE_TTL_MS = 5 * 60 * 1000; // sign-in challenge good for 5 minutes

/** The exact message the wallet signs. Server rebuilds it identically to verify. */
export function buildSignInMessage(address: string, nonce: string): string {
  return `Parahawk sign-in\nAddress: ${address}\nNonce: ${nonce}\n\nSigning proves you control this address. No funds move.`;
}

/** Issue a stateless, signed, short-lived sign-in nonce. */
export function issueNonce(): { nonce: string; token: string } {
  const nonce = randomBytes(16).toString("hex");
  const payload = b64url(JSON.stringify({ nonce, exp: Date.now() + NONCE_TTL_MS }));
  return { nonce, token: `${payload}.${sign(payload)}` };
}

/** Validate a nonce token (signature + expiry) and return the nonce, or null. */
export function verifyNonce(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  if (!safeEqual(token.slice(dot + 1), sign(payload))) return null;
  try {
    const { nonce, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!nonce || !exp || exp < Date.now()) return null;
    return nonce as string;
  } catch {
    return null;
  }
}

/**
 * Verify a wallet signature over the sign-in message. Fails closed: any error or
 * a bad signature returns false, so no unauthenticated connect can succeed. Uses
 * BIP-322 (what Xverse produces for segwit addresses). In mock/dev it accepts a
 * well-formed address so the flow is testable without a wallet.
 */
export async function verifyWalletSignature(
  address: string,
  message: string,
  signature: string,
): Promise<boolean> {
  if (config.mockData) return isValidAddress(address);
  try {
    // Lazy-load bip322-js so a native-module load issue on serverless can only
    // ever break wallet sign-in, never the whole site's page rendering.
    const { Verifier } = await import("bip322-js");
    return Verifier.verifySignature(address, message, signature) === true;
  } catch (err) {
    console.error("[verifyWalletSignature] failed:", (err as Error).message);
    return false;
  }
}
