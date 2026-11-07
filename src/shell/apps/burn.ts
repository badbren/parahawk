/**
 * Burn — climb the ladder.
 *
 * Two of a tier make one of the next, and the two are gone for good. This is
 * the practice version: it burns the pieces the practice ledger holds (Whites
 * won in Block Hunt, and whatever was burned up from them), for free, and plays
 * the reveal on what comes out.
 *
 * The live collection's rules sit next to every burn — the fee, the 24-hour
 * cooldown on both pieces, the one-rung-a-day unlock — each marked as skipped
 * here, so practice is never mistaken for the real thing. Every number comes
 * from src/econ/tokenomics.ts.
 */
import { TIERS, fmtSatsUsd, getTier, nextTier, UPGRADE_COOLDOWN_HOURS, type Tier, type TierId } from "../../econ/tokenomics";
import { COLLECTION, tokenArtUrl } from "../../art/catalog";
import { recordBurn } from "../data/game-runs";
import type { TickFeed } from "../data/tick";
import type { PracticeClaim, PracticeLedger } from "../session/ledger";
import { shortAddress, type WalletSession } from "../session/wallet";
import { h } from "../util/dom";
import { pieceArtTier, pieceName, pieceTokenId, showReveal } from "./reveal";
import "./burn.css";

export interface BurnOptions {
  ledger: PracticeLedger;
  wallet?: WalletSession;
  tick?: TickFeed;
  /** Opens another desktop app — the empty state sends people to Block Hunt. */
  openApp?: (id: string) => void;
}

const plural = (n: number, tier: Tier) => `${n} ${tier.name}${n === 1 ? "" : "s"}`;

/** Tier chip: swatch + name, the same look as the whitepaper's. */
const chip = (t: Tier, extra?: string) =>
  h("span", { class: "ph-burn-chip" }, h("i", { style: `background:${t.swatch}`, "aria-hidden": "true" }), t.name, extra ? h("b", {}, extra) : null);

export function mountBurn(host: HTMLElement, opts: BurnOptions): () => void {
  const { ledger } = opts;
  let selected: string[] = [];
  let message: { text: string; bad: boolean } | null = null;
  let closeReveal: (() => void) | null = null;

  const scroll = h("div", { class: "ph-burn-scroll" });
  const root = h("div", { class: "ph-burn" }, scroll);
  host.replaceChildren(root);

  /** Thumbnail buttons, kept across renders so their images never reload. */
  const pieceEls = new Map<string, HTMLButtonElement>();
  const pieceEl = (c: PracticeClaim): HTMLButtonElement => {
    let el = pieceEls.get(c.id);
    if (!el) {
      const tier = getTier(c.tier)!;
      const tokenId = pieceTokenId(c.id);
      el = h("button", { class: "ph-burn-piece", type: "button", "data-id": c.id, "aria-pressed": "false",
        title: `${pieceName(c.id)} · ${tier.name}` },
        h("img", { src: tokenArtUrl(pieceArtTier(tier), tokenId, true), alt: "", loading: "lazy", decoding: "async", width: 96, height: 96 }),
        h("span", {}, `#${tokenId}`));
      // One retry after a failed load (a cold start, a restarting server), then leave it.
      const img = el.querySelector("img")!;
      img.addEventListener("error", () => {
        if (img.dataset.retried) return;
        img.dataset.retried = "1";
        window.setTimeout(() => { img.src = `${tokenArtUrl(pieceArtTier(tier), tokenId, true)}&retry=1`; }, 1500);
      });
      el.addEventListener("click", () => toggle(c.id));
      pieceEls.set(c.id, el);
    }
    return el;
  };

  const held = () => ledger.held();
  const tierOfId = (id: string): TierId | undefined => held().find((c) => c.id === id)?.tier;

  const toggle = (id: string) => {
    message = null;
    if (selected.includes(id)) selected = selected.filter((s) => s !== id);
    else {
      const t = tierOfId(id);
      if (!t || !nextTier(t)) return;
      // A different tier starts a new pair rather than refusing the click.
      if (selected.length > 0 && tierOfId(selected[0]!) !== t) selected = [];
      selected = [...selected, id].slice(-2);
    }
    renderPanel();
    renderSelection();
  };

  // ── The ladder strip: every tier, what you hold of it ───────────────────
  const ladder = h("div", { class: "ph-burn-ladder", role: "list" });
  const renderLadder = (counts: Map<TierId, number>) => {
    ladder.replaceChildren(...TIERS.flatMap((t, i) => {
      const n = counts.get(t.id) ?? 0;
      const item = h("span", { class: `ph-burn-rung${n > 0 ? " is-held" : ""}`, role: "listitem" }, chip(t, String(n)));
      return i < TIERS.length - 1 ? [item, h("span", { class: "ph-burn-arrow", "aria-hidden": "true" }, "2 → 1")] : [item];
    }));
  };

  // ── The pieces, grouped by tier ──────────────────────────────────────────
  const groups = h("div", { class: "ph-burn-groups" });
  const renderGroups = (list: PracticeClaim[]) => {
    const byTier = new Map<TierId, PracticeClaim[]>();
    for (const c of list) byTier.set(c.tier, [...(byTier.get(c.tier) ?? []), c]);
    const sections = TIERS.filter((t) => byTier.has(t.id)).map((t) => {
      const pieces = byTier.get(t.id)!;
      const up = nextTier(t.id);
      return h("section", { class: "ph-burn-group", style: `--tier:${t.color}` },
        h("h3", {}, chip(t), h("span", {}, `${pieces.length} held`),
          up ? h("em", {}, `${Math.floor(pieces.length / 2)} burn${Math.floor(pieces.length / 2) === 1 ? "" : "s"} possible`) : h("em", {}, "the top — nothing burns into it")),
        h("div", { class: `ph-burn-grid${up ? "" : " is-top"}` }, ...pieces.map(pieceEl)));
    });
    // Drop cached buttons for pieces that are gone (burned, or another identity).
    const live = new Set(list.map((c) => c.id));
    for (const id of [...pieceEls.keys()]) if (!live.has(id)) pieceEls.delete(id);
    groups.replaceChildren(...sections);
  };

  const renderSelection = () => {
    for (const [id, el] of pieceEls) {
      const on = selected.includes(id);
      el.classList.toggle("is-on", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    }
  };

  // ── The panel: what the pair makes, what it would cost for real ─────────
  const panel = h("aside", { class: "ph-burn-panel", "aria-live": "polite" });
  const burnBtn = h("button", { class: "ph-burn-go", type: "button" }, "Burn them");
  burnBtn.addEventListener("click", () => doBurn());

  const renderPanel = () => {
    const pair = selected.map((id) => held().find((c) => c.id === id)).filter((c): c is PracticeClaim => !!c);
    const tier = pair[0] ? getTier(pair[0].tier) : undefined;
    const up = tier ? nextTier(tier.id) : undefined;
    // replaceChildren takes no nulls; an empty string is an empty text node.
    const msg = message ? h("p", { class: `ph-burn-msg${message.bad ? " is-bad" : ""}` }, message.text) : "";

    if (!tier || !up) {
      burnBtn.disabled = true;
      panel.replaceChildren(
        h("h3", {}, "Pick two of the same tier"),
        h("p", {}, "Burning destroys both. What comes out is one of the next tier up, with traits rolled fresh — it never looks like what went in."),
        msg);
      return;
    }
    if (pair.length < 2) {
      burnBtn.disabled = true;
      panel.replaceChildren(
        h("h3", {}, `Pick one more ${tier.name}`),
        h("p", {}, "Two ", chip(tier), " make one ", chip(up), "."),
        msg);
      return;
    }
    burnBtn.disabled = false;
    const btc = opts.tick?.latest()?.btcUsd ?? null;
    panel.replaceChildren(
      h("h3", {}, "Ready to burn"),
      h("div", { class: "ph-burn-eq" },
        h("span", {}, plural(2, tier)), h("b", { "aria-hidden": "true" }, "→"), chip(up, "1")),
      h("dl", { class: "ph-burn-facts" },
        h("dt", {}, "Ever possible"), h("dd", {}, `${up.maxSupply.toLocaleString("en-US")} ${up.name}s, if every White climbed to here`),
        h("dt", {}, "Live fee"), h("dd", {}, `${fmtSatsUsd(up.upgradeFeeSats, btc)} on the live collection — `, h("strong", {}, "practice burns are free")),
        h("dt", {}, "Live rules"), h("dd", {},
          `Both pieces must be ${UPGRADE_COOLDOWN_HOURS} hours old, and ${up.name} unlocks ${up.unlockDay} day${up.unlockDay === 1 ? "" : "s"} after the mint opens. Practice skips both.`)),
      burnBtn,
      msg);
  };

  const doBurn = () => {
    if (selected.length !== 2) return;
    const was = getTier(tierOfId(selected[0]!) ?? "white")!;
    let made: PracticeClaim;
    try {
      made = ledger.burn(selected[0]!, selected[1]!);
    } catch (err) {
      message = { text: (err as Error).message, bad: true };
      renderPanel();
      return;
    }
    // Counted in the player's stats (fire-and-forget; never throws).
    recordBurn(was.id, made.tier);
    const up = getTier(made.tier)!;
    selected = [];
    message = { text: `Burned 2 ${was.name}s into ${/^[aeiou]/i.test(up.name) ? "an" : "a"} ${up.name} — ${pieceName(made.id)}.`, bad: false };
    // The ledger re-rendered during burn(), before this message existed.
    renderPanel();
    closeReveal?.();
    closeReveal = showReveal(root, {
      claim: made,
      kicker: `Burned 2 ${was.name}s`,
      closeLabel: "Back to the burn",
      onClose: () => { closeReveal = null; burnBtn.focus({ preventScroll: true }); },
    });
  };
  // ── Header and empty state ───────────────────────────────────────────────
  const who = h("p", { class: "ph-burn-who" });
  const empty = h("div", { class: "ph-burn-empty" },
    h("h3", {}, "Nothing to burn yet"),
    h("p", {}, "Every Block Hunt run pays Whites — two for a win, one for a loss. Win a pair, then come back and burn them into an Orange."),
    opts.openApp ? h("button", { class: "ph-burn-go", type: "button", onclick: () => opts.openApp?.("game") }, "Play Block Hunt") : null);

  const intro = h("header", { class: "ph-burn-hero" },
    h("h2", {}, "Burn two, get one"),
    h("p", {}, `Burn two ${COLLECTION} of a tier and one of the next tier is made from them. The two are destroyed — supply only ever goes down — and the new piece rolls its own traits.`),
    ladder,
    who,
    h("p", { class: "ph-burn-practice" }, h("span", {}, "PRACTICE"),
      " These are your practice pieces. Nothing here is minted or inscribed, and none of it carries over when the collection goes live."));

  const body = h("div", { class: "ph-burn-body" }, groups, panel);

  const render = () => {
    const list = held();
    const counts = new Map<TierId, number>();
    for (const c of list) counts.set(c.tier, (counts.get(c.tier) ?? 0) + 1);
    // A selection that no longer exists (burned elsewhere, identity switched) is dropped.
    selected = selected.filter((id) => list.some((c) => c.id === id));
    renderLadder(counts);
    const acct = opts.wallet?.account() ?? null;
    who.textContent = acct
      ? `Pieces held by ${shortAddress(acct.address, 6, 6)}.`
      : "Pieces held in this browser. Connect a wallet to keep them with your address.";
    renderGroups(list);
    renderSelection();
    renderPanel();
    scroll.replaceChildren(intro, list.length ? body : empty);
  };

  const offLedger = ledger.subscribe(render);
  const offWallet = opts.wallet?.subscribe(() => render());
  const offTick = opts.tick?.subscribe(() => { if (selected.length === 2) renderPanel(); });

  return () => {
    closeReveal?.();
    offLedger();
    offWallet?.();
    offTick?.();
    pieceEls.clear();
    host.replaceChildren();
  };
}
