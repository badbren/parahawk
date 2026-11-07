import { renderPage } from "../layout.js";

/**
 * /inscribe as a plain page.
 *
 * Inscribing itself lives in the desktop's Inscribe window
 * (src/shell/apps/inscribe.ts). Xverse injects its provider into the top page
 * only, never into an iframe, so the version of this page that used to hold the
 * whole tool could not reach the wallet from inside the desktop. A top-level
 * visit to /inscribe already opens that window (the desktop gate in
 * server.ts); this page is what frames, ?classic=1 and bots see: what Inscribe
 * does, and the way in.
 *
 * The facts here match the window and docs/specs/inscribe.md: Xverse builds,
 * pays for and broadcasts the inscription; Parahawk adds no fee; mainnet only.
 */
export async function renderInscribe(): Promise<string> {
  const body = `
<h1>Inscribe</h1>
<p class="lead">Put text or a small file on Bitcoin, for good, paid from your own Xverse wallet. Parahawk adds no fee.</p>

<div class="ins-open">
  <a class="ins-btn" href="/inscribe" target="_top">Open Inscribe →</a>
  <p class="dim">Inscribe runs in the Parahawk desktop, where your Xverse wallet can reach it. On a phone, open parahawk.space inside the Xverse app's browser.</p>
</div>

<h2>How it works</h2>
<ol class="ins-steps">
  <li><strong>Connect Xverse.</strong> You sign one short message to sign in. Signing is free and moves nothing.</li>
  <li><strong>Type some text or pick a file</strong>: an image, text, JSON, PDF, audio or video, up to about 290&nbsp;KB. You pay per byte, so small is cheap.</li>
  <li><strong>Pick a fee rate.</strong> Live rates come from mempool.space, and the window shows an estimate of the total before you start.</li>
  <li><strong>Approve in Xverse.</strong> Xverse shows the exact total, then builds the two transactions an inscription needs (commit and reveal), pays from your wallet and broadcasts them. The inscription lands in your Xverse ordinals address.</li>
</ol>
<p class="dim">Mainnet only, because that's all Xverse's inscription flow supports. Real bitcoin: an inscription can't be undone or edited. Parahawk never sees your keys and never touches the transactions.</p>

<style>
.ins-open{border:1px solid #6b3f05;border-left:3px solid #f7931a;background:#120b02;padding:18px 22px;margin:0 0 26px}
.ins-btn{display:inline-block;padding:12px 20px;margin:0 0 12px;background:#f7931a;color:#0b0b0b;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-decoration:none;border:1px solid #000}
.ins-btn:hover{background:#ffa733;color:#000}
.ins-steps{margin:0 0 18px;padding-left:22px;line-height:1.65}
.ins-steps li{margin:0 0 8px}
</style>`;

  return renderPage({ title: "Inscribe", active: "inscribe", body });
}
