import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compose } from "./engine.js";
import {
  ART_TIERS, ART_VERSION, EYE_NOTES, EYE_ODDS, FIELD_NOTES, FIELD_ODDS, FIGURE_TRAITS, FILL_NOTES, HOOD_NOTES,
  MOUTH_NOTES, MOUTH_ODDS, RIG_NOTES, TIER_CEILING, TIER_FILLS, UNIVERSAL_FIELD, fillOddsFor, isUniversal,
  lookArtUrl, lookOdds, lookTraits, multOddsFor, oddsOf, rollTraits, sniperTraits, tierFills, tokenArtUrl,
  type ArtTier,
} from "./catalog.js";
import { TIERS } from "../econ/tokenomics.js";
import { artRouter } from "../web/art-routes.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sum = (table: ReadonlyArray<readonly [unknown, number]>) => table.reduce((n, [, w]) => n + w, 0);

/** A token as the art route draws it, straight from the engine. */
const draw = (tier: ArtTier, id: number, animated = false) => {
  const t = rollTraits(id, tier);
  return compose({ tokenId: id, tier, fill: t.fill, field: t.field, mouth: t.mouth, eyes: t.eyes, mult: t.mult, animated });
};

/**
 * Determinism is the contract: a token's picture is a pure function of its id
 * and tier, rebuilt on demand and never stored. These pins fail on ANY change
 * to how a token rolls or draws. If the drawing changed on purpose, bump
 * ART_VERSION in catalog.ts and re-pin both together; if the TRAITS moved,
 * something re-rolled every token in the collection — undo it.
 */
describe("determinism", () => {
  it("the same id and tier always draws the same picture", () => {
    expect(draw("Green", 4242)).toBe(draw("Green", 4242));
    expect(draw("Prismatic", 7, true)).toBe(draw("Prismatic", 7, true));
  });

  it("no token's traits have moved", () => {
    expect(sniperTraits(35, "White")).toEqual({
      tier: "White", fill: "Barcode", field: "Motes", mouth: "Grill", eyes: "Graffiti X", mult: 1, hood: "Standard", rig: "Webbing",
    });
    const table = ART_TIERS.flatMap((tier) => Array.from({ length: 2000 }, (_, i) => sniperTraits(i + 1, tier)));
    expect(sha(JSON.stringify(table))).toBe("756b57a5457985b99389a9c3d1eaad26b49d0cec9e1ec25c7c0ca0a1a52fd159");
  });

  it("the reference renders match the pinned art for this ART_VERSION", () => {
    const renders = ART_TIERS.flatMap((tier) => [draw(tier, 1), draw(tier, 35), draw(tier, 345), draw(tier, 7, true)]);
    expect({ version: ART_VERSION, hash: sha(renders.join("\n")) }).toEqual({ version: 2, hash: "a85542c685cd6456fa8952ad59cd97a634c772f3096b757efb3bde7c9ce61ac1" });
  });
});

describe("catalog", () => {
  it("every tier owns seven fills, its own and nobody else's", () => {
    const seen = new Set<string>();
    for (const tier of ART_TIERS) {
      const fills = tierFills(tier);
      expect(fills).toHaveLength(7);
      expect(new Set(fills).size).toBe(7);
      for (const f of TIER_FILLS[tier]) {
        expect(seen.has(f)).toBe(false);
        seen.add(f);
      }
    }
  });

  it("every odds table sums to 100", () => {
    for (const tier of ART_TIERS) {
      expect(sum(fillOddsFor(tier))).toBe(100);
      expect(sum(multOddsFor(tier))).toBeCloseTo(100, 9);
    }
    for (const table of [FIELD_ODDS, MOUTH_ODDS, EYE_ODDS, ...Object.values(FIGURE_TRAITS)]) expect(sum(table)).toBe(100);
  });

  it("every trait has a note", () => {
    for (const tier of ART_TIERS) for (const f of tierFills(tier)) expect(FILL_NOTES[f], f).toBeTruthy();
    for (const [f] of FIELD_ODDS) expect(FIELD_NOTES[f], f).toBeTruthy();
    expect(FIELD_NOTES[UNIVERSAL_FIELD]).toBeTruthy();
    for (const [m] of MOUTH_ODDS) expect(MOUTH_NOTES[m], m).toBeTruthy();
    for (const [e] of EYE_ODDS) expect(EYE_NOTES[e], e).toBeTruthy();
    for (const [h] of FIGURE_TRAITS.hood) expect(HOOD_NOTES[h], h).toBeTruthy();
    for (const [r] of FIGURE_TRAITS.rig) expect(RIG_NOTES[r], r).toBeTruthy();
  });

  it("matches the tokenomics ladder: same tiers, same order, ceilings equal to max supply", () => {
    expect(TIERS.map((t) => t.name)).toEqual([...ART_TIERS]);
    for (const t of TIERS) expect(TIER_CEILING[t.name as ArtTier]).toBe(t.maxSupply);
  });

  it("about ten 4x of every tier can ever exist", () => {
    for (const tier of ART_TIERS) {
      const p4 = multOddsFor(tier).find(([m]) => m === 4)![1];
      expect((p4 / 100) * TIER_CEILING[tier]).toBeCloseTo(10, 6);
    }
  });
});

describe("looks", () => {
  it("builds one URL spelling, with the version last", () => {
    expect(tokenArtUrl("White", 35)).toBe(`/art/White/35.svg?v=${ART_VERSION}`);
    expect(lookArtUrl("Red", 9, { eyes: "Visor Slit", mult: 3 }, { still: true, face: true }))
      .toBe(`/art/Red/9.svg?eyes=Visor%20Slit&mult=3&view=face&still=1&v=${ART_VERSION}`);
  });

  it("the jackpot brings Totality, and taking it off gives back the field the token rolled", () => {
    const jackpot = lookTraits(35, "Blue", { fill: "Shiver" });
    expect(jackpot.field).toBe(UNIVERSAL_FIELD);
    expect(lookTraits(35, "Blue", { fill: "Shiver", field: "Rain" }).field).toBe(UNIVERSAL_FIELD);
    // #345 rolls the jackpot on every tier; wearing a plain fill shows its real field roll.
    expect(isUniversal(sniperTraits(345, "Red").fill, "Red")).toBe(true);
    expect(lookTraits(345, "Red", { fill: "Hatch" }).field).toBe(rollTraits(345, "Red").field);
  });

  it("a look's odds are its five rolled axes times hood and rig", () => {
    const t = sniperTraits(35, "White");
    const expected = oddsOf({ fill: t.fill, field: t.field, mouth: t.mouth, eyes: t.eyes, mult: t.mult }, "White") * 0.6 * 0.48;
    expect(lookOdds(t)).toBeCloseTo(expected, 12);
  });

  it("hood and rig swaps change the figure only when asked for", () => {
    const t = rollTraits(35, "Orange");
    const base = { tokenId: 35, tier: "Orange", ...t, animated: false };
    expect(compose({ ...base, hood: undefined, rig: undefined })).toBe(compose(base));
    const heavy = compose({ ...base, hood: "Heavy" });
    expect(heavy).not.toBe(compose(base));
    expect(heavy).toContain("hood: Heavy");
  });
});

describe("the art route", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.use("/art", artRouter());
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/art`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const get = async (path: string) => {
    const r = await fetch(base + path);
    return { status: r.status, type: r.headers.get("content-type") ?? "", cache: r.headers.get("cache-control") ?? "", body: await r.text() };
  };

  it("draws a token as it rolls, and caches hard only when the URL is versioned", async () => {
    const plain = await get("/White/35.svg?still=1");
    expect(plain.status).toBe(200);
    expect(plain.type).toContain("image/svg+xml");
    expect(plain.body).toBe(draw("White", 35));
    expect(plain.cache).not.toContain("immutable");
    expect((await get(`/White/35.svg?still=1&v=${ART_VERSION}`)).cache).toContain("immutable");
    expect((await get("/White/35.svg?still=1&v=999")).cache).not.toContain("immutable");
  });

  it("animates unless asked to hold still", async () => {
    expect((await get("/Blue/7.svg")).body).toContain("<animate");
    expect((await get("/Blue/7.svg?still=1")).body).not.toContain("<animate");
  });

  it("answers both spellings of a chosen fill with the same picture", async () => {
    const older = await get("/White/Weft.svg?token=35&still=1");
    expect(older.status).toBe(200);
    expect(older.body).toBe((await get("/White/35.svg?fill=Weft&still=1")).body);
  });

  it("draws a look and a face close-up", async () => {
    const heavy = await get("/Green/35.svg?hood=Heavy&eyes=Ring&mult=3&still=1");
    expect(heavy.status).toBe(200);
    expect(heavy.body).toContain("hood: Heavy");
    expect((await get("/Green/35.svg?view=face&still=1")).body).toContain('viewBox="240 190 520 520"');
  });

  it("refuses anything that is not a known tier, fill or trait", async () => {
    expect((await get("/Purple/1.svg")).status).toBe(404);
    expect((await get("/White/1.png")).status).toBe(404);
    expect((await get("/White/Coil.svg")).status).toBe(404);          // Coil is a Green fill
    expect((await get("/White/Weft.svg?token=abc")).status).toBe(400);
    expect((await get("/White/35.svg?eyes=Laser")).status).toBe(400);
    expect((await get("/White/35.svg?field=Totality")).status).toBe(400); // only ever arrives with the jackpot
    expect((await get("/White/35.svg?mult=5")).status).toBe(400);
    expect((await get("/White/35.svg?view=side")).status).toBe(400);
    expect((await get("/White/35.svg?fill=Coil")).status).toBe(400);
  });
});
