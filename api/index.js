// Vercel serverless entry: serves the whole Parahawk Express app as a single
// function. All non-/api paths are rewritten here by vercel.json. Imports the
// COMPILED output (dist/) so there's no TS/.js-extension resolution to fight —
// `npm run build` (the Vercel buildCommand) produces dist/ before this bundles.
import { createServer } from "../dist/web/server.js";

export default createServer();
