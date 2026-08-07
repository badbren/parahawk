import { renderPage } from "../layout.js";
import { getBadgesIndex, getBadgeHolders } from "../../services/badges.js";
import { getAddressResolver } from "../../services/winners.js";
import { BADGE_DEFS, BADGE_BY_KEY } from "../../data/badges.js";
import { walletCell } from "../addr.js";
import { fmtInt, esc } from "../format.js";

const BADGE_STYLE = `
<style>
.bgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-top:8px}
.bcard{border:1px solid var(--line);background:#0a0a0a;padding:20px;display:flex;gap:14px;align-items:flex-start;text-decoration:none;border-bottom:1px solid var(--line)}
.bcard:hover{border-color:#33501f;background:#0d1408}
.bcard .ic{font-size:40px;line-height:1}
.bcard .nm{color:#fff;font-size:18px}
.bcard .ct{color:var(--green);font-size:14px;margin:2px 0 6px}
.bcard .ht{color:var(--dim);font-size:14px;line-height:1.4}
.bemoji{font-size:15px;letter-spacing:1px}
.tscroll{max-height:640px;overflow:auto;border:1px solid var(--line)}
.tscroll table{margin:0}
.tscroll thead th{position:sticky;top:0;background:#0d0d0d;z-index:1}
</style>`;

export async function renderBadges(): Promise<string> {
  const [idx, resolve] = await Promise.all([
    getBadgesIndex(),
    getAddressResolver().catch(() => (() => null) as (m: string) => string | null),
  ]);

  const cards = BADGE_DEFS.map((b) => {
    const n = idx.holders[b.key] ?? 0;
    return `<a class="bcard" href="/badges/${encodeURIComponent(b.key)}">
      <div class="ic">${b.emoji}</div>
      <div>
        <div class="nm">${esc(b.name)}</div>
        <div class="ct">${n ? `${fmtInt(n)} holder${n === 1 ? "" : "s"} →` : "view holders →"}</div>
        <div class="ht">${esc(b.howto)}</div>
      </div>
    </a>`;
  }).join("");

  const mbRows =
    idx.mostBadges.length === 0
      ? `<tr><td colspan="4" class="dim">no wallets indexed yet — this fills in as winners are snapshotted and wallets are searched</td></tr>`
      : idx.mostBadges
          .map((m, i) => {
            const icons = m.keys
              .map((k) => BADGE_BY_KEY[k]?.emoji ?? "•")
              .join(" ");
            return `<tr><td class="dim">${i + 1}</td><td>${walletCell(m.address, resolve)}</td><td class="bemoji">${icons}</td><td>${m.distinct} type${m.distinct === 1 ? "" : "s"} <span class="dim">· ${fmtInt(m.total)} total</span></td></tr>`;
          })
          .join("");

  const body = `
<h1>Badges 🏅</h1>
<p class="lead">Every Parasite achievement, who holds them, and who holds the most. Click a badge to see its holders, or a wallet to open its full stats.</p>

<div class="stale" style="background:#0d1408;border-color:#33501f;color:#c7f59a">
  This board <strong>fills in as winners are snapshotted and wallets are searched</strong> — Parahawk also indexes the pool's known contributors itself. The Bravocado list is complete now; the rest grow over time.
</div>

<h2>Achievements</h2>
<div class="bgrid">${cards}</div>
<p class="muted-note" style="margin-top:10px">The <strong>Bravocado</strong> holder list is complete (from the all-time 10T+ board). The others fill in as Parahawk indexes wallets — ${fmtInt(idx.indexedWallets)} indexed so far. Search a wallet to add it.</p>

<h2>🏆 Most badges</h2>
<div class="tscroll"><table>
  <thead><tr><th>#</th><th>Wallet</th><th>Badges</th><th>Count</th></tr></thead>
  <tbody>${mbRows}</tbody>
</table></div>
<p class="muted-note">Ranked by distinct achievement types held, then total count. Covers indexed wallets (those with a full address we've looked up); masked-only miners who've never rented can't be indexed yet.</p>
${BADGE_STYLE}`;

  return renderPage({ title: "Badges", active: "badges", body });
}

export async function renderBadgeHolders(typeRaw: string): Promise<string> {
  const type = String(typeRaw || "").toLowerCase();
  const def = BADGE_BY_KEY[type];
  if (!def) {
    return renderPage({
      title: "Badge",
      active: "badges",
      body: `<h1>Badges 🏅</h1><p class="lead">Unknown badge "${esc(typeRaw)}".</p><p><a href="/badges">← all badges</a></p>`,
    });
  }

  const [holders, resolve] = await Promise.all([
    getBadgeHolders(type),
    getAddressResolver().catch(() => (() => null) as (m: string) => string | null),
  ]);

  const rows =
    holders.length === 0
      ? `<tr><td colspan="3" class="dim">no holders indexed yet</td></tr>`
      : holders
          .map(
            (h, i) =>
              `<tr><td class="dim">${i + 1}</td><td>${walletCell(h.address, resolve)}</td><td>${h.count > 1 ? `×${fmtInt(h.count)}` : "✓"}</td></tr>`,
          )
          .join("");

  const body = `
<p style="margin:0 0 6px"><a href="/badges">← all badges</a></p>
<h1>${def.emoji} ${esc(def.name)}</h1>
<p class="lead">${esc(def.howto)}</p>
<div class="tscroll"><table>
  <thead><tr><th>#</th><th>Wallet</th><th>Held</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>
<p class="muted-note" style="margin-top:12px">${type === "bravocado"
      ? "Complete list — every miner with a 10T+ best share. Matched wallets are clickable through to their stats."
      : "Coverage grows as Parahawk indexes wallets (from winner snapshots + searches). Clickable wallets have a matched full address."}</p>
${BADGE_STYLE}`;

  return renderPage({ title: `${def.name} badge`, active: "badges", body });
}
