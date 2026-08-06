// Vercel Cron endpoint — replaces the long-lived setInterval pollers. Vercel
// invokes this on the schedule in vercel.json; each hit runs one poll cycle
// (collect a sample, check for a new block, ingest new hits) into Supabase.
// Protected by CRON_SECRET so only Vercel's scheduler can trigger it.
import { runPollOnce } from "../../dist/pollers/index.js";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const authed = !secret || req.headers.authorization === `Bearer ${secret}`;
  if (!authed) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    await runPollOnce();
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("cron/poll:", err);
    res.status(500).json({ error: "poll failed" });
  }
}
