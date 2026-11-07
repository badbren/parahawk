import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryProfileStore } from "../profile/store.js";
import { profileRouter } from "./profile-routes.js";

const ALICE = "bc1qalice0000000000000000000000000000000";
const BOB = "bc1qbob00000000000000000000000000000000000";
const OWNER = "bc1qowner000000000000000000000000000000000";

let store: MemoryProfileStore;
let router: express.Router;
let server: Server;
let base = "";
const clock = Date.UTC(2026, 10, 6, 12);

beforeAll(async () => {
  const app = express();
  app.use("/api/profile", (req, res, next) => router(req, res, next));
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/profile`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  store = new MemoryProfileStore();
  router = profileRouter({
    store,
    now: () => clock,
    // Tests sign in by header.
    session: (req) => {
      const a = req.get("x-test-address");
      return a ? { address: a, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER } : null;
    },
    isAdmin: (s) => s?.address === OWNER,
  });
});

const as = (who: string | null, headers: Record<string, string> = {}) => ({ ...(who ? { "x-test-address": who } : {}), ...headers });
const put = (name: unknown, who: string | null = ALICE, headers: Record<string, string> = {}) =>
  fetch(`${base}/me`, {
    method: "PUT",
    headers: as(who, { "Content-Type": "application/json", ...headers }),
    body: typeof name === "string" && name.startsWith("RAW:") ? name.slice(4) : JSON.stringify({ displayName: name }),
  });
const me = (who: string | null) => fetch(`${base}/me`, { headers: as(who) });

describe("GET /me", () => {
  it("is nobody when signed out, and never cached", async () => {
    const res = await me(null);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ address: null, displayName: null, isPrivate: false, uid: null, avatarUrl: null });
  });

  it("is your address and name when signed in", async () => {
    await store.setName(ALICE, "Alice", { now: clock, dailyLimit: 10 });
    expect(await (await me(ALICE)).json()).toMatchObject({ address: ALICE, displayName: "Alice", isPrivate: false, avatarUrl: null });
    expect(await (await me(BOB)).json()).toEqual({ address: BOB, displayName: null, isPrivate: false, uid: null, avatarUrl: null });
  });
});

describe("PUT /me", () => {
  it("sets, tidies and clears a name", async () => {
    let res = await put("  Hash   Hunter ");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ address: ALICE, displayName: "Hash Hunter" });
    res = await put(null);
    expect(await res.json()).toMatchObject({ address: ALICE, displayName: null });
  });

  it("needs a sign-in", async () => {
    const res = await put("Alice", null);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/Xverse/);
  });

  it("refuses cross-site requests", async () => {
    const res = await put("Alice", ALICE, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("wants JSON with a displayName", async () => {
    expect((await fetch(`${base}/me`, { method: "PUT", headers: as(ALICE, { "Content-Type": "text/plain" }), body: "Alice" })).status).toBe(415);
    expect((await put("RAW:{}")).status).toBe(400);
    expect((await put("RAW:{not json")).status).toBe(400);
    expect((await put("RAW:" + JSON.stringify({ displayName: "x".repeat(3000) }))).status).toBe(413);
  });

  it("says why a name is refused", async () => {
    const res = await put("no");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/3–20/);
    expect((await (await put("Parahawk")).json()).error).toBe("That name is reserved.");
  });

  it("lets the owner use reserved names", async () => {
    const res = await put("Parahawk", OWNER);
    expect(res.status).toBe(200);
    expect((await res.json()).displayName).toBe("Parahawk");
  });

  it("answers 409 when the name is taken, ignoring case and separators", async () => {
    expect((await put("Bad Bren", ALICE)).status).toBe(200);
    const res = await put("bad.bren", BOB);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("That name is taken.");
  });

  it("caps renames at 10 a day, except for the owner", async () => {
    for (let i = 0; i < 10; i++) expect((await put(`Alice ${i}`)).status).toBe(200);
    const res = await put("Alice 10");
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/tomorrow/);
    for (let i = 0; i < 12; i++) expect((await put(`Boss ${i}`, OWNER)).status).toBe(200);
  });
});

describe("GET /names", () => {
  it("looks names up, publicly and briefly cached", async () => {
    await store.setName(ALICE, "Alice", { now: clock, dailyLimit: 10 });
    const res = await fetch(`${base}/names?addresses=${ALICE},${BOB}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("public");
    expect(await res.json()).toEqual({ names: { [ALICE]: "Alice" } });
  });

  it("caps the list and checks it", async () => {
    const many = Array.from({ length: 101 }, (_, i) => `bc1q${String(i).padStart(30, "0")}`).join(",");
    expect((await fetch(`${base}/names?addresses=${many}`)).status).toBe(400);
    expect((await fetch(`${base}/names?addresses=<script>`)).status).toBe(400);
    expect(await (await fetch(`${base}/names`)).json()).toEqual({ names: {} });
  });
});

describe("DELETE /names/:ref", () => {
  it("lets only the owner reset a name", async () => {
    await store.setName(BOB, "Rude Name", { now: clock, dailyLimit: 10 });
    expect((await fetch(`${base}/names/${BOB}`, { method: "DELETE", headers: as(ALICE) })).status).toBe(403);
    expect((await fetch(`${base}/names/${BOB}`, { method: "DELETE" })).status).toBe(401);
    const res = await fetch(`${base}/names/${BOB}`, { method: "DELETE", headers: as(OWNER) });
    expect(res.status).toBe(200);
    expect((await store.get(BOB))?.displayName).toBeNull();
  });
});

it("answers unknown paths with JSON", async () => {
  const res = await fetch(`${base}/nope`);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not found" });
});

// ── Round 2: privacy, pictures, public profiles ──────────────────────────────

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const send = (path: string, method: string, body: unknown, who: string | null = ALICE) =>
  fetch(`${base}${path}`, { method, headers: as(who, { "Content-Type": "application/json" }), body: JSON.stringify(body) });
const setPicture = (who: string | null = ALICE, image: unknown = `data:image/png;base64,${PNG_B64}`) => send("/me/avatar", "PUT", { image }, who);
/** "/api/profile/avatar/…" → this test server's URL for it. */
const local = (url: string) => `${base}${url.replace("/api/profile", "")}`;

describe("privacy", () => {
  it("toggles from PUT /me, alone or with a name", async () => {
    let res = await send("/me", "PUT", { isPrivate: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ address: ALICE, isPrivate: true, displayName: null });
    res = await send("/me", "PUT", { displayName: "Alice", isPrivate: false });
    expect(await res.json()).toMatchObject({ displayName: "Alice", isPrivate: false });
    expect((await send("/me", "PUT", { isPrivate: "yes" })).status).toBe(400);
  });

  it("keeps private names out of the wallet → name lookup", async () => {
    await store.setName(ALICE, "Alice", { now: clock, dailyLimit: 10 });
    await store.setName(BOB, "Bob", { now: clock, dailyLimit: 10 });
    await store.setPrivate(BOB, true, clock);
    expect(await (await fetch(`${base}/names?addresses=${ALICE},${BOB}`)).json()).toEqual({ names: { [ALICE]: "Alice" } });
  });
});

describe("GET /public/:ref", () => {
  it("shows a public profile by wallet, with its uid and picture", async () => {
    await store.setName(ALICE, "Alice", { now: clock, dailyLimit: 10 });
    await setPicture(ALICE);
    const res = await fetch(`${base}/public/${ALICE}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ref: ALICE, name: "Alice", isPrivate: false, address: ALICE, isOwner: false });
    expect(body.uid).toMatch(/^[0-9a-f]{12}$/);
    expect(body.avatarUrl).toMatch(new RegExp(`^/api/profile/avatar/${body.uid}\\?v=[0-9a-f]{12}$`));
  });

  it("never gives both the name and the wallet of someone private", async () => {
    await store.setName(BOB, "Bob", { now: clock, dailyLimit: 10 });
    const rec = await store.setPrivate(BOB, true, clock);
    const byWallet = await (await fetch(`${base}/public/${BOB}`)).json();
    expect(byWallet).toMatchObject({ name: null, uid: null, avatarUrl: null, isPrivate: true, address: BOB });
    const byUid = await (await fetch(`${base}/public/~${rec.uid}`)).json();
    expect(byUid).toMatchObject({ name: "Bob", uid: rec.uid, isPrivate: true, address: null });
  });

  it("answers for any wallet, profile or not, and 404s an unknown uid", async () => {
    expect(await (await fetch(`${base}/public/${BOB}`)).json()).toMatchObject({ name: null, address: BOB, isPrivate: false });
    expect((await fetch(`${base}/public/~000000000000`)).status).toBe(404);
    expect((await fetch(`${base}/public/~nope`)).status).toBe(404);
    expect((await fetch(`${base}/public/${encodeURIComponent("<b>")}`)).status).toBe(400);
  });

  it("marks the owner's profile", async () => {
    expect(await (await fetch(`${base}/public/${OWNER}`)).json()).toMatchObject({ isOwner: true });
  });
});

describe("profile pictures", () => {
  it("sets, serves (cached for good when versioned) and removes a picture", async () => {
    const res = await setPicture();
    expect(res.status).toBe(200);
    const { avatarUrl } = await res.json() as { avatarUrl: string };
    const pic = await fetch(local(avatarUrl));
    expect(pic.status).toBe(200);
    expect(pic.headers.get("content-type")).toBe("image/png");
    expect(pic.headers.get("x-content-type-options")).toBe("nosniff");
    expect(pic.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await pic.arrayBuffer())).toEqual(Buffer.from(PNG_B64, "base64"));
    const unversioned = await fetch(local(avatarUrl.replace(/\?v=.*/, "")));
    expect(unversioned.headers.get("cache-control")).not.toContain("immutable");
    const del = await fetch(`${base}/me/avatar`, { method: "DELETE", headers: as(ALICE) });
    expect(await del.json()).toMatchObject({ avatarUrl: null });
    expect((await fetch(local(avatarUrl))).status).toBe(404);
  });

  it("refuses SVG, junk, cross-site posts and a missing sign-in", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64");
    const res = await setPicture(ALICE, `data:image/svg+xml;base64,${svg}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/PNG, JPEG or WebP/);
    expect((await setPicture(ALICE, "nope")).status).toBe(400);
    expect((await setPicture(null)).status).toBe(401);
    const crossSite = await fetch(`${base}/me/avatar`, {
      method: "PUT", headers: as(ALICE, { "Content-Type": "application/json", Origin: "https://evil.example" }), body: "{}",
    });
    expect(crossSite.status).toBe(403);
  });

  it("caps uploads at 10 an hour, except for the owner", async () => {
    for (let i = 0; i < 10; i++) expect((await setPicture(ALICE)).status).toBe(200);
    const res = await setPicture(ALICE);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    for (let i = 0; i < 12; i++) expect((await setPicture(OWNER)).status).toBe(200);
  });

  it("lets only the owner remove someone else's picture, by wallet or ~uid", async () => {
    const { uid } = await (await setPicture(BOB)).json() as { uid: string };
    expect((await fetch(`${base}/avatar/~${uid}`, { method: "DELETE", headers: as(ALICE) })).status).toBe(403);
    expect((await fetch(`${base}/avatar/~${uid}`, { method: "DELETE", headers: as(OWNER) })).status).toBe(200);
    expect((await store.get(BOB))?.avatarVersion).toBeNull();
  });

  it("lets the owner reset a private person's name by ~uid", async () => {
    await store.setName(BOB, "Rude Name", { now: clock, dailyLimit: 10 });
    const rec = await store.setPrivate(BOB, true, clock);
    expect((await fetch(`${base}/names/~${rec.uid}`, { method: "DELETE", headers: as(OWNER) })).status).toBe(200);
    expect((await store.get(BOB))?.displayName).toBeNull();
  });
});
