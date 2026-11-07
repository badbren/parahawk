# Spec — Inscribe (Ordinals on mainnet, paid from the user's Xverse)

## Status (2026-11-06): finished; owner-only until the owner has done 20 test inscriptions

The owner's call: "we'll use xverse to pay for the inscribe, we just need it all to work."
Then: "make it so when they are inside there they can't actually inscribe anything yet. basically the
step where they'd pay for xverse is where we stop… Admin will inscribe 20x before releasing."
See **Release gate** below.

- **Inscribe is a native desktop window**: `src/shell/apps/inscribe.ts` + `inscribe.css`, registered
  in `src/shell/desktop/registry.ts` with `paths: ["/inscribe"]`, so the deep link opens it.
  It runs in the desktop's top page because **Xverse injects its provider into the top page only,
  never into iframes**. The old iframe'd `/inscribe` page could not reach the wallet from inside
  the desktop.
- **Xverse does the Bitcoin part end to end.** It builds the commit + reveal, pays from the
  wallet, broadcasts, and returns a txid. Parahawk never sees a key and never builds, signs or
  broadcasts a transaction.
- **Parahawk adds no fee.** The request carries no `appFee`.
- **Mainnet only**: that is all Xverse's inscription flow supports (Xverse docs: "Inscriptions
  currently only support Mainnet"). There is no free test-network rehearsal.
- `/inscribe` as a plain page (frames, `?classic=1`, bots) is now a short explainer with an
  "Open Inscribe →" link (`target="_top"` to `/inscribe`, which opens the desktop window).

## Release gate (src/inscribe/release.ts)

Until release, the whole window works for everyone (wallet, content, file, fee, cost) and nothing is
greyed out, but only the **owner's** press reaches Xverse:

- **Owner** (the server session says admin, `me.isAdmin()`): "Inscribe with Xverse" goes to Xverse for
  real, and a line under the button says so ("this one is real: Xverse will ask you to pay").
- **Everyone else**: the request is still built and checked (so a bad file still gets its real error),
  then the window stops at the step where Xverse would ask for payment. It shows "Almost there —
  inscribing opens to everyone soon. The admin is doing 20 test inscriptions first." `createInscription`
  is never called, and the button stays orange and pressable.
- **Banner** at the top: "Inscribe is finished ✓ — the admin is doing 20 test inscriptions before it opens
  to everyone." It has an ✕, and closing it is remembered per browser (`ph.inscribe.banner`). Bump
  `BANNER_ID` in inscribe.ts to show a new banner to everyone again.

The gate is client-side by nature: Parahawk never touches the transaction, so someone who calls Xverse
from their own console only spends their own money. It exists to keep normal visitors from paying
before the owner has tested it, not as a security boundary.

**To release:** set `INSCRIBE_OPEN_TO_ALL = true` in `src/inscribe/release.ts`. The banner, the stop
note and the owner line all go away with it. Add a changelog entry when you do.

## The Xverse API (read from the published source, not guessed)

Source: `@sats-connect/core@0.19.0`, the `createInscription` that sats-connect 3.x and 4.x export,
and `jsontokens@4.0.1`.

```
window.XverseProviders.BitcoinProvider.createInscription(token: string) → Promise<{ txId: string }>
```

- `token` is jsontokens' `createUnsecuredToken(payload)`:
  `base64url({"typ":"JWT","alg":"none"}) + "." + base64url(JSON payload, UTF-8) + "."`.
- `payload` is
  `{ network: { type: "Mainnet" }, contentType, content, payloadType: "PLAIN_TEXT" | "BASE_64",
  suggestedMinerFeeRate?, appFee?, appFeeAddress? }`.
- When the person refuses in Xverse, the promise rejects. sats-connect maps that to `onCancel`.
- There is no JSON-RPC (`request(...)`) method for inscribing. The `ord_*` RPC methods are only
  `ord_getInscriptions` and `ord_sendInscriptions`, so the legacy provider method is the only way.
- sats-connect checks the payload before sending it, and `src/inscribe/payload.ts` mirrors those
  checks so a bad request fails with a readable message instead of failing inside the wallet:
  - content type `^[a-z]+\/[a-z0-9\-.+]+(?=;.*|$)`
  - non-empty content
  - content of at most 400,000 characters on mainnet (base64 for files, so a file of ≈292 KB)
- We call the provider directly, the same way `src/shell/session/wallet.ts` already talks to
  Xverse. **No CDN script is loaded**: the old page imported sats-connect from jsdelivr, which this
  removes.

Fees: Xverse's docs list no Xverse charge on top of network fees (only the optional `appFee` a site
can add, which we don't). We don't claim either way. The UI says Xverse shows the exact total before
you approve, which it does.

The returned `txId` is what we link to on mempool.space. The inscription id isn't returned. It
appears in Xverse → Collectibles once the reveal confirms.

## What Parahawk runs

- `GET /api/inscribe/fees` (`src/web/inscribe-routes.ts`): proxies mempool.space's
  `/api/v1/fees/recommended`, because the CSP is `connect-src 'self'`.
  - Parsed by `src/inscribe/fees.ts`: sanity-checked, rounded up to whole sat/vB.
  - Cached 30 s in-process plus `s-maxage=30` at the edge, with one upstream request at a time.
  - Serves the last good answer, marked `stale`, for up to 10 min while upstream is down, then a
    plain 503.
  - Mainnet only; any other `?network=` gets a 400.
  - Sits behind the 30/min `/api` limiter.
- No broadcast or UTXO route: Xverse broadcasts.

## The window (what the person sees)

1. **Wallet**:
   - Signed in with Xverse: where the inscription goes (the ordinals address) and what pays (the
     payment address).
   - Not signed in: a Connect Xverse button. This is the normal sign-in (one free BIP-322
     message).
   - Signed in with any other wallet: just "Inscribing needs Xverse — taskbar → Connect wallet."
   - No Xverse: "Get Xverse", plus the phone hint (open the site in the Xverse app's browser).
2. **What to inscribe**: Text or File, with a live byte count and content type. Image files get a
   still preview from a `data:` URL, since the CSP allows `data:` images but not `blob:`.
3. **Fee rate**: Fast / Normal / Slow from the proxy, or Custom (1–2,000 sat/vB). If rates can't
   load, it falls back to Custom.
4. **Cost**: an estimate in sats and USD (the price comes from the tick feed), with a "How we got
   this" table, and the note that Xverse shows the exact total.
5. **Inscribe with Xverse** (the Bitcoin-orange button).
   - Disabled with a reason until everything is ready.
   - While pending: "Waiting for Xverse…".
   - On success: the txid with a mempool.space link. The button then locks, so a second press
     can't pay twice, until the content changes or "Inscribe something else" is pressed.
   - A refusal shows "Cancelled in Xverse — nothing was sent."
6. **Sent from this browser**: the last 12 txids, in localStorage `ph.inscribe.history`. A txid is
   saved even if the window was closed while Xverse was open.

## The estimate (src/inscribe/cost.ts)

An inscription is two transactions:

- The **commit** pays into a one-off taproot address that commits to the inscription script.
- The **reveal** spends it through that script, which puts the content in the witness and sends
  the inscription to the ordinals address.

Leaf script:

```
<32-byte key> OP_CHECKSIG OP_FALSE OP_IF "ord" 01 <content-type> 00 <body in ≤520-byte pushes> OP_ENDIF
```

- **Reveal**: the base part is 94 bytes (1 input, 1 taproot output). Witness =
  `[sig 64, script, control block 33]` + marker/flag. Weight = `base×4 + witness`;
  vB = `ceil(weight/4)`. Content costs ≈¼ vB per byte.
- **Commit**: 1 input of the payment address's type, plus the commit output (P2TR 43 vB) and change.
  - Input sizes: P2TR 57.5, P2WPKH 68, P2SH-P2WPKH 91 (Xverse's classic payment address), P2PKH 148.
  - Real coin selection may add inputs.
- **Total** = `ceil(commit vB × rate) + ceil(reveal vB × rate) + 546` postage. The postage is an
  assumption: Xverse picks the real value.
- Worked example: a 21-byte text at 3 sat/vB with a bc1q payment address is 143 + 153 vB →
  429 + 459 + 546 = **1,434 sats** (≈ $1.09 at $76k).

## Risks that remain

- **Real money, irreversible.** The window says so in its header, and Xverse's own pop-up is the
  final confirmation.
- **The estimate is not the bill.** Xverse's postage, coin selection and any fee of its own decide
  the real total. The window says this next to every number.
- **A wallet error after broadcast** would show as an error while a transaction exists. The message
  tells the person to check Xverse's activity tab before trying again.
- **Xverse could drop the legacy `createInscription`.** If that happens, the window says to update
  Xverse rather than failing silently. Re-check `@sats-connect/core`'s exports when upgrading.

## Parked: the network-fee-only builder

The original plan was to build commit/reveal ourselves, sign via `signPsbt`, and broadcast through
our own proxy, so that no turnkey service is involved. It is parked: Xverse's flow does the job, and
a hand-built taproot commit/reveal touches user funds.

If it's ever revived:

- Build it on signet first (Xverse supports Signet/Testnet4 for PSBT signing, unlike its inscribe
  flow).
- Add `POST /api/inscribe/broadcast` and a UTXO proxy.
- Keep mainnet behind a config flag that defaults off (like `config.orderingLive`).
- Persist the commit's recovery data so a failed reveal can be retried.

The size model above is the one that builder would need.

## Files

- `src/shell/apps/inscribe.ts`, `inscribe.css`: the window.
- `src/inscribe/cost.ts`: the estimate. `src/inscribe/payload.ts`: the Xverse request + token.
  `src/inscribe/fees.ts`: rate parsing. `src/inscribe/inscribe.test.ts`.
- `src/inscribe/release.ts` (+ `release.test.ts`): the release gate (`INSCRIBE_OPEN_TO_ALL`).
- `src/web/inscribe-routes.ts` (+ `.test.ts`): `/api/inscribe/fees`.
- `src/web/pages/inscribe.ts`: the plain-page explainer.
- `src/shell/desktop/registry.ts`: the `inscribe` entry is native (was `sitePage`).

## Owner test (real wallet, mainnet)

Only the owner can do this until release: sign in with the owner's Xverse (the admin address), or the
press stops at the pay step. Anyone else, including the owner signed out, sees the stop note.

1. Open the local site in a browser that has Xverse, and connect Xverse from the taskbar.
2. Open **Inscribe**. Check that "Inscription goes to" shows your `bc1p…` ordinals address.
3. Type a short text such as `gm`. Pick **Slow**. The window estimates ≈1.3–1.5k sats at today's
   ~1–3 sat/vB.
4. Press **Inscribe with Xverse**. In the Xverse pop-up, read the total, then approve.
5. Check the result:
   - The window shows the txid and a mempool.space link.
   - The transaction appears on mempool.space.
   - Once it confirms, the inscription shows in Xverse → Collectibles.
6. Also try **Cancel** in the pop-up once. The window should say "Cancelled in Xverse — nothing was
   sent."
