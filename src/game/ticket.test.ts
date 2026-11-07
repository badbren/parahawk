import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createSeedDealer,
  issueTicket,
  SEED_MAX,
  SEED_MIN,
  signTicket,
  TICKET_TTL_MS,
  ticketsBlocked,
  verifyTicket,
  type TicketPayload,
} from "./ticket.js";

const NOW = Date.UTC(2026, 9, 22, 21);
const ADDR = "bc1qalice0000000000000000000000000000000";
const deal = createSeedDealer();

describe("tickets", () => {
  it("round-trips: what was dealt is what verifies", () => {
    const t = issueTicket(ADDR, NOW, deal);
    expect(t.ticket.startsWith("gt1.")).toBe(true);
    const v = verifyTicket(t.ticket, NOW + 60_000);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.payload).toMatchObject({ v: 1, seed: t.seed, address: ADDR, issuedAt: NOW });
      expect(v.expiresAt).toBe(NOW + TICKET_TTL_MS);
    }
  });

  it("expires after the TTL", () => {
    const t = issueTicket(ADDR, NOW, deal);
    expect(verifyTicket(t.ticket, NOW + TICKET_TTL_MS).ok).toBe(true);
    expect(verifyTicket(t.ticket, NOW + TICKET_TTL_MS + 1)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses anything it did not sign exactly", () => {
    const t = issueTicket(ADDR, NOW, deal).ticket;
    const [prefix, body, sig] = t.split(".") as [string, string, string];
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TicketPayload;
    const reencoded = (p: object) => Buffer.from(JSON.stringify(p)).toString("base64url");
    const forged = [
      "", "nope", `${prefix}.${body}`, `${prefix}.${body}.${sig}x`, `gt2.${body}.${sig}`,
      `${prefix}.${reencoded({ ...payload, seed: 1 })}.${sig}`,            // a chosen seed
      `${prefix}.${reencoded({ ...payload, address: "bc1qmallory" })}.${sig}`,
      `${prefix}.${reencoded({ ...payload, issuedAt: NOW - 10 * 60_000 })}.${sig}`, // backdated
      `${prefix}.${body}.${createHmac("sha256", "guess").update(`gt1.${body}`).digest("base64url")}`,
    ];
    for (const f of forged) expect(verifyTicket(f, NOW).ok, f.slice(0, 40)).toBe(false);
    expect(verifyTicket(12345, NOW).ok).toBe(false);
  });

  it("refuses a well-signed ticket dated in the future", () => {
    const future = signTicket({ v: 1, seed: 5, address: ADDR, issuedAt: NOW + 60_000, nonce: "abcdefghijkl" });
    expect(verifyTicket(future, NOW)).toEqual({ ok: false, reason: "forged" });
  });

  it("does not accept a session-shaped token signed with the session key", () => {
    // Sessions are `payload.sig` with the raw secret; tickets use a derived key and a prefix.
    const body = Buffer.from(JSON.stringify({ v: 1, seed: 5, address: ADDR, issuedAt: NOW, nonce: "abcdefghijkl" })).toString("base64url");
    const sessionStyleSig = createHmac("sha256", "dev-insecure-session-secret-do-not-use-in-prod").update(body).digest("base64url");
    expect(verifyTicket(`gt1.${body}.${sessionStyleSig}`, NOW).ok).toBe(false);
  });

  it("is blocked on Vercel with the dev secret, and only there", () => {
    expect(ticketsBlocked({ VERCEL: "1" }, true)).toBe(true);
    expect(ticketsBlocked({ VERCEL: "1" }, false)).toBe(false);
    expect(ticketsBlocked({}, true)).toBe(false);
  });
});

describe("the seed dealer", () => {
  it("deals 32-bit seeds, never 0", () => {
    const d = createSeedDealer();
    for (let i = 0; i < 2000; i++) {
      const s = d();
      expect(Number.isInteger(s) && s >= SEED_MIN && s <= SEED_MAX).toBe(true);
    }
  });

  it("redraws a seed it dealt recently, even when the source repeats itself", () => {
    const source = [5, 5, 5, 6, 5, 7, 6, 8];
    const d = createSeedDealer(10, () => source.shift()!);
    expect([d(), d(), d(), d()]).toEqual([5, 6, 7, 8]);
  });

  it("forgets the oldest seeds once its memory is full", () => {
    const source = [1, 2, 3, 1];
    const d = createSeedDealer(2, () => source.shift()!);
    expect([d(), d(), d(), d()]).toEqual([1, 2, 3, 1]);
  });
});
