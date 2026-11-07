/**
 * The BTC Hunters art, drawn on demand.
 *
 *   GET /art/<Tier>/<id>.svg             a token exactly as it rolls
 *   GET /art/<Tier>/<id>.svg?eyes=Ring   the same token wearing a look: any of
 *                                        fill, field, mouth, eyes, mult, hood, rig
 *   GET /art/<Tier>/<Fill>.svg?token=N   the older spelling of ?fill= on token N
 *   ...&view=face                        a close-up of the face
 *   ...&still=1                          no animation (thumbnails, reduced motion)
 *
 * A picture is a pure function of its URL, so nothing is stored: it is built
 * when asked for (a few milliseconds), kept in a small in-memory cache, and
 * cached hard at the edge. Every name is checked against the catalog rather
 * than sanitised, so a request cannot be walked into anything but a known
 * tier and known traits.
 */
import express from "express";
import rateLimit from "express-rate-limit";
import { compose } from "../art/engine.js";
import {
  ART_VERSION, FACE_VIEWBOX, LOOK_AXES, MAX_ART_TOKEN, isArtTier, lookOptions, rollTraits, tierFills,
  type ArtLook, type ArtTier,
} from "../art/catalog.js";

const CACHE_MAX = 400;
const cache = new Map<string, string>();

/** Least-recently-used: a hit moves to the back, the front is evicted. */
function remember(key: string, build: () => string): string {
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const svg = build();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, svg);
  return svg;
}

/** A token id from a URL segment or query value, or null if it is not one. */
function tokenId(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= MAX_ART_TOKEN ? n : null;
}

/** The look a query asks for, or the first axis it names a trait that does not exist on. */
function lookFrom(query: express.Request["query"], tier: ArtTier): { look: ArtLook } | { bad: string } {
  const look: ArtLook = {};
  for (const axis of LOOK_AXES) {
    const raw = query[axis];
    if (raw === undefined) continue;
    if (typeof raw !== "string") return { bad: axis };
    const value = axis === "mult" ? Number(raw) : raw;
    if (!lookOptions(axis, tier).includes(value)) return { bad: axis };
    (look as Record<string, string | number>)[axis] = value;
  }
  return { look };
}

function draw(tier: ArtTier, id: number, look: ArtLook, still: boolean, face: boolean): string {
  const t = rollTraits(id, tier);
  const svg = compose({
    tokenId: id,
    tier,
    fill: look.fill ?? t.fill,
    field: look.field ?? t.field,
    mouth: look.mouth ?? t.mouth,
    eyes: look.eyes ?? t.eyes,
    mult: look.mult ?? t.mult,
    hood: look.hood,
    rig: look.rig,
    animated: !still,
  });
  // The close-up is the same drawing seen through a smaller window.
  return face ? svg.replace(/viewBox="[^"]*"/, `viewBox="${FACE_VIEWBOX}"`) : svg;
}

export function artRouter(): express.Router {
  const r = express.Router();

  // The gallery asks for a handful of pictures per click, which the site-wide
  // 120/min cap would throttle. Drawing is cheap and cached, so this one is
  // generous, and it is still a cap.
  r.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false }));

  r.get("/:tier/:file", (req, res) => {
    const { tier, file } = req.params;
    if (!isArtTier(tier) || !file.endsWith(".svg")) {
      res.status(404).type("text").send("unknown tier");
      return;
    }
    const name = file.slice(0, -4);
    const still = req.query.still === "1";
    if (req.query.view !== undefined && req.query.view !== "face") {
      res.status(400).type("text").send("unknown view");
      return;
    }
    const face = req.query.view === "face";

    const asked = lookFrom(req.query, tier);
    if ("bad" in asked) {
      res.status(400).type("text").send(`unknown ${asked.bad}`);
      return;
    }
    const look = asked.look;

    // A number is a token; anything else must be one of this tier's fills, worn by ?token=N.
    let id = tokenId(name);
    if (id === null) {
      if (!tierFills(tier).includes(name)) {
        res.status(404).type("text").send("unknown fill");
        return;
      }
      look.fill = name;
      id = req.query.token === undefined ? 1 : tokenId(req.query.token);
      if (id === null) {
        res.status(400).type("text").send("bad token");
        return;
      }
    }

    const token = id;
    const key = [tier, token, ...LOOK_AXES.map((a) => look[a] ?? "-"), still ? 1 : 0, face ? 1 : 0].join("|");
    const svg = remember(key, () => draw(tier, token, look, still, face));
    // Versioned URLs (the desktop always sends ?v=) never change; anything else
    // might, the next time the art does.
    res.set("Cache-Control", req.query.v === String(ART_VERSION)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=300, s-maxage=86400");
    res.type("image/svg+xml").send(svg);
  });

  // Nothing under /art falls through to the desktop gate or the site's 404 page.
  r.use((_req, res) => { res.status(404).type("text").send("not found"); });
  return r;
}
