import express from "express";
import { config } from "../config.js";
import { renderOverview } from "./pages/overview.js";
import { renderHistory } from "./pages/history.js";
import { renderCalc } from "./pages/calc.js";
import { renderAbout } from "./pages/about.js";
import { renderLuck } from "./pages/luck.js";
import { renderPotMath } from "./pages/potmath.js";
import { renderWiki } from "./pages/wiki.js";
import { renderLeaving } from "./pages/leaving.js";
import { renderBoard } from "./pages/board.js";
import { renderCados } from "./pages/cados.js";
import { renderAddress } from "./pages/address.js";
import { getOverview } from "../services/overview.js";
import { POTMATH_CLIENT_JS } from "./potmath-client.js";

/** Wrap an async page renderer with error handling. */
function page(render: () => Promise<string>) {
  return async (_req: express.Request, res: express.Response) => {
    try {
      res.type("html").send(await render());
    } catch (err) {
      res.status(500).type("text").send(`error: ${(err as Error).message}`);
    }
  };
}

export function createServer(): express.Express {
  const app = express();
  app.disable("x-powered-by");

  // Static assets (wiki images, etc.) served from ./public at /assets.
  app.use("/assets", express.static("public", { maxAge: "1h" }));

  app.get("/", page(renderOverview));
  app.get("/board", page(renderBoard));
  app.get("/cados", page(renderCados));
  app.get("/history", page(renderHistory));
  app.get("/luck", page(renderLuck));
  app.get("/potmath", page(renderPotMath));
  app.get("/calc", page(renderCalc));
  app.get("/about", page(renderAbout));
  app.get("/wiki", page(renderWiki));
  app.get("/leaving", async (req, res) => {
    try {
      res.type("html").send(await renderLeaving(String(req.query.url ?? "")));
    } catch (err) {
      res.status(500).type("text").send(`error: ${(err as Error).message}`);
    }
  });

  app.get("/address/:addr", async (req, res) => {
    try {
      res.type("html").send(await renderAddress(req.params.addr));
    } catch (err) {
      res.status(500).type("text").send(`error: ${(err as Error).message}`);
    }
  });

  // JSON snapshot for programmatic use / debugging
  app.get("/api/overview", async (_req, res) => {
    try {
      res.json(await getOverview());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
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
