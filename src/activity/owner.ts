/**
 * Is this the owner's wallet? The same test as isAdmin() in
 * src/web/pages/admin.ts (trimmed, lower-cased, against config.adminAddress),
 * for code that has an address rather than a session — e.g. someone else's
 * public profile. The owner holds every Parahawk badge (badges.ts).
 */
import { config } from "../config.js";

export function isOwnerAddress(address: string | null | undefined): boolean {
  return Boolean(address && config.adminAddress && address.trim().toLowerCase() === config.adminAddress);
}
