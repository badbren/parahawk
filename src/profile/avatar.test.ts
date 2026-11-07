import { describe, expect, it } from "vitest";
import { AVATAR_MAX_BYTES, avatarSize, checkAvatar, decodeAvatarPayload, sniffAvatarType } from "./avatar.js";

/** A real 1×1 PNG. */
const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const bytes = (b64: string) => Uint8Array.from(Buffer.from(b64, "base64"));

/** A PNG header claiming w × h (enough for the size check; the body is never decoded). */
function pngHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

/** A JPEG with an APP0 segment, then a baseline frame of w × h. */
function jpeg(w: number, h: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}

/** A WebP whose first chunk is VP8X with a w × h canvas. */
function webpVp8x(w: number, h: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0]);
  const cw = w - 1, ch = h - 1;
  b.set([cw & 0xff, (cw >> 8) & 0xff, (cw >> 16) & 0xff, ch & 0xff, (ch >> 8) & 0xff, (ch >> 16) & 0xff], 24);
  return b;
}

/** A lossless WebP (VP8L) of w × h. */
function webpVp8l(w: number, h: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 10, 0, 0, 0, 0x2f]);
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  b.set([bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff], 21);
  return b;
}

describe("profile pictures", () => {
  it("accepts a real PNG and reads its size", () => {
    const c = checkAvatar(bytes(PNG_1x1));
    expect(c).toMatchObject({ ok: true, type: "image/png", width: 1, height: 1 });
  });

  it("reads JPEG and WebP headers", () => {
    expect(sniffAvatarType(jpeg(128, 96))).toBe("image/jpeg");
    expect(avatarSize(jpeg(128, 96), "image/jpeg")).toEqual({ width: 128, height: 96 });
    expect(avatarSize(webpVp8x(128, 128), "image/webp")).toEqual({ width: 128, height: 128 });
    expect(avatarSize(webpVp8l(100, 80), "image/webp")).toEqual({ width: 100, height: 80 });
    expect(checkAvatar(jpeg(128, 128))).toMatchObject({ ok: true, type: "image/jpeg" });
  });

  it("goes by the bytes, never a declared type: SVG, GIF and junk are refused", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(checkAvatar(svg)).toEqual({ ok: false, error: "Pictures have to be PNG, JPEG or WebP." });
    expect(checkAvatar(new TextEncoder().encode("GIF89a........"))).toMatchObject({ ok: false });
    expect(checkAvatar(new Uint8Array(0))).toMatchObject({ ok: false });
    expect(checkAvatar(null)).toMatchObject({ ok: false });
  });

  it("refuses big files and giant images (a small file can unpack huge)", () => {
    const big = new Uint8Array(AVATAR_MAX_BYTES + 1);
    big.set(pngHeader(64, 64));
    expect(checkAvatar(big)).toEqual({ ok: false, error: "That picture is too big." });
    expect(checkAvatar(pngHeader(20_000, 20_000))).toEqual({ ok: false, error: "That picture is too large." });
    expect(checkAvatar(jpeg(4096, 10))).toMatchObject({ ok: false });
  });

  it("refuses a header it can't read", () => {
    const broken = pngHeader(1, 1).slice(0, 20);
    expect(checkAvatar(broken)).toEqual({ ok: false, error: "That picture looks broken. Try another one." });
  });

  it("decodes a data: URL or bare base64, and nothing else", () => {
    expect(decodeAvatarPayload(`data:image/png;base64,${PNG_1x1}`)).toEqual(bytes(PNG_1x1));
    expect(decodeAvatarPayload(PNG_1x1)).toEqual(bytes(PNG_1x1));
    expect(decodeAvatarPayload("not base64!")).toBeNull();
    expect(decodeAvatarPayload(42)).toBeNull();
    expect(decodeAvatarPayload("A".repeat(AVATAR_MAX_BYTES * 2))).toBeNull();
  });
});
