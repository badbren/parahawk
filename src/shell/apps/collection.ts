/**
 * The Collection window — every BTC Hunter there can be.
 *
 * Six tiers, seven fills each, and every other trait with its odds, its note
 * and its picture: click any trait and the big preview shows the same Hunter
 * wearing it, or pick a number to meet a different one. Everything on screen
 * comes from src/art/catalog.ts (traits, odds, notes) and
 * src/econ/tokenomics.ts (what a tier costs), so this window cannot disagree
 * with the art or with the rules.
 *
 * Performance rule — the owner's Edge rasterises in software: the preview is
 * the only animated picture on screen, and only while motion is on. Fill
 * thumbnails are stills, loaded lazily, and nothing in a grid animates.
 *
 * Honesty rule: nothing is inscribed yet, and the header says so.
 */
import "./collection.css";
import {
  ART_TIERS, COLLECTION, COLLECTION_ITEM, EYE_NOTES, EYE_ODDS, FIELD_NOTES, FIELD_ODDS, FILL_NOTES,
  HOOD_NOTES, HOOD_ODDS, LOOK_AXES, MOUTH_NOTES, MOUTH_ODDS, MULT_NOTE, RIG_NOTES, RIG_ODDS, TIER_CEILING,
  TIER_FAMILY, UNIVERSAL_FIELD, UNIVERSAL_ODDS, fillOddsFor, isComposite, isUniversal, lookArtUrl, lookOdds,
  lookTraits, multOddsFor, sniperTraits, tierFills, universalFor,
  type ArtLook, type ArtTier, type LookAxis, type OddsTable, type SniperTraits,
} from "../../art/catalog";
import {
  PLAY_PRICE_USD, TIERS, WHITES_PER_LOSS, WHITES_PER_WIN, allInUsd, fmtDollars, fmtUsdSats, type Tier,
} from "../../econ/tokenomics";
import type { TickFeed } from "../data/tick";
import { h } from "../util/dom";
import { motionReduced } from "../util/motion";

/**
 * The Hunter the window opens on. #1 rolls the showcase look on every tier —
 * Strata, Grill, Graffiti X, 1x, Standard hood, Webbing — which is how RH
 * Sniper's gallery and its art bench always presented the collection.
 */
const SUBJECT = 1;

/** Hunter numbers run one per White that can ever be minted. */
const MAX_NUMBER = TIER_CEILING.White;

const tierOf = (t: ArtTier): Tier => TIERS.find((x) => x.name === t)!;
const n0 = (n: number) => n.toLocaleString("en-US");

/** "33%" / "4.8%" / "0.75%" / "0.025%" — enough digits to stay honest about the rare ones. */
function pct(p: number): string {
  if (p >= 10) return `${Math.round(p)}%`;
  if (p >= 1) return `${+p.toFixed(1)}%`;
  return `${+p.toPrecision(2)}%`;
}

/** How many of a tier's ceiling a percentage comes to. */
const count = (p: number, tier: ArtTier): string => "≈" + n0(Math.round((p / 100) * TIER_CEILING[tier]));

/** "309" / "12,400" / "4.2 million" / "3.1 billion". */
function oneIn(n: number): string {
  if (n >= 1e9) return `${+(n / 1e9).toPrecision(2)} billion`;
  if (n >= 1e6) return `${+(n / 1e6).toPrecision(2)} million`;
  return n0(Math.round(n));
}

function traitName(axis: LookAxis, v: string | number): string {
  switch (axis) {
    case "mult": return `${v}x`;
    case "fill": return `${v} fill`;
    default: return `${v} ${axis}`;
  }
}

// ── The trait lists ──────────────────────────────────────────────────────────

interface RowSpec { value: string | number; label: string; pct: number; note: string; tag?: string }

interface SectionSpec {
  axis: Exclude<LookAxis, "fill">;
  title: string;
  blurb: string;
  rows(tier: ArtTier): RowSpec[];
}

const named = (table: OddsTable, notes: Record<string, string>): RowSpec[] =>
  table.map(([value, w]) => ({ value, label: value, pct: w, note: notes[value] ?? "" }));

const MULT_NOTES: Record<number, string> = {
  1: "The fill's pattern, drawn once.",
  2: "Drawn twice, from two origins.",
  3: "Three origins — a 3x Starburst fires from three points.",
  4: "Four origins. About ten of these in every tier.",
};

const SECTIONS: SectionSpec[] = [
  {
    axis: "field",
    title: "Field",
    blurb: "What is behind the figure. Totality only ever arrives with a jackpot fill.",
    rows: () => [
      ...named(FIELD_ODDS, FIELD_NOTES),
      { value: UNIVERSAL_FIELD, label: UNIVERSAL_FIELD, pct: UNIVERSAL_ODDS, note: FIELD_NOTES[UNIVERSAL_FIELD] ?? "", tag: "With the jackpot" },
    ],
  },
  {
    axis: "eyes",
    title: "Eyes",
    blurb: "Graffiti X stays dominant on purpose: it is the face of the collection. Clicking an eye zooms to the face.",
    rows: () => named(EYE_ODDS, EYE_NOTES),
  },
  {
    axis: "mouth",
    title: "Mouth",
    blurb: "The jaw: one wide slot, then glyphs across it.",
    rows: () => named(MOUTH_ODDS, MOUTH_NOTES),
  },
  {
    axis: "mult",
    title: "Multiplicity",
    blurb: MULT_NOTE,
    rows: (tier) => multOddsFor(tier).map(([m, w]) => ({ value: m, label: `${m}x`, pct: w, note: MULT_NOTES[m] ?? "" })),
  },
  {
    axis: "hood",
    title: "Hood",
    blurb: "Part of the silhouette. Hood and rig come from the number alone, so they never change with the tier.",
    rows: () => named(HOOD_ODDS, HOOD_NOTES),
  },
  {
    axis: "rig",
    title: "Rig",
    blurb: "What is cut into the chest.",
    rows: () => named(RIG_ODDS, RIG_NOTES),
  },
];

// ── The window ───────────────────────────────────────────────────────────────

export function mountCollection(host: HTMLElement, tick?: TickFeed): () => void {
  const state = {
    tier: "White" as ArtTier,
    /** The Hunter on show. */
    subject: SUBJECT,
    /** Traits the viewer picked. Every Hunter shown rolls all of them. */
    picks: {} as ArtLook,
    /**
     * Set only when no Hunter numbered 1–40,000 rolls every pick: the subject
     * is shown wearing them instead, and the caption says so.
     */
    look: {} as ArtLook,
    face: false,
    notice: "",
  };
  let btcUsd: number | null = tick?.latest()?.btcUsd ?? null;

  // ── Header and tier chips ──────────────────────────────────────────────────
  const head = h("header", { class: "ph-col-head" },
    h("div", { class: "ph-col-title" },
      h("h1", {}, COLLECTION),
      h("span", { class: "ph-col-badge", title: "Nothing has been inscribed. Every picture here is drawn by the real art code." },
        "Preview — not inscribed yet")),
    h("p", {},
      `${COLLECTION} will be Bitcoin ordinals. Whites are only ever minted by playing Block Hunt; burn two of a colour `,
      "for one of the next, six colours up to Prismatic. Every Hunter is drawn from its number — the same number always ",
      "draws the same Hunter, and nothing is stored. Click any trait to meet a random Hunter that has it; click again for another."));

  // Only White's number is a supply. Above it, how many exist is up to the burners.
  const tierButtons = ART_TIERS.map((t) => {
    const tier = tierOf(t);
    const below = TIERS[tier.rung - 1];
    return h("button", {
      type: "button",
      class: "ph-col-tier",
      style: `--c:${tier.color}`,
      title: below ? `${t} — made by burning two ${below.name}s` : `${t} — ${n0(MAX_NUMBER)}, every one won in Block Hunt`,
      onclick: () => setTier(t),
    },
    h("i", { class: "ph-col-swatch", style: `background:${tier.swatch}`, "aria-hidden": "true" }),
    t,
    below ? null : h("small", {}, n0(MAX_NUMBER)));
  });
  const tiersNav = h("nav", { class: "ph-col-tiers", "aria-label": "Tiers" }, ...tierButtons);

  // ── The stage: one big picture and what it is ──────────────────────────────
  const art = h("img", { class: "ph-col-art", alt: "", width: 1000, height: 1000 });
  const frame = h("div", { class: "ph-col-frame" }, art);
  const nameEl = h("div", { class: "ph-col-name" });
  const lineEl = h("div", { class: "ph-col-line" });
  const picksEl = h("div", { class: "ph-col-picks" });
  const oddsEl = h("div", { class: "ph-col-odds" });
  const noticeEl = h("div", { class: "ph-col-swap" });
  const cap = h("div", { class: "ph-col-cap", "aria-live": "polite" }, nameEl, lineEl, picksEl, oddsEl, noticeEl);

  const viewFull = h("button", { type: "button", class: "ph-col-btn", onclick: () => setFace(false) }, "Full body");
  const viewFace = h("button", { type: "button", class: "ph-col-btn", onclick: () => setFace(true) }, "Face");
  const numIn = h("input", {
    class: "ph-col-num", type: "number", min: 1, max: MAX_NUMBER, value: SUBJECT, "aria-label": "Hunter number",
  });
  numIn.addEventListener("keydown", (e) => { if (e.key === "Enter") showNumber(); });
  const controls = h("div", { class: "ph-col-controls" },
    h("div", { class: "ph-col-seg", role: "group", "aria-label": "View" }, viewFull, viewFace),
    h("label", { class: "ph-col-pick" }, "Hunter #", numIn),
    h("button", { type: "button", class: "ph-col-btn", onclick: showNumber }, "Show"),
    h("button", { type: "button", class: "ph-col-btn", title: "Another random Hunter with everything you picked", onclick: () => reroll() }, "Random"));
  const stage = h("div", { class: "ph-col-stage" }, frame, cap, controls);

  // ── The traits ─────────────────────────────────────────────────────────────
  const tierCard = h("section", { class: "ph-col-tiercard" });
  const fillGrid = h("div", { class: "ph-col-fills", role: "group", "aria-label": "Fill" });
  const fillSec = h("section", { class: "ph-col-sec" },
    h("h2", {}, "Fill"),
    h("p", { class: "ph-col-blurb" },
      "What the body is made of. Each colour owns its own five — a Weft only ever exists on a White — so a tier reads ",
      "from its structure even in greyscale. Then a combination of all five at 4%, and a 1% jackpot that takes over ",
      "the whole picture. Shown here on the showcase Hunter, #1."),
    fillGrid);

  const sectionEls = SECTIONS.map((spec) => ({
    spec,
    rows: h("div", { class: "ph-col-rows", role: "group", "aria-label": spec.title }),
    forced: h("p", { class: "ph-col-forced", hidden: true }),
  }));

  const traitsPane = h("div", { class: "ph-col-traits" },
    tierCard,
    fillSec,
    h("div", { class: "ph-col-secs" }, ...sectionEls.map(({ spec, rows, forced }) =>
      h("section", { class: "ph-col-sec" }, h("h2", {}, spec.title), h("p", { class: "ph-col-blurb" }, spec.blurb), forced, rows))),
    h("p", { class: "ph-col-foot" },
      "Every trait is rolled on its own from the Hunter's number, so the odds of one exact combination are its traits' ",
      "odds multiplied together. The ≈ counts are out of the most of that tier that could ever exist."));

  const root = h("div", { class: "ph-col" }, head, tiersNav, h("div", { class: "ph-col-body" }, stage, traitsPane));
  host.append(root);

  // ── State changes ──────────────────────────────────────────────────────────

  /** The picks that can show: under the jackpot the field is always Totality, so a field pick sits out. */
  function livePicks(): ArtLook {
    const p = { ...state.picks };
    if (p.fill !== undefined && isUniversal(p.fill, state.tier)) delete p.field;
    return p;
  }

  function rollsAll(id: number, picks: ArtLook): boolean {
    const t = sniperTraits(id, state.tier);
    return LOOK_AXES.every((a) => picks[a] === undefined || t[a] === picks[a]);
  }

  /** Meet a new random Hunter that rolls every pick — a different one each time, wherever there is one. */
  function reroll(): void {
    const picks = livePicks();
    const start = 1 + Math.floor(Math.random() * MAX_NUMBER);
    let found: number | null = null;
    for (let i = 0; i < MAX_NUMBER; i++) {
      const id = ((start - 1 + i) % MAX_NUMBER) + 1;
      if (id !== state.subject && rollsAll(id, picks)) { found = id; break; }
    }
    if (found === null && rollsAll(state.subject, picks)) found = state.subject;
    if (found !== null) {
      state.subject = found;
      state.look = {};
      state.notice = "";
    } else {
      state.subject = start;
      state.look = picks;
      state.notice = `No ${state.tier} numbered 1–${n0(MAX_NUMBER)} rolls all of that, so this is #${n0(start)} wearing it.`;
    }
    numIn.value = String(state.subject);
    render();
  }

  function pick(axis: LookAxis, value: string | number): void {
    // Totality is the jackpot's field, so asking for it means asking for the jackpot.
    if (axis === "field" && value === UNIVERSAL_FIELD) { axis = "fill"; value = universalFor(state.tier); }
    (state.picks as Record<string, string | number>)[axis] = value;
    state.face = axis === "eyes" || axis === "mouth";
    reroll();
  }

  function unpick(axis: LookAxis): void {
    delete state.picks[axis];
    // The Hunter on show still rolls whatever is left, so it stays — unless it was only wearing the picks.
    if (Object.keys(state.look).length) reroll(); else render();
  }

  function clearPicks(): void {
    state.picks = {};
    if (Object.keys(state.look).length) reroll(); else render();
  }

  function setTier(t: ArtTier): void {
    // A picked fill keeps its place in the line-up: the commonest stays the commonest.
    if (state.picks.fill !== undefined && t !== state.tier) {
      const fill = tierFills(t)[tierFills(state.tier).indexOf(state.picks.fill)];
      if (fill === undefined) delete state.picks.fill; else state.picks.fill = fill;
    }
    state.tier = t;
    // Every click on a tier, even the one already open, meets a new Hunter.
    reroll();
  }

  function showNumber(): void {
    const n = Number(numIn.value);
    if (!Number.isInteger(n) || n < 1 || n > MAX_NUMBER) {
      state.notice = `Hunter numbers run from 1 to ${n0(MAX_NUMBER)}.`;
      render();
      return;
    }
    state.subject = n;
    state.picks = {};
    state.look = {};
    state.face = false;
    state.notice = "";
    render();
  }

  function setFace(face: boolean): void {
    state.face = face;
    render();
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  let wanted = "";
  /** Swap the picture only once the new one is ready, and only if no newer click has landed since. */
  function showArt(url: string, alt: string): void {
    if (url === wanted) return;
    wanted = url;
    frame.classList.add("is-loading");
    const next = new Image();
    next.src = url;
    const done = () => {
      if (wanted !== url) return;
      art.src = url;
      art.alt = alt;
      frame.classList.remove("is-loading");
    };
    next.decode().then(done, done);
  }

  function renderTierCard(): void {
    const tier = tierOf(state.tier);
    const below = TIERS[tier.rung - 1];
    const all = allInUsd(tier);
    const range = `${fmtDollars(all.lo)}–${fmtDollars(all.hi)}`;
    const facts: Array<[string, string, string]> = below
      ? [
          ["Made from", `2 ${below.name}s + ${fmtUsdSats(tier.upgradeFeeUsd, btcUsd)}`, "Both are burned for good."],
          ["At most", n0(TIER_CEILING[state.tier]), "If every White climbed exactly this far."],
          ["Whites inside", n0(tier.whites), `${n0(tier.whites)} Whites went into every one.`],
          ["All in", range, `Its Whites through the game, plus ${fmtDollars(tier.feesInsideUsd)} of upgrade fees.`],
        ]
      : [
          ["Minted by", `A run of Block Hunt: ${fmtUsdSats(PLAY_PRICE_USD, btcUsd)}`,
            `A win mints ${WHITES_PER_WIN}, a loss mints ${WHITES_PER_LOSS}. There is no other way in.`],
          ["At most", n0(MAX_NUMBER), "Every one of them won in the game."],
          ["All in", range, "50¢ each when you win, $1 when you lose."],
        ];
    tierCard.replaceChildren(
      h("h2", {}, h("i", { class: "ph-col-swatch", style: `background:${tier.swatch}`, "aria-hidden": "true" }), tier.name),
      h("p", { class: "ph-col-family" }, TIER_FAMILY[state.tier]),
      h("dl", { class: "ph-col-facts" }, ...facts.map(([k, v, note]) =>
        h("div", { class: "ph-col-fact" }, h("dt", {}, k), h("dd", {}, v), h("dd", { class: "ph-col-fact-note" }, note)))));
  }

  /** The fill gallery is the showcase Hunter in each of the tier's fills; it changes with the tier, not with every click. */
  let fillsFor = "";
  function renderFills(now: SniperTraits, picks: ArtLook): void {
    if (state.tier !== fillsFor) {
      fillsFor = state.tier;
      const own = sniperTraits(SUBJECT, state.tier).fill;
      fillGrid.replaceChildren(...fillOddsFor(state.tier).map(([name, w]) => {
        const tag = isUniversal(name, state.tier) ? "Jackpot" : isComposite(name, state.tier) ? "All five" : "";
        const src = lookArtUrl(state.tier, SUBJECT, name === own ? {} : { fill: name }, { still: true });
        return h("button", {
          type: "button", class: "ph-col-fill", "data-fill": name,
          title: `A random ${state.tier} with ${name} — click again for another`,
          onclick: () => pick("fill", name),
        },
        h("img", { src, alt: "", loading: "lazy", decoding: "async", width: 1000, height: 1000 }),
        h("span", { class: "ph-col-fill-name" }, h("b", {}, name), h("span", { class: "ph-col-pct" }, pct(w))),
        tag ? h("span", { class: "ph-col-tag" }, tag) : null,
        h("span", { class: "ph-col-fill-note" }, FILL_NOTES[name] ?? ""),
        h("span", { class: "ph-col-count" }, `${count(w, state.tier)} of ${n0(TIER_CEILING[state.tier])}`));
      }));
    }
    for (const b of Array.from(fillGrid.children) as HTMLElement[]) {
      const v = b.dataset.fill;
      b.classList.toggle("is-on", v === now.fill);
      b.classList.toggle("is-picked", v === picks.fill);
      b.setAttribute("aria-pressed", String(v === picks.fill));
    }
  }

  function renderSections(now: SniperTraits, picks: ArtLook): void {
    const jackpot = isUniversal(now.fill, state.tier);
    for (const { spec, rows, forced } of sectionEls) {
      const list = spec.rows(state.tier);
      const max = Math.max(...list.map((r) => r.pct));
      const isField = spec.axis === "field";
      rows.replaceChildren(...list.map((r) => {
        const on = now[spec.axis] === r.value;
        const picked = picks[spec.axis] === r.value || (isField && r.value === UNIVERSAL_FIELD && jackpot && picks.fill === now.fill);
        return h("button", {
          type: "button",
          class: `ph-col-row${on ? " is-on" : ""}${picked ? " is-picked" : ""}`,
          "aria-pressed": String(picked),
          disabled: isField && jackpot && r.value !== UNIVERSAL_FIELD,
          title: picked ? "Click again for another" : `A random ${state.tier} with ${traitName(spec.axis, r.value)}`,
          onclick: () => pick(spec.axis, r.value),
        },
        h("span", { class: "ph-col-mark", "aria-hidden": "true" }, on ? "●" : ""),
        h("span", { class: "ph-col-row-name" }, r.label, r.tag ? h("span", { class: "ph-col-tag" }, r.tag) : null),
        h("span", { class: "ph-col-pct" }, pct(r.pct)),
        h("span", { class: "ph-col-count" }, count(r.pct, state.tier)),
        h("span", { class: "ph-col-note" }, r.note),
        h("i", { class: "ph-col-bar", style: `width:${((r.pct / max) * 100).toFixed(1)}%`, "aria-hidden": "true" }));
      }));
      forced.textContent = isField && jackpot
        ? `The ${now.fill} jackpot brings Totality with it — pick another fill to change the field.`
        : "";
      forced.hidden = !forced.textContent;
    }
  }

  function renderStage(now: SniperTraits, picks: ArtLook): void {
    const url = lookArtUrl(state.tier, state.subject, state.look, { still: motionReduced(), face: state.face });
    showArt(url, `${COLLECTION_ITEM} #${state.subject}, ${state.tier} tier: ${now.fill} fill, ${now.field} field, ` +
      `${now.eyes} eyes, ${now.mouth} mouth, ${now.mult}x, ${now.hood} hood, ${now.rig} rig`);
    frame.classList.toggle("is-face", state.face);
    for (const [b, on] of [[viewFull, !state.face], [viewFace, state.face]] as const) {
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    }

    nameEl.replaceChildren(`${COLLECTION_ITEM} #${n0(state.subject)} `, h("span", {}, state.tier));
    const parts: Array<[LookAxis, string]> = [
      ["fill", now.fill], ["field", now.field], ["eyes", `${now.eyes} eyes`], ["mouth", `${now.mouth} mouth`],
      ["mult", `${now.mult}x`], ["hood", `${now.hood} hood`], ["rig", `${now.rig} rig`],
    ];
    lineEl.replaceChildren(...parts.flatMap(([axis, label], i) => {
      const el = h("span", picks[axis] !== undefined ? { class: "is-picked" } : {}, label);
      return i ? [" · ", el] : [el];
    }));

    const picked = LOOK_AXES.filter((a) => picks[a] !== undefined);
    picksEl.hidden = !picked.length;
    picksEl.replaceChildren(...(picked.length ? [
      h("span", { class: "ph-col-picks-label" }, "Picked:"),
      ...picked.map((a) => h("button", { type: "button", class: "ph-col-chip", title: `Stop picking ${traitName(a, picks[a]!)}`, onclick: () => unpick(a) },
        traitName(a, picks[a]!), h("b", { "aria-hidden": "true" }, "×"))),
      ...(picked.length > 1 ? [h("button", { type: "button", class: "ph-col-btn", onclick: clearPicks }, "Clear all")] : []),
    ] : []));

    const p = lookOdds(now);
    const ceiling = TIER_CEILING[state.tier];
    const expected = (p / 100) * ceiling;
    const share = expected >= 1.5 ? `about ${n0(Math.round(expected))} of all ${n0(ceiling)} ${state.tier}s would share it`
      : expected >= 0.5 ? `about one in all ${n0(ceiling)} ${state.tier}s`
      : `rarer than one in all ${n0(ceiling)} ${state.tier}s`;
    oddsEl.textContent = `This exact combination: 1 in ${oneIn(100 / p)} — ${share}.`;

    noticeEl.hidden = !state.notice;
    noticeEl.textContent = state.notice;
  }

  function render(): void {
    const tier = tierOf(state.tier);
    root.style.setProperty("--c", tier.color);
    root.style.setProperty("--swatch", tier.swatch);
    tierButtons.forEach((b, i) => {
      const on = ART_TIERS[i] === state.tier;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    const now = lookTraits(state.subject, state.tier, state.look);
    const picks = livePicks();
    renderTierCard();
    renderFills(now, picks);
    renderSections(now, picks);
    renderStage(now, picks);
  }

  // USD prices gain their sats once a BTC price lands, and follow it after.
  const unsubscribe = tick?.subscribe((t) => {
    if (t.btcUsd === btcUsd) return;
    btcUsd = t.btcUsd;
    renderTierCard();
  });

  render();
  return () => {
    unsubscribe?.();
    wanted = "";
    host.replaceChildren();
  };
}
