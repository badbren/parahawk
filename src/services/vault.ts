import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { config } from "../config.js";

/**
 * Encryption-at-rest for users' linked venue API keys.
 *
 * Parahawk is non-custodial: it never holds funds, but to place an order from a
 * user's own NiceHash/MRR account it must store that user's API key. Those keys
 * are encrypted with AES-256-GCM under a server secret (KEYS_SECRET) and never
 * logged, never returned to the client after entry, and only ever decrypted in
 * memory at the moment an order is placed. A key should be created at the venue
 * with MARKETPLACE/ORDER scope only — never withdrawal — so even a full breach
 * of this vault can't move anyone's coins.
 *
 * GCM gives us authenticated encryption: a tampered blob fails to decrypt rather
 * than silently returning garbage. Each record carries its own random salt (for
 * the scrypt KDF) and IV, so identical plaintexts never produce identical blobs.
 */

const ALGO = "aes-256-gcm";
const KEY_LEN = 32; // 256-bit
const SALT_LEN = 16;
const IV_LEN = 12; // GCM standard nonce length
const MIN_SECRET_LEN = 16;

/** True when KEYS_SECRET is set well enough to enable the vault. */
export function isVaultReady(): boolean {
  return config.keysSecret.length >= MIN_SECRET_LEN;
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LEN);
}

/**
 * Encrypt a secret string into a self-describing blob:
 *   v1:<salt>:<iv>:<tag>:<ciphertext>   (each field base64)
 * `secret` defaults to the configured KEYS_SECRET; tests pass one explicitly.
 */
export function encryptSecret(plaintext: string, secret: string = config.keysSecret): string {
  if (secret.length < MIN_SECRET_LEN) {
    throw new Error(`vault secret too short (need ≥${MIN_SECRET_LEN} chars)`);
  }
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(secret, salt);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    salt.toString("base64"),
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a blob produced by encryptSecret. Throws if the secret is wrong or the
 * blob was tampered with (GCM auth-tag mismatch) — callers must treat any throw
 * as "key unavailable", never fall back to plaintext.
 */
export function decryptSecret(blob: string, secret: string = config.keysSecret): string {
  const parts = blob.split(":");
  const [version, saltB64, ivB64, tagB64, ctB64] = parts;
  if (parts.length !== 5 || version !== "v1" || !saltB64 || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("malformed vault blob");
  }
  const salt = Buffer.from(saltB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const key = deriveKey(secret, salt);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  // .final() throws on auth-tag mismatch — tamper detection.
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Masked display for the UI: only the last 4 chars survive, so a linked key can
 * be recognized without ever re-exposing it. e.g. "…a1b2".
 */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return "…" + plaintext;
  return "…" + plaintext.slice(-4);
}
