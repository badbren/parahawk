import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, maskSecret } from "./vault.js";

const SECRET = "test-keys-secret-at-least-16-chars-long";

describe("vault encrypt/decrypt", () => {
  it("round-trips a value", () => {
    const key = "nh_api_key_abcdef0123456789";
    const blob = encryptSecret(key, SECRET);
    expect(decryptSecret(blob, SECRET)).toBe(key);
  });

  it("never stores the plaintext in the blob", () => {
    const key = "super-secret-token-XYZ";
    const blob = encryptSecret(key, SECRET);
    expect(blob).not.toContain(key);
    expect(blob).not.toContain("XYZ");
  });

  it("produces a different blob each time (random salt + IV)", () => {
    const a = encryptSecret("same-value", SECRET);
    const b = encryptSecret("same-value", SECRET);
    expect(a).not.toBe(b);
    // …but both decrypt back to the same plaintext.
    expect(decryptSecret(a, SECRET)).toBe("same-value");
    expect(decryptSecret(b, SECRET)).toBe("same-value");
  });

  it("fails to decrypt with the wrong secret", () => {
    const blob = encryptSecret("value", SECRET);
    expect(() => decryptSecret(blob, "a-different-16char-secret!!")).toThrow();
  });

  it("detects tampering (GCM auth tag)", () => {
    const blob = encryptSecret("value", SECRET);
    const parts = blob.split(":");
    // Flip a byte in the ciphertext field.
    const ct = Buffer.from(parts[4], "base64");
    ct[0] ^= 0xff;
    parts[4] = ct.toString("base64");
    expect(() => decryptSecret(parts.join(":"), SECRET)).toThrow();
  });

  it("rejects a malformed blob", () => {
    expect(() => decryptSecret("not-a-real-blob", SECRET)).toThrow(/malformed/);
  });

  it("refuses to encrypt under a too-short secret", () => {
    expect(() => encryptSecret("value", "short")).toThrow(/too short/);
  });
});

describe("maskSecret", () => {
  it("shows only the last 4 chars", () => {
    expect(maskSecret("abcdef0123456789")).toBe("…6789");
  });
  it("handles very short values", () => {
    expect(maskSecret("ab")).toBe("…ab");
  });
});
