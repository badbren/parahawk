import QRCode from "qrcode";
import { config } from "../config.js";

let cached: string | null = null;

/**
 * Server-generated QR code (PNG data URL) for the tip Lightning address.
 * Encoded as a `lightning:` URI so wallets recognise it. Cached after first gen.
 * Returns null when no LIGHTNING_ADDRESS is configured.
 */
export async function tipQrDataUrl(): Promise<string | null> {
  if (!config.lightningAddress) return null;
  if (cached) return cached;
  const uri = `lightning:${config.lightningAddress}`;
  cached = await QRCode.toDataURL(uri, {
    margin: 1,
    width: 220,
    color: { dark: "#e6e6e6", light: "#00000000" },
  });
  return cached;
}
