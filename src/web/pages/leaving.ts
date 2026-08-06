import { renderPage } from "../layout.js";
import { esc } from "../format.js";

/**
 * Hosts Parahawk is willing to hand users off to. Anything not on this list is
 * refused, so /leaving can never be abused as an open redirect.
 */
const ALLOWED_HOSTS = new Set(["ordinalmaxibiz.wiki", "www.ordinalmaxibiz.wiki"]);

/**
 * Interstitial shown before sending a user to an external site — a plain,
 * honest "you are leaving Parahawk" warning with an explicit Continue button.
 * The destination is validated against ALLOWED_HOSTS first.
 */
export async function renderLeaving(rawUrl: string): Promise<string> {
  let url: URL | null = null;
  try {
    url = new URL(rawUrl);
  } catch {
    url = null;
  }
  const ok =
    url !== null &&
    (url.protocol === "https:" || url.protocol === "http:") &&
    ALLOWED_HOSTS.has(url.host);

  if (!ok || url === null) {
    return renderPage({
      title: "External link blocked",
      active: "",
      body: `<h1>Link not allowed</h1>
<p class="lead">That external link isn't on Parahawk's allow-list, so we won't forward you to it.</p>
<p><a href="/wiki">← back to the wiki</a></p>`,
    });
  }

  const href = url.href;
  const host = url.host;

  const body = `
<h1>You're leaving Parahawk 🚪</h1>
<p class="lead">This link goes to an <strong>external site</strong> Parahawk doesn't control.</p>

<div class="stale" style="background:#2a1a00;border-color:var(--amber);color:var(--amber)">
  You're about to visit <strong>${esc(host)}</strong> — one of Mr.V's wikis. It's not affiliated with Parahawk; we can't vouch for its content or safety. Only continue if you trust it.
</div>

<div class="card" style="margin-top:18px">
  <div class="k">Destination</div>
  <div class="v" style="font-size:22px;word-break:break-all">${esc(href)}</div>
</div>

<p style="margin-top:22px;display:flex;gap:16px;flex-wrap:wrap;align-items:center">
  <a href="${esc(href)}" target="_blank" rel="noopener noreferrer"><button type="button">Continue to ${esc(host)} ↗</button></a>
  <a href="/wiki">← no thanks, take me back</a>
</p>
`;

  return renderPage({ title: "Leaving Parahawk", active: "", body });
}
