import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySuggestionStore } from "../suggestions/store.js";
import type { InboxPage } from "../suggestions/rules.js";
import { suggestionsRouter, type SuggestionsRouterOptions } from "./suggestion-routes.js";

const OWNER = "bc1qowner000000000000000000000000000000";
const ALICE = "bc1qalice0000000000000000000000000000000";

// ── Server ───────────────────────────────────────────────────────────────────
let clock = Date.UTC(2026, 10, 6, 12);
let router: express.Router;
let store: MemorySuggestionStore;
let record: ReturnType<typeof vi.fn>;
let server: Server;
let base = "";

/** Tests sign in by header; the owner is OWNER. */
const session = (r: express.Request) => {
  const a = r.get("x-test-address");
  return a ? { address: a, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER } : null;
};
const mount = (opts: SuggestionsRouterOptions = {}) => {
  store = new MemorySuggestionStore();
  record = vi.fn(async () => {});
  router = suggestionsRouter({
    store, session, now: () => clock, record,
    isAdmin: (s) => s?.address === OWNER,
    namesFor: async (addrs) => new Map(addrs.filter((a) => a === ALICE).map((a) => [a, "alice"])),
    ipLimit: null,
    ...opts,
  });
};

beforeAll(async () => {
  const app = express();
  app.use("/api/suggestions", (req, res, next) => router(req, res, next));
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/suggestions`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { clock += 24 * 3_600_000; mount(); });

const send = (body: unknown, who: string | null = null, headers: Record<string, string> = {}) =>
  fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(who ? { "x-test-address": who } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const req = (method: string, path = "", who: string | null = OWNER, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { ...(who ? { "x-test-address": who } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const IDEA = { title: "Dark mode for the calculator", notes: "It's bright at night." };

// ── Sending ──────────────────────────────────────────────────────────────────
describe("POST / — anyone can send", () => {
  it("takes a guest's suggestion with no address, and never caches", async () => {
    const res = await send(IDEA);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { id } = await res.json();
    expect(await store.list(10)).toEqual([{ id, at: clock, ...IDEA, address: null, status: "new" }]);
    expect(record).not.toHaveBeenCalled();
  });

  it("attaches the signed-in address from the session — never from the body — and counts it for badges", async () => {
    const res = await send({ ...IDEA, address: "bc1qsomeoneelse000000000000000000000000" }, ALICE);
    expect(res.status).toBe(201);
    expect((await store.list(1))[0]!.address).toBe(ALICE);
    expect(record).toHaveBeenCalledWith(ALICE, "suggestion");
  });

  it("cleans what it keeps", async () => {
    await send({ title: "  Two   spaces ", notes: "  hi\r\n\r\n\r\n\r\n\r\nthere  " });
    expect((await store.list(1))[0]).toMatchObject({ title: "Two spaces", notes: "hi\n\n\nthere" });
  });

  it("says what's wrong, and which field", async () => {
    const short = await send({ title: "hi", notes: "x" });
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ field: "title", error: expect.stringMatching(/at least 3/) });
    const empty = await send({ title: "Hello", notes: "   " });
    expect(await empty.json()).toMatchObject({ field: "notes" });
    expect((await send([1, 2])).status).toBe(400);
    expect(await store.list(10)).toEqual([]);
  });

  it("drops a filled honeypot quietly — the bot sees success", async () => {
    const res = await send({ ...IDEA, website: "http://spam.example" }, ALICE);
    expect(res.status).toBe(201);
    expect(await store.list(10)).toEqual([]);
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses cross-site posts, non-JSON, bad JSON and oversized bodies — all in JSON", async () => {
    expect((await send(IDEA, null, { Origin: "https://evil.example" })).status).toBe(403);
    const form = await fetch(base, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "title=x" });
    expect(form.status).toBe(415);
    const bad = await send("{nope");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "bad JSON" });
    const huge = await send({ title: "Big one", notes: "x".repeat(20_000) });
    expect(huge.status).toBe(413);
    expect(await huge.json()).toEqual({ error: "that's too long to send" });
    expect(await store.list(10)).toEqual([]);
  });

  it("caps a signed-in address at 10 a day", async () => {
    for (let i = 0; i < 10; i++) expect((await send(IDEA, ALICE)).status).toBe(201);
    const over = await send(IDEA, ALICE);
    expect(over.status).toBe(429);
    expect((await over.json()).error).toMatch(/10 today/);
    // Guests and other wallets aren't affected; a day later Alice can send again.
    expect((await send(IDEA)).status).toBe(201);
    clock += 24 * 3_600_000 + 1;
    expect((await send(IDEA, ALICE)).status).toBe(201);
  });

  it("caps sends per IP, counting only the ones that were accepted", async () => {
    mount({ ipLimit: { windowMs: 3_600_000, limit: 2 } });
    expect((await send({ title: "no", notes: "" })).status).toBe(400); // a typo doesn't use the allowance
    expect((await send(IDEA)).status).toBe(201);
    expect((await send(IDEA, ALICE)).status).toBe(201);
    const over = await send(IDEA);
    expect(over.status).toBe(429);
    expect((await over.json()).error).toMatch(/try again in an hour/);
    expect(await store.list(10)).toHaveLength(2);
  });
});

// ── The owner's inbox ────────────────────────────────────────────────────────
describe("the inbox is the owner's alone", () => {
  it("refuses guests and other wallets on every inbox route", async () => {
    await send(IDEA);
    const [id] = (await store.list(1)).map((s) => s.id);
    for (const who of [null, ALICE]) {
      const want = who ? 403 : 401;
      expect((await req("GET", "", who)).status).toBe(want);
      expect((await req("GET", "/count", who)).status).toBe(want);
      expect((await req("PATCH", `/${id}`, who, { status: "done" })).status).toBe(want);
      expect((await req("DELETE", `/${id}`, who)).status).toBe(want);
    }
    expect((await store.list(1))[0]!.status).toBe("new");
  });

  it("lists newest first with names, the new count, and private no-store caching", async () => {
    await send({ title: "First idea", notes: "a" }, ALICE);
    clock += 1_000;
    await send({ title: "Second idea", notes: "b" });
    const res = await req("GET");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const page = (await res.json()) as InboxPage;
    expect(page.newCount).toBe(2);
    expect(page.items.map((i) => [i.title, i.address, i.name])).toEqual([
      ["Second idea", null, null],
      ["First idea", ALICE, "alice"],
    ]);
  });

  it("still lists when the name lookup fails", async () => {
    mount({ namesFor: async () => { throw new Error("db down"); } });
    await send(IDEA, ALICE);
    const page = (await (await req("GET")).json()) as InboxPage;
    expect(page.items[0]).toMatchObject({ address: ALICE, name: null });
  });

  it("marks read / done / back, and deletes, reporting the new count each time", async () => {
    await send(IDEA);
    await send({ title: "Another one", notes: "b" });
    const [a, b] = (await store.list(10)).map((s) => s.id);
    expect(await (await req("GET", "/count")).json()).toEqual({ new: 2 });

    const read = await req("PATCH", `/${a}`, OWNER, { status: "read" });
    expect(await read.json()).toEqual({ ok: true, newCount: 1 });
    expect(await (await req("PATCH", `/${a}`, OWNER, { status: "done" })).json()).toEqual({ ok: true, newCount: 1 });
    expect((await req("PATCH", `/${a}`, OWNER, { status: "archived" })).status).toBe(400);
    expect((await req("PATCH", "/missing", OWNER, { status: "read" })).status).toBe(404);

    expect(await (await req("DELETE", `/${b}`)).json()).toEqual({ ok: true, newCount: 0 });
    expect((await req("DELETE", `/${b}`)).status).toBe(404);
    expect((await store.list(10)).map((s) => [s.id, s.status])).toEqual([[a, "done"]]);
  });

  it("refuses a cross-site PATCH even from the owner", async () => {
    await send(IDEA);
    const [id] = (await store.list(1)).map((s) => s.id);
    const res = await fetch(`${base}/${id}`, {
      method: "PATCH",
      headers: { "x-test-address": OWNER, "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ status: "done" }),
    });
    expect(res.status).toBe(403);
    expect((await store.list(1))[0]!.status).toBe("new");
  });

  it("answers anything else with a JSON 404", async () => {
    const res = await req("GET", "/nope/deeper");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});
