/**
 * The reveal — the moment a piece turns over.
 *
 * Every piece the practice ledger hands out comes through here: the Whites a
 * Block Hunt run pays (one for a loss, two for a win, shown one after the
 * other) and whatever a burn makes. It plays like opening a pack: the card
 * flies in back-first, spins a couple of full turns, slows, and lands face-up
 * on the art; the tier's colour flashes behind it; then what it rolled comes in
 * line by line, each trait with its odds.
 *
 * Timeline, one piece: 0–0.2s the overlay comes up · 0.2–2.6s the spin ·
 * 2.6s landing flash, the art goes live · 2.75–3.5s the traits, a line at a
 * time · ~3.7s the button. Clicking the card (or Enter) skips the spin.
 *
 * It fits whatever it is shown over — the Burn window, the game at its default
 * size and at its smallest — with the button always on screen: the card's size
 * is solved from the room left over (reveal.css), and the spin scales with it.
 *
 * A consolation (a run that ended with the lamp out) lands with a calmer,
 * dimmer flash than a win or a burn, so a loss never plays like a jackpot.
 *
 * Built for the slowest machine that runs it — the owner's Edge with hardware
 * acceleration off: during the spin exactly one element moves, and only by
 * transform; the art is the still SVG until it lands (an animated SVG would
 * repaint the card every frame of the spin); nothing blurs, and no shadow
 * animates. With the desktop's motion setting off, or the OS asking for less
 * motion, there is no spin — the card is simply there.
 *
 * **Honesty rule.** This runs on the live site while nothing is minted, so
 * every card carries a PRACTICE — NOT MINTED ribbon and the panel says plainly
 * that nothing was inscribed. Do not remove either to make the moment cleaner —
 * a reward screen that reads as real when it is not is the one thing this must
 * never do.
 */
import { WHITE, getTier, type Tier } from "../../econ/tokenomics";
import {
  COLLECTION,
  COLLECTION_ITEM,
  EYE_ODDS,
  FIELD_ODDS,
  MOUTH_ODDS,
  TIER_CEILING,
  fillWeightOf,
  isArtTier,
  isComposite,
  isUniversal,
  multOddsFor,
  oddsOf,
  rollTraits,
  sniperTraits,
  tokenArtUrl,
  type ArtTier,
  type OddsTable,
} from "../../art/catalog";
import type { PracticeClaim } from "../session/ledger";
import { h } from "../util/dom";
import { motionReduced } from "../util/motion";
import "./reveal.css";

/**
 * What the reveal needs to know about a piece: its serial, and its tier (none
 * means White). A whole PracticeClaim fits, and so does a bare preview object.
 */
export type RevealPiece = Pick<PracticeClaim, "id"> & Partial<Omit<PracticeClaim, "id">>;

/** How the landing feels: a win or a burn, or the dig's consolation prize. */
export type RevealTone = "triumph" | "consolation";

export interface RevealOptions {
  /** One piece… */
  claim?: RevealPiece;
  /** …or several, revealed one after another (a won run pays two). */
  claims?: RevealPiece[];
  /** Overrides every piece's tier. Kept for older callers. */
  tier?: Tier;
  /** Runs played so far, shown as a little context under the card. */
  runs?: number;
  /** The small line over the title, e.g. "Block found — 2 Whites" or "Burned 2 Whites". */
  kicker?: string;
  /** The label of the button that closes the reveal. */
  closeLabel?: string;
  /**
   * The landing. Defaults to a consolation when the kicker says the lamp went
   * out ("Lamp out — …"), and a triumph otherwise.
   */
  tone?: RevealTone;
  onClose?: () => void;
}

/**
 * A practice serial as a collection number: 1 to 40,000 (the White mint, from
 * the catalog), stable for that serial, and the same number the art is drawn
 * from — so the picture always matches the name on it. The serial is hashed
 * first (MurmurHash3's finaliser) so neighbouring serials land far apart.
 */
export function pieceTokenId(id: string): number {
  const n = parseInt(id.replace(/^#/, ""), 16);
  if (!Number.isFinite(n)) return 1;
  // Every step ends in >>> 0: XOR returns a signed 32-bit int, and a negative
  // number here would ask the art route for a token that does not exist.
  let x = n >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x % TIER_CEILING.White) + 1;
}

/** A piece's name, as the card and the Burn window print it. */
export const pieceName = (id: string): string => `${COLLECTION_ITEM} #${pieceTokenId(id)}`;

/** The art's name for a tokenomics tier. */
export const pieceArtTier = (tier: Tier): ArtTier => (isArtTier(tier.name) ? tier.name : "White");

/** A piece's tier object: the caller's override, else its own, else White. */
const tierOf = (piece: RevealPiece, override?: Tier): Tier => override ?? getTier(piece.tier ?? "white") ?? WHITE;

const article = (word: string): string => (/^[aeiou]/i.test(word) ? "An" : "A");

/** "33%" / "4.8%" / "0.36%" / "0.025%" — enough digits to stay honest about small odds. */
function pct(p: number): string {
  if (p >= 10) return `${Math.round(p)}%`;
  if (p >= 1) return `${p.toFixed(1).replace(/\.0$/, "")}%`;
  if (p >= 0.1) return `${p.toFixed(2)}%`;
  return `${p.toFixed(3)}%`;
}

const weightIn = <T>(table: OddsTable<T>, name: T): number => (table.find((e) => e[0] === name) ?? [name, 0])[1];

/** Faint hex characters for the card back, stable per piece. */
function hexGlyphs(seedStr: string): string {
  const glyphs = "0123456789abcdef";
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
  let out = "";
  for (let i = 0; i < 900; i++) out += glyphs[Math.floor(next() * 16)];
  return out;
}

/** The card back's emblem: a scope over an X, drawn in the tier's colour. Static markup. */
const MARK_SVG =
  '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-linecap="square">' +
  '<circle cx="32" cy="32" r="25" stroke-width="2.5" opacity=".6"/>' +
  '<path d="M32 1v13M32 50v13M1 32h13M50 32h13" stroke-width="2.5" opacity=".6"/>' +
  '<path d="M22 22l20 20M42 22L22 42" stroke-width="6"/></svg>';

interface TraitRow { label: string; value: string; odds?: string; note?: string; cls?: string }

/** What the piece rolled, axis by axis, each with its odds — and the odds of the whole look. */
function traitRows(tokenId: number, tier: ArtTier): TraitRow[] {
  const t = sniperTraits(tokenId, tier);
  const rolled = rollTraits(tokenId, tier);
  const jackpot = isUniversal(t.fill, tier);
  const fillW = fillWeightOf(tier, t.fill);
  const fillNote = jackpot
    ? "The 1% jackpot — it brings the Totality field with it."
    : isComposite(t.fill, tier) ? `All five ${tier} fills in one body.` : undefined;
  // A jackpot's field is forced, so it is not part of the roll's odds.
  const exact = jackpot
    ? oddsOf({ fill: rolled.fill, mouth: rolled.mouth, eyes: rolled.eyes, mult: rolled.mult }, tier)
    : oddsOf(rolled, tier);
  return [
    { label: "Fill", value: t.fill, odds: pct(fillW), ...(fillNote ? { note: fillNote } : {}),
      ...(jackpot ? { cls: "is-jackpot" } : fillW <= 5 ? { cls: "is-rare" } : {}) },
    { label: "Field", value: t.field, odds: jackpot ? "jackpot" : pct(weightIn(FIELD_ODDS, t.field)) },
    { label: "Eyes", value: t.eyes, odds: pct(weightIn(EYE_ODDS, t.eyes)) },
    { label: "Mouth", value: t.mouth, odds: pct(weightIn(MOUTH_ODDS, t.mouth)) },
    { label: "Multiplicity", value: `${t.mult}×`, odds: pct(weightIn(multOddsFor(tier), t.mult)),
      ...(t.mult > 1 ? { cls: "is-rare" } : {}) },
    { label: "Exact look", value: exact > 0 ? `1 in ${Math.round(100 / exact).toLocaleString("en-US")}` : "—",
      odds: exact > 0 ? pct(exact) : "", cls: "is-total" },
  ];
}

const renderRow = (r: TraitRow): HTMLElement =>
  h("div", { class: `ph-reveal-trait${r.cls ? " " + r.cls : ""}`, ...(r.note ? { title: r.note } : {}) },
    h("span", {}, r.label), h("b", {}, r.value), r.odds ? h("em", {}, r.odds) : null, r.note ? h("small", {}, r.note) : null);

/** The card's full design height; the spin's distances scale from it. */
const CARD_DESIGN_H = 316;

/**
 * The spin, as keyframes: it flies in from deep and low over the first fifth,
 * turns two and a half times from back to face, decelerating all the way, and
 * thumps slightly as it lands. Sampled densely so the deceleration is a curve,
 * not a few straight segments. `k` scales the distances to the card's size, so
 * a small card does not fly in from proportionally further away.
 *
 * Transform only, never opacity: an opacity animation on the spinning element
 * makes Chrome flatten its 3D, and the card then shows its face mirrored where
 * the back should be.
 */
function spinFrames(k: number): Keyframe[] {
  const frames: Keyframe[] = [];
  const N = 30;
  for (let i = 0; i <= N; i++) {
    const p = i / N;
    const fly = Math.min(1, p / 0.18);
    const flyE = 1 - (1 - fly) ** 3;
    const rot = 180 + 900 * (1 - (1 - p) ** 3.2);
    const thump = p > 0.86 ? Math.sin(((p - 0.86) / 0.14) * Math.PI) * 0.045 : 0;
    frames.push({
      offset: p,
      transform: `translate3d(0, ${((1 - flyE) * 70 * k).toFixed(1)}px, ${((1 - flyE) * -380 * k).toFixed(1)}px) ` +
        `rotateY(${rot.toFixed(2)}deg) scale(${(0.55 + 0.45 * flyE + thump).toFixed(4)})`,
    });
  }
  return frames;
}

/** The landing flash, per tone: a win blooms out hard; a consolation glows and settles. */
const FLASH: Record<RevealTone, { frames: Keyframe[]; ms: number }> = {
  triumph: {
    frames: [{ opacity: 0, transform: "scale(.55)" }, { opacity: 1, transform: "scale(1)", offset: 0.25 }, { opacity: 0, transform: "scale(1.35)" }],
    ms: 700,
  },
  consolation: {
    frames: [{ opacity: 0, transform: "scale(.85)" }, { opacity: 0.32, transform: "scale(.95)", offset: 0.4 }, { opacity: 0, transform: "scale(1.04)" }],
    ms: 1000,
  },
};

const SPIN_MS = 2400;
const ROW_STEP_MS = 120;

/**
 * Mounts the reveal into `host` (a window body or the game's stage — anything
 * positioned). Returns a teardown that is safe to call twice.
 */
export function showReveal(host: HTMLElement, opts: RevealOptions): () => void {
  const pieces: RevealPiece[] = opts.claims?.length ? opts.claims : opts.claim ? [opts.claim] : [];
  if (pieces.length === 0) {
    opts.onClose?.();
    return () => undefined;
  }
  const still = motionReduced();
  const tone: RevealTone = opts.tone ?? (/^\s*lamp out\b/i.test(opts.kicker ?? "") ? "consolation" : "triumph");

  const kicker = h("p", { class: "ph-reveal-kicker" },
    opts.kicker ?? (pieces.length > 1 ? `${pieces.length} pieces, fresh out of the shaft` : "Fresh out of the shaft"));
  const title = h("h2", { class: "ph-reveal-title" });
  const count = h("p", { class: "ph-reveal-count" });

  const burst = h("div", { class: "ph-reveal-burst", "aria-hidden": "true" });
  const hex = h("div", { class: "ph-reveal-hex", "aria-hidden": "true" });
  const mark = h("div", { class: "ph-reveal-mark", "aria-hidden": "true" });
  mark.innerHTML = MARK_SVG;
  const back = h("div", { class: "ph-reveal-face is-back", "aria-hidden": "true" },
    hex, mark, h("div", { class: "ph-reveal-brand" }, COLLECTION, h("small", {}, "practice pack")));
  const art = h("img", { class: "ph-reveal-art", alt: "", width: 240, height: 240, decoding: "async" });
  const name = h("span", { class: "ph-reveal-name" });
  const chip = h("span", { class: "ph-reveal-chip" });
  const front = h("div", { class: "ph-reveal-face is-front" },
    art, h("div", { class: "ph-reveal-band" }, name, chip), h("div", { class: "ph-reveal-stamp" }, "PRACTICE — NOT MINTED"));
  const card = h("div", { class: "ph-reveal-card", role: "img", title: "Click to skip the spin" }, front, back);
  const stage = h("div", { class: "ph-reveal-stage" }, burst, card);

  const traits = h("div", { class: "ph-reveal-traits" });
  // Short hosts keep only the strong line (reveal.css); the honesty line always stays.
  const note = h("p", { class: "ph-reveal-note" },
    opts.runs != null ? h("span", { class: "ph-reveal-runs" }, `${opts.runs.toLocaleString("en-US")} ${opts.runs === 1 ? "run" : "runs"} played. `) : null,
    h("strong", {}, "Practice — nothing was minted or inscribed."),
    h("span", { class: "ph-reveal-more" }, ` ${COLLECTION} are not live yet; this is what the moment will look like.`));
  const next = h("button", { class: "ph-reveal-btn", type: "button", hidden: true }, "Next →");
  const close = h("button", { class: "ph-reveal-btn", type: "button", hidden: true }, opts.closeLabel ?? "Done");
  const announce = h("p", { class: "ph-sr", "aria-live": "polite" });

  // Head, then the card with what it rolled beside it (or below it, on a tall
  // narrow host), then the button and the honesty line. reveal.css lays it out.
  const panel = h("div", { class: "ph-reveal-panel" },
    h("div", { class: "ph-reveal-head" }, kicker, title, count),
    h("div", { class: "ph-reveal-body" }, stage, traits),
    h("div", { class: "ph-reveal-foot" }, h("div", { class: "ph-reveal-actions" }, next, close), note),
    announce);
  const root = h("div", { class: `ph-reveal is-${tone}`, role: "dialog", "aria-modal": "true", "aria-label": "Reveal", tabindex: -1 }, panel);
  if (still) root.classList.add("is-still");
  // Hidden until its spin begins, so an empty face never shows. Visibility, not
  // opacity — see spinFrames().
  card.style.visibility = still ? "visible" : "hidden";
  host.append(root);
  root.focus({ preventScroll: true });

  let anims: Animation[] = [];
  let timers: number[] = [];
  let landed = false;
  let closed = false;
  let current = 0;
  const clearMotion = () => {
    for (const a of anims) a.cancel();
    anims = [];
    for (const t of timers) clearTimeout(t);
    timers = [];
  };

  const show = (i: number) => {
    clearMotion();
    landed = false;
    current = i;
    const piece = pieces[i]!;
    const tier = tierOf(piece, opts.tier);
    const artTier = pieceArtTier(tier);
    const tokenId = pieceTokenId(piece.id);
    const label = pieceName(piece.id);

    root.style.setProperty("--tier", tier.color);
    burst.classList.toggle("is-prism", tier.id === "prismatic");
    title.textContent = `${article(tier.name)} ${tier.name}`;
    count.textContent = pieces.length > 1 ? `${i + 1} of ${pieces.length}` : "";
    hex.textContent = hexGlyphs(piece.id);
    art.src = tokenArtUrl(artTier, tokenId, true);
    art.alt = `${label}, ${tier.name}`;
    name.textContent = label;
    chip.replaceChildren(h("i", { style: `background:${tier.swatch}`, "aria-hidden": "true" }), tier.name);
    card.setAttribute("aria-label", art.alt);
    const spec = traitRows(tokenId, artTier);
    const rows = spec.map(renderRow);
    traits.replaceChildren(...rows);
    traits.scrollTop = 0;
    next.hidden = true;
    close.hidden = true;
    announce.textContent = "";

    const land = () => {
      if (landed) return;
      landed = true;
      if (!still) {
        // The art goes live — swapped only once loaded, so the face never blanks.
        const live = new Image();
        live.onload = () => { if (!closed && current === i) art.src = live.src; };
        live.src = tokenArtUrl(artTier, tokenId, false);
        anims.push(burst.animate(FLASH[tone].frames, { duration: FLASH[tone].ms, easing: "ease-out" }));
      }
      rows.forEach((row, k) => {
        if (still) row.classList.add("is-in");
        else timers.push(window.setTimeout(() => row.classList.add("is-in"), 150 + k * ROW_STEP_MS));
      });
      const done = () => {
        const more = i + 1 < pieces.length;
        next.hidden = !more;
        close.hidden = more;
        (more ? next : close).focus({ preventScroll: true });
        announce.textContent = `${art.alt}. ${spec.slice(0, 5).map((r) => `${r.label} ${r.value}`).join(", ")}.`;
      };
      if (still) done();
      else timers.push(window.setTimeout(done, 150 + rows.length * ROW_STEP_MS + 200));
    };

    if (still) {
      land();
      return;
    }
    card.style.visibility = "visible";
    const k = Math.max(0.3, stage.getBoundingClientRect().height / CARD_DESIGN_H);
    const spin = card.animate(spinFrames(k), { duration: SPIN_MS, easing: "linear", fill: "both" });
    anims.push(spin);
    spin.finished.then(land, () => undefined);
  };

  /** Jump the spin to its landing — for anyone who has seen it before. */
  const skip = () => { if (!landed) for (const a of anims) if (a.playState === "running") a.finish(); };

  const teardown = () => {
    if (closed) return;
    closed = true;
    clearMotion();
    document.removeEventListener("keydown", onKey, true);
    root.remove();
    opts.onClose?.();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); teardown(); return; }
    if ((ev.key === "Enter" || ev.key === " ") && !landed && root.contains(document.activeElement)) {
      ev.preventDefault();
      skip();
    }
  };
  document.addEventListener("keydown", onKey, true);
  card.addEventListener("click", skip);
  next.addEventListener("click", () => { if (current + 1 < pieces.length) show(current + 1); });
  close.addEventListener("click", teardown);

  // Let the overlay come up first, so it and the spin never animate at once.
  requestAnimationFrame(() => root.classList.add("is-on"));
  if (still) show(0);
  else timers.push(window.setTimeout(() => show(0), 200));

  return teardown;
}
