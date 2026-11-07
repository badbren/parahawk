/**
 * The signed-in person's Parahawk profile, as the desktop sees it: the display
 * name they picked (shown across the site — taskbar, Profile, Chat, the
 * Parahawk pages), their privacy switch, and their profile picture.
 *
 * Keyed off the SERVER session (session/me.ts), not the browser wallet: only an
 * address the server has seen a signature for can own a profile. Only Xverse
 * signs in on the server, so other wallets never have one here.
 *
 *   GET    /api/profile/me          → { address, displayName, isPrivate, uid, avatarUrl }
 *   PUT    /api/profile/me          ← { displayName: string | null } and/or { isPrivate }
 *   PUT    /api/profile/me/avatar   ← { image: data URL }        (src/web/profile-routes.ts)
 *   DELETE /api/profile/me/avatar
 */
import type { ServerSession } from "./me";

export interface ProfileInfo {
  /** The server-session address, or null when nobody is signed in. */
  address: string | null;
  /** The name they chose, or null (show the short address instead). */
  displayName: string | null;
  /** Privacy on: their name stays off their wallet everywhere, and their wallet off their name. */
  isPrivate?: boolean;
  /** Their permanent profile id (links to a private profile are /u/~<uid>), or null. */
  uid?: string | null;
  /** Same-origin URL of their picture, or null. */
  avatarUrl?: string | null;
}

export interface ProfileSession {
  current(): ProfileInfo;
  /** Ask the server again. Resolves with the fresh profile. */
  refresh(): Promise<ProfileInfo>;
  /** Save a new display name (null clears it). Rejects with a human-readable message. */
  setDisplayName(name: string | null): Promise<ProfileInfo>;
  /** Privacy on or off. Rejects with a human-readable message. */
  setPrivate(isPrivate: boolean): Promise<ProfileInfo>;
  /** A new picture as a data: URL (already cropped and shrunk), or null to remove it. Rejects with a human-readable message. */
  setAvatar(dataUrl: string | null): Promise<ProfileInfo>;
  /** Fires on every change. Replays the current state immediately. */
  subscribe(fn: (p: ProfileInfo) => void): () => void;
}

export interface ProfileSessionOptions {
  url?: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

const NOBODY: ProfileInfo = { address: null, displayName: null, isPrivate: false, uid: null, avatarUrl: null };

/** The server's reply, read defensively. */
function parse(body: unknown): ProfileInfo {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return {
    address: str(b.address),
    displayName: str(b.displayName),
    isPrivate: b.isPrivate === true,
    uid: str(b.uid),
    // Only ever our own origin's picture route.
    avatarUrl: typeof b.avatarUrl === "string" && b.avatarUrl.startsWith("/api/profile/avatar/") ? b.avatarUrl : null,
  };
}

const same = (a: ProfileInfo, b: ProfileInfo) =>
  a.address === b.address && a.displayName === b.displayName && !!a.isPrivate === !!b.isPrivate
  && (a.uid ?? null) === (b.uid ?? null) && (a.avatarUrl ?? null) === (b.avatarUrl ?? null);

export function createProfileSession(me: ServerSession, opts: ProfileSessionOptions = {}): ProfileSession {
  const url = opts.url ?? "/api/profile/me";
  const get = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  let info: ProfileInfo = { ...NOBODY, address: me.current().address };
  const listeners = new Set<(p: ProfileInfo) => void>();

  const set = (next: ProfileInfo) => {
    if (same(next, info)) return;
    info = next;
    for (const fn of [...listeners]) fn(info);
  };

  // Only the newest answer counts: a slow reply for a previous account must not
  // land on top of a sign-out or a change that happened since.
  let generation = 0;

  const refresh = async (): Promise<ProfileInfo> => {
    const mine = ++generation;
    if (!me.current().address) { set({ ...NOBODY }); return info; }
    try {
      const res = await get(url, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return info;
      const next = parse(await res.json());
      if (mine === generation) set(next);
    } catch {
      /* offline or blocked: keep what we had */
    }
    return info;
  };

  /** One write: send, read the reply, adopt it, or throw the server's own words. */
  const write = async (path: string, method: string, body: unknown, fallback: string): Promise<ProfileInfo> => {
    const mine = ++generation;
    let res: Response;
    try {
      res = await get(path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error("Couldn't reach Parahawk. Check your connection and try again.");
    }
    let reply: unknown = null;
    try { reply = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const msg = (reply as { error?: unknown } | null)?.error;
      throw new Error(typeof msg === "string" && msg ? msg : fallback);
    }
    if (mine === generation) set(parse(reply));
    return info;
  };

  // Sign-in, sign-out and account switches: drop the old profile at once, then ask.
  me.subscribe((now) => {
    if (now.address === info.address) return;
    generation++;
    set({ ...NOBODY, address: now.address });
    if (now.address) void refresh();
  });
  if (info.address) void refresh();

  return {
    current: () => info,
    refresh,
    setDisplayName: (name) => write(url, "PUT", { displayName: name }, "Couldn't save that name. Try again in a minute."),
    setPrivate: (isPrivate) => write(url, "PUT", { isPrivate }, "Couldn't change that. Try again in a minute."),
    setAvatar: (dataUrl) => dataUrl === null
      ? write(`${url}/avatar`, "DELETE", undefined, "Couldn't remove your picture. Try again in a minute.")
      : write(`${url}/avatar`, "PUT", { image: dataUrl }, "Couldn't save that picture. Try again in a minute."),
    subscribe(fn) {
      listeners.add(fn);
      fn(info);
      return () => { listeners.delete(fn); };
    },
  };
}
