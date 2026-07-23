import { config } from "../config.js";
import { tipQrDataUrl } from "./qr.js";
import { esc } from "./format.js";

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

const NAV: Array<[string, string]> = [
  ["/", "overview"],
  ["/board", "board"],
  ["/history", "history"],
  ["/luck", "luck"],
  ["/calc", "calc"],
  ["/about", "about"],
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
  font-size:14px; line-height:1.5; letter-spacing:.2px;
}
a{color:var(--accent); text-decoration:none; border-bottom:1px dotted #4a5a33}
a:hover{color:#c7f59a}
.wrap{max-width:1080px; margin:0 auto; padding:0 18px}
header.top{border-bottom:1px solid var(--line); padding:14px 0; position:sticky; top:0; background:var(--bg); z-index:5}
header.top .wrap{display:flex; align-items:center; gap:18px; flex-wrap:wrap}
.brand{font-weight:700; font-size:16px; color:#fff; border:0}
.brand .hawk{color:var(--green)}
nav{display:flex; gap:14px; flex-wrap:wrap}
nav a{border:0; color:var(--dim); text-transform:uppercase; font-size:12px; letter-spacing:1px}
nav a.active,nav a:hover{color:var(--fg)}
main{padding:26px 0 60px}
h1{font-size:20px; margin:0 0 4px; color:#fff}
h2{font-size:15px; margin:34px 0 10px; color:#fff; text-transform:uppercase; letter-spacing:1px; border-bottom:1px solid var(--line); padding-bottom:6px}
p.lead{color:var(--dim); margin:0 0 20px}
.grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px}
.card{border:1px solid var(--line); padding:14px; background:#0a0a0a}
.card .k{color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:1px}
.card .v{font-size:24px; color:#fff; margin-top:6px}
.card .sub{color:var(--dim); font-size:12px; margin-top:4px}
.big{border:1px solid var(--line); padding:22px; background:#0a0a0a; margin-bottom:12px}
.big .k{color:var(--dim); font-size:12px; text-transform:uppercase; letter-spacing:2px}
.big .v{font-size:46px; color:#fff; margin-top:6px; line-height:1}
.green{color:var(--green)} .amber{color:var(--amber)} .red{color:var(--red)} .dim{color:var(--dim)}
table{width:100%; border-collapse:collapse; margin:10px 0}
th,td{text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); font-size:13px}
th{color:var(--dim); text-transform:uppercase; font-size:11px; letter-spacing:1px}
.bar{height:6px; background:#161616; border:1px solid var(--line); position:relative}
.bar>span{position:absolute; left:0; top:0; bottom:0; background:var(--green)}
input,button{font-family:inherit; font-size:14px}
input[type=text],input[type=number]{background:#0a0a0a; border:1px solid var(--line); color:var(--fg); padding:9px 11px; width:100%}
button{background:var(--green); color:#04120a; border:0; padding:9px 16px; cursor:pointer; font-weight:700; text-transform:uppercase; letter-spacing:1px}
button:hover{background:#c7f59a}
.stale{background:#2a1a00; border:1px solid var(--amber); color:var(--amber); padding:8px 12px; margin-bottom:16px; font-size:12px}
canvas{max-width:100%}
footer.bot{border-top:1px solid var(--line); padding:26px 0; color:var(--dim); font-size:12px; margin-top:40px}
footer.bot .wrap{display:flex; gap:26px; align-items:center; flex-wrap:wrap; justify-content:space-between}
footer.bot img{image-rendering:pixelated}
.tip{display:flex; gap:14px; align-items:center}
.tip .addr{color:var(--green); word-break:break-all}
.muted-note{color:var(--dim); font-size:12px}
`;

export async function renderPage(opts: PageOpts): Promise<string> {
  const nav = NAV.map(
    ([href, key]) =>
      `<a href="${href}" class="${opts.active === key ? "active" : ""}">${key}</a>`,
  ).join("");

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
<header class="top"><div class="wrap">
  <a class="brand" href="/">para<span class="hawk">hawk</span> 🦅</a>
  <nav>${nav}</nav>
</div></header>
<main><div class="wrap">
${stale}
${opts.body}
</div></main>
<footer class="bot"><div class="wrap">
  <div>
    <div>Parahawk — free stats &amp; alerts for the <a href="https://parasite.wtf" target="_blank" rel="noopener">Parasite Pool</a> 🥑</div>
    <div class="muted-note">not affiliated with Parasite Pool · data is best-effort · no financial advice</div>
  </div>
  ${tipBlock}
</div></footer>
</body>
</html>`;
}
