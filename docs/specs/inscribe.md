# Spec — Inscribe (network-fee-only Ordinals on mainnet, via Xverse)

## Goal
Let a user inscribe an Ordinal on Bitcoin **mainnet** paying **only the network fee** — no
marketplace markup and, critically, **not** paying the service fee that Xverse's built-in
inscription flow charges. Connect Xverse (sats-connect), enter content (text or an image/file),
pick a fee rate, see a **live, itemized cost estimate**, and (eventually) inscribe.

Status of the shipped page (`src/web/pages/inscribe.ts`):
- **Real:** wallet connect + address retrieval (sats-connect from jsdelivr), and the live
  size/fee estimate with the math shown on screen.
- **Gated off (not live):** the commit-PSBT build → `signPsbt` → broadcast reveal flow. Pressing
  *Inscribe* only `console.log()`s the intended plan and broadcasts nothing. This is deliberate —
  see [Risks](#funds--security-risks). Do not remove the gate until the phased plan below is done.

---

## How an Ordinal inscription works (commit / reveal)

An inscription is created with **two transactions**, because the inscription content is embedded in
a **taproot script-path spend** and Bitcoin only reveals a taproot leaf script when it is *spent*.

### 1. The reveal script (the "envelope")
Ord stores content inside an unexecuted branch of a taproot leaf script:

```
<32-byte internal pubkey> OP_CHECKSIG      # so the leaf is spendable with a signature
OP_FALSE
OP_IF
  OP_PUSH "ord"                            # protocol marker
  OP_PUSH 0x01  OP_PUSH <content-type>     # tag 1 = content-type, e.g. text/plain;charset=utf-8
  OP_0                                      # body separator (empty push)
  OP_PUSH <chunk-1> ... OP_PUSH <chunk-n>  # body, split into <=520-byte pushes
OP_ENDIF
```

`OP_FALSE OP_IF … OP_ENDIF` is never executed, so arbitrary data rides along for free (script-wise).
The body is chunked into **≤520-byte** pushes (Bitcoin's max element push), so large content adds a
small per-chunk push-opcode overhead (`OP_PUSHDATA2` = 3 bytes per full 520-byte chunk).

### 2. Commit tx
A normal transaction whose output is a **P2TR (taproot) address** whose tweaked output key commits
to the reveal leaf script above. It funds that output with `reveal_fee + postage` sats. Its size (and
fee) depend on which UTXOs the wallet selects — for the estimate we assume **1 taproot input + 2
outputs** (commit + change).

### 3. Reveal tx
Spends the commit output via the **script path**, putting the envelope in the **witness**. The
witness stack is `[schnorr-signature, reveal-script, control-block]`. Because witness data is
discounted **4×** in weight, the content is cheap: 1 witness byte = ¼ vbyte.

- **Weight** = `base_size × 4 + witness_size` (segwit marker+flag count as 2 witness bytes).
- **vbytes** = `ceil(weight / 4)`.

The reveal's single output is the **inscription output**, sent to the user's **ordinals** address and
carrying the **postage**.

### Postage / dust
The inscription "lives" on a specific sat inside the reveal output. That output must be ≥ the dust
limit. We use **546 sats** (the shipped `POSTAGE_SATS`). This is **not a fee** — it's the user's own
sats, now owned as the inscription's UTXO; they get it back if they ever move the inscription. (P2TR
dust is technically ~330 sats; 546 is the conventional, wallet-safe default.)

### The estimate implemented on the page
`estimateReveal(contentBytes, contentType)` in `inscribe.ts` computes, live:
`content bytes → reveal leaf-script bytes → witness bytes → weight → reveal vbytes`, then
`reveal_fee = reveal_vB × rate`, `commit_fee = commit_vB × rate` (commit_vB ≈ `11 + 58 + 43 + 43`),
`total ≈ commit_fee + reveal_fee + postage`. The page prints every intermediate number so it can be
checked by hand. Numbers are **estimates** — the true commit size depends on real UTXO selection.

---

## Is "network-fee-only" achievable? (and its limits)

**Yes — but only by building the commit/reveal ourselves.** The user then pays exactly:

```
commit_fee (vB × rate) + reveal_fee (vB × rate) + postage (returned to them as the inscription)
```

Nothing accrues to Parahawk. The catch is that **you must not use a wallet's turnkey "inscribe"
API**, because those bundle a service fee (see next section). Limits / honesty:

- **You can't beat the fee floor.** Two transactions (commit + reveal) is inherent to ordinals; a
  tiny text inscription is still ~300–500 vB total. There is no one-tx shortcut on mainnet today.
- **Estimate ≠ exact.** Real commit size depends on the wallet's coin selection; our estimate assumes
  one taproot input. Multiple/legacy inputs cost more.
- **Fee-rate accuracy** needs a live mempool feed, which the browser can't fetch directly (CSP) — see
  the proxy requirement below.
- **We build unsigned PSBTs; the wallet signs.** Parahawk never holds keys or funds. The user
  approves every signature in Xverse.

---

## What Xverse **can** and **can't** do via sats-connect

sats-connect is Xverse's (and other wallets') JS bridge. The page loads it from
`https://cdn.jsdelivr.net/npm/sats-connect@3/+esm` and reaches it via `window.SatsConnect`
(no npm dependency added). The API surface differs by version, so the page **feature-detects**:
modern `request('wallet_connect', …)` first, then legacy `getAddress({ payload, onFinish, onCancel })`.

| Capability | Method | Use for us |
| --- | --- | --- |
| Connect + get addresses | `request('wallet_connect')` / legacy `getAddress` | ✅ **Used.** Retrieve the user's **payment** and **ordinals** addresses + public keys. |
| Sign a PSBT | `request('signPsbt', { psbt, signInputs, broadcast })` / legacy `signTransaction` | ✅ **The correct path.** We hand Xverse an unsigned commit (and later reveal) PSBT; the user signs. Fee = whatever the PSBT encodes → **network-fee-only**. |
| Send BTC | `request('sendTransfer')` / legacy `sendBtc` | ⚠️ Could fund the commit address, but gives us less control over inputs/fee than a PSBT. Prefer `signPsbt`. |
| **Turnkey inscribe** | `request('ord_inscribe')` / legacy `createInscription` | ❌ **Do NOT use.** Convenient, but Xverse **adds its own service fee** on top of the network fee. Using it defeats the entire "network-fee-only" premise. |
| Sign a message | `request('signMessage')` / legacy `signMessage` | Not needed here (Parahawk already has BIP-322 sign-in elsewhere). |

**Bottom line:** `wallet_connect`/`getAddress` + `signPsbt` give us network-fee-only inscription;
`createInscription` does not. That is exactly why the shipped plan avoids `createInscription`.

Broadcasting: `signPsbt` *can* broadcast (`broadcast: true`), but for a commit→reveal we want to
broadcast the commit ourselves, wait for confirmation, then build/sign/broadcast the reveal — so we
sign locally and broadcast via our own proxy (below).

---

## CSP: `connect-src 'self'` → same-origin proxy required

`src/web/server.ts` sets `connect-src 'self'`. So **the browser cannot `fetch`/XHR to any external
host** — mempool.space, an ord indexer, a broadcast API: all blocked. Anything network-facing must go
through a **same-origin Parahawk endpoint** that proxies upstream server-side.

Two proxies this feature needs (both **stubbed client-side today, not implemented server-side**):

- **`GET /api/inscribe/fees`** — proxy `mempool.space/api/v1/fees/recommended`, returning
  `{ fastestFee, halfHourFee, hourFee, minimumFee }`. The page calls it for the "↻ recommended"
  button and **falls back to the manual rate** when it 404s (current behavior — shown honestly on
  the page).
- **`POST /api/inscribe/broadcast`** — accept a raw signed tx hex, proxy it to
  `mempool.space/api/tx` (or a self-hosted node), return the txid. Used for both commit and reveal.
- (Likely also **`GET /api/inscribe/utxos?address=`** — proxy the user's spendable UTXOs so we can
  build the commit PSBT with real inputs.)

Note: **wallet connect is not affected by `connect-src`.** Xverse injects a provider object into the
page and communicates over `window.postMessage` / extension messaging, not the network — so connect
works despite the strict CSP. Loading the sats-connect **module** from jsdelivr is governed by
`script-src` (which allows `cdn.jsdelivr.net`), not `connect-src`, so that's fine too.

When these endpoints are built, keep them tight: cache the fees response briefly; validate the
broadcast body is hex and length-bounded; rate-limit (the app already puts `/api/*` behind
`upstreamLimiter`); never echo upstream error bodies verbatim.

---

## Funds & security risks (why the gate exists)

This feature **touches user funds** — a bug can permanently lose money. Concrete failure modes:

- **Malformed reveal → stuck/unspendable commit.** If the reveal script or control block is wrong,
  the sats parked in the commit output can be **unrecoverable**.
- **Fee mistakes.** Underpay → tx never confirms (commit funds parked indefinitely). Overpay / a units
  bug (sats vs BTC, vB vs bytes, forgetting the 4× witness discount) → user overpays badly.
- **Wrong postage / dust.** Below dust → reveal is non-standard and won't relay.
- **Wrong recipient.** Inscription must land on the **ordinals** address, not the payment address, or
  it can be swept as ordinary change and lost.
- **Address/UTXO confusion.** Spending an ordinals UTXO that already holds an inscription can burn it.
- **CDN / supply-chain.** sats-connect is loaded from jsdelivr at runtime. Pin the version (done:
  `@3`); consider self-hosting/SRI before mainnet go-live.

**Mitigations already in place:** the whole build/sign/broadcast step is gated — *Inscribe* logs the
plan and broadcasts nothing; connect + estimate are safe (read-only). **Never** ship the PSBT builder
straight to mainnet.

---

## Phased plan

1. **Estimate + connect (shipped).** UI, wallet connect, live cost math. No PSBT, no broadcast.
2. **Proxies.** Implement `GET /api/inscribe/fees`, `GET /api/inscribe/utxos`, and
   `POST /api/inscribe/broadcast` server-side (mempool.space passthroughs; cached + rate-limited).
   Wire "↻ recommended" to real data.
3. **Builder on signet/testnet.** Build commit+reveal PSBTs (e.g. `@scure/btc-signer` /
   `bitcoinjs-lib` + a small ord-envelope encoder) **server-side or in a reviewed client module**.
   Sign via `signPsbt`. Prove round-trips end-to-end **on signet first**, then testnet. Add unit
   tests for the size model vs. real broadcast vbytes, and for envelope encoding.
4. **Mainnet behind a flag.** Gate real broadcast behind an explicit config flag (mirror the existing
   `config.orderingLive` dry-run pattern used for venue orders). Default **off**. Require an on-page
   confirm that restates the exact total. Consider a max-fee guardrail and a max-content-size cap.
5. **Harden.** Pin/SRI or self-host sats-connect; add broadcast idempotency; surface commit txid so a
   user can recover if the reveal step fails midway.

Only after step 4 verifies on signet **and** testnet should the client gate in `inscribe.ts`
(`onInscribe` → currently `console.log` only) be replaced with the real build/sign/broadcast calls.

---

## Files
- `src/web/pages/inscribe.ts` — the page (`renderInscribe`). New file.
- `docs/specs/inscribe.md` — this doc.
- **To wire in (not done here):** a route in `src/web/server.ts` and a nav entry in
  `src/web/layout.ts` (see the handoff notes in the task response).
- **Future:** `/api/inscribe/{fees,utxos,broadcast}` handlers in `server.ts`; a PSBT/envelope builder
  module; a `config` flag for mainnet go-live.
