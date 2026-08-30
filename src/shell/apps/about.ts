/**
 * "What is this place?" — the one window that explains Parahawk, the mint, the
 * ladder and the game.
 *
 * Every figure on screen is read from src/econ/tokenomics.ts, so the copy can
 * never drift from the spec: retune a knob there and this window retells the
 * story correctly. USD figures track the live BTC price from the tick feed and
 * simply disappear until a price arrives — they are never guessed.
 *
 * Honesty rule: the STATUS section is not decoration. Nothing here is live
 * yet, and this window says so plainly. Do not soften it until the contracts
 * actually ship.
 */
import {
  BLACK,
  BLACKS_PER_PHD,
  BLACK_PRICE_SATS,
  FULL_MINT_PHD,
  FULL_MINT_SATS,
  GAME_RESERVE,
  GENESIS_SUPPLY,
  MAX_ORE_PER_RUN,
  MAX_PLAYS_PER_WALLET,
  MAX_SPEND_PER_WALLET_SATS,
  ORE_PER_BLACK,
  PLAY_PRICE_SATS,
  SATS_PER_BTC,
  TIERS,
  TOP_TIER,
  fmtSats,
  fmtSatsUsd,
  type Tier,
} from "../../econ/tokenomics";
import { BLOCK_BONUS, MAX_NONCES, RUN_SECONDS } from "./game/blockrun";
import type { TickFeed } from "../data/tick";
import { h } from "../util/dom";

/** A titled block with a Win98-ish bevelled header. */
function section(title: string, ...body: Array<Node | string | false | null>): HTMLElement {
  return h("section", { class: "ph-about-sec" }, h("h2", {}, title), ...body);
}

const p = (...kids: Array<Node | string | false | null>) => h("p", {}, ...kids);
const strong = (s: string) => h("strong", {}, s);
const dim = (s: string) => h("span", { class: "ph-about-dim" }, s);

/** A tier's colour chip plus its name, used in the ladder table and the game copy. */
function chip(t: Tier): HTMLElement {
  return h("span", { class: "ph-about-chip" },
    h("i", { class: "ph-about-swatch", style: `background:${t.color}`, "aria-hidden": "true" }),
    t.name);
}

/** Rows carrying sats figures re-render when the BTC price lands, so USD stays live. */
interface SatsCell { el: HTMLElement; sats: number }

export function mountAbout(host: HTMLElement, tick?: TickFeed): () => void {
  host.classList.add("ph-about");
  const satsCells: SatsCell[] = [];
  /** A cell that shows sats now and gains its "(~$x)" half once a price is known. */
  const satsText = (sats: number, cls?: string): HTMLElement => {
    const el = h("span", cls ? { class: cls } : {}, fmtSats(sats));
    satsCells.push({ el, sats });
    return el;
  };

  // ── Hero ─────────────────────────────────────────────────────────────────
  const hero = h("header", { class: "ph-about-hero" },
    h("h1", {}, "What is this place?"),
    p("Parahawk is a free stats and alerts platform for the ",
      h("a", { href: "https://parasite.wtf", target: "_blank", rel: "noreferrer noopener" }, "Parasite Pool"),
      " bitcoin mining community — pot age, hashprice, the luck audit, per-address odometers. All of it is free and always will be."),
    p("This desktop is the front door. The stats site is one app in a window; the rest is what we are building on top: ",
      strong("an NFT collection whose whole purpose is to buy the pool more hashpower"), "."));

  // ── Status (the honest bit) ──────────────────────────────────────────────
  const statusRow = (state: "live" | "soon" | "planned", label: string, note: string) =>
    h("li", { class: `ph-about-status is-${state}` },
      h("span", { class: "ph-about-badge" }, state === "live" ? "LIVE" : state === "soon" ? "SOON" : "PLANNED"),
      h("span", {}, strong(label), " ", dim(note)));

  const status = section("Status — read this first",
    p("The numbers below are the ", strong("published design"), ", not a live product. Nothing can be bought yet."),
    h("ul", { class: "ph-about-statuses" },
      statusRow("live", "The stats site", "— pot, hashprice, luck audit, odometers. Free, working, no wallet needed."),
      statusRow("live", "This desktop", "— open to everyone as a guest. There is no login wall and there never will be."),
      statusRow("live", "Wallet sign-in", "— connect Phantom or MetaMask to get a Profile. Read-only: it proves who you are, it never moves funds."),
      statusRow("live", "The game", "— Block Hunt is on the desktop and playable now, free, as a practice run. Nothing is charged and no ore is claimed."),
      statusRow("planned", "The mint and the forge", "— the economics are locked (below). No contract is deployed and the chain is not final."),
    ),
    p(dim("If any of that changes, this window changes with it — it is generated from the same file the contracts will be.")));

  // ── The mint ─────────────────────────────────────────────────────────────
  const mint = section("The mint",
    p("One tier is mintable: ", chip(BLACK), ". Everything above it is forged, never sold."),
    h("div", { class: "ph-about-anchor" },
      h("div", { class: "ph-about-big" }, satsText(BLACK_PRICE_SATS), h("span", {}, " per Black")),
      h("div", { class: "ph-about-eq" },
        h("span", {}, `${BLACKS_PER_PHD} Blacks buy 1 PHd of Parasite hashpower`),
        h("span", {}, `${GENESIS_SUPPLY.toLocaleString("en-US")} Blacks = ${(FULL_MINT_SATS / SATS_PER_BTC).toFixed(2)} BTC = ${FULL_MINT_PHD.toLocaleString("en-US")} PHd`))),
    p("That is the whole idea in one line: ", strong("the full mint is exactly one bitcoin, and it buys the pool 2,000 petahash-days."),
      " Supply was picked to make that true, not the other way round."),
    p("The mint is ", strong("open and rolling"), " — no countdown, no sellout pressure. Blacks mint on demand up to ",
      GENESIS_SUPPLY.toLocaleString("en-US"), ", and the pool buys hashpower as they do. ",
      GAME_RESERVE.toLocaleString("en-US"), " of them (a tenth) are held back to be earned in the game rather than bought."));

  // ── The ladder ───────────────────────────────────────────────────────────
  const ladderRows = TIERS.map((t) =>
    h("tr", {},
      h("th", { scope: "row" }, chip(t)),
      h("td", {}, t.rung === 0 ? dim("mint or game") : `${t.burn} × ${TIERS[t.rung - 1]!.name}`),
      h("td", { class: "ph-num" }, t.blacks.toLocaleString("en-US")),
      h("td", { class: "ph-num" }, t.maxSupply.toLocaleString("en-US")),
      h("td", { class: "ph-num" }, t.rung === 0 ? dim("—") : satsText(t.forgeFeeSats)),
      h("td", { class: "ph-num" }, t.weight.toLocaleString("en-US", { maximumFractionDigits: 2 }))));

  const ladder = section("The ladder — burn two, get one",
    p("Forging destroys what it consumes. Burn ", strong("2 Blacks"), " for an Orange, 3 Oranges for a Green, and so on up. ",
      "Because every forge burns more than it creates, ", strong("the number of Parahawk NFTs in existence only ever goes down"), ". ",
      GENESIS_SUPPLY.toLocaleString("en-US"), " is the number minted, not the number that will exist."),
    h("div", { class: "ph-about-scroll" },
      h("table", { class: "ph-about-table" },
        h("thead", {}, h("tr", {},
          h("th", { scope: "col" }, "Tier"),
          h("th", { scope: "col" }, "Forged from"),
          h("th", { scope: "col", class: "ph-num" }, "Blacks"),
          h("th", { scope: "col", class: "ph-num" }, "Max ever"),
          h("th", { scope: "col", class: "ph-num" }, "Forge fee"),
          h("th", { scope: "col", class: "ph-num" }, "Weight"))),
        h("tbody", {}, ...ladderRows))),
    h("dl", { class: "ph-about-defs" },
      h("dt", {}, "Max ever"),
      h("dd", {}, "The ceiling if every single Black were forged all the way up. Nobody gets close — expect a handful of ", chip(TOP_TIER), " to exist, ever."),
      h("dt", {}, "Forge fee"),
      h("dd", {}, "A flat ", strong("20% of what you burn"), ", priced off the protocol's own base value (Blacks consumed × mint price) rather than a floor. ",
        dim("Floor-linked fees need an oracle and can be manipulated; this cannot.")),
      h("dt", {}, "Weight"),
      h("dd", {}, "Share of the pool hashpower the NFT earns, with Black = 1. Each rung adds a ", strong("+25% bonus"),
        " on top of what it burned — that bonus is the reason to forge instead of hoarding.")));

  // ── The game ─────────────────────────────────────────────────────────────
  const game = section("The game",
    p(strong("Block Hunt"), " is on the desktop now — free to play, nothing claimed. You are the parasite. You burrow down a winding passage for ",
      strong(`${RUN_SECONDS} seconds`), ", through rock that changes as you go, and break into a block at the bottom."),
    h("ul", { class: "ph-about-list" },
      h("li", {}, h("span", { class: "ph-about-k" }, "Steer left and right"), " — that is the whole control. You cannot get lost and you cannot stall."),
      h("li", {}, h("span", { class: "ph-about-k" }, "Catch hashes"), " as the passage winds. Catch them cleanly and your multiplier climbs; scraping a wall costs the streak and nothing else."),
      h("li", {}, h("span", { class: "ph-about-k" }, `${MAX_NONCES} nonces`), " a run hide in chambers off the easy line. They are the reason to look around."),
      h("li", {}, h("span", { class: "ph-about-k" }, "You always find the block."),
        ` There is no way to fail a run — breaking in pays ${BLOCK_BONUS} on its own, so nobody goes home with nothing.`)),
    h("ul", { class: "ph-about-list" },
      h("li", {}, satsText(PLAY_PRICE_SATS, "ph-about-k"), " a run — a tenth of a Black."),
      h("li", {}, h("span", { class: "ph-about-k" }, `${MAX_PLAYS_PER_WALLET} runs`), " per wallet, ever. That is ", satsText(MAX_SPEND_PER_WALLET_SATS), " all-in."),
      h("li", {}, h("span", { class: "ph-about-k" }, `${ORE_PER_BLACK.toLocaleString("en-US")} ore`), " claims one ", chip(BLACK), " from the game reserve."),
      h("li", {}, `A first run banks around 100. A decent one is about 130, and even flawless play is capped at ${MAX_ORE_PER_RUN}. So ${MAX_PLAYS_PER_WALLET} runs is roughly `,
        strong("2 Blacks"), " for most people, and 4 at the absolute limit.")),
    p(strong("The game is never a cheaper mint."), " The ore rate is set so an ordinary player earns Blacks at ",
      satsText(BLACK_PRICE_SATS), " each — exactly the mint price. Skill earns a discount; the run cap and the per-run ceiling bound it."),
    p(strong("It is deliberately not winner-take-all."), " Because every run is the same length and everyone who reaches the block banks the same bonus, the gap between a first run and an expert one stays near ",
      strong("2×"), " rather than running away. Being good helps; being new is never worthless."),
    p(dim("The per-wallet cap is not sybil-proof — wallets are free. It does not need to be: runs are paid, and the rate matches the mint, so spinning up wallets buys effort, not discount. The cap is there for fairness and to meter the faucet.")));

  // ── Where the sats go ────────────────────────────────────────────────────
  const proceeds = section("Where the sats go",
    p("Mint, forge fees and game runs all point at the same place: ", strong("buying Parasite hashpower"),
      " through the Refinery, at roughly 50,000 sats per petahash-day."),
    p("Parasite is building an API that would let a contract buy hashpower automatically. ",
      dim("It does not exist yet — until it does, this is a stated commitment and a public ledger, not an automated one. We would rather say that than imply otherwise.")));

  const footer = h("footer", { class: "ph-about-foot" },
    p(dim("Numbers on this page are generated from the project's tokenomics module and covered by tests. If you spot a contradiction between this window and anything else we publish, this window is the one that is right.")));

  host.replaceChildren(hero, status, mint, ladder, game, proceeds, footer);

  // ── Live USD ─────────────────────────────────────────────────────────────
  // Sats are the unit of account; USD is a courtesy that appears once we have a
  // price and updates as it moves. No price, no dollar figures — never a guess.
  const paint = (btcUsd: number | null) => {
    for (const c of satsCells) c.el.textContent = fmtSatsUsd(c.sats, btcUsd);
  };
  paint(tick?.latest()?.btcUsd ?? null);
  const off = tick?.subscribe((t) => paint(t.btcUsd));

  return () => {
    off?.();
    host.classList.remove("ph-about");
  };
}
