/**
 * Profile — the window that appears once a wallet is connected.
 *
 * It is deliberately honest about being mostly empty: the mint, forge and game
 * are not live, so the collection and ore rows show real zeroes against real
 * caps rather than invented numbers or fake activity. When those systems ship,
 * the placeholders here are the shape the data goes into.
 */
import {
  GAME_RESERVE,
  MAX_ORE_PER_RUN,
  MAX_PLAYS_PER_WALLET,
  ORE_PER_BLACK,
  TIERS,
  type Tier,
} from "../../econ/tokenomics";
import type { PracticeLedger } from "../session/ledger";
import type { WalletAccount, WalletSession } from "../session/wallet";
import { shortAddress } from "../session/wallet";
import { h } from "../util/dom";

const CHAIN_LABEL: Record<WalletAccount["chain"], string> = { solana: "Solana", evm: "Ethereum / EVM" };
const WALLET_LABEL: Record<WalletAccount["id"], string> = { phantom: "Phantom", metamask: "MetaMask" };

function section(title: string, ...body: Array<Node | string | false | null>): HTMLElement {
  return h("section", { class: "ph-prof-sec" }, h("h2", {}, title), ...body);
}

/** A count against a cap, e.g. "0 / 20 runs used". */
function stat(label: string, value: string, note?: string): HTMLElement {
  return h("div", { class: "ph-prof-stat" },
    h("span", { class: "ph-prof-stat-v" }, value),
    h("span", { class: "ph-prof-stat-l" }, label),
    note ? h("span", { class: "ph-prof-stat-n" }, note) : null);
}

function tierRow(t: Tier, held: number): HTMLElement {
  return h("tr", { class: held > 0 ? "is-held" : "" },
    h("th", { scope: "row" },
      h("span", { class: "ph-prof-chip" },
        h("i", { class: "ph-prof-swatch", style: `background:${t.color}`, "aria-hidden": "true" }), t.name)),
    h("td", { class: "ph-num" }, String(held)),
    h("td", { class: "ph-num ph-prof-dim" }, t.weight.toLocaleString("en-US", { maximumFractionDigits: 2 })),
    h("td", { class: "ph-num ph-prof-dim" }, (held * t.weight).toLocaleString("en-US", { maximumFractionDigits: 2 })));
}

export function mountProfile(host: HTMLElement, session: WalletSession, ledger?: PracticeLedger): () => void {
  host.classList.add("ph-prof");

  const render = (acct: WalletAccount | null) => {
    if (!acct) {
      host.replaceChildren(h("div", { class: "ph-prof-empty" },
        h("p", {}, "No wallet connected."),
        h("p", { class: "ph-prof-dim" }, "Use ", h("strong", {}, "Connect wallet"), " in the taskbar to sign in again.")));
      return;
    }

    // ── Identity ───────────────────────────────────────────────────────────
    const addr = h("code", { class: "ph-prof-addr", title: acct.address }, acct.address);
    const copy = h("button", { class: "ph-prof-btn", type: "button" }, "Copy");
    let copyTimer: number | null = null;
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(acct.address).then(
        () => {
          copy.textContent = "Copied";
          if (copyTimer != null) clearTimeout(copyTimer);
          copyTimer = window.setTimeout(() => { copy.textContent = "Copy"; copyTimer = null; }, 1400);
        },
        () => { copy.textContent = "Press Ctrl+C"; },
      );
    });

    const identity = h("header", { class: "ph-prof-id" },
      h("div", { class: "ph-prof-id-top" },
        h("span", { class: "ph-prof-who" }, shortAddress(acct.address, 6, 6)),
        h("span", { class: "ph-prof-tag" }, WALLET_LABEL[acct.id]),
        h("span", { class: "ph-prof-tag" }, CHAIN_LABEL[acct.chain])),
      h("div", { class: "ph-prof-id-addr" }, addr, copy),
      h("p", { class: "ph-prof-dim" },
        "This is a read-only sign-in. Parahawk can see this address and nothing else — it cannot move funds, and it never asks you to sign a transaction to look at your profile."));

    // ── Collection ─────────────────────────────────────────────────────────
    const collection = section("Collection",
      h("div", { class: "ph-prof-scroll" },
        h("table", { class: "ph-prof-table" },
          h("thead", {}, h("tr", {},
            h("th", { scope: "col" }, "Tier"),
            h("th", { scope: "col", class: "ph-num" }, "Held"),
            h("th", { scope: "col", class: "ph-num" }, "Weight each"),
            h("th", { scope: "col", class: "ph-num" }, "Your weight"))),
          h("tbody", {}, ...TIERS.map((t) => tierRow(t, 0))))),
      h("p", { class: "ph-prof-note" },
        h("span", { class: "ph-prof-badge" }, "PLANNED"),
        " Nothing is minted yet — no contract is deployed and the chain is not final. These are real zeroes, not a loading state."));

    // ── Practice ───────────────────────────────────────────────────────────
    // Real numbers from real runs, but a practice record: no contract exists,
    // nothing here is an NFT, and it does not carry over. Said plainly below.
    const led = ledger?.state();
    const runs = led?.runs ?? 0;
    const ore = led?.ore ?? 0;
    const claimed = led?.blacks ?? [];
    const toGo = Math.max(0, ORE_PER_BLACK - ore);

    const claimedList = claimed.length > 0
      ? h("div", { class: "ph-prof-claims" },
          ...claimed.slice().reverse().map((b) =>
            h("div", { class: "ph-prof-claim" },
              h("i", { class: "ph-prof-swatch", style: `background:${TIERS[0]!.color}`, "aria-hidden": "true" }),
              h("b", {}, "Black"),
              h("code", {}, b.id),
              h("span", {}, new Date(b.at).toLocaleDateString()))))
      : null;

    const game = section("Mining — practice",
      h("div", { class: "ph-prof-stats" },
        stat("runs", String(runs), `the live cap will be ${MAX_PLAYS_PER_WALLET} per wallet`),
        stat("ore banked", ore.toLocaleString("en-US"), toGo > 0 ? `${toGo.toLocaleString("en-US")} to go for a Black` : "enough for a Black"),
        stat("best run", String(led?.bestRun ?? 0), `capped at ${MAX_ORE_PER_RUN} a run`),
        stat("Blacks claimed", String(claimed.length), `from a ${GAME_RESERVE.toLocaleString("en-US")} reserve`)),
      claimedList,
      h("p", { class: "ph-prof-note" },
        h("span", { class: "ph-prof-badge" }, "PRACTICE"),
        " These are your real runs, but a practice record — nothing above is an NFT, nothing was minted, and none of it carries over when the collection ships."));

    // ── Desktop ────────────────────────────────────────────────────────────
    const desktop = section("Desktop",
      h("p", {}, "Your icon layout and hidden apps are saved ", h("strong", {}, "in this browser"), " right now."),
      h("p", { class: "ph-prof-note" },
        h("span", { class: "ph-prof-badge" }, "SOON"),
        " Per-wallet sync, so the same desktop follows this address to any browser."));

    const disconnect = h("button", { class: "ph-prof-btn ph-prof-btn-danger", type: "button" }, "Disconnect");
    disconnect.addEventListener("click", () => session.disconnect());
    const foot = h("footer", { class: "ph-prof-foot" }, disconnect);

    host.replaceChildren(identity, collection, game, desktop, foot);
  };

  // Both identities matter: which wallet is signed in, and what it has mined.
  const offWallet = session.subscribe(render);
  const offLedger = ledger?.subscribe(() => render(session.account()));

  return () => {
    offWallet();
    offLedger?.();
    host.classList.remove("ph-prof");
  };
}
