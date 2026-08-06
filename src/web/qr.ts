import QRCode from "qrcode";
import { config } from "../config.js";

let cached: string | null = null;

/**
 * Server-generated QR code (PNG data URL) for the tip address. A Lightning
 * address (contains "@") is encoded as a `lightning:` URI; anything else is
 * treated as an on-chain bitcoin address and encoded as `bitcoin:` so wallets
 * recognise it. Cached after first gen. Returns null when no address is set.
 */
export async function tipQrDataUrl(): Promise<string | null> {
  const addr = config.lightningAddress;
  if (!addr) return null;
  if (cached) return cached;
  const uri = addr.includes("@") ? `lightning:${addr}` : `bitcoin:${addr}`;
  cached = await QRCode.toDataURL(uri, {
    margin: 1,
    width: 220,
    color: { dark: "#e6e6e6", light: "#00000000" },
  });
  return cached;
}
