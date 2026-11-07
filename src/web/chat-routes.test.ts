import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_BURST_MAX, CHAT_COOLDOWN_MS } from "../chat/rules.js";
import { MemoryChatStore, type ChatStore } from "../chat/store.js";
import type { ProfileRef } from "../profile/names.js";
import type { BadgeChip } from "../activity/public.js";
import { authorFor, chatRouter, type ChatRouterOptions, type WireAuthor } from "./chat-routes.js";

const ALICE = "bc1qalice0000000000000000000000000000000";
const BOB = "bc1qbob00000000000000000000000000000000000";
const CAROL = "bc1qcarol000000000000000000000000000000000"; // keeps her wallet private
const OWNER = "bc1qowner000000000000000000000000000000000";

let clock = Date.UTC(2026, 10, 6, 12);
let router: express.Router;
let store: ChatStore;
let onPost: ReturnType<typeof vi.fn>;
let server: Server;
let base = "";

/** Tests sign in by header; OWNER is the admin. */
const session = (r: express.Request) => {
  const a = r.get("x-test-address");
  return a ? { address: a, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER } : null;
};
const isAdmin = (s: { address: string } | null) => s?.address === OWNER;

const ref = (p: Partial<ProfileRef>): ProfileRef => ({ name: null, isPrivate: false, uid: "u0", avatarUrl: null, ...p });
const PROFILES = new Map<string, ProfileRef>([
  [ALICE, ref({ name: "alice", uid: "ua1ice", avatarUrl: "/api/profile/avatar/ua1ice?v=3" })],
  [CAROL, ref({ name: "carol", isPrivate: true, uid: "k3x9carol", avatarUrl: "/api/profile/avatar/k3x9carol?v=1" })],
]);
const TRUSTED: BadgeChip = { id: "trusted", emoji: "🛡️", name: "Trusted", kind: "parahawk" };
const FIRST_WORDS: BadgeChip = { id: "first-words", emoji: "💬", name: "First Words", kind: "parahawk" };
const BLOCK_FINDER: BadgeChip = { id: "pool:block_winner", emoji: "🏆", name: "Block Finder", kind: "pool" };
/** Parahawk's own badges, and the Parasite Pool ones (which belong to the wallet). */
const OURS = new Map<string, BadgeChip[]>([[ALICE, [TRUSTED, FIRST_WORDS]], [CAROL, [FIRST_WORDS]]]);
const POOL = new Map<string, BadgeChip[]>([[ALICE, [BLOCK_FINDER]], [CAROL, [BLOCK_FINDER]]]);

let profilesFor: ReturnType<typeof vi.fn>;
let badgesFor: ReturnType<typeof vi.fn>;

/** Like nameBadgesFor: pool badges first (only where showPool allows), then ours. */
const fakeBadges = async (addrs: readonly string[], showPool: (a: string) => boolean) => {
  const out = new Map<string, BadgeChip[]>();
  for (const a of addrs) {
    const chips = [...(showPool(a) ? POOL.get(a) ?? [] : []), ...(OURS.get(a) ?? [])];
    if (chips.length) out.set(a, chips);
  }
  return out;
};

const mount = (opts: ChatRouterOptions = {}) => {
  store = opts.store ?? new MemoryChatStore();
  onPost = vi.fn();
  profilesFor = vi.fn(async (addrs: readonly string[]) => new Map([...PROFILES].filter(([a]) => addrs.includes(a))));
  badgesFor = vi.fn(fakeBadges);
  router = chatRouter({ store, session, isAdmin, now: () => clock, profilesFor, badgesFor, onPost, ...opts });
};

beforeAll(async () => {
  const app = express();
  app.use("/api/chat", (req, res, next) => router(req, res, next));
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { clock += 3_600_000; mount(); });

interface Reply {
  messages: Array<{ id: number; ref: string; body: string; at: number }>;
  authors: Record<string, WireAuthor>;
  latestId: number;
  removed: number[];
  viewer: { address: string | null; admin: boolean };
}

const as = (who: string | null): Record<string, string> => (who ? { "x-test-address": who } : {});
const post = (body: unknown, who: string | null = ALICE, headers: Record<string, string> = {}) =>
  fetch(`${base}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...as(who), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const readRaw = async (query = "", who: string | null = null) => {
  const res = await fetch(`${base}/messages${query}`, { headers: as(who) });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return res.text();
};
const read = async (query = "", who: string | null = null) => JSON.parse(await readRaw(query, who)) as Reply;
const del = (id: number | string, who: string | null = ALICE, headers: Record<string, string> = {}) =>
  fetch(`${base}/messages/${id}`, { method: "DELETE", headers: { ...as(who), ...headers } });
/** Post as `who`, moving the clock past the cooldown first. */
const say = async (text: string, who = ALICE) => {
  clock += CHAT_COOLDOWN_MS;
  const res = await post({ body: text }, who);
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { message: Reply["messages"][number]; authors: Reply["authors"] };
};

describe("GET /messages", () => {
  it("is open to everyone, never cached, and says who is reading", async () => {
    expect(await read()).toEqual({ messages: [], authors: {}, latestId: 0, removed: [], viewer: { address: null, admin: false } });
    expect((await read("", OWNER)).viewer).toEqual({ address: OWNER, admin: true });
  });

  it("returns the latest page oldest-first, or what came after an id", async () => {
    for (const t of ["one", "two", "three"]) await say(t);
    expect((await read()).messages.map((m) => m.body)).toEqual(["one", "two", "three"]);
    expect((await read("?limit=2")).messages.map((m) => m.body)).toEqual(["two", "three"]);
    expect((await read("?after=1")).messages.map((m) => m.id)).toEqual([2, 3]);
    const later = await read("?after=3");
    expect(later.messages).toEqual([]);
    expect(later.authors).toEqual({});
    expect(later.latestId).toBe(3);
  });

  it("ignores junk paging values instead of failing", async () => {
    await say("hi");
    expect((await read("?after=-1&limit=abc")).messages).toHaveLength(1);
    expect((await read("?limit=100000")).messages).toHaveLength(1);
  });

  it("describes each author once: name, picture and badges (pool first), looked up once per reply", async () => {
    await say("from alice", ALICE);
    await say("from bob", BOB);
    await say("alice again", ALICE);
    profilesFor.mockClear();
    badgesFor.mockClear();
    const r = await read();
    expect(r.messages.map((m) => m.ref)).toEqual([ALICE, BOB, ALICE]);
    expect(Object.keys(r.authors).sort()).toEqual([ALICE, BOB].sort());
    expect(r.authors[ALICE]).toEqual({
      ref: ALICE, name: "alice", named: true, avatarUrl: "/api/profile/avatar/ua1ice?v=3", badges: [BLOCK_FINDER, TRUSTED, FIRST_WORDS], mine: false,
    });
    // No profile at all: the short address, no picture, no badges.
    expect(r.authors[BOB]).toEqual({ ref: BOB, name: "bc1qbo…0000", named: false, avatarUrl: null, badges: [], mine: false });
    expect(profilesFor).toHaveBeenCalledTimes(1);
    expect(badgesFor).toHaveBeenCalledTimes(1);
    expect([...profilesFor.mock.calls[0]![0]].sort()).toEqual([ALICE, BOB].sort());
  });

  it("asks for pool badges only where they may show: not for a private person", async () => {
    await say("a", ALICE);
    await say("c", CAROL);
    badgesFor.mockClear();
    await read();
    const showPool = badgesFor.mock.calls[0]![1] as (a: string) => boolean;
    expect(showPool(ALICE)).toBe(true);
    expect(showPool(CAROL)).toBe(false);
    expect(showPool(BOB)).toBe(true); // no profile = public
  });

  it("strips pool badges from a private person even if the badge lookup sends them", async () => {
    await say("c", CAROL);
    mount({ store, badgesFor: async () => new Map([[CAROL, [BLOCK_FINDER, FIRST_WORDS]]]) });
    const r = await read();
    expect(r.authors["~k3x9carol"]!.badges).toEqual([FIRST_WORDS]);
  });

  it("marks the reader's own author entry as mine — nobody else's", async () => {
    await say("a", ALICE);
    await say("b", BOB);
    const asAlice = await read("", ALICE);
    expect(asAlice.authors[ALICE]!.mine).toBe(true);
    expect(asAlice.authors[BOB]!.mine).toBe(false);
    const asGuest = await read();
    expect(Object.values(asGuest.authors).every((a) => !a.mine)).toBe(true);
  });

  it("never puts a private person's wallet anywhere in a reply", async () => {
    await say("hi from carol", CAROL);
    await say("hi from bob", BOB);
    for (const who of [null, BOB, OWNER]) {
      const raw = await readRaw("", who);
      expect(raw.includes(CAROL), `reader ${who}`).toBe(false);
      const r = JSON.parse(raw) as Reply;
      expect(r.messages[0]!.ref).toBe("~k3x9carol");
      expect(r.authors["~k3x9carol"]).toEqual({
        ref: "~k3x9carol", name: "carol", named: true, avatarUrl: "/api/profile/avatar/k3x9carol?v=1", badges: [FIRST_WORDS], mine: false,
      });
    }
    // Carol reading her own messages: they're hers, still under her private ref.
    const own = await read("", CAROL);
    expect(own.authors["~k3x9carol"]!.mine).toBe(true);
  });

  it("keeps the room readable — but anonymous — when the profile lookup fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await say("still here", CAROL);
    await say("me too", ALICE);
    mount({ store, profilesFor: async () => { throw new Error("db down"); } });
    badgesFor.mockClear();
    const raw = await readRaw("", BOB);
    expect(raw.includes(CAROL)).toBe(false);
    expect(raw.includes(ALICE)).toBe(false);
    const r = JSON.parse(raw) as Reply;
    expect(r.messages.map((m) => m.body)).toEqual(["still here", "me too"]);
    for (const m of r.messages) {
      expect(m.ref).toMatch(/^\?[0-9a-f]{10}$/);
      expect(r.authors[m.ref]).toMatchObject({ name: "Someone", named: false, avatarUrl: null });
    }
    expect(r.messages[0]!.ref).not.toBe(r.messages[1]!.ref);
    // We can't tell who is private, so nobody's pool badges show.
    const showPool = badgesFor.mock.calls[0]![1] as (a: string) => boolean;
    expect(showPool(ALICE)).toBe(false);
    expect(Object.values(r.authors).flatMap((a) => a.badges).some((b) => b.kind === "pool")).toBe(false);
    err.mockRestore();
  });

  it("keeps working without badges when the badge lookup fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await say("hi", ALICE);
    mount({ store, badgesFor: async () => { throw new Error("db down"); } });
    const r = await read();
    expect(r.authors[ALICE]).toMatchObject({ name: "alice", badges: [] });
    err.mockRestore();
  });
});

describe("authorFor (the privacy rule on its own)", () => {
  const chips = [TRUSTED];
  it("links public people by wallet", () => {
    expect(authorFor(ALICE, PROFILES.get(ALICE), false, chips, false)).toMatchObject({ ref: ALICE, name: "alice", named: true });
  });
  it("gives a private person with no name a stand-in name, never the wallet", () => {
    const a = authorFor(CAROL, ref({ isPrivate: true, uid: "zz9" }), false, chips, false);
    expect(a).toMatchObject({ ref: "~zz9", name: "Anonymous", named: false });
    expect(JSON.stringify(a).includes(CAROL)).toBe(false);
  });
  it("refuses a uid or picture URL that would spell out the wallet", () => {
    for (const uid of [CAROL, `x${CAROL}`, CAROL.slice(4, 30), "", "a/b", "../x"]) {
      const a = authorFor(CAROL, ref({ name: "carol", isPrivate: true, uid, avatarUrl: `/api/profile/avatar/${CAROL}` }), false, chips, false);
      expect(JSON.stringify(a).includes(CAROL), uid).toBe(false);
      expect(a.ref.startsWith("~") ? a.ref : "tag").not.toContain(CAROL.slice(4, 30));
    }
  });
  it("drops picture URLs that aren't same-origin paths", () => {
    for (const avatarUrl of ["https://evil.example/x.png", "//evil.example/x.png", "javascript:alert(1)", "data:image/png;base64,AAAA"]) {
      expect(authorFor(ALICE, ref({ name: "alice", avatarUrl }), false, [], false).avatarUrl).toBeNull();
    }
  });
  it("caps the badges it sends, and labels each one's kind", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `b${i}`, emoji: "⭐", name: `B${i}` }));
    const sent = authorFor(ALICE, undefined, false, many, false).badges;
    expect(sent).toHaveLength(16);
    expect(sent.every((b) => b.kind === "parahawk")).toBe(true);
  });
  it("keeps pool badges for public people, in the order given", () => {
    expect(authorFor(ALICE, PROFILES.get(ALICE), false, [BLOCK_FINDER, TRUSTED], false).badges.map((b) => b.id)).toEqual([BLOCK_FINDER.id, TRUSTED.id]);
  });
  it("drops pool badges for private people and when the lookup failed", () => {
    expect(authorFor(CAROL, PROFILES.get(CAROL), false, [BLOCK_FINDER, TRUSTED], false).badges).toEqual([TRUSTED]);
    expect(authorFor(ALICE, undefined, true, [BLOCK_FINDER, TRUSTED], false).badges).toEqual([TRUSTED]);
  });
});

describe("POST /messages", () => {
  it("posts for a signed-in wallet, answers with its author entry, and tells the badges", async () => {
    const res = await post({ body: "  gm  " });
    expect(res.status).toBe(201);
    const { message, authors } = await res.json();
    expect(message).toEqual({ id: 1, ref: ALICE, body: "gm", at: clock });
    expect(authors[ALICE]).toMatchObject({ name: "alice", mine: true, badges: [BLOCK_FINDER, TRUSTED, FIRST_WORDS] });
    await vi.waitFor(() => expect(onPost).toHaveBeenCalledWith(ALICE));
  });

  it("answers a private person under their private ref", async () => {
    const res = await post({ body: "psst" }, CAROL);
    const text = await res.text();
    expect(res.status).toBe(201);
    expect(text.includes(CAROL)).toBe(false);
    expect(JSON.parse(text).message.ref).toBe("~k3x9carol");
  });

  it("refuses guests, cross-site posts and non-JSON", async () => {
    expect((await post({ body: "hi" }, null)).status).toBe(401);
    expect((await post({ body: "hi" }, ALICE, { Origin: "https://evil.example" })).status).toBe(403);
    const form = await fetch(`${base}/messages`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...as(ALICE) }, body: "body=hi" });
    expect(form.status).toBe(415);
    expect(await store.latestId()).toBe(0);
    expect(onPost).not.toHaveBeenCalled();
  });

  it("refuses empty, oversized and malformed messages with a readable reason", async () => {
    for (const body of [{}, { body: "" }, { body: "   " }, { body: 7 }, { body: "x".repeat(501) }]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    }
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ body: "x".repeat(20_000) })).status).toBe(413);
  });

  it("holds a wallet to one message per cooldown", async () => {
    expect((await post({ body: "one" })).status).toBe(201);
    clock += CHAT_COOLDOWN_MS - 1;
    const res = await post({ body: "two" });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await post({ body: "bob is fine" }, BOB)).status).toBe(201);
    clock += 1;
    expect((await post({ body: "two" })).status).toBe(201);
  });

  it("checks the store too, so a second server instance can't be used to double-post", async () => {
    expect((await post({ body: "one" })).status).toBe(201);
    mount({ store }); // a fresh instance: empty soft caps, same database
    clock += 500;
    expect((await post({ body: "two" })).status).toBe(429);
  });

  it("caps a burst", async () => {
    for (let i = 0; i < CHAT_BURST_MAX; i++) await say(`m${i}`);
    clock += CHAT_COOLDOWN_MS;
    const res = await post({ body: "one too many" });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/try again in \d+ min/);
    clock += 10 * 60_000;
    expect((await post({ body: "later" })).status).toBe(201);
  });
});

describe("DELETE /messages/:id", () => {
  it("lets authors delete their own, and tells every reader to drop it", async () => {
    const { message: m } = await say("oops");
    await say("keep");
    expect((await del(m.id)).status).toBe(200);
    const after = await read();
    expect(after.messages.map((x) => x.body)).toEqual(["keep"]);
    expect(after.removed).toEqual([m.id]);
    expect(after.latestId).toBe(2);
    expect((await del(m.id)).status).toBe(404);
  });

  it("refuses other people's messages — except for the owner", async () => {
    const { message: m } = await say("mine", ALICE);
    expect((await del(m.id, BOB)).status).toBe(403);
    expect((await del(m.id, null)).status).toBe(401);
    expect((await del(m.id, OWNER, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await del(m.id, OWNER)).status).toBe(200);
    expect((await read()).messages).toEqual([]);
  });

  it("lets a private person delete their own, by session, not by ref", async () => {
    const { message: m } = await say("secret", CAROL);
    expect((await del(m.id, BOB)).status).toBe(403);
    expect((await del(m.id, CAROL)).status).toBe(200);
  });

  it("answers 404 for ids that don't exist", async () => {
    expect((await del(42)).status).toBe(404);
    expect((await del("abc")).status).toBe(404);
  });
});

describe("GET /unread", () => {
  it("counts other people's messages after an id", async () => {
    await say("a1", ALICE);
    await say("b1", BOB);
    await say("a2", ALICE);
    const count = async (after: number, who: string | null) => {
      const res = await fetch(`${base}/unread?after=${after}`, { headers: as(who) });
      expect(res.headers.get("cache-control")).toBe("no-store");
      return res.json() as Promise<{ latestId: number; count: number }>;
    };
    expect(await count(0, ALICE)).toEqual({ latestId: 3, count: 1 });
    expect(await count(0, null)).toEqual({ latestId: 3, count: 3 });
    expect(await count(3, BOB)).toEqual({ latestId: 3, count: 0 });
  });
});
