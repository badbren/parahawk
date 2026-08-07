import { renderPage } from "../layout.js";
import { esc } from "../format.js";

interface CommunityCard {
  img: string;
  alt: string;
  title: string;
  tagline: string;
  url: string;
  /** Crisp nearest-neighbour scaling for small pixel-art images. */
  pixel?: boolean;
}

/**
 * Community hub — the people & resources behind Parasite Pool and OMB, as equal
 * side-by-side cards (same image size). Bobby helps run Parasite (his home-mining
 * shop, "Bobby's World"); Mr.V builds & maintains the OMB / Bravocados wikis.
 */
const CARDS: CommunityCard[] = [
  {
    img: "/assets/community/bobby.png",
    alt: "Bobby's World",
    title: "Bobby's World",
    tagline: "for all your home mining needs · by Bobbyshakes",
    url: "https://bobbyshakesgit.github.io/bobbys-world/",
  },
  {
    img: "/assets/wiki/omb.jpg",
    alt: "Ordinal Maxi Biz",
    title: "Ordinal Maxi Biz Wiki",
    tagline: "the OMB knowledge base · by Mr.V",
    url: "https://ordinalmaxibiz.wiki/",
  },
  {
    img: "/assets/wiki/bravocado.png",
    alt: "Bravocados",
    title: "Bravocados Wiki",
    tagline: "everything cados · by Mr.V",
    url: "https://ordinalmaxibiz.wiki/bravocados",
    pixel: true,
  },
];

export async function renderCommunity(): Promise<string> {
  const cards = CARDS.map(
    (c) => `
    <a class="ccard" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">
      <span class="chead">${esc(c.title)}</span>
      <span class="cimg"><img class="${c.pixel ? "pixel" : ""}" src="${esc(c.img)}" alt="${esc(c.alt)}"/></span>
      <span class="ctag">${esc(c.tagline)}</span>
      <span class="cgo">visit ↗</span>
    </a>`,
  ).join("");

  const body = `
<h1>Community 🌐</h1>
<p class="lead">Community created resources behind the OMB &amp; Parasite movement. Click a card to head over.</p>

<div class="cgrid">
  ${cards}
</div>

<p class="muted-note" style="margin-top:26px"><strong>Bobby</strong> helps run the Parasite side of things — <a href="https://bobbyshakesgit.github.io/bobbys-world/" target="_blank" rel="noopener">Bobby's World</a> is his home-mining shop (miners, PSUs and more).</p>
<p class="muted-note">The <strong>OMB</strong> and <strong>Bravocados</strong> wikis are built and maintained by <strong>Mr.V</strong>. 💚 Thank him with a donation: <span style="color:var(--green);word-break:break-all">bc1qfrt77mfrcrvjxcq7ahcgtm7w4czl6eftk4jk2c</span></p>
<p class="muted-note">External sites, not affiliated with Parahawk.</p>

<style>
.cgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:10px}
@media(max-width:820px){.cgrid{grid-template-columns:1fr}}
.ccard{display:flex;flex-direction:column;align-items:center;border:1px solid var(--line);background:#0a0a0a;padding:20px;text-decoration:none;transition:border-color .12s,transform .12s}
.ccard:hover{border-color:var(--green);transform:translateY(-3px)}
.ccard .chead{color:#fff;font-size:19px;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;text-align:center;min-height:2.4em;display:flex;align-items:center}
.ccard .cimg{width:100%;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;border:1px solid var(--line)}
.ccard .cimg img{width:100%;height:100%;object-fit:contain}
.ccard .cimg img.pixel{image-rendering:pixelated}
.ccard .ctag{margin-top:14px;color:#b7c9a6;font-size:15px;text-align:center;min-height:2.6em}
.ccard .cgo{margin-top:10px;color:var(--green);font-size:16px;letter-spacing:1px;text-transform:uppercase}
</style>
`;

  return renderPage({ title: "Community", active: "community", body });
}
