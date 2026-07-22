import express from "express";
import { config } from "../config.js";
import { renderOverview } from "./pages/overview.js";
import { renderHistory } from "./pages/history.js";
import { renderCalc } from "./pages/calc.js";
import { renderAbout } from "./pages/about.js";
import { getOverview } from "../services/overview.js";

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

  app.get("/", page(renderOverview));
  app.get("/history", page(renderHistory));
  app.get("/calc", page(renderCalc));
  app.get("/about", page(renderAbout));

  // JSON snapshot for programmatic use / debugging
  app.get("/api/overview", async (_req, res) => {
    try {
      res.json(await getOverview());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
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
