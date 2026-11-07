/**
 * The server session, as the desktop sees it.
 *
 * Separate from session/wallet.ts on purpose: that is the browser wallet the
 * visitor connected (read-only identity), this is the signed cookie the server
 * issued after a wallet signature proved an address. Only the server's view
 * can say "this is the owner", so owner-only icons key off this.
 *
 * Asked for once on load and again whenever something might have changed it
 * (a sign-in, a window that went to /account). It is never cached: /api/me
 * answers `private, no-store`, and the desktop page itself carries nothing
 * per-person, because it is shared through the CDN.
 */

export interface ServerIdentity {
  address: string | null;
  admin: boolean;
}

export interface ServerSession {
  current(): ServerIdentity;
  isAdmin(): boolean;
  /** Ask the server again. Resolves with the fresh identity. */
  refresh(): Promise<ServerIdentity>;
  subscribe(fn: (me: ServerIdentity) => void): () => void;
}

const NOBODY: ServerIdentity = { address: null, admin: false };

export function createServerSession(url = "/api/me"): ServerSession {
  let me: ServerIdentity = NOBODY;
  const listeners = new Set<(me: ServerIdentity) => void>();

  const refresh = async (): Promise<ServerIdentity> => {
    try {
      const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return me;
      const body = (await res.json()) as Partial<ServerIdentity>;
      const next: ServerIdentity = {
        address: typeof body.address === "string" ? body.address : null,
        admin: body.admin === true,
      };
      const changed = next.address !== me.address || next.admin !== me.admin;
      me = next;
      if (changed) for (const fn of [...listeners]) fn(me);
    } catch {
      /* offline or blocked: keep what we had — owner icons stay as they were */
    }
    return me;
  };

  return {
    current: () => me,
    isAdmin: () => me.admin,
    refresh,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
