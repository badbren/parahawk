import { renderPage } from "../layout.js";
import { config } from "../../config.js";
import { esc } from "../format.js";
import { csrfToken, type Session } from "../../services/auth.js";
import { getLinkedAccounts, type LinkedAccountView, type Venue } from "../../services/linked.js";
import { isVaultReady } from "../../services/vault.js";

interface VenueMeta {
  slug: Venue;
  name: string;
  keysUrl: string;
  refSignup: string;
  scopeHint: string;
  needsOrg: boolean;
}

function venueMetas(): VenueMeta[] {
  const nhRef = config.venueRefs.nicehash;
  const mrrRef = config.venueRefs.miningrigrentals;
  return [
    {
      slug: "nicehash",
      name: "NiceHash",
      keysUrl: "https://www.nicehash.com/my/settings/keys",
      refSignup: nhRef ? `https://www.nicehash.com/?refId=${encodeURIComponent(nhRef)}` : "https://www.nicehash.com/",
      scopeHint: "Grant only Marketplace → “Manage marketplace orders” + Wallet → “View balances”. Never a withdrawal scope.",
      needsOrg: true,
    },
    {
      slug: "miningrigrentals",
      name: "MiningRigRentals",
      keysUrl: "https://www.miningrigrentals.com/account/apikey",
      refSignup: mrrRef ? `https://www.miningrigrentals.com/register?ref=${encodeURIComponent(mrrRef)}` : "https://www.miningrigrentals.com/register",
      scopeHint: "Grant only the rig-rental / order permissions. Never account-withdrawal.",
      needsOrg: false,
    },
  ];
}

function flash(msg: string | undefined): string {
  if (!msg) return "";
  const ok = !/^err/i.test(msg);
  const text =
    { linked: "✅ Account linked — your key is encrypted at rest.", unlinked: "Account unlinked.", connected: "✅ Wallet connected.", err_link: "⚠ Could not link that key — check the values and try again.", err_vault: "⚠ Linking is disabled: KEYS_SECRET is not set on the server.", err_addr: "⚠ That doesn't look like a bc1 address." }[msg] ?? esc(msg);
  return `<div class="stale" style="${ok ? "background:#0c1408;border-color:#2c4a1c;color:#c7f59a" : ""}">${text}</div>`;
}

/** The connect card, shown when there's no session. */
function connectCard(): string {
  const devNote = config.mockData
    ? `<p class="muted-note">Dev mode: paste any <code>bc1…</code> address to simulate a connected wallet (no signature required locally).</p>`
    : `<p class="muted-note">Connect with your bitcoin wallet — you'll sign a one-time message to prove the address is yours. Nothing is spent and no funds move.</p>`;
  return `
<div class="card" style="max-width:640px">
  <h3>Connect your wallet</h3>
  ${devNote}
  <form method="POST" action="/account/connect" style="margin-top:12px">
    <input type="text" name="address" placeholder="bc1q…" autocomplete="off" spellcheck="false" required style="margin-bottom:12px"/>
    <button type="submit">Connect</button>
  </form>
  <p class="muted-note" style="margin-top:14px">Connecting is optional — the price board and wizard work without it. You only need it to link a venue key and place orders from your own account.</p>
</div>`;
}

function venueBlock(v: VenueMeta, linked: LinkedAccountView | undefined, csrf: string): string {
  if (linked) {
    return `
<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <div><h3 style="margin:0">${esc(v.name)}</h3>
      <div class="dim" style="font-size:15px;margin-top:4px">Linked · key ${esc(linked.keyMasked)}${linked.orgId ? ` · org ${esc(linked.orgId)}` : ""}</div>
    </div>
    <form method="POST" action="/account/unlink">
      <input type="hidden" name="csrf" value="${esc(csrf)}"/>
      <input type="hidden" name="venue" value="${esc(v.slug)}"/>
      <button type="submit" style="background:#2a1414;color:#ff9a9a">Unlink</button>
    </form>
  </div>
  <p class="muted-note" style="margin-top:10px">Your key is stored encrypted (AES-256-GCM) and only decrypted in memory to place an order you confirm. Revoke it any time at <a href="${esc(v.keysUrl)}" target="_blank" rel="noopener nofollow">${esc(v.name)}</a>.</p>
</div>`;
  }
  return `
<div class="card">
  <h3 style="margin-top:0">${esc(v.name)}</h3>
  <p class="muted-note">${esc(v.scopeHint)}
    <a href="${esc(v.keysUrl)}" target="_blank" rel="noopener nofollow">create a scoped key ↗</a></p>
  <form method="POST" action="/account/link" style="margin-top:12px">
    <input type="hidden" name="csrf" value="${esc(csrf)}"/>
    <input type="hidden" name="venue" value="${esc(v.slug)}"/>
    ${v.needsOrg ? `<label class="dim" style="font-size:13px">Organization ID<input type="text" name="orgId" placeholder="your NiceHash org id" autocomplete="off" style="margin:5px 0 12px"/></label>` : ""}
    <label class="dim" style="font-size:13px">API key<input type="text" name="apiKey" placeholder="key" autocomplete="off" spellcheck="false" required style="margin:5px 0 12px"/></label>
    <label class="dim" style="font-size:13px">API secret<input type="password" name="apiSecret" placeholder="secret (encrypted before storage)" autocomplete="off" required style="margin:5px 0 14px"/></label>
    <button type="submit">Link ${esc(v.name)}</button>
  </form>
  <p class="muted-note" style="margin-top:10px;font-size:14px">New to ${esc(v.name)}? <a href="${esc(v.refSignup)}" target="_blank" rel="noopener nofollow">create an account ↗</a>${config.venueRefs[v.slug] ? ' <span class="dim">(referral link — the venue pays Parahawk, never you)</span>' : ""}</p>
</div>`;
}

export async function renderLinked(session: Session | null, msg?: string): Promise<string> {
  const metas = venueMetas();

  let inner: string;
  if (!session) {
    inner = `${flash(msg)}${connectCard()}`;
  } else {
    const linked = await getLinkedAccounts(session.address);
    const byVenue = new Map(linked.map((l) => [l.venue, l]));
    const csrf = csrfToken(session.address);

    const vaultWarn = isVaultReady()
      ? ""
      : `<div class="stale">⚠ The server has no <code>KEYS_SECRET</code> set, so key linking is disabled (we won't store keys unencrypted). Set it to enable ordering.</div>`;

    inner = `
${flash(msg)}
<div class="card" style="max-width:760px;margin-bottom:22px">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <div><div class="k" style="color:var(--dim);font-size:14px;text-transform:uppercase;letter-spacing:1px">Connected as</div>
      <div style="font-size:20px;color:#fff;word-break:break-all;margin-top:4px">${esc(session.address)}</div></div>
    <form method="POST" action="/account/disconnect"><button type="submit" style="background:#141414;color:var(--dim)">Disconnect</button></form>
  </div>
</div>
${vaultWarn}
<div class="promise" style="border:1px solid #2c4a1c;background:#0c1408;color:#c7f59a;padding:14px 18px;margin:0 0 22px;font-size:16px">🔒 Keys are encrypted at rest, never shown again after entry, and never sent back to your browser. Create them <strong>order-scoped only</strong> — Parahawk can't withdraw your funds and wouldn't.</div>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
  ${metas.map((v) => venueBlock(v, byVenue.get(v.slug), csrf)).join("")}
</div>`;
  }

  const body = `
<h1>Linked Accounts</h1>
<p class="lead">Bring your own venue keys. Parahawk places orders from <em>your</em> account with <em>your</em> balance — it never holds your funds. Link a key scoped to placing orders only; revoke it at the venue any time.</p>
${inner}
`;

  return renderPage({ title: "Linked Accounts", active: "account", body });
}
