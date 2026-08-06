import { renderPage } from "../layout.js";
import { esc } from "../format.js";

interface WikiCard {
  img: string;
  alt: string;
  title: string;
  url: string;
  /** Crisp nearest-neighbour scaling for small pixel-art images. */
  pixel?: boolean;
}

/**
 * Mr.V's wikis — two big, clickable cards. Each links through the /leaving
 * interstitial so users get an "external site" warning before they go.
 */
const CARDS: WikiCard[] = [
  {
    img: "/assets/wiki/omb.jpg",
    alt: "Ordinal Maxi Biz",
    title: "Ordinal Maxi Biz Wiki",
    url: "https://ordinalmaxibiz.wiki/",
  },
  {
    img: "/assets/wiki/bravocado.png",
    alt: "Bravocados",
    title: "Bravocados Wiki",
    url: "https://ordinalmaxibiz.wiki/bravocados",
    pixel: true,
  },
];

export async function renderWiki(): Promise<string> {
  const cards = CARDS.map(
    (c) => `
    <a class="wcard" href="/leaving?url=${encodeURIComponent(c.url)}">
      <span class="whead">${esc(c.title)}</span>
      <span class="wimg"><img class="${c.pixel ? "pixel" : ""}" src="${esc(c.img)}" alt="${esc(c.alt)}"/></span>
      <span class="wgo">visit wiki ↗</span>
    </a>`,
  ).join("");

  const body = `
<h1>Mr.V Wiki 📚</h1>
<p class="lead">Two cracking wikis Mr.V built for the community. Click an image to head over — we'll warn you before leaving Parahawk.</p>

<div class="wgrid">
  ${cards}
</div>

<p class="muted-note" style="margin-top:26px">External sites, not affiliated with Parahawk. Big thanks to Mr.V 🙏</p>

<style>
.wgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:26px;margin-top:10px}
@media(max-width:820px){.wgrid{grid-template-columns:1fr}}
.wcard{display:flex;flex-direction:column;align-items:center;border:1px solid var(--line);background:#0a0a0a;padding:22px;text-decoration:none;border-bottom:1px solid var(--line);transition:border-color .12s,transform .12s}
.wcard:hover{border-color:var(--green);transform:translateY(-3px)}
.wcard .whead{color:#fff;font-size:24px;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;text-align:center}
.wcard .wimg{width:100%;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;border:1px solid var(--line)}
.wcard .wimg img{width:100%;height:100%;object-fit:contain}
.wcard .wimg img.pixel{image-rendering:pixelated;object-fit:contain}
.wcard .wgo{margin-top:16px;color:var(--green);font-size:17px;letter-spacing:1px;text-transform:uppercase}
</style>
`;

  return renderPage({ title: "Mr.V Wiki", active: "mr.v wiki", body });
}
