import { renderPage } from "../layout.js";
import { LATEST_RELEASE, RELEASES, type Release, type ReleaseChange, type ReleaseSection } from "../changelog-data.js";

/**
 * Changelog page. The releases live in ../changelog-data.ts, shared with the
 * desktop shell (the Changelog icon's "!" after an update).
 *
 * The running release, when it's a big one (it has highlights or sections), is
 * shown as a hero: big version, headline cards, then its changes grouped under
 * headings. Every other release renders as the plain timeline entry it always was.
 */

function tagClass(tag: string): string {
  const t = tag.toLowerCase();
  if (t === "launch" || t === "open source") return "green";
  if (t === "new" || t === "faster") return "green";
  if (t === "improved" || t === "smart" || t === "changed" || t === "fixed") return "amber";
  if (t === "security") return "red";
  if (t === "soon") return "soon";
  return "dim";
}

const item = (c: ReleaseChange) => `<li><span class="cl-tag ${tagClass(c.tag)}">${c.tag}</span> ${c.text}</li>`;

const isBig = (r: Release) => (r.highlights?.length ?? 0) > 0 || (r.sections?.length ?? 0) > 0;

function sectionsOf(r: Release): ReleaseSection[] {
  return r.sections && r.sections.length > 0 ? r.sections : [{ title: "What's new", changes: r.changes }];
}

/** A plain timeline entry — how every release looked before 2.0. Sections, when present, become sub-headings. */
function timelineEntry(r: Release): string {
  const list = r.sections && r.sections.length > 0
    ? r.sections.map((s) => `
  <h4 class="cl-sub">${s.emoji ? `${s.emoji} ` : ""}${s.title}</h4>
  <ul class="cl-list">${s.changes.map(item).join("")}</ul>`).join("")
    : `
  <ul class="cl-list">${r.changes.map(item).join("")}</ul>`;
  return `
<section class="cl-rel${r.current ? " cur" : ""}">
  <div class="cl-head">
    <span class="cl-ver">v${r.version}</span>
    <span class="cl-name">${r.name}</span>
    ${r.current ? `<span class="cl-badge">running now</span>` : ""}
    <span class="cl-date">${r.date}</span>
  </div>
  <p class="cl-sum">${r.summary}</p>${list}
</section>`;
}

/** The running release, big: version, name, summary, headline cards, then each section. */
function hero(r: Release): string {
  const sections = sectionsOf(r);
  const total = sections.reduce((n, s) => n + s.changes.length, 0);
  const cards = (r.highlights ?? [])
    .map((h) => `<div class="cl-hl"><div class="cl-hl-e">${h.emoji}</div><div class="cl-hl-t">${h.title}</div><div class="cl-hl-d">${h.text}</div></div>`)
    .join("");
  const jump = sections
    .map((s, i) => `<a class="cl-jump" href="#cl-s${i}">${s.emoji ? `${s.emoji} ` : ""}${s.title}</a>`)
    .join("");
  const body = sections
    .map((s, i) => `
<section class="cl-sec" id="cl-s${i}">
  <h3 class="cl-sec-h">${s.emoji ? `<span class="cl-sec-e">${s.emoji}</span>` : ""}${s.title}<span class="cl-sec-n">${s.changes.length}</span></h3>
  <ul class="cl-list">${s.changes.map(item).join("")}</ul>
</section>`)
    .join("");
  return `
<section class="cl-hero">
  <div class="cl-hero-top">
    <span class="cl-hero-ver">v${r.version}</span>
    ${r.current ? `<span class="cl-badge">running now</span>` : ""}
    <span class="cl-date">${r.date}</span>
  </div>
  <div class="cl-hero-name">${r.name}</div>
  <p class="cl-hero-sum">${r.summary}</p>
  <div class="cl-hero-count"><b>${total}</b> updates in <b>${sections.length}</b> sections</div>
  ${cards ? `<div class="cl-hl-grid">${cards}</div>` : ""}
  <div class="cl-jumps" role="navigation" aria-label="Sections">${jump}</div>
</section>${body}`;
}

/** The page body — pure, so it's tested without the layout. */
export function changelogBody(releases: readonly Release[] = RELEASES, current: Release = LATEST_RELEASE): string {
  const big = isBig(current);
  const rest = releases.filter((r) => !(big && r === current));

  const now = big
    ? ""
    : `
<div class="cl-now">
  <div>
    <div class="cl-now-k">Current version</div>
    <div class="cl-now-v">v${current.version}</div>
  </div>
  <div class="cl-now-note">
    Parahawk is open source — read every change in full on
    <a href="https://github.com/badbren/parahawk" target="_blank" rel="noopener">GitHub</a>,
    or <a href="https://discord.com/users/1097991369986932828" target="_blank" rel="noopener">suggest the next one on Discord</a>.
  </div>
</div>`;

  return `
<h1>Changelog</h1>
<p class="lead">What's new in Parahawk, newest first. We're on <strong>v${current.version}</strong> — everything runs on live data, and things still move fast.</p>
${now}
${big ? hero(current) : ""}
${big && rest.length > 0 ? `<h2 class="cl-earlier">Earlier releases</h2>` : ""}
${rest.map(timelineEntry).join("")}

<p class="muted-note" style="margin-top:30px">Parahawk is open source — every change is on <a href="https://github.com/badbren/parahawk" target="_blank" rel="noopener">GitHub</a>. Spotted something broken or missing? Use <strong>Suggestions</strong> on the desktop or <a href="https://discord.com/users/1097991369986932828" target="_blank" rel="noopener">message me on Discord</a> — it might be in the next release.</p>

<style>
.cl-now{display:flex;gap:28px;align-items:center;flex-wrap:wrap;border:2px solid var(--green);background:#0b1206;padding:20px 24px;margin:0 0 30px}
.cl-now-k{color:var(--dim);font-size:14px;text-transform:uppercase;letter-spacing:1.5px}
.cl-now-v{color:var(--hi,var(--fg));font-size:34px;line-height:1.1;margin-top:4px}
.cl-now-note{color:#b7c9a6;font-size:16px;max-width:52ch;line-height:1.5}
.cl-rel{border-left:2px solid var(--line);padding:2px 0 8px 22px;margin:0 0 28px;position:relative}
.cl-rel.cur{border-left-color:var(--green)}
.cl-rel::before{content:"";position:absolute;left:-7px;top:8px;width:12px;height:12px;border-radius:50%;background:#0a0a0a;border:2px solid var(--line)}
.cl-rel.cur::before{background:var(--green);border-color:var(--green)}
.cl-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.cl-ver{color:var(--green);font-weight:700;font-size:22px}
.cl-name{color:var(--hi,var(--fg));font-size:20px}
.cl-badge{color:#04120a;background:var(--green);font-size:12px;text-transform:uppercase;letter-spacing:1px;padding:2px 8px;font-weight:700}
.cl-date{color:var(--dim);font-size:15px;margin-left:auto}
.cl-sum{color:#b7c9a6;font-size:17px;margin:8px 0 14px}
.cl-sub{font-size:16px;margin:16px 0 8px;color:var(--hi,var(--fg))}
.cl-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.cl-list li{color:var(--fg);font-size:17px;line-height:1.5}
.cl-tag{display:inline-block;font-size:12px;text-transform:uppercase;letter-spacing:1px;padding:1px 8px;margin-right:8px;border:1px solid currentColor;border-radius:3px;vertical-align:1px}
.cl-tag.green{color:var(--green)} .cl-tag.amber{color:var(--amber)} .cl-tag.red{color:var(--red)} .cl-tag.dim{color:var(--dim)} .cl-tag.soon{color:var(--hi,var(--amber))}

/* The running release, big. Static glow only: no animation, no filters. */
.cl-hero{border:2px solid #f7931a;background:linear-gradient(180deg,rgba(247,147,26,.13),rgba(247,147,26,.03) 55%,rgba(0,0,0,0));box-shadow:0 0 0 1px rgba(247,147,26,.18),inset 0 0 60px rgba(247,147,26,.08);padding:24px 26px 20px;margin:0 0 34px}
.cl-hero-top{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.cl-hero-ver{font-family:Impact,"Arial Narrow","Arial Black",sans-serif;font-weight:900;font-size:76px;line-height:.9;letter-spacing:1px;color:var(--hi,var(--fg));text-shadow:0 0 18px rgba(247,147,26,.45)}
.cl-hero-name{font-family:Impact,"Arial Narrow","Arial Black",sans-serif;font-size:34px;line-height:1.1;letter-spacing:.5px;color:var(--hi,var(--fg));margin:12px 0 0;text-transform:uppercase}
.cl-hero-sum{color:var(--fg);font-size:19px;line-height:1.55;margin:12px 0 0;max-width:80ch}
.cl-hero-count{color:var(--dim);font-size:15px;margin:14px 0 0;text-transform:uppercase;letter-spacing:1.5px}
.cl-hero-count b{color:var(--hi,var(--fg));font-size:18px}
.cl-hl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin:18px 0 0}
.cl-hl{border:1px solid #3a2a12;background:#0c0904;padding:14px 16px}
.cl-hl-e{font-size:28px;line-height:1}
.cl-hl-t{color:var(--hi,var(--fg));font-size:18px;font-weight:700;margin:10px 0 6px}
.cl-hl-d{color:var(--fg);font-size:15px;line-height:1.45}
.cl-jumps{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0}
.cl-jump{border:1px solid #3a2a12;padding:4px 10px;font-size:14px;color:var(--fg)}
.cl-jump:hover{border-color:#f7931a;color:var(--hi,var(--fg))}
.cl-sec{border-left:2px solid #3a2a12;padding:2px 0 4px 22px;margin:0 0 30px;scroll-margin-top:16px}
.cl-sec-h{display:flex;align-items:center;gap:10px;margin:0 0 14px;font-size:24px}
.cl-sec-e{font-size:24px}
.cl-sec-n{font-size:12px;color:var(--dim);border:1px solid var(--line);border-radius:10px;padding:1px 8px;letter-spacing:1px}
.cl-earlier{margin-top:44px}
@media(max-width:720px){
  .cl-hero{padding:18px 16px}
  .cl-hero-ver{font-size:54px}
  .cl-hero-name{font-size:24px}
  .cl-hero-sum{font-size:17px}
  .cl-sec{padding-left:14px}
}
</style>
`;
}

export async function renderChangelog(): Promise<string> {
  return renderPage({ title: "Changelog", active: "changelog", body: changelogBody() });
}
