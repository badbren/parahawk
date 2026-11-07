/**
 * The Snipers trait catalog — every category, every trait, every odd.
 *
 * Ported from RH Sniper (pfp.js + pfplab.js, 2026-10-22) when the collection
 * moved to Parahawk. The drawing lives in engine.ts and figure.ts; this file is
 * everything a viewer needs to KNOW about a token without drawing it: which
 * tiers exist, which fills each tier owns, the odds on every axis, and the roll
 * that turns a token id into its traits. The desktop imports this directly, so
 * the Collection window can show odds and roll tokens without shipping the
 * renderer, and the two can never disagree because there is only one table.
 *
 * Determinism is the contract. A token's picture is a pure function of its id
 * and tier, rebuilt on demand and never stored, so nothing here may change the
 * order or the arithmetic of a roll without changing every token's art. The
 * functions below are the originals, line for line; art.test.ts proves the
 * port rolls exactly what RH Sniper rolled.
 */

/**
 * The collection's name, and what one of them is called. Renamed from RH
 * Sniper's "Snipers" when the collection became Bitcoin ordinals; the name is
 * in every SVG's title, so changing it is an art change (bump ART_VERSION).
 */
export const COLLECTION = "BTC Hunters";
export const COLLECTION_ITEM = "BTC Hunter";

/**
 * Bump when the art changes. Art URLs carry it, so browsers and the CDN fetch
 * the new picture instead of serving a cached old one. art.test.ts pins a hash
 * of reference renders and fails until this moves with the art.
 *
 *   1  RH Sniper's art, ported byte for byte
 *   2  renamed BTC Hunters (title and label text only; no drawing moved)
 */
export const ART_VERSION = 2;

/**
 * The ladder, bottom to top. The tier IS the laser colour, so rank reads at a
 * glance from across a timeline. Red sits above Blue on purpose.
 */
export const ART_TIERS = ["White", "Orange", "Green", "Blue", "Red", "Prismatic"] as const;
export type ArtTier = (typeof ART_TIERS)[number];

export const isArtTier = (s: string): s is ArtTier => (ART_TIERS as readonly string[]).includes(s);

/** One row of an odds table: a trait and its weight. Weights in a table sum to 100. */
export type OddsTable<T = string> = ReadonlyArray<readonly [T, number]>;

// ── Per-token randomness ─────────────────────────────────────────────────────

/** Deterministic per-token randomness. Same id in, same picture out, forever. */
export function tokenRng(tokenId: number): () => number {
  // xorshift seeded by the id, mixed so neighbouring ids look unrelated
  let s = (tokenId * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

/** Weighted pick. Weights are relative, so they read as rarity directly. */
export function weighted<T>(rand: () => number, table: OddsTable<T>): T {
  const total = table.reduce((n, [, w]) => n + w, 0);
  let r = rand() * total;
  for (const [name, w] of table) { if ((r -= w) < 0) return name; }
  return table[table.length - 1]![0];
}

// ── The figure's own traits ──────────────────────────────────────────────────

/**
 * The first trait roll, from the original figure. Hood and rig still change the
 * silhouette; eyes, angle and ground were superseded by the axes further down
 * but are still ROLLED, in this order, because they consume the random stream —
 * drop one and every token's hood and rig would move.
 */
export const FIGURE_TRAITS = {
  eyes:   [["Graffiti X", 55], ["Visor Slit", 25], ["Crosshair", 20]],
  angle:  [["Raised", 58], ["Steep", 27], ["Level", 15]],
  hood:   [["Standard", 60], ["Peaked", 25], ["Heavy", 15]],
  rig:    [["Webbing", 48], ["Plated", 32], ["Stripped", 20]],
  ground: [["Reticle", 55], ["Grid", 28], ["Void", 17]],
} as const satisfies Record<string, OddsTable>;

export type FigureTraits = { -readonly [K in keyof typeof FIGURE_TRAITS]: string };

/** Roll every figure trait for a token id. */
export function traitsOf(tokenId: number): FigureTraits {
  const rand = tokenRng(tokenId);
  const t = {} as FigureTraits;
  for (const key of Object.keys(FIGURE_TRAITS) as Array<keyof FigureTraits>) t[key] = weighted(rand, FIGURE_TRAITS[key]);
  return t;
}

// ── Fills: what the body is made of ──────────────────────────────────────────

/**
 * Which fills belong to which tier.
 *
 * A tier's set is EXCLUSIVE — a Weft only ever exists on a White, a Coil only
 * on a Green. That buys two things a shared pool cannot:
 *
 *   - the tier becomes readable from structure, not just colour. A greyscale
 *     screenshot of a Blue still says Blue, because only Blues oscillate.
 *   - upgrading always changes the look completely. Burning two Oranges into a
 *     Green cannot hand back something that looks like what you burned, so the
 *     reward is visible instead of being a hue shift.
 *
 * Ordered commonest first, so the table reads top to bottom as common to rare
 * against FILL_WEIGHTS.
 */
export const TIER_FILLS: Record<ArtTier, readonly string[]> = {
  White:     ["Weft", "Barcode", "Ladder", "Stitch", "Drift"],
  Orange:    ["Waveform", "Contour", "Circuitry", "Chevron", "Filament"],
  Green:     ["Nest", "Ripple", "Coil", "Maze", "Sprawl"],
  Blue:      ["Lattice", "Rings", "Lissajous", "Pulse", "Crystal"],
  Red:       ["Hatch", "Shear", "Splinter", "Rupture", "Shard"],
  Prismatic: ["Moire", "Mesh", "Cascade", "Starburst", "Tangle"],
};

/** Within a tier the five are weighted 33 / 26 / 19 / 12 / 5; the combination takes 4 and the jackpot 1. */
export const FILL_WEIGHTS = [33, 26, 19, 12, 5] as const;

/**
 * The 1% jackpot, on every tier, named per tier because each tier breaks in
 * the idiom of its own family. All six force the Totality field, so rolling
 * the jackpot IS the whole look — one event, one number, unmistakable at
 * thumbnail size, instead of a product of three weights nobody can point at.
 */
export const UNIVERSAL_FILL = "Shatter";
export const TIER_UNIVERSAL: Record<ArtTier, string> = {
  White:     "Cleave",
  Orange:    "Arcflash",
  Green:     "Sunder",
  Blue:      "Shiver",
  Red:       "Shatter",
  Prismatic: "Nova",
};
export const UNIVERSAL_ODDS = 1;
export const UNIVERSAL_FIELD = "Totality";

export const universalFor = (tier: string): string => TIER_UNIVERSAL[tier as ArtTier] || UNIVERSAL_FILL;
export const isUniversal = (name: string, tier: string): boolean => name === universalFor(tier);

/**
 * The combination fill: the tier's whole set layered into one token, at 4%.
 * A different name per tier because it is a different THING per tier — a Red
 * one shares no geometry with a Blue one, so one name would advertise a
 * collision that does not exist.
 */
export const COMPOSITE_FILL = "Composite";
export const TIER_COMPOSITE: Record<ArtTier, string> = {
  White:     "Weave",
  Orange:    "Assembly",
  Green:     "Thicket",
  Blue:      "Harmonic",
  Red:       "Debris",
  Prismatic: "Manifold",
};
export const COMPOSITE_ODDS = 4;

export const compositeFor = (tier: string): string => TIER_COMPOSITE[tier as ArtTier] || COMPOSITE_FILL;
export const isComposite = (name: string, tier: string): boolean =>
  name === compositeFor(tier) || name === COMPOSITE_FILL;

/** A tier's fill table: its own five, then the combination, then the jackpot. Sums to 100. */
export const fillOddsFor = (tier: string): OddsTable =>
  (TIER_FILLS[tier as ArtTier] || TIER_FILLS.Orange)
    .map((n, i): readonly [string, number] => [n, FILL_WEIGHTS[i]!])
    .concat([[compositeFor(tier), COMPOSITE_ODDS], [universalFor(tier), UNIVERSAL_ODDS]]);

export const fillWeightOf = (tier: string, fill: string): number =>
  (fillOddsFor(tier).find((e) => e[0] === fill) || [, 33])[1];

/** The seven fills a tier can roll, commonest first. */
export const tierFills = (tier: string): string[] =>
  [...(TIER_FILLS[tier as ArtTier] || []), compositeFor(tier), universalFor(tier)];

// ── Multiplicity: how many times the fill's pattern is instanced ─────────────

/**
 * The most of each tier that could ever exist — the burn ladder's ceilings.
 *
 * Multiplicity odds are solved per tier for a COUNT (about ten 4x in every
 * tier) rather than set flat, because a flat percentage does not mean the same
 * thing on a rung of 40,000 as on a rung of 1,250. These are art constants on
 * purpose: they feed the roll, so tying them to the live supply would let a
 * supply change silently re-roll every token. art.test.ts checks they still
 * match the tokenomics ceilings.
 */
export const TIER_CEILING: Record<ArtTier, number> = {
  White: 40000, Orange: 20000, Green: 10000,
  Blue: 5000,   Red: 2500,     Prismatic: 1250,
};

export const multOddsFor = (tier: string): OddsTable<number> => {
  const ceil = TIER_CEILING[tier as ArtTier] || 40000;
  const p4 = Math.min(1.0,  100000 / ceil / 100);
  const p3 = Math.min(5.0,  600000 / ceil / 100);
  const p2 = Math.min(18.0, 3000000 / ceil / 100);
  return [[1, 100 - p2 - p3 - p4], [2, p2], [3, p3], [4, p4]];
};

// ── Field, mouth, eyes ───────────────────────────────────────────────────────

/** What is behind the figure. Totality is not here: it only ever arrives with a jackpot fill. */
export const FIELD_ODDS: OddsTable = [
  ["Reticle",   25],
  ["Motes",     21],
  ["Strata",    19],
  ["Tunnel",    14],
  ["Swarm",      9],
  ["Spectrum",   7],
  ["Broadcast",  4],   // Swarm and Spectrum together
  ["Rain",       1],   // the only tokens that get hash rain at all
];

/** The jaw: one wide slot, then glyphs across it. */
export const MOUTH_ODDS: OddsTable = [
  ["Grill",  30],
  ["Static", 22],
  ["Fanged", 18],
  ["Cipher", 14],
  ["Weld",   12],
  ["Sealed",  4],
];

/** Graffiti X stays dominant on purpose: it is the face of the collection. */
export const EYE_ODDS: OddsTable = [
  ["Graffiti X", 46],
  ["Crosshair",  16],
  ["Visor Slit", 13],
  ["Shutter",    10],
  ["Fracture",    7],
  ["Ring",        5],
  ["Slash",       3],
];

export interface AxisOdds {
  fill: OddsTable;
  field: OddsTable;
  mouth: OddsTable;
  eyes: OddsTable;
  mult: OddsTable<number>;
}

/** Every axis's table for one tier. Only `fill` and `mult` differ between tiers. */
export const oddsFor = (tier: string): AxisOdds => ({
  fill: fillOddsFor(tier), field: FIELD_ODDS, mouth: MOUTH_ODDS, eyes: EYE_ODDS,
  mult: multOddsFor(tier),
});

export interface RolledTraits {
  fill: string;
  field: string;
  mouth: string;
  eyes: string;
  mult: number;
}

/**
 * Roll a token's traits from its id — taken at creation, which for everything
 * above White means the moment two tokens are burned. The axes are rolled
 * independently, so one exact combination is the PRODUCT of its odds; the
 * headline rate is the fill's, and oddsOf() gives the combination's.
 */
export function rollTraits(tokenId: number, tier: string): RolledTraits {
  const r = tokenRng(tokenId ^ 0x9e37);
  const O = oddsFor(tier || "Orange");
  return {
    fill:  weighted(r, O.fill),
    field: weighted(r, O.field),
    mouth: weighted(r, O.mouth),
    eyes:  weighted(r, O.eyes),
    mult:  weighted(r, O.mult),
  };
}

/** Odds of one exact combination, as a percentage. Omitted axes are ignored. */
export function oddsOf(t: Partial<RolledTraits>, tier: string): number {
  const O = oddsFor(tier || "Orange");
  const w = (axis: keyof AxisOdds, n: string | number) =>
    ((O[axis] as OddsTable<string | number>).find((e) => e[0] === n) || [, 0])[1];
  return (Object.keys(t) as Array<keyof RolledTraits>)
    .filter((k) => O[k])
    .reduce((p, k) => p * (w(k, t[k]!) / 100), 1) * 100;
}

// ── A whole token ────────────────────────────────────────────────────────────

/** Everything that decides how one token looks, exactly as the engine draws it. */
export interface SniperTraits extends RolledTraits {
  tier: ArtTier;
  hood: string;
  rig: string;
}

/**
 * The full trait set for a token. The field is the one the picture SHOWS: a
 * jackpot fill forces Totality, whatever the field roll said.
 */
export function sniperTraits(tokenId: number, tier: ArtTier): SniperTraits {
  const t = rollTraits(tokenId, tier);
  const f = traitsOf(tokenId);
  return {
    tier,
    ...t,
    field: isUniversal(t.fill, tier) ? UNIVERSAL_FIELD : t.field,
    hood: f.hood,
    rig: f.rig,
  };
}

// ── Where the pictures live ──────────────────────────────────────────────────

/** Token ids the art route will draw. Any integer works; this keeps the cache key space sane. */
export const MAX_ART_TOKEN = 1_000_000_000;

/**
 * A look: a token with some of its traits swapped, which is what the
 * Collection window draws when you click a trait. An axis left out keeps what
 * the token rolled. Totality is not a field you can ask for: it only ever
 * arrives with the jackpot fill, so asking for that fill is how you get it.
 */
export interface ArtLook {
  fill?: string;
  field?: string;
  mouth?: string;
  eyes?: string;
  mult?: number;
  hood?: string;
  rig?: string;
}

/** The axes a look can swap, in the order they appear in a URL. */
export const LOOK_AXES = ["fill", "field", "mouth", "eyes", "mult", "hood", "rig"] as const;
export type LookAxis = (typeof LOOK_AXES)[number];

/** Hood and rig: the figure's own roll, and the only two of its traits still drawn. */
export const HOOD_ODDS: OddsTable = FIGURE_TRAITS.hood;
export const RIG_ODDS: OddsTable = FIGURE_TRAITS.rig;

/** Every value an axis can take on a tier — what the art route accepts and the window lists. */
export function lookOptions(axis: LookAxis, tier: string): ReadonlyArray<string | number> {
  switch (axis) {
    case "fill":  return tierFills(tier);
    case "field": return FIELD_ODDS.map((e) => e[0]);
    case "mouth": return MOUTH_ODDS.map((e) => e[0]);
    case "eyes":  return EYE_ODDS.map((e) => e[0]);
    case "mult":  return multOddsFor(tier).map((e) => e[0]);
    case "hood":  return HOOD_ODDS.map((e) => e[0]);
    case "rig":   return RIG_ODDS.map((e) => e[0]);
  }
}

/** The square a face close-up crops to, in the art's 1000-unit frame. */
export const FACE_VIEWBOX = "240 190 520 520";

/** A token wearing a look: /art/<Tier>/<id>.svg?eyes=Ring&mult=3 — no look is the token as it rolls. */
export function lookArtUrl(
  tier: ArtTier,
  tokenId: number,
  look: ArtLook = {},
  opts: { still?: boolean; face?: boolean } = {},
): string {
  const q: string[] = [];
  for (const axis of LOOK_AXES) {
    const v = look[axis];
    if (v !== undefined) q.push(`${axis}=${encodeURIComponent(String(v))}`);
  }
  if (opts.face) q.push("view=face");
  if (opts.still) q.push("still=1");
  q.push(`v=${ART_VERSION}`);
  return `/art/${tier}/${tokenId}.svg?${q.join("&")}`;
}

/** A token exactly as it rolls: /art/<Tier>/<id>.svg */
export const tokenArtUrl = (tier: ArtTier, tokenId: number, still = false): string =>
  lookArtUrl(tier, tokenId, {}, { still });

/**
 * A token wearing a chosen fill. The route still answers the older
 * /art/<Tier>/<Fill>.svg?token=<id> spelling; this builds the look spelling so
 * a thumbnail and the same picture in the big preview share one cache entry.
 */
export const fillArtUrl = (tier: ArtTier, fill: string, tokenId = 1, still = false): string =>
  lookArtUrl(tier, tokenId, { fill }, { still });

/**
 * The traits a token shows while wearing a look. The jackpot fill forces
 * Totality, and taking it off gives back the field the token actually rolled
 * (not Totality, even if the token rolled the jackpot itself).
 */
export function lookTraits(tokenId: number, tier: ArtTier, look: ArtLook = {}): SniperTraits {
  const base = sniperTraits(tokenId, tier);
  const t: SniperTraits = { ...base };
  for (const axis of LOOK_AXES) {
    const v = look[axis];
    if (v !== undefined) (t as unknown as Record<string, string | number>)[axis] = v;
  }
  t.field = isUniversal(t.fill, tier) ? UNIVERSAL_FIELD : (look.field ?? rollTraits(tokenId, tier).field);
  return t;
}

/**
 * Odds of a token showing exactly these traits, as a percentage, across every
 * axis that is drawn: oddsOf()'s five plus hood and rig. A jackpot's field is
 * part of the fill, so it is not counted twice.
 */
export function lookOdds(t: SniperTraits): number {
  const { fill, field, mouth, eyes, mult } = t;
  const rolled = isUniversal(fill, t.tier) ? { fill, mouth, eyes, mult } : { fill, field, mouth, eyes, mult };
  const w = (table: OddsTable, name: string) => (table.find((e) => e[0] === name) || [, 0])[1] / 100;
  return oddsOf(rolled, t.tier) * w(HOOD_ODDS, t.hood) * w(RIG_ODDS, t.rig);
}

// ── What each trait is ───────────────────────────────────────────────────────

/** Each tier's fills share one idea, so a tier reads from structure even in greyscale. */
export const TIER_FAMILY: Record<ArtTier, string> = {
  White:     "Rigid — everything runs on the grid it is made of.",
  Orange:    "Signal — traces, routes and waves.",
  Green:     "Growth — everything spreads, branches or coils.",
  Blue:      "Oscillation — everything repeats.",
  Red:       "Fracture — everything breaks.",
  Prismatic: "All of them — every tier's colour on separate strands, never blended.",
};

export const FILL_NOTES: Record<string, string> = {
  // White
  Weft:      "Horizontal scanlines whose spacing tightens and loosens.",
  Barcode:   "Vertical bars, widths drawn from a small set, so it scans as code.",
  Ladder:    "Two rails with rungs between them, repeated across the body.",
  Stitch:    "Short crossing dashes on a grid — cross-stitch.",
  Drift:     "Vertical traces that wander sideways, like a seismograph.",
  Weave:     "All five White fills layered into one body.",
  Cleave:    "The jackpot. Axis-aligned splits with no wander — it breaks like a pane, along its own grid.",
  // Orange
  Waveform:  "Stacked sine waves, each with its own frequency and phase.",
  Contour:   "The silhouette eroded over and over — a topographic map of the figure.",
  Circuitry: "Traces routed on eight directions only, pads at every turn. Reads as a board.",
  Chevron:   "Repeating V bands marching across the body.",
  Filament:  "Strands whose heading drifts, so they braid instead of ricocheting.",
  Assembly:  "All five Orange fills layered into one body.",
  Arcflash:  "The jackpot. A trace routing itself across the body at right angles until it shorts.",
  // Green
  Nest:      "Contour rings, each one offset and turned a little.",
  Ripple:    "Concentric circles from several sources, overlapping.",
  Coil:      "Tight spirals, each unwinding from its own centre.",
  Maze:      "A backtracking walk on the cell grid. Every path is legal.",
  Sprawl:    "A branching tree, rooted in the floor and inside the skull.",
  Thicket:   "All five Green fills layered into one body.",
  Sunder:    "The jackpot. Splits that branch — it cracks the way a root grows.",
  // Blue
  Lattice:   "A fixed triangular mesh. The calmest fill, identical on every token.",
  Rings:     "Concentric circles on one centre.",
  Lissajous: "Two oscillations at right angles.",
  Pulse:     "Flat traces with sudden spikes — an EKG across the body.",
  Crystal:   "Straight rays from a few nucleation points, chorded tip to tip.",
  Harmonic:  "All five Blue fills layered into one body.",
  Shiver:    "The jackpot. Chords displaced by a sine along their length, so the break oscillates.",
  // Red
  Hatch:     "Parallel hatching whose angle changes band by band.",
  Shear:     "Slip planes that step at a fault and carry on displaced.",
  Splinter:  "Short segments aligned to one slowly turning flow field.",
  Rupture:   "Impact fracture: cracks run out from a hit and die where the body ends.",
  Shard:     "Long chords that all pass near the centre — radial fracture.",
  Debris:    "All five Red fills layered into one body.",
  Shatter:   "The jackpot. Jagged chords whose direction resets every few steps — cracked glass.",
  // Prismatic
  Moire:     "Two ring families on offset centres. The interference is the point.",
  Mesh:      "Every site joined to its near neighbours — a wire frame.",
  Cascade:   "Chevrons nested down the body, each wider than the last.",
  Starburst: "Rays from one centre, every one a different length.",
  Tangle:    "A small-step random walk trapped in the body. Controlled scribble.",
  Manifold:  "All five Prismatic fills layered — every hue and every structure at once.",
  Nova:      "The jackpot. Every chord from a single origin: the top rung does not crack, it detonates.",
};

export const FIELD_NOTES: Record<string, string> = {
  Reticle:   "A scope, off-centre on purpose so it is not a bullseye.",
  Motes:     "Drifting lights.",
  Strata:    "Drifting scan bands over a nearly empty frame.",
  Tunnel:    "Real perspective, converging level with the eyes.",
  Swarm:     "Motes at nearly three times the density.",
  Spectrum:  "A live level meter along the bottom edge.",
  Broadcast: "Swarm and Spectrum together — stars over the wavelength bars.",
  Rain:      "Hash rain. The only tokens that get it at all.",
  Totality:  "Every field at once — tunnel, scope, strata, rain, motes and bars. Only ever arrives with a jackpot fill.",
};

export const MOUTH_NOTES: Record<string, string> = {
  Grill:  "An even row of X's, no jitter. The clean default.",
  Static: "Every X at its own angle — a snarl without teeth.",
  Fanged: "A big X at each corner, small ones between.",
  Cipher: "X glyphs alternating with hex characters.",
  Weld:   "Eleven small X's, jittered. The busiest mouth.",
  Sealed: "No glyphs, one bar across the slot. A sealed mask.",
};

export const EYE_NOTES: Record<string, string> = {
  "Graffiti X": "The face of the collection, sprayed on and lit from behind.",
  Crosshair:    "A plus, filling the same box.",
  "Visor Slit": "A horizontal band. The calmest of them.",
  Shutter:      "Two stacked bars with a gap — a shuttered visor.",
  Fracture:     "An X with a notch knocked out of one arm. Cracked, not a Y.",
  Ring:         "A hollow square. Reads as a lens rather than an eye.",
  Slash:        "One diagonal instead of two, both eyes leaning the same way.",
};

export const HOOD_NOTES: Record<string, string> = {
  Standard: "The plain cowl.",
  Peaked:   "A tall, narrow point at the crown.",
  Heavy:    "A wider, deeper cowl.",
};

export const RIG_NOTES: Record<string, string> = {
  Webbing:  "Two long slots cut into the chest, where the straps run.",
  Plated:   "Four square cut-outs across the chest.",
  Stripped: "Nothing cut — a bare chest.",
};

export const MULT_NOTE =
  "How many times the fill's pattern is instanced. A 3x Starburst fires from three points instead of one. " +
  "Odds are solved per tier for roughly the same COUNT of each in every tier, so a 4x is about as scarce wherever you find one.";
