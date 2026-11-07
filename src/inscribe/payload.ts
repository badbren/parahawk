/**
 * The request Xverse's inscription flow takes, built and checked here so the
 * desktop window and the tests agree on it. Pure (no DOM, no Node).
 *
 * Read from the published sats-connect sources (@sats-connect/core 0.19.0,
 * whose `createInscription` is what sats-connect 3.x and 4.x export; Nov 2026):
 *
 *   window.XverseProviders.BitcoinProvider.createInscription(token) → { txId }
 *
 * where `token` is an UNSECURED JWT (jsontokens' createUnsecuredToken: header
 * {"typ":"JWT","alg":"none"}, base64url of the UTF-8 JSON, a trailing ".") of
 *
 *   { network: { type: "Mainnet" }, contentType, content,
 *     payloadType: "PLAIN_TEXT" | "BASE_64", suggestedMinerFeeRate?,
 *     appFee?, appFeeAddress? }
 *
 * Xverse then builds the commit + reveal, pays from the wallet, broadcasts, and
 * answers with a txid; a refusal rejects the promise. Its docs say inscriptions
 * are Mainnet-only. Parahawk never sets appFee: it adds nothing.
 *
 * The checks below mirror sats-connect's own validateInscriptionPayload, so a
 * bad request is caught here with a readable message instead of failing
 * silently inside the wallet.
 */

export const TEXT_CONTENT_TYPE = "text/plain;charset=utf-8";

/** sats-connect's mainnet cap on `content`, in characters (base64 characters for files). */
export const MAX_CONTENT_CHARS = 400_000;

/** The biggest file that fits: base64 turns 3 bytes into 4 characters. */
export const MAX_FILE_BYTES = Math.floor((MAX_CONTENT_CHARS / 4) * 3);

/** The content-type check sats-connect runs before it hands anything to Xverse. */
export const CONTENT_TYPE_RE = /^[a-z]+\/[a-z0-9\-.+]+(?=;.*|$)/;

/** Sanity bounds for the miner fee rate, sat/vB. */
export const MIN_FEE_RATE = 1;
export const MAX_FEE_RATE = 2_000;

export interface InscriptionPayload {
  network: { type: "Mainnet" };
  contentType: string;
  content: string;
  payloadType: "PLAIN_TEXT" | "BASE_64";
  suggestedMinerFeeRate: number;
}

export type InscriptionContent =
  | { kind: "text"; text: string }
  | { kind: "file"; bytes: Uint8Array; contentType: string };

/** A request that can't go to Xverse; the message is for the person, as-is. */
export class PayloadError extends Error {}

/** Content types by file extension, for files the browser can't name. */
const BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  txt: TEXT_CONTENT_TYPE,
  md: "text/markdown;charset=utf-8",
  html: "text/html;charset=utf-8",
  htm: "text/html;charset=utf-8",
  css: "text/css",
  js: "text/javascript",
  csv: "text/csv",
  json: "application/json",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  glb: "model/gltf-binary",
};

/** Text types read as UTF-8 by ord explorers unless told otherwise. */
const NEEDS_CHARSET = new Set(["text/plain", "text/html", "text/markdown"]);

/**
 * The content type to inscribe a file under: the browser's, when sats-connect
 * would accept it, else one from the extension; null when neither works.
 */
export function contentTypeFor(fileName: string, browserType: string): string | null {
  let type = browserType.trim().toLowerCase();
  if (!CONTENT_TYPE_RE.test(type)) {
    const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
    type = (ext && BY_EXTENSION[ext]) || "";
  }
  if (!type || !CONTENT_TYPE_RE.test(type)) return null;
  if (NEEDS_CHARSET.has(type)) type += ";charset=utf-8";
  return type;
}

/** UTF-8 length of a string — what a text inscription weighs on chain. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 with padding. Written out so the browser and Node behave the same. */
export function base64(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out.push(B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!);
  }
  const left = bytes.length - i;
  if (left === 1) {
    const n = bytes[i]! << 16;
    out.push(B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + "==");
  } else if (left === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out.push(B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + "=");
  }
  return out.join("");
}

/** base64url of a string's UTF-8 bytes, unpadded — jsontokens' encoding. */
export function base64Url(text: string): string {
  return base64(new TextEncoder().encode(text)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** jsontokens' createUnsecuredToken: what Xverse's legacy (non-RPC) methods take. */
export function unsecuredToken(payload: object): string {
  return `${base64Url(JSON.stringify({ typ: "JWT", alg: "none" }))}.${base64Url(JSON.stringify(payload))}.`;
}

/** A fee rate Xverse can take: a whole number of sat/vB, or null when out of bounds. */
export function cleanFeeRate(rate: number): number | null {
  if (!Number.isFinite(rate)) return null;
  const r = Math.round(rate);
  return r >= MIN_FEE_RATE && r <= MAX_FEE_RATE ? r : null;
}

const kb = (bytes: number) => `${Math.floor(bytes / 1024).toLocaleString("en-US")} KB`;

/** Checks the content and fee rate and builds the request, or throws a PayloadError saying what's wrong. */
export function buildPayload(content: InscriptionContent, feeRate: number): InscriptionPayload {
  const rate = cleanFeeRate(feeRate);
  if (rate == null) throw new PayloadError(`Pick a fee rate between ${MIN_FEE_RATE} and ${MAX_FEE_RATE.toLocaleString("en-US")} sat/vB.`);

  if (content.kind === "text") {
    if (content.text.trim() === "") throw new PayloadError("Type something to inscribe.");
    if (content.text.length > MAX_CONTENT_CHARS) {
      throw new PayloadError(`That's too long for Xverse: ${MAX_CONTENT_CHARS.toLocaleString("en-US")} characters at most.`);
    }
    return { network: { type: "Mainnet" }, contentType: TEXT_CONTENT_TYPE, content: content.text, payloadType: "PLAIN_TEXT", suggestedMinerFeeRate: rate };
  }

  if (content.bytes.length === 0) throw new PayloadError("That file is empty.");
  if (!CONTENT_TYPE_RE.test(content.contentType)) throw new PayloadError(`Xverse can't inscribe that kind of file (${content.contentType || "unknown type"}).`);
  if (content.bytes.length > MAX_FILE_BYTES) {
    throw new PayloadError(`That file is too big for Xverse — the limit is ${kb(MAX_FILE_BYTES)}.`);
  }
  return { network: { type: "Mainnet" }, contentType: content.contentType, content: base64(content.bytes), payloadType: "BASE_64", suggestedMinerFeeRate: rate };
}

/** A Bitcoin txid: 64 hex characters. */
export function isTxid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

export function mempoolTxUrl(txid: string): string {
  return `https://mempool.space/tx/${txid.toLowerCase()}`;
}
