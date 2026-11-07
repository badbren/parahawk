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
import { renderLeaderboard, parseBoardWindow } from "./pages/leaderboard.js";
import { renderPotMath } from "./pages/potmath.js";
import { potMathFromOverview, getPotMathTrend } from "../services/potmath.js";
import { potMathCard } from "./potmath-card.js";
import { renderCommunity } from "./pages/community.js";
import { renderLeaving } from "./pages/leaving.js";
import { renderBoard } from "./pages/board.js";
import { renderOrderBooks } from "./pages/order-books.js";
import { renderMarketplace } from "./pages/marketplace.js";
import { renderInscribe } from "./pages/inscribe.js";
import { renderLinked } from "./pages/linked.js";
import { renderAdmin, isAdmin, MANUAL_VENUES, usdPerPhdToSatsPerPhd } from "./pages/admin.js";
import { setManualPrice } from "../services/manual-prices.js";
import { recordVisit } from "../services/traffic.js";
import {
  getSession,
  setSession,
  clearSession,
  verifyWalletSignature,
  isSignableAddress,
  checkCsrf,
  issueNonce,
  verifyNonce,
  buildSignInMessage,
} from "../services/auth.js";
import { linkAccount, unlinkAccount, getCredentials, type Venue } from "../services/linked.js";
import { isVaultReady } from "../services/vault.js";
import { auditDelivery } from "../services/auditor.js";
import { saveWizardOrder } from "../services/wizard-orders.js";
import { nhCheckAuth, nhCreatePool, nhPlaceOrder } from "../data/venues/nicehash-client.js";
import { POOL_TARGETS } from "./marketplace-wizard.js";
import { renderAddress } from "./pages/address.js";
import { getOverview } from "../services/overview.js";
import { blocksFound } from "../services/pool-blocks.js";
import { getPoolStatsSeries, type PoolWindow } from "../data/parasite.js";
import { getHistory, type Point } from "../services/history.js";
import { POTMATH_CLIENT_JS } from "./potmath-client.js";
import { renderPage } from "./layout.js";
import { renderDesktopPage, sanitizeOpenPath, computeAssetVersion } from "./desktop-page.js";
import { artRouter } from "./art-routes.js";
import { gameRouter } from "./game-routes.js";
import { profileRouter } from "./profile-routes.js";
import { chatRouter } from "./chat-routes.js";
import { suggestionsRouter } from "./suggestion-routes.js";
import { activityRouter } from "./activity-routes.js";
import { inscribeRouter } from "./inscribe-routes.js";
import { priceRouter } from "./price-routes.js";
import { adminRouter } from "./admin-routes.js";
import { recordActivity } from "../activity/record.js";
import { PHD_TO_DIFF } from "../math/constants.js";
import { getBlockTimestamp } from "../data/mempool.js";

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

/**
 * Rendered pages kept in memory where no CDN sits in front (local dev, any
 * host but Vercel). Fresh for 20 s, like the edge; after that the old copy is
 * served at once while one re-render runs, for up to 10 min. page() routes are
 * public by declaration (their Cache-Control says so), so this is the page the
 * edge would hand out anyway. Without it every click re-fetched Parasite,
 * mempool and Supabase: 0.3–1.1 s per page (owner, 2026-11-06: "a lot of delay
 * and lag going thru pages"). Off on Vercel (the edge does this job) and under
 * vitest (tests expect a fresh render).
 */
const PAGE_MEMO = !process.env.VERCEL && !process.env.VITEST;
const PAGE_FRESH_MS = 20_000, PAGE_STALE_MS = 10 * 60_000, PAGE_MEMO_MAX = 200;
const pageMemo = new Map<string, { html: string; at: number }>();
const pageRenders = new Map<string, Promise<string>>();
function renderMemo(key: string, render: () => Promise<string>): Promise<string> {
  const rerender = (): Promise<string> => {
    let p = pageRenders.get(key);
    if (!p) {
      p = render()
        .then((html) => {
          pageMemo.delete(key);
          pageMemo.set(key, { html, at: Date.now() });
          if (pageMemo.size > PAGE_MEMO_MAX) pageMemo.delete(pageMemo.keys().next().value as string);
          return html;
        })
        .finally(() => pageRenders.delete(key));
      pageRenders.set(key, p);
    }
    return p;
  };
  const hit = pageMemo.get(key), age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < PAGE_FRESH_MS) return Promise.resolve(hit.html);
  if (hit && age < PAGE_STALE_MS) { rerender().catch(() => { /* logged by the next request that waits on it */ }); return Promise.resolve(hit.html); }
  return rerender();
}

/** Wrap an async page renderer with error handling. */
function page(render: () => Promise<string>) {
  return async (req: express.Request, res: express.Response) => {
    try {
      // Let Vercel's edge CDN serve the rendered page for ~20s (and stale for a
      // bit while revalidating), so navigating between pages is instant and cold
      // serverless instances don't re-fetch upstream on every hit. All pages are
      // public and their own scripts refresh live bits client-side.
      res.set("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
      res.type("html").send(await (PAGE_MEMO ? renderMemo(req.originalUrl, render) : render()));
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
          "frame-ancestors": ["'self'"],
          "base-uri": ["'self'"],
        },
      },
      // X-Content-Type-Options: nosniff (helmet default), Referrer-Policy,
      // same-origin framing only (the desktop shell iframes the site), and
      // HSTS (a no-op until behind TLS, safe to include).
      referrerPolicy: { policy: "no-referrer" },
      frameguard: { action: "sameorigin" },
      hsts: { maxAge: 15552000 },
    }),
  );

  // The Snipers art (art-routes.ts). Ahead of the global limiter on purpose: a
  // gallery is many small pictures, so it carries its own, more generous cap.
  app.use("/art", artRouter());

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

  // Slim live-data projection polled by the desktop shell (every 15s per open
  // tab, CDN-cached for 10s). Registered BEFORE the /api upstream limiter on
  // purpose: it must not be capped at 30/min. Shape = Tick in src/shell/data/tick.ts.
  app.get("/api/tick", async (_req, res) => {
    try {
      const o = await getOverview();
      const work = o.pool.workSinceLastBlockDiff ?? 0;
      const lastFound = o.pool.lastFoundHeight > 0 ? o.pool.lastFoundHeight : null;
      // Exact block time (same cached mempool lookup the pot-age code uses), and the all-time
      // found-block count (services/pool-blocks.ts, cached 10 min) for the desktop intro + wallpaper.
      const [lastFoundAtMs, found] = await Promise.all([
        getBlockTimestamp(o.pool.lastFoundHeight).catch(() => null),
        blocksFound(lastFound).catch(() => null),
      ]);
      res.set("Cache-Control", "public, s-maxage=10, stale-while-revalidate=30");
      res.json({
        hashratePhs: o.pool.poolHashratePhs,
        avg1dPhs: o.pool.avg1dPhs > 0 ? o.pool.avg1dPhs : null,
        difficulty: o.pool.networkDifficulty,
        height: o.chain.height,
        lastFoundHeight: lastFound,
        lastFoundAtMs,
        blocksFound: found,
        potBlocks: o.potAge.blocks,
        potHours: o.potAge.hours,
        potVerdict: o.potAge.verdict,
        btcUsd: o.pool.btcPriceUsd,
        hashpriceSats: o.pool.hashpriceSatsPerPhd,
        phdBanked: work > 0 ? work / PHD_TO_DIFF : 0,
        generatedAt: new Date(o.generatedAt).toISOString(),
      });
    } catch (err) {
      console.error("[/api/tick] failed:", err);
      res.status(503).set("Cache-Control", "no-store").json({ error: "upstream unavailable" });
    }
  });

  // Who the server session says you are — the desktop asks once on load to
  // decide whether to show owner-only icons. Never cached anywhere: it is
  // per-person, and the desktop page itself is shared through the CDN.
  app.get("/api/me", (req, res) => {
    const session = getSession(req);
    res.set("Cache-Control", "private, no-store");
    res.json({ address: session?.address ?? null, admin: isAdmin(session) });
  });

  // Block Hunt leaderboard + stats (game-routes.ts). Behind the global limiter,
  // ahead of the tighter upstream one: nothing here calls an upstream, and the
  // posts carry their own per-wallet cooldown.
  app.use("/api/game", gameRouter());

  // Profiles (display names), Chat, Suggestions and site activity (the Parahawk
  // badges). Same placement as /api/game: nothing here calls an upstream, Chat
  // polls every few seconds, and each router carries its own per-wallet limits.
  app.use("/api/profile", profileRouter());
  app.use("/api/chat", chatRouter());
  app.use("/api/suggestions", suggestionsRouter());
  app.use("/api/activity", activityRouter());
  // Trusted visitors updating a stale hand-typed venue price (the "Trusted" badge's perk).
  app.use("/api/prices", priceRouter());
  // The owner's dashboard numbers (owner-only).
  app.use("/api/admin", adminRouter());

  app.use("/api", upstreamLimiter);

  // Inscribe's same-origin proxies (fee rates, broadcast) — they DO call
  // upstream, so they sit behind the tighter limiter.
  app.use("/api/inscribe", inscribeRouter());

  // Static assets (wiki images, etc.) served from ./public at /assets.
  app.use("/assets", express.static("public", { maxAge: "1h" }));

  // ── Desktop gate ──────────────────────────────────────────────────────────
  // Top-level browser navigations (Sec-Fetch-Dest: document) get the desktop
  // shell, which then loads the requested page inside a same-origin iframe.
  // Frames, fetches, curl and bots (no Sec-Fetch-Dest) fall through to the
  // plain site. Every GET passing through here varies on Sec-Fetch-Dest so the
  // edge caches the two variants separately.
  //
  // The classic VIEW is off for now (no menu entry, no sticky preference — see
  // src/shell/main.ts). ?classic=1 still answers one request with the plain
  // page, because the wallet pages need it: their "Open in a full tab" link is
  // how Xverse reaches a page it cannot see inside the desktop's iframe. It is
  // per-request only, so the next navigation is the desktop again.
  const assetVersion = computeAssetVersion();
  const UNGATED = ["/api", "/assets", "/art", "/overview/gauge", "/potmath/card", "/potmath.js", "/hit", "/healthz", "/account/nonce"];
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (UNGATED.some((p) => req.path === p || req.path.startsWith(p + "/"))) return next();
    res.vary("Sec-Fetch-Dest");
    const accept = req.headers.accept ?? "";
    // ?classic=1 (last value wins if repeated) forces the plain site.
    const classicRaw = req.query.classic;
    const classic = Array.isArray(classicRaw) ? classicRaw[classicRaw.length - 1] : classicRaw;
    if (req.headers["sec-fetch-dest"] !== "document" || !accept.includes("text/html") || classic === "1") {
      return next();
    }
    const root = req.path === "/";
    res.set("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
    res.type("html").send(
      renderDesktopPage({
        openPath: root ? null : sanitizeOpenPath(req.originalUrl),
        boot: root ? "full" : "skip",
        assetVersion,
      }),
    );
  });

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
  // The Block Hunt board, as a Parahawk tab (?window=today|week|all).
  app.get("/leaderboard", (req, res) => page(() => renderLeaderboard(parseBoardWindow(req.query.window)))(req, res));
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
  app.get("/inscribe", page(renderInscribe));

  // ── Wallet identity + Linked Accounts (non-custodial key vault) ────────────
  const KNOWN_VENUES = new Set<Venue>(["nicehash", "miningrigrentals"]);
  // Reject cross-site form posts (defense-in-depth alongside the CSRF token).
  function sameOrigin(req: express.Request): boolean {
    const origin = req.get("origin");
    // Absent, or "null" (browsers null the Origin on form POSTs under our
    // Referrer-Policy: no-referrer) → rely on the CSRF token + SameSite cookie.
    if (!origin || origin === "null") return true;
    try {
      const oh = new URL(origin).host;
      return oh === req.get("host") || oh === req.get("x-forwarded-host");
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
  // Issue a sign-in challenge for the wallet to sign (prod / BIP-322 flow).
  app.get("/account/nonce", (req, res) => {
    const address = String(req.query.address ?? "").trim();
    if (!isSignableAddress(address)) return res.status(400).json({ error: "invalid address" });
    const { nonce, token } = issueNonce();
    res.json({ token, message: buildSignInMessage(address, nonce) });
  });
  app.post("/account/connect", async (req, res) => {
    // The wallet's exact address is used as-is (base58 is case-sensitive), gated
    // by the BIP-322 signature check below.
    const address = String(req.body.address ?? "").trim();
    if (!sameOrigin(req) || !isSignableAddress(address)) {
      return res.status(400).json({ error: "invalid address" });
    }
    // Verify a BIP-322 signature over our own nonce. The message is rebuilt
    // server-side from the signed token, so the client can't alter it.
    const nonce = verifyNonce(String(req.body.token ?? ""));
    if (!nonce) return res.status(400).json({ error: "sign-in expired — please retry" });
    const message = buildSignInMessage(address, nonce);
    if (!(await verifyWalletSignature(address, message, String(req.body.signature ?? "")))) {
      return res.status(400).json({ error: "signature did not verify" });
    }
    setSession(res, address);
    res.json({ ok: true });
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

  // ── Owner-only admin: manual venue prices ─────────────────────────────────
  app.get("/admin", async (req, res, next) => {
    // Nobody but the owner learns this page exists: anyone else gets the plain 404.
    if (!isAdmin(getSession(req))) return next();
    try {
      res.set("Cache-Control", "private, no-cache");
      // Inside the desktop, /admin is the Admin window's Prices tab (a frame):
      // no site header. ?bare=1 asks for the same from anywhere.
      const bare = req.query.bare === "1" || req.get("sec-fetch-dest") === "iframe";
      res.type("html").send(await renderAdmin(getSession(req), String(req.query.msg ?? ""), { bare }));
    } catch (err) {
      console.error("[/admin] failed:", err);
      res.status(500).type("text").send("internal error");
    }
  });
  app.post("/admin/price", async (req, res) => {
    const session = getSession(req);
    if (!session || !isAdmin(session) || !sameOrigin(req) || !checkCsrf(session.address, req.body.csrf)) {
      return res.status(403).type("text").send("forbidden");
    }
    const venue = String(req.body.venue ?? "");
    const usd = Number(req.body.usd ?? 0);
    if (!MANUAL_VENUES.some((v) => v.slug === venue) || !(usd > 0)) {
      return res.redirect(303, "/admin?msg=invalid+value");
    }
    // Convert the USD-per-PHd the owner typed to sats/PHd at the live BTC price.
    const overview = await getOverview().catch(() => null);
    const btc = overview?.pool.btcPriceUsd ?? 0;
    const sats = Math.round(usdPerPhdToSatsPerPhd(usd, btc));
    if (!(sats > 0)) return res.redirect(303, "/admin?msg=no+live+BTC+price+-+try+again");
    await setManualPrice(venue, sats, session!.address, `$${usd.toFixed(2)}/PHd @ BTC ${Math.round(btc)}`).catch((err) =>
      console.error("[/admin/price]", err),
    );
    res.redirect(303, "/admin?msg=saved");
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
      // A signed-in visitor looking up a wallet counts toward their Parahawk badges.
      const viewer = getSession(req);
      if (viewer) void recordActivity(viewer.address, viewer.address === req.params.addr ? "self_search" : "wallet_search", req.params.addr).catch(() => {});
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

  // Client beacon sink for traffic counting (see the beacon in layout.ts). The
  // browser pings this once per page load; uncached + awaited so the visit is
  // persisted before the 204 (a fire-and-forget write would be lost when the
  // serverless instance freezes after responding). Covered by globalLimiter.
  const hit = async (req: express.Request, res: express.Response) => {
    res.set("Cache-Control", "no-store");
    await recordVisit(req).catch(() => {});
    res.status(204).end();
  };
  app.get("/hit", hit);
  app.post("/hit", hit);

  app.get("/healthz", (_req, res) => res.type("text").send("ok"));

  // Styled 404 so a bad path inside the desktop window still looks like the site.
  app.use(async (_req, res) => {
    try {
      res.status(404).type("html").send(
        await renderPage({
          title: "Not found",
          active: "",
          body: `<h1>Not found</h1><p class="lead">That page doesn't exist. <a href="/">Back to the overview →</a></p>`,
        }),
      );
    } catch {
      res.status(404).type("text").send("not found");
    }
  });

  return app;
}

export function startServer(): void {
  const app = createServer();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`🦅 Parahawk web on http://localhost:${config.port}`);
  });
}
