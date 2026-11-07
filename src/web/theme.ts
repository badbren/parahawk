/**
 * Orange text for the site pages (owner, 2026-11-06: "change all the white
 * text to the orange we using now. everything is white"). White and
 * near-white text becomes Bitcoin orange, the desktop wallpaper's colour;
 * headings and big numbers a lighter orange so they still stand out. Greys
 * (--dim) and the green/amber/red signal colours are unchanged.
 *
 * layout.ts appends this at the END of every page, after the pages' own
 * <style> blocks, so a page that hard-codes #fff for a heading is overridden
 * by the same selector here without editing the page. Inline
 * style="color:#fff" needs !important; SVG fill attributes lose to any CSS
 * rule. A page that hard-codes white text again: add its selector below.
 */
export const THEME_CSS = `
:root{--fg:#f7931a;--hi:#ffab40}
a.pname{color:var(--fg)}
a.pname:hover,a.lbw:hover,nav a.active,nav a:hover{color:var(--hi)}
h1,h2,h3,.card .v,.big .v{color:var(--hi)}
.wi-t,.badge-ct,.bchip:hover,.bcard .nm,.board2col .btable h3,.chartcard h3,.cl-now-v,.cl-name,.ccard .chead,
.chartbox-head h2,.sub-hd,.aud-verdict .big,.save-hero .v,.wcard .whead,.wbig,.wcostT tr.win td,.wcard h3,
.potmath .cell .num,.potmath .raw b,.potmath .keys li b{color:var(--hi)}
[style*="color:#fff"]{color:var(--hi) !important}
svg text[fill="#fff"]{fill:var(--hi)}
svg.phlogo g[fill="#fff"]{fill:var(--fg)}
`;
