/**
 * The claim reveal — what you see when a run finally pays out a Black.
 *
 * This is the payoff moment for the whole game loop, so it gets a real beat:
 * the panel opens, the card lands, its stats fill in. The card art is
 * deliberately procedural (the mite silhouette on a hex field, tier colour, a
 * serial) rather than a placeholder image, so it looks finished without
 * pretending to be final artwork.
 *
 * **Honesty rule.** This runs on the live site while nothing is deployed, so
 * the reveal states plainly, on the card itself and beneath it, that nothing
 * was minted. Do not remove that line to make the moment cleaner — a reward
 * screen that reads as real when it is not is the one thing this must never do.
 */
import { BLACK, ORE_PER_BLACK, type Tier } from "../../econ/tokenomics";
import type { PracticeBlack } from "../session/ledger";
import { h, prefersReducedMotion } from "../util/dom";

export interface RevealOptions {
  /** The claim being shown. */
  black: PracticeBlack;
  /** Which tier it is. Blacks today; the forge will pass others later. */
  tier?: Tier;
  /** Runs it took to get here, shown as a small bit of context. */
  runs?: number;
  onClose?: () => void;
}

/** A field of faint hex characters behind the mite — the collection's texture. */
function hexField(seedStr: string): HTMLElement {
  const glyphs = "0123456789abcdef";
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
  let out = "";
  for (let i = 0; i < 220; i++) out += glyphs[Math.floor(next() * 16)];
  return h("div", { class: "ph-reveal-hex", "aria-hidden": "true" }, out);
}

/**
 * Mounts the reveal into `host` (the game window body). Returns a teardown that
 * is safe to call twice.
 */
export function showReveal(host: HTMLElement, opts: RevealOptions): () => void {
  const tier = opts.tier ?? BLACK;
  const reduced = prefersReducedMotion();

  const card = h("div", { class: "ph-reveal-card", style: `--tier:${tier.color}` },
    hexField(opts.black.id),
    h("img", { class: "ph-reveal-mite", src: "/assets/brand/parasite-white-512.png", alt: "" }),
    h("div", { class: "ph-reveal-tier" }, tier.name),
    h("div", { class: "ph-reveal-serial" }, opts.black.id),
    h("div", { class: "ph-reveal-stats" },
      h("div", {}, h("span", {}, "Weight"), h("b", {}, String(tier.weight))),
      h("div", {}, h("span", {}, "Ore spent"), h("b", {}, opts.black.ore.toLocaleString("en-US"))),
      h("div", {}, h("span", {}, "Forges into"), h("b", {}, "2 → Orange"))),
    h("div", { class: "ph-reveal-stamp" }, "PRACTICE — NOT MINTED"));

  const close = h("button", { class: "ph-game-btn", type: "button" }, "Back to the shaft");

  const panel = h("div", { class: "ph-reveal-panel" },
    h("p", { class: "ph-reveal-kicker" }, "You mined enough ore"),
    h("h2", { class: "ph-reveal-title" }, "A Black"),
    card,
    h("p", { class: "ph-reveal-note" },
      opts.runs != null ? `${ORE_PER_BLACK.toLocaleString("en-US")} ore over ${opts.runs} ${opts.runs === 1 ? "run" : "runs"}. ` : "",
      h("strong", {}, "Nothing was minted."),
      " The collection is not live — no contract is deployed and the chain is not final. This is what the moment will look like."),
    close);

  const root = h("div", { class: "ph-reveal", role: "dialog", "aria-modal": "true", "aria-label": "You mined a Black" }, panel);
  if (reduced) root.classList.add("is-still");
  host.append(root);
  // Let the browser paint the start state before the entrance transition.
  requestAnimationFrame(() => root.classList.add("is-on"));

  let closed = false;
  const teardown = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    root.remove();
    opts.onClose?.();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); teardown(); }
  };
  document.addEventListener("keydown", onKey, true);
  close.addEventListener("click", teardown);
  close.focus();

  return teardown;
}
