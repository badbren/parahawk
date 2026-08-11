/**
 * Badge audit — reconcile the indexed badge counts against live Parasite data.
 *
 * The /badges counts for the index-derived badges (refinery, block, dispenser,
 * miner, loyalty, …) come from the `account_badges` table, which is refreshed on
 * a slow round-robin (40 wallets / 10 min), so the numbers can lag. This tool:
 *
 *   1. dumps every indexed wallet address to data/indexed-wallets.txt,
 *   2. re-fetches each wallet's LIVE Parasite badges (getUserStats),
 *   3. reports the live per-badge holder counts + every value that drifted, and
 *   4. with --apply, writes the refreshed badges back so /badges is accurate now.
 *
 * Bravocado + Block Finder are NOT audited here — they're authoritative already
 * (on-chain dispenser + curated BLOCK_FINDERS), independent of account_badges.
 *
 * Usage:
 *   npm run audit:badges                 # report only (no writes), all wallets
 *   npm run audit:badges -- --limit=50   # only re-check the first 50
 *   npm run audit:badges -- --apply      # ALSO refresh account_badges to live
 *
 * Needs the same env as the site (SUPABASE_URL + SUPABASE_SERVICE_KEY to read the
 * real index; PARASITE_BASE_URL to fetch live badges).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { getStore } from "../db/index.js";
import { getUserStats } from "../data/parasite.js";
import { hasSupabase } from "../config.js";

const AUTHORITATIVE = new Set(["block_winner", "bravocado"]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface Change {
  address: string;
  badge: string;
  from: number;
  to: number;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 0) : Infinity;

  if (!hasSupabase()) {
    console.warn(
      "⚠ No Supabase configured — this audits the in-memory store (likely empty). " +
        "Set SUPABASE_URL + SUPABASE_SERVICE_KEY to audit the live index.",
    );
  }

  const store = getStore();
  const stored = await store.getAccountBadges(5000);
  const storedByAddr = new Map<string, Record<string, number>>(stored.map((r) => [r.address, r.badges]));
  const wallets = stored.map((r) => r.address);
  console.log(`Indexed wallets in account_badges: ${wallets.length}`);

  mkdirSync("data", { recursive: true });
  writeFileSync("data/indexed-wallets.txt", wallets.join("\n") + (wallets.length ? "\n" : ""));
  console.log(`Wrote data/indexed-wallets.txt (${wallets.length} addresses)`);

  const toCheck = Number.isFinite(limit) ? wallets.slice(0, limit) : wallets;
  console.log(
    `Re-fetching live Parasite badges for ${toCheck.length} wallet(s)${apply ? " (will WRITE refreshed values)" : " (report only — pass --apply to write)"}…`,
  );

  const liveByAddr = new Map<string, Record<string, number>>();
  const changes: Change[] = [];
  let done = 0;
  let failed = 0;
  for (const address of toCheck) {
    try {
      const u = await getUserStats(address);
      const live = u.badges ?? {};
      liveByAddr.set(address, live);

      const before = storedByAddr.get(address) ?? {};
      const keys = new Set([...Object.keys(before), ...Object.keys(live)]);
      for (const k of keys) {
        const from = before[k] ?? 0;
        const to = live[k] ?? 0;
        if (from !== to) changes.push({ address, badge: k, from, to });
      }

      if (apply) {
        await store.upsertAccountBadges({ address, badges: live, updatedAt: Date.now() });
      }
    } catch {
      failed++;
    }
    if (++done % 25 === 0) console.log(`  …${done}/${toCheck.length}`);
    await sleep(250); // gentle on Parasite's API
  }

  // Live per-badge holder counts (of the wallets we re-checked).
  const holders: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const live of liveByAddr.values()) {
    for (const [k, n] of Object.entries(live)) {
      if (n > 0) {
        holders[k] = (holders[k] ?? 0) + 1;
        totals[k] = (totals[k] ?? 0) + n;
      }
    }
  }

  const perBadge = Object.keys(holders)
    .sort()
    .map((k) => ({
      badge: k,
      holders: holders[k] ?? 0,
      total: totals[k] ?? 0,
      authoritative: AUTHORITATIVE.has(k),
    }));

  const report = {
    generatedAt: new Date().toISOString(),
    applied: apply,
    walletsIndexed: wallets.length,
    walletsChecked: toCheck.length,
    walletsFailed: failed,
    perBadge,
    changes,
  };
  writeFileSync("data/badge-audit.json", JSON.stringify(report, null, 2));

  console.log("\n── Live badge counts (of re-checked wallets) ──");
  for (const b of perBadge) {
    const note = b.authoritative ? "  (authoritative elsewhere — index count ignored on /badges)" : "";
    console.log(`  ${b.badge.padEnd(16)} ${String(b.holders).padStart(5)} holders  ${String(b.total).padStart(6)} total${note}`);
  }
  console.log(
    `\n${changes.length} badge value change(s) vs stored${failed ? `, ${failed} wallet(s) failed to fetch` : ""}. ` +
      `Wrote data/badge-audit.json.${apply ? " account_badges refreshed to live values." : " Re-run with --apply to refresh /badges now."}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("audit-badges failed:", e);
    process.exit(1);
  });
