import { randomUUID } from "node:crypto";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "../config.js";
import { renderOverview } from "./pages/overview.js";
import { hashrateGauge, gaugeScaleFor } from "./gauge.js";
import { renderHistory } from "./pages/history.js";
import { renderAbout } from "./pages/about.js";
import { renderChangelog } from "./pages/changelog.js";
import { renderBadges, renderBadgeHolders } from "./pages/badges.js";
import { renderPotMath } from "./pages/potmath.js";
import { potMathFromOverview, getPotMathTrend } from "../services/potmath.js";
import { potMathCard } from "./potmath-card.js";
import { renderCommunity } from "./pages/community.js";
import { renderLeaving } from "./pages/leaving.js";
import { renderBoard } from "./pages/board.js";
import { renderOrderBooks } from "./pages/order-books.js";
import { renderMarketplace } from "./pages/marketplace.js";
import { renderLinked } from "./pages/linked.js";
import {
  getSession,
  setSession,
  clearSession,
  verifyWalletSignature,
  isValidAddress,
  checkCsrf,
} from "../services/auth.js";
import { linkAccount, unlinkAccount, getCredentials, type Venue } from "../services/linked.js";
import { isVaultReady } from "../services/vault.js";
import { auditDelivery } from "../services/auditor.js";
import { saveWizardOrder } from "../services/wizard-orders.js";
import { nhCheckAuth, nhCreatePool, nhPlaceOrder } from "../data/venues/nicehash-client.js";
import { POOL_TARGETS } from "./marketplace-wizard.js";
import { renderAddress } from "./pages/address.js";
import { getOverview } from "../services/overview.js";
import { getPoolStatsSeries, type PoolWindow } from "../data/parasite.js";
import { getHistory, type Point } from "../services/history.js";
import { POTMATH_CLIENT_JS } from "./potmath-client.js";

/** Keep only the points inside a window; fall back to all if the slice is empty. */
function sliceByWindow(points: Point[], window: PoolWindow): Point[] {
  const spanMs =
    window === "1h" ? 3_600_000 : window === "4h" ? 4 * 3_600_000 : window === "1w" ? 7 * 86_400_000 : 86_400_000;
  const cutoff = Date.now() - spanMs;
  const kept = points.filter((p) => p.t >= cutoff);
  return kept.length ? kept : points;
}

/**
 * Historical series for one /history chart metric over a selectable window.
 * hashrate/users/workers come from parasite.space; hashprice from Parahawk's
 * own store (thin — only moves at difficulty retargets).
 */
async function getPoolHistory(
  metric: string,
  window: string,
): Promise<{ points: Point[]; unit: string; label: string }> {
  const w: PoolWindow = (["1h", "4h", "1d", "1w"] as const).includes(window as PoolWindow)
    ? (window as PoolWindow)
    : "1d";

  if (metric === "hashprice") {
    const h = await getHistory(w === "1w" ? 7 : 1);
    const points = sliceByWindow(h.hashprice, w).map((p) => ({ t: p.t, v: Math.round(p.v) }));
    return { points, unit: "sats/PHd", label: "Refinery hashprice" };
  }

  const series = await getPoolStatsSeries(w);
  if (metric === "users") return { points: series.users, unit: "users", label: "Users online" };
  if (metric === "workers") return { points: series.workers, unit: "workers", label: "Workers online" };
  const points = series.hashrate.map((p) => ({ t: p.t, v: Math.round(p.v * 10) / 10 }));
  return { points, unit: "PH/s", label: "Pool hashrate" };
}

/** Wrap an async page renderer with error handling. */
function page(render: () => Promise<string>) {
  return async (_req: express.Request, res: express.Response) => {
    try {
      // Let Vercel's edge CDN serve the rendered page for ~20s (and stale for a
      // bit while revalidating), so navigating between pages is instant and cold
      // serverless instances don't re-fetch upstream on every hit. All pages are
      // public and their own scripts refresh live bits client-side.
      res.set("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
      res.type("html").send(await render());
    } catch (err) {
      // Log server-side; never echo err.message (it can leak upstream URLs).
      console.error("[page] render failed:", err);
      res.status(500).type("text").send("internal error");
    }
  };
}

export function createServer(): express.Express {
  const app = express();
  app.disable("x-powered-by");

  // Security headers (finding #3). CSP is set explicitly rather than using
  // helmet's strict default because the pages rely on inline <script>/<style>
  // and the Chart.js CDN. Finding #1's jsonForScript is the real XSS fix; this
  // CSP is defense-in-depth.
  // TODO: tighten to nonces / self-host chart.js so we can drop 'unsafe-inline'
  // and the jsdelivr allowance.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'self'"],
        },
      },
      // X-Content-Type-Options: nosniff (helmet default), Referrer-Policy, deny
      // framing, and HSTS (a no-op until behind TLS, safe to include).
      referrerPolicy: { policy: "no-referrer" },
      frameguard: { action: "deny" },
      hsts: { maxAge: 15552000 },
    }),
  );

  // Rate limiting (finding #2): a generous global cap plus a tighter cap on the
  // upstream-fanning /address and /api/* routes.
  const globalLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  const upstreamLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  app.use(globalLimiter);
  app.use("/address", upstreamLimiter);
  app.use("/api", upstreamLimiter);

  // Static assets (wiki images, etc.) served from ./public at /assets.
  app.use("/assets", express.static("public", { maxAge: "1h" }));

  // Form bodies for the /account POST flow (connect / link / unlink).
  app.use(express.urlencoded({ extended: false }));

  app.get("/", page(renderOverview));
  // Just the Pool Hashrate gauge SVG — the homepage swaps this in every 10s so
  // the dial updates often without a full-page reload.
  app.get("/overview/gauge", page(async () => {
    const o = await getOverview();
    const h = o.pool.poolHashratePhs;
    return hashrateGauge({ value: h, max: gaugeScaleFor(h), unit: "PH/s", size: 352 });
  }));
  app.get("/board", page(renderBoard));
  app.get("/badges", page(renderBadges));
  app.get("/badges/:type", async (req, res) => {
    try {
      res.type("html").send(await renderBadgeHolders(req.params.type));
    } catch (err) {
      console.error("[/badges/:type] failed:", err);
      res.status(500).type("text").send("internal error");
    }
  });
  app.get("/marketplace", async (req, res) => {
    try {
      res.set("Cache-Control", "private, no-cache");
      res.type("html").send(await renderMarketplace(getSession(req)));
    } catch (err) {
      console.error("[/marketplace] failed:", err);
      res.status(500).type("text").send("internal error");
    }
  });

  // ── Wallet identity + Linked Accounts (non-custodial key vault) ────────────
  const KNOWN_VENUES = new Set<Venue>(["nicehash", "miningrigrentals"]);
  // Reject cross-site form posts (defense-in-depth alongside the CSRF token).
  function sameOrigin(req: express.Request): boolean {
    const origin = req.get("origin");
    if (!origin) return true; // some browsers omit Origin on top-level form posts
    try {
      return new URL(origin).host === req.get("host");
    } catch {
      return false;
    }
  }
  app.get("/account", async (req, res) => {
    try {
      res.type("html").send(await renderLinked(getSession(req), String(req.query.msg ?? "")));
    } catch (err) {
      console.error("[/account] failed:", err);
      res.status(500).type("text").send("internal error");
    }
  });
  app.post("/account/connect", (req, res) => {
    const address = String(req.body.address ?? "").trim().toLowerCase();
    if (!sameOrigin(req)) return res.redirect(303, "/account?msg=err_addr");
    if (!isValidAddress(address)) return res.redirect(303, "/account?msg=err_addr");
    try {
      const ok = verifyWalletSignature(address, String(req.body.message ?? ""), String(req.body.signature ?? ""));
      if (!ok) return res.redirect(303, "/account?msg=err_addr");
      setSession(res, address);
      res.redirect(303, "/account?msg=connected");
    } catch {
      // Prod path before BIP-322 verifier is wired: fail closed.
      res.redirect(303, "/account?msg=err_auth");
    }
  });
  app.post("/account/disconnect", (_req, res) => {
    clearSession(res);
    res.redirect(303, "/account");
  });
  app.post("/account/link", async (req, res) => {
    const session = getSession(req);
    if (!session || !sameOrigin(req) || !checkCsrf(session.address, req.body.csrf)) {
      return res.redirect(303, "/account?msg=err_link");
    }
    const venue = String(req.body.venue ?? "") as Venue;
    if (!KNOWN_VENUES.has(venue)) return res.redirect(303, "/account?msg=err_link");
    if (!isVaultReady()) return res.redirect(303, "/account?msg=err_vault");
    try {
      await linkAccount({
        address: session.address,
        venue,
        orgId: req.body.orgId ? String(req.body.orgId) : undefined,
        apiKey: String(req.body.apiKey ?? "").trim(),
        apiSecret: String(req.body.apiSecret ?? "").trim(),
      });
      res.redirect(303, "/account?msg=linked");
    } catch (err) {
      console.error("[/account/link] failed:", err);
      res.redirect(303, "/account?msg=err_link");
    }
  });
  app.post("/account/unlink", async (req, res) => {
    const session = getSession(req);
    if (!session || !sameOrigin(req) || !checkCsrf(session.address, req.body.csrf)) {
      return res.redirect(303, "/account");
    }
    const venue = String(req.body.venue ?? "") as Venue;
    if (KNOWN_VENUES.has(venue)) await unlinkAccount(session.address, venue).catch(() => {});
    res.redirect(303, "/account?msg=unlinked");
  });

  // Place an order from the user's own linked venue account. SAFETY: this only
  // ever fires a real venue order when config.orderingLive is true; otherwise it
  // runs a dry-run (creates nothing at the venue) so the whole flow is testable
  // without moving money. Auth is always verified read-only first.
  app.post("/account/order", async (req, res) => {
    const session = getSession(req);
    if (!session || !sameOrigin(req) || !checkCsrf(session.address, req.body.csrf)) {
      return res.status(403).json({ error: "not authorized" });
    }
    const venue = String(req.body.venue ?? "") as Venue;
    if (venue !== "nicehash") {
      return res.status(400).json({ error: "only NiceHash ordering is wired right now" });
    }
    const phd = Number(req.body.phd ?? 0);
    const phRate = Number(req.body.phRate ?? 0);
    const durationHrs = Number(req.body.durationHrs ?? 0);
    const poolKey = String(req.body.pool ?? "standard") as keyof typeof POOL_TARGETS;
    const pool = POOL_TARGETS[poolKey] ?? POOL_TARGETS.standard;
    const worker = String(req.body.worker ?? "parahawk").trim() || "parahawk";
    const priceBtcPerPhDay = Number(req.body.priceBtcPerPhDay ?? 0);
    const amountBtc = Number(req.body.amountBtc ?? 0);
    try {
      const creds = await getCredentials(session.address, venue);
      if (!creds) return res.status(400).json({ error: "link your NiceHash key first (Account tab)" });
      const nh = { orgId: creds.orgId ?? "", apiKey: creds.apiKey, apiSecret: creds.apiSecret };

      // Read-only auth check first — proves the key works & is scoped, no spend.
      let balanceBtc = 0;
      try {
        balanceBtc = (await nhCheckAuth(nh)).total;
      } catch {
        return res.status(400).json({ error: "NiceHash rejected the key — check it's active and order-scoped" });
      }

      const live = config.orderingLive;
      const [host, portStr] = pool.host.split(":");
      const poolRes = await nhCreatePool(
        nh,
        { name: "Parahawk-Parasite", stratumHostname: host!, stratumPort: Number(portStr), username: `${session.address}.${worker}`, password: "x" },
        live,
      );
      const orderRes = await nhPlaceOrder(
        nh,
        { poolId: poolRes.id, priceBtcPerPhDay, limitPhs: phRate, amountBtc, type: "STANDARD" },
        live,
      );
      const id = orderRes.dryRun ? `dry-${randomUUID()}` : orderRes.id;
      await saveWizardOrder({
        id,
        address: session.address,
        venue,
        phd,
        phRate,
        durationHrs,
        poolTarget: pool.host,
        satsPaid: Math.round(amountBtc * 1e8) || undefined,
        status: orderRes.dryRun ? "dryrun" : "placed",
        placedAt: Date.now(),
      }).catch(() => {});
      res.json({ ok: true, dryRun: orderRes.dryRun, orderId: id, pool: pool.host, balanceBtc });
    } catch (err) {
      console.error("[/account/order] failed:", err);
      res.status(500).json({ error: "order failed — see server logs" });
    }
  });

  // Delivery auditor JSON — promised vs pool-side delivered PHd over a window.
  app.get("/api/audit", async (req, res) => {
    try {
      const address = String(req.query.address ?? "").trim();
      const phd = Number(req.query.phd ?? 0);
      const hours = Math.max(1, Math.min(720, Number(req.query.hours ?? 24)));
      if (!address || !(phd > 0)) return res.status(400).json({ error: "address and phd required" });
      res.json(await auditDelivery(address, phd, hours));
    } catch (err) {
      console.error("[/api/audit] failed:", err);
      res.status(500).json({ error: "audit failed" });
    }
  });

  app.get("/order-books", page(renderOrderBooks));
  // Awards merged into the Bravocados board — redirect old links.
  app.get("/cados", (_req, res) => res.redirect(301, "/board"));
  app.get("/history", page(renderHistory));
  app.get("/potmath", page(renderPotMath));
  // Just the live Pot Math card, as an HTML fragment. The Calculator page polls
  // this every 45s to refresh the headline numbers in place — no full-page
  // reload, so an open what-if calculator keeps its state and there's no flash.
  app.get("/potmath/card", page(async () => {
    const o = await getOverview();
    const pm = potMathFromOverview(o);
    const trend = await getPotMathTrend(pm).catch(() => null);
    return potMathCard(pm, trend);
  }));
  // /luck and /calc folded into /potmath — redirect old links.
  app.get("/luck", (_req, res) => res.redirect(301, "/potmath"));
  app.get("/calc", (_req, res) => res.redirect(301, "/potmath"));
  app.get("/about", page(renderAbout));
  app.get("/changelog", page(renderChangelog));
  app.get("/community", page(renderCommunity));
  // Mr.V wiki folded into Community — redirect old links.
  app.get("/wiki", (_req, res) => res.redirect(301, "/community"));
  app.get("/leaving", async (req, res) => {
    try {
      res.type("html").send(await renderLeaving(String(req.query.url ?? "")));
    } catch (err) {
      console.error("[/leaving] failed:", err);
      res.status(500).type("text").send("internal error");
    }
  });

  app.get("/address/:addr", async (req, res) => {
    try {
      res.type("html").send(await renderAddress(req.params.addr));
    } catch (err) {
      console.error("[/address] failed:", err);
      res.status(500).type("text").send("internal error");
    }
  });

  // JSON snapshot for programmatic use / debugging
  app.get("/api/overview", async (_req, res) => {
    try {
      res.json(await getOverview());
    } catch (err) {
      console.error("[/api/overview] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  // Historical series for the /history per-chart timeframe toggles.
  app.get("/api/pool-history", async (req, res) => {
    try {
      const metric = String(req.query.metric ?? "hashrate");
      const window = String(req.query.window ?? "1d");
      res.json(await getPoolHistory(metric, window));
    } catch (err) {
      console.error("[/api/pool-history] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  // Shared Pot Math formulas for the client-side /calc widget (same source of
  // truth as the server module — see potmath-client.ts).
  app.get("/potmath.js", (_req, res) => {
    res.type("application/javascript").set("cache-control", "no-cache").send(POTMATH_CLIENT_JS);
  });

  app.get("/healthz", (_req, res) => res.type("text").send("ok"));

  return app;
}

export function startServer(): void {
  const app = createServer();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `🦅 Parahawk web on http://localhost:${config.port}  (mock=${config.mockData})`,
    );
  });
}
