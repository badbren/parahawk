import { config } from "../config.js";
import { tipQrDataUrl } from "./qr.js";
import { esc } from "./format.js";
import { parahawkLogo } from "./logo.js";

export interface PageOpts {
  title: string;
  active: string;
  /** Extra tags injected into <head> (e.g. Chart.js CDN, meta refresh). */
  head?: string;
  /** Page body HTML. */
  body: string;
  /** Optional stale banner text. */
  staleBanner?: string | null;
}

/**
 * Nav grouped by theme so Parasite-pool stats and Bravocado culture read as
 * distinct sections: [pool stats] · [bravocados] · [tools].
 */
const NAV_GROUPS: Array<Array<[string, string]>> = [
  [
    ["/", "overview"],
    ["/history", "pool"],
  ],
  [
    ["/potmath", "pot math"],
    ["/luck", "luck"],
  ],
  [
    ["/board", "bravocados"],
    ["/cados", "awards"],
    ["/wiki", "mr.v wiki"],
  ],
  [
    ["/calc", "calc"],
    ["/about", "about"],
  ],
];

const STYLE = `
:root{
  --bg:#000; --fg:#e6e6e6; --dim:#8a8a8a; --line:#222;
  --green:#8fd14f; --amber:#f5c451; --red:#ff5c5c; --accent:#8fd14f;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--fg);
  font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;
  font-size:20px; line-height:1.55; letter-spacing:.2px;
}
a{color:var(--accent); text-decoration:none; border-bottom:1px dotted #4a5a33}
a:hover{color:#c7f59a}
.wrap{max-width:1760px; margin:0 auto; padding:0 40px}
header.top{border-bottom:1px solid var(--line); padding:20px 0; position:sticky; top:0; background:var(--bg); z-index:5}
header.top .wrap{display:flex; align-items:center; gap:28px; flex-wrap:wrap}
.brand{display:inline-flex; align-items:center; gap:10px; border:0; line-height:0}
.brand .phlogo{display:block}
nav{display:flex; gap:24px; flex-wrap:wrap; align-items:center}
.navgroup{display:inline-flex; gap:24px; flex-wrap:wrap; align-items:center}
.navsep{color:#3a3a3a; user-select:none; font-size:30px}
nav a{
  border:0; color:var(--dim); text-transform:uppercase;
  font-family:Impact,"Arial Narrow","Arial Black",sans-serif; font-weight:900;
  font-size:32px; letter-spacing:1px; line-height:1;
  filter:url(#nav-rough);
}
nav a.active,nav a:hover{color:#fff}
.addrsearch{display:flex; gap:0; flex:1 1 320px; max-width:520px; min-width:220px; order:3}
.addrsearch input{background:#0a0a0a; border:1px solid var(--line); border-right:0; color:var(--fg); padding:11px 15px; width:100%; font-size:17px}
.addrsearch input::placeholder{color:#5a5a5a}
.addrsearch button{background:#0a0a0a; border:1px solid var(--line); color:var(--dim); padding:0 16px; cursor:pointer; font-size:20px; text-transform:none; letter-spacing:0}
.addrsearch button:hover{background:#141414; color:var(--fg)}
@media(max-width:900px){.addrsearch{order:9; flex-basis:100%; max-width:none}}
main{padding:38px 0 80px}
h1{font-size:34px; margin:0 0 8px; color:#fff}
h2{font-size:24px; margin:48px 0 16px; color:#fff; text-transform:uppercase; letter-spacing:1.5px; border-bottom:1px solid var(--line); padding-bottom:10px}
h3{font-size:19px}
p.lead{color:var(--dim); margin:0 0 28px; font-size:22px}
.grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:18px}
.card{border:1px solid var(--line); padding:22px; background:#0a0a0a}
.card .k{color:var(--dim); font-size:15px; text-transform:uppercase; letter-spacing:1px}
.card .v{font-size:38px; color:#fff; margin-top:10px}
.card .sub{color:var(--dim); font-size:16px; margin-top:8px}
.big{border:1px solid var(--line); padding:34px; background:#0a0a0a; margin-bottom:18px}
.big .k{color:var(--dim); font-size:18px; text-transform:uppercase; letter-spacing:2px}
.big .v{font-size:76px; color:#fff; margin-top:10px; line-height:1}
.green{color:var(--green)} .amber{color:var(--amber)} .red{color:var(--red)} .dim{color:var(--dim)}
table{width:100%; border-collapse:collapse; margin:14px 0}
th,td{text-align:left; padding:11px 14px; border-bottom:1px solid var(--line); font-size:18px}
th{color:var(--dim); text-transform:uppercase; font-size:15px; letter-spacing:1px}
.bar{height:9px; background:#161616; border:1px solid var(--line); position:relative; display:inline-block; width:140px; vertical-align:middle}
.bar>span{position:absolute; left:0; top:0; bottom:0; background:var(--green)}
input,button{font-family:inherit; font-size:20px}
input[type=text],input[type=number]{background:#0a0a0a; border:1px solid var(--line); color:var(--fg); padding:13px 15px; width:100%}
button{background:var(--green); color:#04120a; border:0; padding:13px 24px; cursor:pointer; font-weight:700; text-transform:uppercase; letter-spacing:1px}
button:hover{background:#c7f59a}
.stale{background:#2a1a00; border:1px solid var(--amber); color:var(--amber); padding:13px 18px; margin-bottom:22px; font-size:17px}
canvas{max-width:100%}
footer.bot{border-top:1px solid var(--line); padding:38px 0; color:var(--dim); font-size:16px; margin-top:56px}
footer.bot .wrap{display:flex; gap:40px; align-items:center; flex-wrap:wrap; justify-content:space-between}
footer.bot img{image-rendering:pixelated}
.tip{display:flex; gap:20px; align-items:center}
.tip .addr{color:var(--green); word-break:break-all}
.muted-note{color:var(--dim); font-size:16px}
`;

export async function renderPage(opts: PageOpts): Promise<string> {
  const nav = NAV_GROUPS.map(
    (group) =>
      `<span class="navgroup">${group
        .map(
          ([href, key]) =>
            `<a href="${href}" class="${opts.active === key ? "active" : ""}">${key}</a>`,
        )
        .join("")}</span>`,
  ).join(`<span class="navsep" aria-hidden="true">·</span>`);

  const qr = await tipQrDataUrl();
  const addr = config.lightningAddress;
  const tipBlock = addr
    ? `<div class="tip">${qr ? `<img src="${qr}" width="96" height="96" alt="tip QR"/>` : ""}
         <div><div>⚡ tips keep Parahawk free &amp; ad-free</div>
         <div class="addr">${esc(addr)}</div></div></div>`
    : `<div class="muted-note">⚡ set LIGHTNING_ADDRESS to show the tip jar here</div>`;

  const stale = opts.staleBanner
    ? `<div class="stale">⚠ ${esc(opts.staleBanner)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(opts.title)} · Parahawk 🦅</title>
<style>${STYLE}</style>
${opts.head ?? ""}
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <filter id="nav-rough" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency="0.02 0.06" numOctaves="2" seed="11" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
</defs></svg>
<header class="top"><div class="wrap">
  <a class="brand" href="/" aria-label="Parahawk home">${parahawkLogo({ height: 80 })}</a>
  <form class="addrsearch" role="search" onsubmit="var v=this.q.value.trim(); if(v){window.location.href='/address/'+encodeURIComponent(v);} return false;">
    <input name="q" type="text" placeholder="Enter wallet address…  (bc1…)" autocomplete="off" spellcheck="false" aria-label="Look up a wallet address"/>
    <button type="submit" aria-label="Search">⌕</button>
  </form>
  <nav>${nav}</nav>
</div></header>
<main><div class="wrap">
${stale}
${opts.body}
</div></main>
<footer class="bot"><div class="wrap">
  <div>
    <div>Parahawk — free stats &amp; alerts for the <a href="https://parasite.space" target="_blank" rel="noopener">Parasite Pool</a> 🥑</div>
    <div style="margin-top:6px">
      <a href="https://ordinalmaxibiz.wiki/bravocados" target="_blank" rel="noopener">🥑 Bravocados wiki</a> ·
      <a href="https://ordinalmaxibiz.wiki/explorer" target="_blank" rel="noopener">OMB explorer</a>
    </div>
    <div class="muted-note">not affiliated with Parasite Pool or OMB · data is best-effort · no financial advice</div>
  </div>
  ${tipBlock}
</div></footer>
</body>
</html>`;
}
