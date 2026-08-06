import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "../config.js";
import { renderOverview } from "./pages/overview.js";
import { renderHistory } from "./pages/history.js";
import { renderAbout } from "./pages/about.js";
import { renderPotMath } from "./pages/potmath.js";
import { renderWiki } from "./pages/wiki.js";
import { renderLeaving } from "./pages/leaving.js";
import { renderBoard } from "./pages/board.js";
import { renderOrderBooks } from "./pages/order-books.js";
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

  app.get("/", page(renderOverview));
  app.get("/board", page(renderBoard));
  app.get("/order-books", page(renderOrderBooks));
  // Awards merged into the Bravocados board — redirect old links.
  app.get("/cados", (_req, res) => res.redirect(301, "/board"));
  app.get("/history", page(renderHistory));
  app.get("/potmath", page(renderPotMath));
  // /luck and /calc folded into /potmath — redirect old links.
  app.get("/luck", (_req, res) => res.redirect(301, "/potmath"));
  app.get("/calc", (_req, res) => res.redirect(301, "/potmath"));
  app.get("/about", page(renderAbout));
  app.get("/wiki", page(renderWiki));
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
