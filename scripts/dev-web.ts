/**
 * Local web tier — the site and the desktop shell, with no pollers and no
 * Discord bot.
 *
 * `npm run dev` starts everything in src/index.ts, and against the production
 * .env that means a SECOND copy of the live bot answering commands and a second
 * set of pollers writing to the live database. This runs only the web server,
 * which reads what it needs on demand, and rebuilds the desktop shell whenever
 * its source changes.
 *
 *   npm run dev:web                      http://localhost:3000
 *   http://localhost:3000/dev/login      signed in as the owner (ADMIN_ADDRESS)
 *   http://localhost:3000/dev/logout
 *
 * /dev/login exists only in this file. It answers loopback requests only and
 * the server binds to 127.0.0.1, and it is never part of the deployed app:
 * Vercel runs api/index.js → dist/web/server.js, which does not import this.
 * The cookie it sets is signed with the local secret, so it means nothing to
 * any other server.
 */
import express from "express";
import { context } from "esbuild";
import { createServer } from "../src/web/server.js";
import { clearSession, setSession } from "../src/services/auth.js";
import { config } from "../src/config.js";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

async function main(): Promise<void> {
  // The same build as `npm run build:shell`, so the committed bundle never
  // drifts from what was tested here.
  const shell = await context({
    entryPoints: ["src/shell/main.ts"],
    bundle: true,
    format: "iife",
    target: "es2020",
    minify: true,
    sourcemap: true,
    outfile: "public/shell/shell.js",
    logLevel: "info",
  });
  await shell.watch();

  const app = express();

  app.get("/dev/login", (req, res) => {
    if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) {
      res.status(404).type("text").send("not found");
      return;
    }
    setSession(res, config.adminAddress);
    res.redirect("/admin");
  });
  app.get("/dev/logout", (req, res) => {
    if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) {
      res.status(404).type("text").send("not found");
      return;
    }
    clearSession(res);
    res.redirect("/");
  });

  // The shell bundle is rebuilt in place while the page that references it
  // keeps the same ?v=, so never let the browser hold on to an old one.
  app.use("/assets/shell", express.static("public/shell", {
    etag: false,
    lastModified: false,
    cacheControl: false,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
  }));

  app.use(createServer());

  app.listen(config.port, "127.0.0.1", () => {
    console.log(`\n  Parahawk (web only — no pollers, no bot)`);
    console.log(`  site    http://localhost:${config.port}`);
    console.log(`  admin   http://localhost:${config.port}/dev/login   (signs in as ${config.adminAddress})\n`);
    // Warm the server's page memo (server.ts) so the first click on each heavy page is instant too.
    // Plain requests (no Sec-Fetch-Dest) get the page itself, the same as a desktop window's iframe.
    for (const p of ["/", "/history", "/potmath", "/marketplace", "/board", "/badges", "/leaderboard"]) {
      fetch(`http://127.0.0.1:${config.port}${p}`).catch(() => { /* the server is restarting; the next start warms it */ });
    }
  });
}

main().catch((err) => {
  console.error("dev-web failed:", err);
  process.exit(1);
});
