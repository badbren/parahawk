/**
 * Inscribe — put text or a small file on Bitcoin, paid from your own Xverse.
 *
 * Lives in the desktop's top page on purpose: Xverse injects its provider into
 * the top page only, never into iframes, so the old iframe'd /inscribe page
 * could not reach the wallet from inside the desktop.
 *
 * Xverse does the Bitcoin part end to end. `createInscription`
 * (src/inscribe/payload.ts has the request, read from the sats-connect source)
 * builds the commit and reveal, pays from the wallet, broadcasts, and answers
 * with a txid. Parahawk never sees a key, never builds or signs a transaction,
 * and adds no fee. Mainnet only — that is all Xverse's flow supports.
 *
 * Our cost is an estimate (src/inscribe/cost.ts). The Xverse pop-up shows the
 * exact total, and that is where the person approves or cancels.
 *
 * Release gate (src/inscribe/release.ts): until INSCRIBE_OPEN_TO_ALL is flipped,
 * only the owner's press reaches Xverse. Everyone else uses the whole window and
 * stops at the step where Xverse would ask them to pay — nothing greyed out.
 */
import { POSTAGE_SATS, inscriptionCost, type InscriptionCost } from "../../inscribe/cost";
import { INSCRIBE_OPEN_TO_ALL, TEST_INSCRIPTIONS_BEFORE_RELEASE, mayInscribe } from "../../inscribe/release";
import {
  MAX_FILE_BYTES,
  PayloadError,
  TEXT_CONTENT_TYPE,
  base64,
  buildPayload,
  cleanFeeRate,
  contentTypeFor,
  isTxid,
  mempoolTxUrl,
  unsecuredToken,
  utf8Length,
  type InscriptionContent,
} from "../../inscribe/payload";
import type { TickFeed } from "../data/tick";
import type { ServerSession } from "../session/me";
import { createLocalStore, type KeyValueStore } from "../session/store";
import type { WalletSession } from "../session/wallet";
import { shortAddress } from "../session/wallet";
import { h } from "../util/dom";
import "./inscribe.css";

export interface InscribeOptions {
  wallet?: WalletSession;
  tick?: TickFeed;
  /** The server session: only the owner inscribes for real until release (src/inscribe/release.ts). */
  me?: ServerSession;
  /** Where "sent from this browser" is kept. Defaults to localStorage. */
  store?: KeyValueStore;
}

/** The one method of Xverse's injected provider this window uses. */
interface XverseInscriber {
  createInscription?: (token: string) => Promise<unknown>;
}

const xverse = (): XverseInscriber | null =>
  (window as unknown as { XverseProviders?: { BitcoinProvider?: XverseInscriber } }).XverseProviders?.BitcoinProvider ?? null;

const HISTORY_KEY = "inscribe.history";
const HISTORY_MAX = 12;
/** The "finished, admin is testing" banner, once closed in this browser. Bump the value to show a new banner again. */
const BANNER_KEY = "inscribe.banner";
const BANNER_ID = "release-test-1";
const FEES_REFRESH_MS = 120_000;
const GET_XVERSE = "https://www.xverse.app/download";

/** One inscription this browser sent, so a closed window never loses its txid. */
interface Sent {
  txId: string;
  at: number;
  label: string;
  bytes: number;
  contentType: string;
  feeRate: number;
}

interface Rates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  fetchedAt: string | null;
  stale: boolean;
}

type Speed = "fast" | "normal" | "slow" | "custom";
const SPEEDS: ReadonlyArray<{ id: Exclude<Speed, "custom">; label: string; hint: string; pick: (r: Rates) => number }> = [
  { id: "fast", label: "Fast", hint: "next block or two", pick: (r) => r.fastestFee },
  { id: "normal", label: "Normal", hint: "about 30 min", pick: (r) => r.halfHourFee },
  { id: "slow", label: "Slow", hint: "about an hour", pick: (r) => r.hourFee },
];

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const bytesLabel = (n: number) => (n < 1024 ? `${num(n)} bytes` : `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB`);
const when = (ms: number) =>
  new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Stored history is read defensively: a hand-edited entry must not break the window. */
function readHistory(store: KeyValueStore): Sent[] {
  const raw = store.get<unknown>(HISTORY_KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Sent => {
      const s = x as Partial<Sent> | null;
      return !!s && isTxid(s.txId) && typeof s.at === "number" && typeof s.label === "string";
    })
    .slice(0, HISTORY_MAX);
}

/** What a wallet error means to a person. A refusal in Xverse is the common case. */
function readableXverseError(err: unknown): string {
  const e = err as { message?: unknown; code?: unknown } | null;
  const msg = typeof e?.message === "string" ? e.message : typeof err === "string" ? err : "";
  if (e?.code === 4001 || e?.code === -32000 || /cancel|reject|denied|declin|closed/i.test(msg)) {
    return "Cancelled in Xverse — nothing was sent.";
  }
  return msg
    ? `Xverse stopped: ${msg}`
    : "Xverse stopped without saying why. Check Xverse's activity tab before trying again.";
}

/** "gm. inscribe me." → a short label for the history list. */
const textLabel = (text: string) => {
  const one = text.trim().replace(/\s+/g, " ");
  return one.length > 40 ? `${one.slice(0, 39)}…` : one;
};

export function mountInscribe(host: HTMLElement, opts: InscribeOptions = {}): () => void {
  const { wallet, tick, me } = opts;
  const store = opts.store ?? createLocalStore();
  host.classList.add("ph-ins");

  // ── State ────────────────────────────────────────────────────────────────
  /** Whether this person's press goes through to Xverse right now (release gate). */
  const goesToXverse = () => mayInscribe(me?.isAdmin() === true);
  let mode: "text" | "file" = "text";
  let file: { name: string; bytes: Uint8Array; contentType: string | null; preview: string | null } | null = null;
  let fileError: string | null = null;
  let rates: Rates | null = null;
  let ratesState: "loading" | "ready" | "error" = "loading";
  let speed: Speed = "normal";
  let connecting = false;
  let connectError: string | null = null;
  let busy = false;
  // "held": a non-owner pressed Inscribe before release — the window stopped at the pay step.
  let outcome: { kind: "sent"; txId: string } | { kind: "error"; message: string } | { kind: "held" } | null = null;
  let history = readHistory(store);
  let alive = true;
  let feesAbort: AbortController | null = null;

  // ── Static frame (built once; paint() only updates it) ───────────────────
  // Before release: a closable note that the tool is done and the owner is testing it.
  const bannerClose = h("button", { class: "ph-ins-banner-x", type: "button", "aria-label": "Close this note", title: "Close" }, "✕");
  const banner = h("div", { class: "ph-ins-banner", role: "note" },
    h("p", {},
      h("b", {}, "Inscribe is finished ✓"),
      ` — the admin is doing ${TEST_INSCRIPTIONS_BEFORE_RELEASE} test inscriptions before it opens to everyone. Try it all the way up to paying.`),
    bannerClose);
  banner.hidden = INSCRIBE_OPEN_TO_ALL || store.get<string>(BANNER_KEY) === BANNER_ID;
  bannerClose.addEventListener("click", () => { banner.hidden = true; store.set(BANNER_KEY, BANNER_ID); });

  const head = h("header", { class: "ph-ins-head" },
    h("h1", {}, "Inscribe"),
    h("p", {}, "Put text or a small file on Bitcoin, for good. Xverse builds it and pays from your wallet. Parahawk adds no fee."),
    h("p", { class: "ph-ins-note" },
      h("span", { class: "ph-ins-badge" }, "LIVE · MAINNET"),
      " Real bitcoin. An inscription can't be undone or edited."));

  const walletBody = h("div", { class: "ph-ins-wallet" });
  const walletSec = h("section", { class: "ph-ins-sec" }, h("h2", {}, "1 · Wallet"), walletBody);

  // Content: Text | File.
  const tabText = h("button", { class: "ph-ins-tab", type: "button", role: "tab" }, "Text");
  const tabFile = h("button", { class: "ph-ins-tab", type: "button", role: "tab" }, "File");
  const textArea = h("textarea", {
    class: "ph-ins-text", rows: 6, spellcheck: "false", "aria-label": "Text to inscribe", placeholder: "gm. inscribe me.",
  });
  const textMeta = h("p", { class: "ph-ins-meta" });
  const textPanel = h("div", { class: "ph-ins-panel", role: "tabpanel" }, textArea, textMeta);

  const fileInput = h("input", {
    class: "ph-ins-file", type: "file", "aria-label": "File to inscribe",
    accept: "image/*,text/plain,text/html,text/markdown,application/json,application/pdf,audio/*,video/*,model/gltf-binary,.glb,.md,.txt,.json",
  });
  const fileMeta = h("p", { class: "ph-ins-meta" });
  const filePreview = h("img", { class: "ph-ins-preview", alt: "", hidden: true });
  const clearFile = h("button", { class: "ph-ins-btn", type: "button", hidden: true }, "Clear file");
  const filePanel = h("div", { class: "ph-ins-panel", role: "tabpanel", hidden: true },
    h("div", { class: "ph-ins-row" }, fileInput, clearFile), fileMeta, filePreview,
    h("p", { class: "ph-ins-dim" }, `Images, text, JSON, PDF, audio or video — up to ${num(MAX_FILE_BYTES / 1024)} KB. Small is cheap: you pay per byte.`));
  const contentSec = h("section", { class: "ph-ins-sec" }, h("h2", {}, "2 · What to inscribe"),
    h("div", { class: "ph-ins-tabs", role: "tablist", "aria-label": "Content" }, tabText, tabFile), textPanel, filePanel);

  // Fee rate.
  const speedButtons = SPEEDS.map((s) => {
    const b = h("button", { class: "ph-ins-speed", type: "button", role: "radio" });
    b.addEventListener("click", () => { speed = s.id; paint(); });
    return { s, b };
  });
  const customBtn = h("button", { class: "ph-ins-speed", type: "button", role: "radio" }, h("b", {}, "Custom"));
  customBtn.addEventListener("click", () => { speed = "custom"; paint(); customInput.focus(); });
  const customInput = h("input", { class: "ph-ins-num", type: "number", min: 1, max: 2000, step: 1, value: 5, "aria-label": "Custom fee rate, sat/vB" });
  const feesLine = h("p", { class: "ph-ins-meta" });
  const feesRetry = h("button", { class: "ph-ins-btn", type: "button" }, "↻ Refresh");
  const feeSec = h("section", { class: "ph-ins-sec" }, h("h2", {}, "3 · Fee rate"),
    h("div", { class: "ph-ins-speeds", role: "radiogroup", "aria-label": "Fee rate" }, ...speedButtons.map((x) => x.b), customBtn),
    h("div", { class: "ph-ins-row ph-ins-custom" }, h("label", {}, customInput, " sat/vB")),
    h("div", { class: "ph-ins-row" }, feesLine, feesRetry));

  // Cost.
  const costBig = h("div", { class: "ph-ins-total" });
  const costTable = h("table", { class: "ph-ins-math" });
  const costSec = h("section", { class: "ph-ins-sec ph-ins-cost" }, h("h2", {}, "4 · Cost"), costBig,
    h("details", {}, h("summary", {}, "How we got this"), costTable),
    h("p", { class: "ph-ins-dim" }, "An estimate. Xverse shows the exact total before you approve, and you can still cancel there. Parahawk adds nothing on top."));

  // Go.
  const goBtn = h("button", { class: "ph-ins-go", type: "button" }, "Inscribe with Xverse");
  const why = h("p", { class: "ph-ins-why" });
  const out = h("div", { class: "ph-ins-out", "aria-live": "polite" });
  const goSec = h("section", { class: "ph-ins-sec" }, h("h2", {}, "5 · Inscribe"), goBtn, why, out);

  const histList = h("ul", { class: "ph-ins-hist-list" });
  const histSec = h("section", { class: "ph-ins-sec ph-ins-hist", hidden: true },
    h("h2", {}, "Sent from this browser"), histList);

  host.replaceChildren(banner, head, walletSec, contentSec, feeSec, costSec, goSec, histSec);

  // ── Derived values ───────────────────────────────────────────────────────
  const account = () => wallet?.account() ?? null;
  const signedInXverse = () => account()?.id === "xverse";

  const content = (): { bytes: number; type: string } | null => {
    if (mode === "text") return textArea.value.trim() ? { bytes: utf8Length(textArea.value), type: TEXT_CONTENT_TYPE } : null;
    return file && !fileError && file.contentType ? { bytes: file.bytes.length, type: file.contentType } : null;
  };

  const feeRate = (): number | null => {
    if (speed !== "custom") {
      const s = SPEEDS.find((x) => x.id === speed);
      return rates && s ? s.pick(rates) : null;
    }
    return cleanFeeRate(Number(customInput.value));
  };

  /** Why the button can't be pressed yet, or null when it can. */
  const blocker = (): string | null => {
    // A second press would inscribe (and pay for) the same thing again.
    if (outcome?.kind === "sent") return "Sent. Change the text or pick a new file to inscribe something else.";
    const p = xverse();
    if (!p) return "Install Xverse to inscribe (step 1).";
    if (!p.createInscription) return "This version of Xverse can't inscribe from websites — update the extension.";
    if (!signedInXverse()) return "Connect Xverse first (step 1).";
    if (mode === "file" && fileError) return fileError;
    if (!content()) return mode === "text" ? "Type something to inscribe (step 2)." : "Pick a file (step 2).";
    if (feeRate() == null) return speed === "custom" ? "Enter a fee rate between 1 and 2,000 sat/vB." : "Waiting for fee rates — or pick Custom.";
    return null;
  };

  // ── Paint ────────────────────────────────────────────────────────────────
  const paintWallet = () => {
    const acct = account();
    if (!xverse()) {
      walletBody.replaceChildren(
        h("p", {}, "Xverse isn't installed in this browser. ",
          h("a", { href: GET_XVERSE, target: "_blank", rel: "noopener noreferrer" }, "Get Xverse ↗"), ", then reload this page."),
        h("p", { class: "ph-ins-dim" }, "On a phone, open parahawk.space inside the Xverse app's browser."));
      return;
    }
    if (acct?.id === "xverse") {
      walletBody.replaceChildren(
        h("dl", { class: "ph-ins-dl" },
          h("dt", {}, "Inscription goes to"),
          h("dd", {}, acct.ordinals
            ? h("code", { title: acct.ordinals }, shortAddress(acct.ordinals, 8, 6))
            : "your Xverse ordinals address", h("span", { class: "ph-ins-dim" }, " (your ordinals address)")),
          h("dt", {}, "Paid from"),
          h("dd", {}, h("code", { title: acct.address }, shortAddress(acct.address, 8, 6)), h("span", { class: "ph-ins-dim" }, " (your Xverse payment address)"))));
      return;
    }
    if (acct) {
      // Signed in with a wallet that isn't Xverse: switching happens in the taskbar.
      walletBody.replaceChildren(h("p", {}, "Inscribing needs Xverse — taskbar → Connect wallet."));
      return;
    }
    const connect = h("button", { class: "ph-ins-btn ph-ins-btn--main", type: "button", disabled: connecting || !wallet }, connecting ? "Connecting…" : "Connect Xverse");
    connect.addEventListener("click", () => {
      if (!wallet || connecting) return;
      connecting = true; connectError = null; paint();
      wallet.connect("xverse")
        .then(() => { connectError = null; })
        .catch((e: unknown) => { connectError = e instanceof Error ? e.message : "Xverse could not connect."; })
        .finally(() => { connecting = false; if (alive) paint(); });
    });
    walletBody.replaceChildren(
      h("p", {}, "Connect Xverse to inscribe."),
      h("div", { class: "ph-ins-row" }, connect),
      h("p", { class: "ph-ins-dim" }, "Xverse asks you to sign a short message to sign in. Signing is free and moves nothing."),
      ...(connectError ? [h("p", { class: "ph-ins-bad" }, connectError)] : []));
  };

  const paintContent = () => {
    tabText.setAttribute("aria-selected", String(mode === "text"));
    tabFile.setAttribute("aria-selected", String(mode === "file"));
    textPanel.hidden = mode !== "text";
    filePanel.hidden = mode !== "file";
    const t = textArea.value;
    textMeta.textContent = `${bytesLabel(utf8Length(t))} · ${TEXT_CONTENT_TYPE}`;
    clearFile.hidden = !file;
    if (!file) {
      fileMeta.textContent = fileError ?? "No file picked.";
      fileMeta.classList.toggle("ph-ins-bad", !!fileError);
    } else {
      fileMeta.textContent = fileError ?? `${file.name} · ${bytesLabel(file.bytes.length)} · ${file.contentType ?? "unknown type"}`;
      fileMeta.classList.toggle("ph-ins-bad", !!fileError);
    }
    filePreview.hidden = !file?.preview;
    if (file?.preview) { if (filePreview.getAttribute("src") !== file.preview) filePreview.src = file.preview; }
    else filePreview.removeAttribute("src");
  };

  const paintFees = () => {
    for (const { s, b } of speedButtons) {
      b.replaceChildren(h("b", {}, s.label), h("span", {}, rates ? `${s.pick(rates)} sat/vB` : "—"), h("small", {}, s.hint));
      b.setAttribute("aria-checked", String(speed === s.id));
      b.disabled = !rates;
    }
    customBtn.setAttribute("aria-checked", String(speed === "custom"));
    customInput.closest(".ph-ins-custom")?.toggleAttribute("hidden", speed !== "custom");
    if (ratesState === "loading") feesLine.textContent = "Getting fee rates from mempool.space…";
    else if (ratesState === "error") feesLine.textContent = "Couldn't get fee rates right now — set one by hand (Custom).";
    else {
      const at = rates?.fetchedAt ? new Date(rates.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      feesLine.textContent = `From mempool.space${at ? `, ${at}` : ""}${rates?.stale ? " (old — mempool.space isn't answering)" : ""}.`;
    }
  };

  const costRows = (c: InscriptionCost, bytes: number, type: string) => [
    ["Content", `${bytesLabel(bytes)} · ${type}`],
    ["Reveal", `${num(c.reveal.vbytes)} vB (${num(c.reveal.weight)} weight units; the content rides in the witness at ¼ vB a byte)`],
    ["Commit", `${num(c.commitVbytes)} vB (one input from your wallet, plus change)`],
    ["Reveal fee", `${num(c.reveal.vbytes)} vB × ${c.feeRate} = ${num(c.revealFee)} sats`],
    ["Commit fee", `${num(c.commitVbytes)} vB × ${c.feeRate} = ${num(c.commitFee)} sats`],
    ["Postage", `${num(POSTAGE_SATS)} sats (stays inside the inscription — still yours)`],
    ["Total", `${num(c.total)} sats`],
  ];

  const paintCost = () => {
    const c = content();
    const rate = feeRate();
    if (!c || rate == null) {
      costBig.replaceChildren(h("span", { class: "ph-ins-dim" }, c ? "Pick a fee rate to see the cost." : "Add something to inscribe to see the cost."));
      costTable.replaceChildren();
      return;
    }
    const cost = inscriptionCost({ contentBytes: c.bytes, contentType: c.type, feeRate: rate, paymentAddress: signedInXverse() ? account()?.address : null });
    const btcUsd = tick?.latest()?.btcUsd ?? 0;
    costBig.replaceChildren(
      h("b", {}, `≈ ${num(cost.total)} sats`),
      ...(btcUsd > 0 ? [h("span", {}, ` ≈ $${((cost.total / 1e8) * btcUsd).toFixed(2)}`)] : []));
    costTable.replaceChildren(...costRows(cost, c.bytes, c.type).map(([k, v]) => h("tr", {}, h("th", { scope: "row" }, k!), h("td", {}, v!))));
  };

  const paintGo = () => {
    const stop = blocker();
    goBtn.disabled = busy || stop != null;
    goBtn.textContent = busy ? "Waiting for Xverse…" : "Inscribe with Xverse";
    // Before release the owner's press is the only real one — say so where they press it.
    const ownerTest = !INSCRIBE_OPEN_TO_ALL && goesToXverse() && stop == null;
    why.textContent = busy
      ? "Approve or cancel in the Xverse pop-up."
      : stop ?? (ownerTest ? "You're the admin, so this one is real: Xverse will ask you to pay. Everyone else stops here for now." : "");
    why.hidden = !why.textContent;
    if (!outcome) { out.replaceChildren(); return; }
    if (outcome.kind === "error") { out.replaceChildren(h("p", { class: "ph-ins-bad" }, outcome.message)); return; }
    if (outcome.kind === "held") {
      out.replaceChildren(h("div", { class: "ph-ins-held" },
        h("p", {}, h("b", {}, "Almost there"), " — inscribing opens to everyone soon. ",
          `The admin is doing ${TEST_INSCRIPTIONS_BEFORE_RELEASE} test inscriptions first.`),
        h("p", { class: "ph-ins-dim" }, "This is the step where Xverse would ask you to pay. Nothing was sent and nothing was charged.")));
      return;
    }
    const again = h("button", { class: "ph-ins-btn", type: "button" }, "Inscribe something else");
    again.addEventListener("click", () => {
      outcome = null; textArea.value = ""; setFile(null); paint(); textArea.focus();
    });
    out.replaceChildren(h("div", { class: "ph-ins-sent" },
      h("p", {}, h("b", {}, "✓ Sent."), " Xverse built it, paid for it and broadcast it."),
      h("p", {}, "Transaction: ",
        h("a", { href: mempoolTxUrl(outcome.txId), target: "_blank", rel: "noopener noreferrer" }, `${outcome.txId.slice(0, 10)}…${outcome.txId.slice(-6)} on mempool.space ↗`)),
      h("p", { class: "ph-ins-dim" }, "It shows up in Xverse under Collectibles once it confirms — usually within the hour at the rate you picked."),
      again));
  };

  const paintHistory = () => {
    histSec.hidden = history.length === 0;
    histList.replaceChildren(...history.map((s) =>
      h("li", {},
        h("span", { class: "ph-ins-dim" }, when(s.at)),
        h("span", { class: "ph-ins-hist-label", title: s.label }, s.label || "(file)"),
        h("span", { class: "ph-ins-dim" }, bytesLabel(s.bytes)),
        h("a", { href: mempoolTxUrl(s.txId), target: "_blank", rel: "noopener noreferrer" }, "tx ↗"))));
  };

  const paint = () => {
    if (!alive) return;
    paintWallet();
    paintContent();
    paintFees();
    paintCost();
    paintGo();
    paintHistory();
  };

  // ── Content ──────────────────────────────────────────────────────────────
  let fileSeq = 0;
  const setFile = (f: File | null) => {
    const mine = ++fileSeq;
    fileError = null;
    if (!f) { file = null; fileInput.value = ""; paint(); return; }
    const contentType = contentTypeFor(f.name, f.type);
    if (f.size > MAX_FILE_BYTES) {
      file = { name: f.name, bytes: new Uint8Array(0), contentType, preview: null };
      fileError = `${f.name} is ${bytesLabel(f.size)} — Xverse takes up to ${num(MAX_FILE_BYTES / 1024)} KB.`;
      paint();
      return;
    }
    if (!contentType) fileError = "Xverse can't inscribe that kind of file.";
    void f.arrayBuffer().then((buf) => {
      if (mine !== fileSeq || !alive) return;
      const bytes = new Uint8Array(buf);
      // The page's CSP allows data: images (not blob:), and the bytes are in hand anyway.
      const preview = contentType?.startsWith("image/") ? `data:${contentType};base64,${base64(bytes)}` : null;
      file = { name: f.name, bytes, contentType, preview };
      if (!fileError && bytes.length === 0) fileError = "That file is empty.";
      paint();
    }, () => {
      if (mine !== fileSeq || !alive) return;
      file = null; fileError = "Couldn't read that file."; paint();
    });
  };

  // Changing what's in the box starts a new inscription: the last result clears
  // (a sent txid stays in "Sent from this browser" below).
  const setMode = (next: "text" | "file") => {
    if (next !== mode) { mode = next; outcome = null; }
    paint();
  };
  tabText.addEventListener("click", () => setMode("text"));
  tabFile.addEventListener("click", () => setMode("file"));
  textArea.addEventListener("input", () => { outcome = null; paintContent(); paintCost(); paintGo(); });
  fileInput.addEventListener("change", () => { outcome = null; setFile(fileInput.files?.[0] ?? null); });
  clearFile.addEventListener("click", () => setFile(null));
  customInput.addEventListener("input", () => { paintCost(); paintGo(); });

  // ── Fee rates ────────────────────────────────────────────────────────────
  const loadFees = () => {
    feesAbort?.abort();
    const ctrl = new AbortController();
    feesAbort = ctrl;
    if (!rates) { ratesState = "loading"; paintFees(); }
    fetch("/api/inscribe/fees", { credentials: "same-origin", signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: Partial<Record<keyof Rates, unknown>>) => {
        const ok = (v: unknown) => typeof v === "number" && v >= 1;
        if (!ok(j.fastestFee) || !ok(j.halfHourFee) || !ok(j.hourFee)) throw new Error("bad rates");
        rates = {
          fastestFee: j.fastestFee as number, halfHourFee: j.halfHourFee as number, hourFee: j.hourFee as number,
          fetchedAt: typeof j.fetchedAt === "string" ? j.fetchedAt : null, stale: j.stale === true,
        };
        ratesState = "ready";
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        if (!rates) { ratesState = "error"; speed = "custom"; }
      })
      .finally(() => { if (feesAbort === ctrl) feesAbort = null; if (alive && !ctrl.signal.aborted) paint(); });
  };
  feesRetry.addEventListener("click", loadFees);
  const feesTimer = window.setInterval(() => { if (document.visibilityState === "visible") loadFees(); }, FEES_REFRESH_MS);

  // ── Inscribe ─────────────────────────────────────────────────────────────
  goBtn.addEventListener("click", async () => {
    if (busy || blocker() != null) return;
    const provider = xverse();
    const rate = feeRate();
    if (!provider?.createInscription || rate == null) return;

    let request: InscriptionContent;
    let label: string, bytes: number, type: string;
    if (mode === "text") {
      request = { kind: "text", text: textArea.value };
      label = textLabel(textArea.value); bytes = utf8Length(textArea.value); type = TEXT_CONTENT_TYPE;
    } else {
      if (!file?.contentType) return;
      request = { kind: "file", bytes: file.bytes, contentType: file.contentType };
      label = file.name; bytes = file.bytes.length; type = file.contentType;
    }

    let token: string;
    try {
      token = unsecuredToken(buildPayload(request, rate));
    } catch (e) {
      outcome = { kind: "error", message: e instanceof PayloadError ? e.message : "Couldn't prepare that for Xverse." };
      paint();
      return;
    }

    // Release gate: everything up to here is real (the request is built and
    // checked); the call that makes Xverse ask for payment is the owner's alone.
    if (!goesToXverse()) {
      outcome = { kind: "held" };
      paint();
      return;
    }

    busy = true; outcome = null; paint();
    try {
      const res = await provider.createInscription(token);
      const txId = (res as { txId?: unknown } | null | undefined)?.txId;
      if (!isTxid(txId)) throw new Error("it finished without a transaction id — check Xverse's activity tab before trying again");
      // Saved even if the window was closed meanwhile: a txid must never be lost.
      history = [{ txId, at: Date.now(), label, bytes, contentType: type, feeRate: rate }, ...history.filter((s) => s.txId !== txId)].slice(0, HISTORY_MAX);
      store.set(HISTORY_KEY, history);
      outcome = { kind: "sent", txId };
    } catch (err) {
      outcome = { kind: "error", message: readableXverseError(err) };
    } finally {
      busy = false;
      paint();
    }
  });

  // ── Live data ────────────────────────────────────────────────────────────
  const offWallet = wallet?.subscribe(() => { connectError = connectError && signedInXverse() ? null : connectError; paint(); });
  const offTick = tick?.subscribe(() => paintCost());
  // The owner check can land after the window opens (the session is asked on load).
  const offMe = me?.subscribe(() => { if (outcome?.kind === "held" && goesToXverse()) outcome = null; paint(); });

  paint();
  loadFees();

  return () => {
    alive = false;
    feesAbort?.abort();
    clearInterval(feesTimer);
    offWallet?.();
    offTick?.();
    offMe?.();
    host.classList.remove("ph-ins");
  };
}
