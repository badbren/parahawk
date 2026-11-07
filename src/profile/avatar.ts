/**
 * Profile pictures — what the server accepts. Pure: bytes in, verdict out.
 *
 * The Profile window crops and shrinks every picture to 128×128 before it is
 * sent (WebP, or JPEG/PNG where a browser can't write WebP), so a real upload
 * is a few KB. The server still trusts nothing about it:
 *
 *   - the type comes from the file's own first bytes (magic numbers), never
 *     from a filename or a declared type — PNG, JPEG and WebP only; SVG (which
 *     can carry script) and everything else is refused;
 *   - the size is capped, and so are the pixel dimensions read from the
 *     header, so a tiny file can't unpack into a giant image in everyone's
 *     Chat (a "decompression bomb").
 */

export type AvatarType = "image/png" | "image/jpeg" | "image/webp";

/** Largest file accepted, in bytes. The Profile window aims for ≤ 32 KB. */
export const AVATAR_MAX_BYTES = 48 * 1024;
/** Largest width or height accepted, in pixels. Uploads are 128×128. */
export const AVATAR_MAX_PX = 512;
/** What the Profile window sends: width = height = this. */
export const AVATAR_PX = 128;

export type AvatarCheck =
  | { ok: true; type: AvatarType; bytes: Uint8Array; width: number; height: number }
  | { ok: false; error: string };

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);

/** The type, from the first bytes. Null for anything that isn't PNG, JPEG or WebP. */
export function sniffAvatarType(b: Uint8Array): AvatarType | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // "RIFF" <size> "WEBP"
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/** Width × height from the header, or null when the header can't be read. */
export function avatarSize(b: Uint8Array, type: AvatarType): { width: number; height: number } | null {
  if (type === "image/png") {
    // Signature (8) + IHDR length (4) + "IHDR" (4), then width, height (u32 BE).
    if (b.length < 24 || !startsWith(b, [0x49, 0x48, 0x44, 0x52], 12)) return null;
    return { width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (type === "image/webp") {
    if (b.length < 30) return null;
    const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (chunk === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    if (chunk === "VP8L") {
      if (b[20] !== 0x2f) return null;
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8 ") {
      // Frame tag (3) then the start code 9d 01 2a, then 14-bit width / height.
      if (!startsWith(b, [0x9d, 0x01, 0x2a], 23)) return null;
      return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
    }
    return null;
  }
  // JPEG: walk the markers to the first start-of-frame.
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // no length
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any frame
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    i += 2 + len;
  }
  return null;
}

/** Decode a base64 string (or a data: URL) into bytes. Null when it isn't valid base64. */
export function decodeAvatarPayload(raw: unknown): Uint8Array | null {
  if (typeof raw !== "string") return null;
  const comma = raw.startsWith("data:") ? raw.indexOf(",") : -1;
  const b64 = (comma >= 0 ? raw.slice(comma + 1) : raw).replace(/\s+/g, "");
  if (b64.length === 0 || b64.length > Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** The whole check, with short errors meant to be shown as-is. */
export function checkAvatar(bytes: Uint8Array | null): AvatarCheck {
  if (!bytes || bytes.length === 0) return { ok: false, error: "That picture didn't come through. Try another one." };
  if (bytes.length > AVATAR_MAX_BYTES) return { ok: false, error: "That picture is too big." };
  const type = sniffAvatarType(bytes);
  if (!type) return { ok: false, error: "Pictures have to be PNG, JPEG or WebP." };
  const size = avatarSize(bytes, type);
  if (!size || size.width < 1 || size.height < 1) return { ok: false, error: "That picture looks broken. Try another one." };
  if (size.width > AVATAR_MAX_PX || size.height > AVATAR_MAX_PX) return { ok: false, error: "That picture is too large." };
  return { ok: true, type, bytes, width: size.width, height: size.height };
}
