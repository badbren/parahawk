/**
 * Profile pictures in the desktop: the round picture itself (with a lettered
 * stand-in when someone has none, or it fails to load), and the crop-and-shrink
 * that runs before an upload.
 *
 * Every upload is cropped to a centred square and shrunk to 128×128 here, so
 * what reaches the server (src/profile/avatar.ts checks it again) is a few KB
 * of WebP — or JPEG on a browser that can't write WebP.
 */
import "./avatar.css";
import { AVATAR_PX } from "../../profile/avatar";
import { h } from "../util/dom";

/** A stable hue for a person's stand-in, from their ref or address. */
export function hueOf(seed: string): number {
  let x = 7;
  for (let i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) >>> 0;
  return x % 360;
}

/** The letter on a stand-in: the name's first, else the address's first after "bc1q"/"bc1p". */
export function initialOf(name: string | null, seed: string): string {
  const src = (name ?? seed.replace(/^bc1[qp]?/i, "")).trim();
  return (src.charAt(0) || "?").toUpperCase();
}

export interface AvatarOptions {
  /** Same-origin picture URL, or null for the stand-in. */
  url: string | null;
  name: string | null;
  /** Ref or address: picks the stand-in's colour and letter. */
  seed: string;
  /** Diameter in CSS px. */
  size: number;
  className?: string;
}

/** A round picture, decorative (the name next to it says who it is). */
export function avatarEl(o: AvatarOptions): HTMLElement {
  const el = h("span", {
    class: `ph-av${o.className ? ` ${o.className}` : ""}`,
    style: `--av:${o.size}px;--av-h:${hueOf(o.seed)}`,
    "aria-hidden": "true",
  }, initialOf(o.name, o.seed));
  // Only ever our own picture route (the server hands these out; never trust anything else).
  if (o.url && o.url.startsWith("/api/profile/avatar/")) {
    const img = h("img", { src: o.url, alt: "", decoding: "async", draggable: "false" });
    img.addEventListener("error", () => img.remove());
    el.append(img);
  }
  return el;
}

/** Biggest file we'll even try to read before shrinking it. */
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
/** What we aim to send (the server's hard cap is 48 KB). */
const TARGET_BYTES = 32 * 1024;

const readAsDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error("Couldn't read that file."));
  r.readAsDataURL(file);
});

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("That doesn't look like a picture. Try a PNG, JPEG or WebP."));
  img.src = src;
});

/** Bytes behind a base64 data: URL. */
const dataUrlBytes = (u: string) => Math.floor((u.length - u.indexOf(",") - 1) * 3 / 4);

/**
 * Crop a picture to a centred square, shrink it to 128×128 and encode it small.
 * Resolves with a data: URL ready for ProfileSession.setAvatar; rejects with a
 * message meant to be shown as-is.
 */
export async function shrinkPicture(file: Blob): Promise<string> {
  if (file.size > MAX_SOURCE_BYTES) throw new Error("That file is too big. Pick one under 15 MB.");
  const img = await loadImage(await readAsDataUrl(file));
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  if (!(side > 0)) throw new Error("That picture looks empty. Try another one.");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize pictures.");
  // A dark backdrop for transparent pictures (JPEG has no transparency).
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, AVATAR_PX, AVATAR_PX);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  // WebP where the browser can write it, else JPEG; step the quality down until it fits.
  const webp = canvas.toDataURL("image/webp", 0.9).startsWith("data:image/webp");
  const type = webp ? "image/webp" : "image/jpeg";
  for (const q of [0.9, 0.8, 0.7, 0.55, 0.4]) {
    const out = canvas.toDataURL(type, q);
    if (dataUrlBytes(out) <= TARGET_BYTES) return out;
  }
  throw new Error("Couldn't make that picture small enough. Try a simpler one.");
}
