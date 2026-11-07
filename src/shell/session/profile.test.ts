import { describe, expect, it, vi } from "vitest";
import type { ServerIdentity, ServerSession } from "./me.js";
import { createProfileSession, type ProfileInfo } from "./profile.js";

const ALICE = "bc1qalice0000000000000000000000000000000";

/** A server session we can sign in and out by hand. */
function fakeMe(address: string | null = null) {
  let me: ServerIdentity = { address, admin: false };
  const listeners = new Set<(m: ServerIdentity) => void>();
  const session: ServerSession = {
    current: () => me,
    isAdmin: () => me.admin,
    refresh: async () => me,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return {
    session,
    signIn(a: string | null) { me = { address: a, admin: false }; for (const fn of [...listeners]) fn(me); },
  };
}

/** A tiny /api/profile/me: names by address, the signed-in address from `who()`. */
function fakeServer(who: () => string | null, names = new Map<string, string>()) {
  const calls: Array<{ method: string; body?: unknown }> = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, body });
    const a = who();
    if (method === "GET") return json(200, { address: a, displayName: a ? names.get(a) ?? null : null });
    if (!a) return json(401, { error: "Sign in with Xverse to set a display name." });
    const name = (body as { displayName: string | null }).displayName;
    if (name === "taken") return json(409, { error: "That name is taken." });
    if (name) names.set(a, name); else names.delete(a);
    return json(200, { address: a, displayName: name });
  });
  return { fetch: fetchFn as unknown as typeof fetch, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("profile session", () => {
  it("has no name while nobody is signed in, and doesn't ask", async () => {
    const me = fakeMe();
    const server = fakeServer(() => me.session.current().address);
    const p = createProfileSession(me.session, { fetch: server.fetch });
    await tick();
    expect(p.current()).toMatchObject({ address: null, displayName: null });
    expect(server.calls).toHaveLength(0);
  });

  it("loads the name when someone signs in, and drops it when they leave", async () => {
    const me = fakeMe();
    const server = fakeServer(() => me.session.current().address, new Map([[ALICE, "Alice"]]));
    const p = createProfileSession(me.session, { fetch: server.fetch });
    const seen: ProfileInfo[] = [];
    p.subscribe((i) => seen.push(i));

    me.signIn(ALICE);
    await tick();
    expect(p.current()).toMatchObject({ address: ALICE, displayName: "Alice" });

    me.signIn(null);
    expect(p.current()).toMatchObject({ address: null, displayName: null });
    expect(seen[seen.length - 1]).toMatchObject({ address: null, displayName: null });
  });

  it("saves a name and tells subscribers", async () => {
    const me = fakeMe(ALICE);
    const server = fakeServer(() => me.session.current().address);
    const p = createProfileSession(me.session, { fetch: server.fetch });
    await tick();
    const fn = vi.fn();
    p.subscribe(fn);
    await p.setDisplayName("Alice");
    expect(p.current().displayName).toBe("Alice");
    expect(fn).toHaveBeenLastCalledWith(expect.objectContaining({ address: ALICE, displayName: "Alice" }));
    expect(server.calls[server.calls.length - 1]).toEqual({ method: "PUT", body: { displayName: "Alice" } });
    await p.setDisplayName(null);
    expect(p.current().displayName).toBeNull();
  });

  it("passes the server's reason through when a save is refused", async () => {
    const me = fakeMe(ALICE);
    const p = createProfileSession(me.session, { fetch: fakeServer(() => me.session.current().address).fetch });
    await expect(p.setDisplayName("taken")).rejects.toThrow("That name is taken.");
    expect(p.current().displayName).toBeNull();
  });

  it("explains a network failure in plain words", async () => {
    const me = fakeMe(ALICE);
    const p = createProfileSession(me.session, { fetch: (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch });
    await expect(p.setDisplayName("Alice")).rejects.toThrow(/Couldn't reach Parahawk/);
  });

  it("ignores a slow answer for the previous account", async () => {
    const me = fakeMe(ALICE);
    let release: () => void = () => undefined;
    const slow = (async () => {
      await new Promise<void>((r) => { release = r; });
      return new Response(JSON.stringify({ address: ALICE, displayName: "Alice" }), { status: 200 });
    }) as unknown as typeof fetch;
    // Asks for Alice's name at once; she signs out before the answer lands.
    const p = createProfileSession(me.session, { fetch: slow });
    me.signIn(null);
    release();
    await tick();
    await tick();
    expect(p.current()).toMatchObject({ address: null, displayName: null });
  });
});

describe("profile session — privacy and pictures", () => {
  /** A /api/profile/me that also does privacy and pictures. */
  function richServer(address: string) {
    let state = { address, displayName: null as string | null, isPrivate: false, uid: "0123456789ab", avatarUrl: null as string | null };
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: String(url), method, body });
      if (String(url).endsWith("/avatar")) {
        if (method === "DELETE") state = { ...state, avatarUrl: null };
        else if ((body as { image: string }).image === "bad") return new Response(JSON.stringify({ error: "Pictures have to be PNG, JPEG or WebP." }), { status: 400 });
        else state = { ...state, avatarUrl: "/api/profile/avatar/0123456789ab?v=aaaaaaaaaaaa" };
      } else if (method === "PUT") {
        state = { ...state, ...(body as object) };
      }
      return new Response(JSON.stringify(state), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    return { fetch: fetchFn as unknown as typeof fetch, calls };
  }

  it("turns privacy on and off", async () => {
    const me = fakeMe(ALICE);
    const server = richServer(ALICE);
    const p = createProfileSession(me.session, { fetch: server.fetch });
    await tick();
    expect(p.current()).toMatchObject({ isPrivate: false, uid: "0123456789ab" });
    await p.setPrivate(true);
    expect(p.current().isPrivate).toBe(true);
    expect(server.calls[server.calls.length - 1]).toMatchObject({ method: "PUT", body: { isPrivate: true } });
  });

  it("sets and removes a picture, passing refusals through", async () => {
    const me = fakeMe(ALICE);
    const server = richServer(ALICE);
    const p = createProfileSession(me.session, { fetch: server.fetch });
    await tick();
    await p.setAvatar("data:image/webp;base64,AAAA");
    expect(p.current().avatarUrl).toBe("/api/profile/avatar/0123456789ab?v=aaaaaaaaaaaa");
    await expect(p.setAvatar("bad")).rejects.toThrow("Pictures have to be PNG, JPEG or WebP.");
    await p.setAvatar(null);
    expect(p.current().avatarUrl).toBeNull();
    expect(server.calls.map((c) => `${c.method} ${c.url}`)).toContain("DELETE /api/profile/me/avatar");
  });

  it("only ever trusts a picture URL on our own picture route", async () => {
    const me = fakeMe(ALICE);
    const evil = (async () => new Response(JSON.stringify({ address: ALICE, displayName: null, avatarUrl: "https://evil.example/x.png" }), { status: 200 })) as unknown as typeof fetch;
    const p = createProfileSession(me.session, { fetch: evil });
    await tick();
    await tick();
    expect(p.current().avatarUrl).toBeNull();
  });
});
