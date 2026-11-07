import { describe, expect, it } from "vitest";
import { POSTAGE_SATS, addressKind, commitVbytes, inscriptionCost, revealSize } from "./cost.js";
import { parseRecommendedFees } from "./fees.js";
import {
  CONTENT_TYPE_RE,
  MAX_CONTENT_CHARS,
  MAX_FILE_BYTES,
  PayloadError,
  TEXT_CONTENT_TYPE,
  base64,
  base64Url,
  buildPayload,
  cleanFeeRate,
  contentTypeFor,
  isTxid,
  mempoolTxUrl,
  unsecuredToken,
  utf8Length,
} from "./payload.js";

const decodeToken = (token: string) => {
  const [header, payload, signature, ...rest] = token.split(".");
  expect(rest).toEqual([]);
  return {
    header: JSON.parse(Buffer.from(header!, "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")),
    signature,
  };
};

describe("revealSize — the ord envelope in the witness", () => {
  it("sizes a one-word text inscription by hand", () => {
    // script: 33 key + 1 checksig + 1 false + 1 if + 4 "ord" + 2 tag + (1+24) type + 1 sep + (1+2) body + 1 endif = 72
    const r = revealSize(2, TEXT_CONTENT_TYPE);
    expect(r.script).toBe(72);
    // witness: 1 count + 65 sig + (1+72) script + 34 control + 2 marker/flag = 175
    expect(r.witness).toBe(175);
    expect(r.weight).toBe(94 * 4 + 175);
    expect(r.vbytes).toBe(Math.ceil((94 * 4 + 175) / 4));
  });

  it("splits the body into 520-byte pushes", () => {
    const a = revealSize(520, "image/png");
    const b = revealSize(521, "image/png");
    // 520 bytes is one full push (3 + 520); 521 adds a second, 1-byte push (1 + 1).
    expect(b.script - a.script).toBe(2);
  });

  it("counts content at a quarter vbyte per byte", () => {
    const small = revealSize(1_000, "image/png").vbytes;
    const big = revealSize(101_000, "image/png").vbytes;
    const perByte = (big - small) / 100_000;
    expect(perByte).toBeGreaterThan(0.25);
    expect(perByte).toBeLessThan(0.252); // push opcodes add a sliver
  });
});

describe("commit size and the total", () => {
  it("reads the payment address type", () => {
    expect(addressKind("bc1pxyz")).toBe("p2tr");
    expect(addressKind("bc1qxyz")).toBe("p2wpkh");
    expect(addressKind("3Abc")).toBe("p2sh-p2wpkh");
    expect(addressKind("1Abc")).toBe("p2pkh");
    expect(addressKind(null)).toBe("unknown");
  });

  it("costs a wrapped-segwit input more than a native one", () => {
    expect(commitVbytes("3Abc")).toBeGreaterThan(commitVbytes("bc1qabc"));
    expect(commitVbytes()).toBe(commitVbytes("bc1qabc"));
  });

  it("adds commit fee, reveal fee and postage", () => {
    const c = inscriptionCost({ contentBytes: 11, contentType: TEXT_CONTENT_TYPE, feeRate: 5, paymentAddress: "bc1qabc" });
    expect(c.revealFee).toBe(Math.ceil(c.reveal.vbytes * 5));
    expect(c.commitFee).toBe(Math.ceil(c.commitVbytes * 5));
    expect(c.total).toBe(c.revealFee + c.commitFee + POSTAGE_SATS);
    // A tweet-sized text at 5 sat/vB is a couple of thousand sats, not tens of thousands.
    expect(c.total).toBeGreaterThan(1_000);
    expect(c.total).toBeLessThan(3_000);
  });

  it("never prices below 1 sat/vB", () => {
    const c = inscriptionCost({ contentBytes: 11, contentType: TEXT_CONTENT_TYPE, feeRate: 0 });
    expect(c.feeRate).toBe(1);
    expect(inscriptionCost({ contentBytes: 11, contentType: TEXT_CONTENT_TYPE, feeRate: Number.NaN }).feeRate).toBe(1);
  });
});

describe("the token Xverse takes", () => {
  it("is jsontokens' unsecured JWT: alg none, base64url JSON, trailing dot", () => {
    const token = unsecuredToken({ a: 1 });
    expect(token.startsWith("eyJ0eXAiOiJKV1QiLCJhbGciOiJub25lIn0.")).toBe(true);
    expect(token.endsWith(".")).toBe(true);
    const d = decodeToken(token);
    expect(d.header).toEqual({ typ: "JWT", alg: "none" });
    expect(d.payload).toEqual({ a: 1 });
    expect(d.signature).toBe("");
  });

  it("carries non-ASCII text intact", () => {
    const payload = buildPayload({ kind: "text", text: "gm 🦅 ünïcödé — ₿" }, 7);
    expect(decodeToken(unsecuredToken(payload)).payload).toEqual(payload);
  });

  it("encodes base64 exactly as Node does", () => {
    for (const len of [0, 1, 2, 3, 4, 5, 255, 1024]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + len) & 255);
      expect(base64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    }
    expect(base64Url("hello? world>>")).toBe(Buffer.from("hello? world>>", "utf8").toString("base64url"));
  });
});

describe("buildPayload", () => {
  it("sends text as plain text, mainnet, with the fee rate", () => {
    expect(buildPayload({ kind: "text", text: "gm" }, 6)).toEqual({
      network: { type: "Mainnet" },
      contentType: TEXT_CONTENT_TYPE,
      content: "gm",
      payloadType: "PLAIN_TEXT",
      suggestedMinerFeeRate: 6,
    });
  });

  it("sends files as base64 under their content type", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const p = buildPayload({ kind: "file", bytes, contentType: "image/png" }, 3);
    expect(p).toMatchObject({ contentType: "image/png", payloadType: "BASE_64", content: Buffer.from(bytes).toString("base64") });
  });

  it("never adds an app fee", () => {
    const p = buildPayload({ kind: "text", text: "gm" }, 6) as unknown as Record<string, unknown>;
    expect(p.appFee).toBeUndefined();
    expect(p.appFeeAddress).toBeUndefined();
  });

  it("says what's wrong in plain words", () => {
    const fail = (fn: () => unknown) => { try { fn(); } catch (e) { expect(e).toBeInstanceOf(PayloadError); return (e as Error).message; } return ""; };
    expect(fail(() => buildPayload({ kind: "text", text: "   " }, 5))).toMatch(/Type something/);
    expect(fail(() => buildPayload({ kind: "text", text: "x".repeat(MAX_CONTENT_CHARS + 1) }, 5))).toMatch(/too long/);
    expect(fail(() => buildPayload({ kind: "file", bytes: new Uint8Array(0), contentType: "image/png" }, 5))).toMatch(/empty/);
    expect(fail(() => buildPayload({ kind: "file", bytes: new Uint8Array(MAX_FILE_BYTES + 1), contentType: "image/png" }, 5))).toMatch(/KB/);
    expect(fail(() => buildPayload({ kind: "file", bytes: new Uint8Array(3), contentType: "Image/PNG" }, 5))).toMatch(/kind of file/);
    expect(fail(() => buildPayload({ kind: "text", text: "gm" }, 0))).toMatch(/fee rate/);
    expect(fail(() => buildPayload({ kind: "text", text: "gm" }, 5000))).toMatch(/fee rate/);
  });

  it("keeps the biggest allowed file within sats-connect's character cap", () => {
    expect(Math.ceil(MAX_FILE_BYTES / 3) * 4).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
  });
});

describe("contentTypeFor", () => {
  it("uses the browser's type when sats-connect would accept it", () => {
    expect(contentTypeFor("a.png", "image/png")).toBe("image/png");
    expect(contentTypeFor("a.webp", "IMAGE/WEBP")).toBe("image/webp");
  });

  it("falls back to the extension", () => {
    expect(contentTypeFor("model.glb", "")).toBe("model/gltf-binary");
    expect(contentTypeFor("notes.MD", "")).toBe("text/markdown;charset=utf-8");
  });

  it("adds a charset to plain text and html", () => {
    expect(contentTypeFor("a.txt", "text/plain")).toBe(TEXT_CONTENT_TYPE);
    expect(contentTypeFor("a.html", "text/html")).toBe("text/html;charset=utf-8");
  });

  it("refuses what it can't name", () => {
    expect(contentTypeFor("mystery", "")).toBeNull();
    expect(contentTypeFor("mystery.xyz", "Weird Type")).toBeNull();
    expect(CONTENT_TYPE_RE.test("Weird Type")).toBe(false);
  });
});

describe("small helpers", () => {
  it("counts UTF-8 bytes", () => {
    expect(utf8Length("gm")).toBe(2);
    expect(utf8Length("₿")).toBe(3);
    expect(utf8Length("🦅")).toBe(4);
  });

  it("cleans fee rates", () => {
    expect(cleanFeeRate(4.4)).toBe(4);
    expect(cleanFeeRate(0.4)).toBeNull();
    expect(cleanFeeRate(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("knows a txid and links it", () => {
    const txid = "A".repeat(64);
    expect(isTxid(txid)).toBe(true);
    expect(isTxid("abc")).toBe(false);
    expect(isTxid(42)).toBe(false);
    expect(mempoolTxUrl(txid)).toBe(`https://mempool.space/tx/${"a".repeat(64)}`);
  });
});

describe("parseRecommendedFees", () => {
  it("takes mempool.space's shape, rounding up to whole sat/vB", () => {
    expect(parseRecommendedFees({ fastestFee: 12, halfHourFee: 8.2, hourFee: 5, economyFee: 3, minimumFee: 1 }))
      .toEqual({ fastestFee: 12, halfHourFee: 9, hourFee: 5, economyFee: 3, minimumFee: 1 });
  });

  it("fills economy and minimum when an older feed leaves them out", () => {
    expect(parseRecommendedFees({ fastestFee: 3, halfHourFee: 2, hourFee: 2 })).toEqual({ fastestFee: 3, halfHourFee: 2, hourFee: 2, economyFee: 2, minimumFee: 1 });
  });

  it("refuses junk", () => {
    expect(() => parseRecommendedFees(null)).toThrow();
    expect(() => parseRecommendedFees({ fastestFee: -1, halfHourFee: 2, hourFee: 2 })).toThrow();
    expect(() => parseRecommendedFees({ fastestFee: 3, halfHourFee: 2 })).toThrow();
  });
});
