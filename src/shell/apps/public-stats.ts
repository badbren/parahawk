/**
 * Someone else's Parahawk numbers, for their public profile window
 * (user-profile.ts): the wallet page's headline numbers (when their wallet is
 * shown), the Parahawk badges they've earned, and their time on Parahawk.
 * Read-only — the same tiles and badge cards as your own Profile → Parahawk
 * section (parahawk-pieces.ts). One call: GET /api/activity/public/:ref.
 *
 * Privacy is the server's job (src/web/activity-routes.ts): someone private,
 * reached by name (~uid), comes back without wallet or pool numbers; reached by
 * wallet, without badges or time on Parahawk.
 */
import { h } from "../util/dom";
import { badgeCard, date, poolTiles, type PoolHeadline } from "./parahawk-pieces";

export interface PublicStatsOptions {
  /** Opens a site path in its window, e.g. their wallet page. */
  openPath?: (path: string) => void;
}

// ── The API's answer (src/web/activity-routes.ts ActivityPublic), as read here ─

interface PublicBadge { id: string; emoji: string; name: string; desc: string; perk?: string }
interface ActivityPublic {
  ref: string;
  address: string | null;
  isPrivate: boolean;
  owner: boolean;
  activity: { memberSince: number | null; daysActive: number; hoursOnSite: number } | null;
  badges: PublicBadge[] | null;
  total: number;
  pool: PoolHeadline | null;
  poolError: string | null;
}

const hours = (n: number) => (n < 1 ? "under an hour" : `${n} h`);

/** Fills `host` with the stats for `ref` (a wallet address, or "~<uid>" for someone private). Returns a cleanup. */
export function mountPublicStats(host: HTMLElement, ref: string, opts: PublicStatsOptions = {}): () => void {
  const root = h("div", { class: "ph-phk ph-phk-public" });
  host.replaceChildren(root);
  let ctl: AbortController | null = null;
  let dead = false;

  const note = (...kids: Array<Node | string>) => root.replaceChildren(h("p", { class: "ph-phk-msg" }, ...kids));

  const render = (d: ActivityPublic) => {
    const parts: HTMLElement[] = [];
    if (d.owner) parts.push(h("p", { class: "ph-phk-owner" }, "🦅 Parahawk's owner — holds every Parahawk badge."));

    // 1 · The wallet page's headline numbers (only alongside the wallet).
    if (d.pool) {
      parts.push(...poolTiles(d.pool, "their", "Refinery orders"));
      const addr = d.address;
      if (addr && opts.openPath) {
        const go = h("button", { class: "ph-phk-link", type: "button" }, "See everything on their wallet page →");
        go.addEventListener("click", () => opts.openPath?.(`/address/${encodeURIComponent(addr)}`));
        parts.push(h("p", { class: "ph-phk-sub" }, go));
      }
    } else if (d.poolError) {
      const retry = h("button", { class: "ph-phk-link", type: "button" }, "try again");
      retry.addEventListener("click", () => { void load(); });
      parts.push(h("p", { class: "ph-phk-sub" }, d.poolError, " ", retry));
    } else if (d.isPrivate) {
      parts.push(h("p", { class: "ph-phk-sub" }, "They keep their wallet private, so its pool numbers stay hidden."));
    }

    // 2 · Parahawk badges they've earned.
    if (d.badges && d.badges.length > 0) {
      parts.push(h("h3", { class: "ph-phk-h" }, "Parahawk badges ",
        h("span", { class: "ph-phk-dim" }, `${d.badges.length} of ${d.total}`)));
      parts.push(h("ul", { class: "ph-phk-badges" },
        ...d.badges.map((b) => badgeCard({ ...b, earned: true, progress: { have: 1, need: 1, label: "earned" } }))));
    } else {
      parts.push(h("p", { class: "ph-phk-sub" }, "No Parahawk badges to show."));
    }

    // 3 · Their time on Parahawk.
    const a = d.activity;
    if (a && a.memberSince) {
      parts.push(h("p", { class: "ph-phk-foot" },
        `Member since ${date(a.memberSince)} · ${hours(a.hoursOnSite)} on Parahawk · ${a.daysActive} day${a.daysActive === 1 ? "" : "s"} active`));
    }
    root.replaceChildren(...parts);
  };

  const load = async () => {
    ctl?.abort();
    const mine = (ctl = new AbortController());
    note("Loading their numbers…");
    try {
      const res = await fetch(`/api/activity/public/${encodeURIComponent(ref)}`, { credentials: "same-origin", signal: mine.signal });
      if (dead || mine !== ctl) return;
      if (res.status === 400 || res.status === 404) { note("There's no Parahawk profile here."); return; }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ActivityPublic;
      if (dead || mine !== ctl) return;
      render(data);
    } catch {
      if (dead || mine.signal.aborted) return;
      const retry = h("button", { class: "ph-prof-btn", type: "button" }, "Try again");
      retry.addEventListener("click", () => { void load(); });
      root.replaceChildren(h("p", { class: "ph-phk-msg" }, "Couldn't load their numbers right now. "), retry);
    }
  };

  void load();
  return () => {
    dead = true;
    ctl?.abort();
    root.remove();
  };
}
