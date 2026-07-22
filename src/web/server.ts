import express from "express";
import { config } from "../config.js";
import { renderOverview } from "./pages/overview.js";
import { getOverview } from "../services/overview.js";

export function createServer(): express.Express {
  const app = express();
  app.disable("x-powered-by");

  // Home / live overview
  app.get("/", async (_req, res) => {
    try {
      res.type("html").send(await renderOverview());
    } catch (err) {
      res.status(500).type("text").send(`overview error: ${(err as Error).message}`);
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
