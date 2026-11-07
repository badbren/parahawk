/**
 * The Profile window's "Parahawk" dropdown: your pool side — a jump to your
 * wallet page, the wallet page's headline numbers (your cut if the pot cracked
 * now, hashrate, best share, rentals), and the Parahawk badges you've earned
 * for using the site.
 *
 * Everything comes from one call, GET /api/activity/me (src/web/activity-routes.ts),
 * which needs the server session — an Xverse sign-in. The pool numbers are for
 * the address you mine to: your sign-in address when it's a bc1 address, or one
 * you set here ("change").
 */
import type { ServerSession } from "../session/me";
import type { WalletAccount } from "../session/wallet";
import type { TickFeed } from "../data/tick";
import { h } from "../util/dom";
import { badgeCard, date, duration, poolTiles, short, type BadgeView, type PoolHeadline } from "./parahawk-pieces";

export interface ParahawkSectionContext {
  /** The connected wallet (Bitcoin or EVM). */
  account: WalletAccount;
  me?: ServerSession;
  tick?: TickFeed;
  /** Opens a site path in its desktop window, e.g. `/address/bc1q…` (the wallet page). */
  openPath?: (path: string) => void;
}

// ── The API's answer (src/web/activity-routes.ts ActivityMe), as read here ───

interface ActivityMe {
  address: string;
  counters: { firstSeen: number; secondsOnSite: number; activeDays: number };
  badges: BadgeView[];
  earned: number;
  stats: {
    rentals: { count: number; lastAt: number | null } | null;
    linkedVenues: string[] | null;
    poolAddress: string | null;
    poolAddressSaved: boolean;
    pool: PoolHeadline | null;
    poolError: string | null;
  };
}

const isBc1 = (a: string | undefined): a is string => typeof a === "string" && /^bc1[0-9a-z]{6,87}$/i.test(a);
const VENUE: Record<string, string> = { nicehash: "NiceHash", miningrigrentals: "MiningRigRentals" };

// ── The section ──────────────────────────────────────────────────────────────

/** Fills `host` with the section's body. Returns a cleanup. */
export function mountParahawkSection(host: HTMLElement, ctx: ParahawkSectionContext): () => void {
  const { account, me, openPath } = ctx;
  const root = h("div", { class: "ph-phk" });
  host.replaceChildren(root);

  let data: ActivityMe | null = null;
  let editing = false;
  let saving = false;
  let formError = "";
  /** What they've typed in the address box, kept across re-renders (an error must not wipe it). */
  let draft: string | null = null;
  let ctl: AbortController | null = null;
  let dead = false;

  const note = (...kids: Array<Node | string>) => root.replaceChildren(h("p", { class: "ph-phk-msg" }, ...kids));

  /** The wallet's other bc1 address, offered to the server when the sign-in address isn't one. */
  const hint = isBc1(account.ordinals) ? account.ordinals : isBc1(account.address) ? account.address : null;

  const load = async () => {
    if (account.chain !== "bitcoin") {
      note("Pool numbers and Parahawk badges need a Bitcoin wallet. Connect ", h("strong", {}, "Xverse"), " instead — it signs one message and spends nothing.");
      return;
    }
    if (!me?.current().address) {
      note("Your Xverse sign-in has run out. Disconnect, then connect Xverse again to see your numbers and badges.");
      return;
    }
    ctl?.abort();
    const mine = (ctl = new AbortController());
    if (!data) note("Loading your numbers…");
    try {
      const res = await fetch(`/api/activity/me${hint ? `?pool=${encodeURIComponent(hint)}` : ""}`, {
        credentials: "same-origin", cache: "no-store", signal: mine.signal,
      });
      if (dead || mine !== ctl) return;
      if (res.status === 401) { data = null; note("Your Xverse sign-in has run out. Disconnect, then connect Xverse again to see your numbers and badges."); return; }
      if (!res.ok) throw new Error(String(res.status));
      data = (await res.json()) as ActivityMe;
      if (dead || mine !== ctl) return;
      render();
    } catch {
      if (dead || mine.signal.aborted) return;
      const retry = h("button", { class: "ph-prof-btn", type: "button" }, "Try again");
      retry.addEventListener("click", () => { void load(); });
      root.replaceChildren(h("p", { class: "ph-phk-msg" }, "Couldn't load your numbers right now. "), retry);
    }
  };

  const savePool = async (address: string | null) => {
    saving = true; formError = ""; render();
    try {
      const res = await fetch("/api/activity/me/pool-address", {
        method: "PUT", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }),
      });
      const body = (await res.json().catch(() => null)) as (ActivityMe & { error?: string }) | null;
      if (dead) return;
      if (!res.ok || !body || typeof body.error === "string") {
        formError = body?.error ?? "Couldn't save that — try again.";
      } else {
        data = body;
        editing = false;
        draft = null;
      }
    } catch {
      formError = "Couldn't reach Parahawk — try again.";
    }
    saving = false;
    if (!dead) render();
  };

  const poolForm = (current: string | null, saved: boolean): HTMLElement => {
    const input = h("input", {
      class: "ph-phk-input", type: "text", value: draft ?? current ?? "", placeholder: "bc1…", spellcheck: "false", autocomplete: "off",
      "aria-label": "The bitcoin address you mine to",
    });
    input.addEventListener("input", () => { draft = input.value; });
    const save = h("button", { class: "ph-prof-btn", type: "submit", ...(saving ? { disabled: true } : {}) }, saving ? "Saving…" : "Save");
    const form = h("form", { class: "ph-phk-form" }, input, save);
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const v = input.value.trim();
      draft = input.value;
      if (!v) { formError = "Paste the bc1 address you mine to."; render(); return; }
      void savePool(v);
    });
    if (current !== null) {
      const cancel = h("button", { class: "ph-prof-btn", type: "button" }, "Cancel");
      cancel.addEventListener("click", () => { editing = false; formError = ""; draft = null; render(); });
      form.append(cancel);
    }
    if (saved) {
      const reset = h("button", { class: "ph-phk-link", type: "button" }, "use my sign-in address");
      reset.addEventListener("click", () => { void savePool(null); });
      form.append(reset);
    }
    queueMicrotask(() => { if (input.isConnected && !saving) input.focus(); });
    return h("div", { class: "ph-phk-ask" },
      h("p", {}, current ? "Mining to a different address? Paste it here." : "Which address do you mine to? Paste it to see your pool numbers."),
      form,
      formError ? h("p", { class: "ph-phk-err", role: "alert" }, formError) : null);
  };

  const render = () => {
    if (!data) return;
    const s = data.stats;
    const parts: Array<HTMLElement | null> = [];

    // 1 · The jump to the wallet page.
    if (s.poolAddress && !editing) {
      const go = h("button", { class: "ph-phk-go", type: "button", ...(openPath ? {} : { disabled: true }) }, "Open my wallet page →");
      const addr = s.poolAddress;
      go.addEventListener("click", () => openPath?.(`/address/${encodeURIComponent(addr)}`));
      const change = h("button", { class: "ph-phk-link", type: "button" }, "change");
      change.addEventListener("click", () => { editing = true; formError = ""; draft = null; render(); });
      parts.push(h("div", { class: "ph-phk-jump" },
        go,
        h("span", { class: "ph-phk-for" }, "for ", h("code", { title: addr }, short(addr)), " · ", change)));
    } else {
      parts.push(poolForm(s.poolAddress, s.poolAddressSaved));
    }

    // 2 · The wallet page's headline numbers.
    const p = s.pool;
    if (p) {
      const via = s.rentals && s.rentals.count > 0 ? `${s.rentals.count} through Parahawk`
        : s.linkedVenues && s.linkedVenues.length > 0 ? `${s.linkedVenues.map((v) => VENUE[v] ?? v).join(", ")} linked`
        : "Refinery orders";
      parts.push(...poolTiles(p, "your", via));
    } else if (s.poolError) {
      const retry = h("button", { class: "ph-phk-link", type: "button" }, "try again");
      retry.addEventListener("click", () => { void load(); });
      parts.push(h("p", { class: "ph-phk-sub" }, s.poolError, " ", retry));
    }

    // 3 · Parahawk badges.
    parts.push(h("h3", { class: "ph-phk-h" }, "Parahawk badges ",
      h("span", { class: "ph-phk-dim" }, `${data.earned} of ${data.badges.length}`)));
    parts.push(h("ul", { class: "ph-phk-badges" }, ...data.badges.map(badgeCard)));

    // 4 · Time on the site.
    const c = data.counters;
    parts.push(h("p", { class: "ph-phk-foot" }, c.firstSeen > 0
      ? `Member since ${date(c.firstSeen)} · ${duration(c.secondsOnSite)} on Parahawk · ${c.activeDays} day${c.activeDays === 1 ? "" : "s"} active`
      : "Your time on Parahawk starts counting now."));

    root.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null));
  };

  const offMe = me?.subscribe(() => { data = null; editing = false; draft = null; void load(); });
  void load();

  return () => {
    dead = true;
    ctl?.abort();
    offMe?.();
    root.remove();
  };
}
