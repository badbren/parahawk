import { renderPage } from "../layout.js";

/**
 * Inscribe — inscribe an Ordinal on Bitcoin MAINNET paying only the network fee.
 *
 * What is REAL on this page:
 *   • Xverse wallet connect + address retrieval, via sats-connect (loaded from
 *     the jsdelivr CDN as an ES module in <head> and reached through
 *     window.SatsConnect — no npm dependency is added).
 *   • The live cost estimate: content bytes → ord reveal-script bytes → witness
 *     bytes → tx weight → vbytes → sats at the chosen fee rate. The math is shown
 *     on the page so it can be checked by hand.
 *
 * What is deliberately GATED OFF (see docs/specs/inscribe.md):
 *   • The actual commit-PSBT build → signPsbt → broadcast reveal flow. Shipping a
 *     half-finished taproot commit/reveal builder that could broadcast a malformed
 *     transaction would risk user funds, so pressing "Inscribe" only console.log()s
 *     the intended plan and broadcasts NOTHING. It lands after signet/testnet
 *     testing, behind a flag.
 *
 * CSP note: connect-src is 'self' only, so the browser cannot fetch mempool.space
 * or an ord indexer directly. Anything that needs those must go through a
 * same-origin proxy — /api/inscribe/fees (recommended fee rates) and
 * /api/inscribe/broadcast (raw-tx broadcast). Neither is implemented server-side
 * yet; the client calls /api/inscribe/fees and falls back cleanly when it 404s.
 * Xverse itself talks to the page through its injected provider (not the network),
 * so wallet connect works despite the strict connect-src.
 */

// Cost-model constants — kept in one place and mirrored in docs/specs/inscribe.md.
const POSTAGE_SATS = 546; // dust value locked into the inscription output (owned by you, not a fee)
const DEFAULT_FEE_RATE = 6; // sat/vB fallback until /api/inscribe/fees (mempool proxy) exists

export async function renderInscribe(): Promise<string> {
  // sats-connect as an ES module. `import * as` never hard-fails on a missing
  // named export, so we can feature-detect the API surface across Xverse versions.
  const head = `
<script type="module">
  try {
    const SatsConnect = await import('https://cdn.jsdelivr.net/npm/sats-connect@3/+esm');
    window.SatsConnect = SatsConnect;
    window.dispatchEvent(new Event('satsconnect:ready'));
  } catch (e) {
    console.error('[inscribe] failed to load sats-connect from jsdelivr', e);
  }
</script>`;

  const body = `
<h1>Inscribe</h1>
<p class="lead">Inscribe an Ordinal on Bitcoin <strong>mainnet</strong> paying <strong>only the network fee</strong> — no marketplace markup, no service cut. Connect Xverse, drop in your content, and see the exact commit + reveal cost <em>before</em> anything is signed.</p>

<div class="warn-hero">
  ⚠ <strong>Experimental — not yet live.</strong> Wallet connect and the live fee estimate below are real.
  The actual inscribe step (build commit PSBT → sign → broadcast reveal) is <strong>gated off</strong>: pressing
  <em>Inscribe</em> logs the intended transaction plan to your browser console and broadcasts <strong>nothing</strong>.
  Building a taproot commit/reveal by hand touches your funds, so it ships only after signet testing — see
  <code>docs/specs/inscribe.md</code>.
</div>

<div id="ins-framed" hidden></div>
<script>
(function(){
  if(window.self===window.top) return;
  var n=document.getElementById('ins-framed'); if(!n) return;
  n.className='stale'; n.hidden=false;
  n.innerHTML='Wallet extensions may not see this page inside the desktop window. <a href="'+location.pathname+'?classic=1" target="_top">Open in a full tab \\u2192</a>';
})();
</script>
<div class="ins-card">
  <div class="ins-h">1 · Connect wallet</div>
  <button type="button" id="ins-connect">Connect Xverse</button>
  <div id="ins-conn" class="ins-conn dim">Not connected. Xverse reaches this page through its injected provider (not the network), so connect works even though Parahawk's CSP only allows same-origin fetches.</div>
</div>

<div class="ins-card">
  <div class="ins-h">2 · Content</div>
  <label class="ins-lab">Text
    <textarea id="ins-text" rows="4" placeholder="gm. inscribe me." spellcheck="false"></textarea>
  </label>
  <div class="ins-or">— or an image / file —</div>
  <label class="ins-lab">File (image / text / json)
    <input type="file" id="ins-file" accept="image/*,text/plain,application/json">
  </label>
  <div class="ins-meta">
    Content-type <span id="ins-ct" class="green">text/plain;charset=utf-8</span>
    · Size <span id="ins-bytes" class="green">0</span> bytes
    <button type="button" id="ins-clearfile" class="ins-mini" hidden>clear file</button>
  </div>
</div>

<div class="ins-card">
  <div class="ins-h">3 · Fee rate</div>
  <div class="ins-row">
    <label class="ins-lab">sat / vB
      <input type="number" id="ins-fee" min="1" step="1" value="${DEFAULT_FEE_RATE}">
    </label>
    <button type="button" id="ins-fees" class="ins-mini">↻ recommended</button>
  </div>
  <div id="ins-feesrc" class="dim ins-small">Manual rate. "Recommended" asks the same-origin proxy <code>/api/inscribe/fees</code> (a mempool.space passthrough — not implemented yet, so it falls back to your manual rate).</div>
</div>

<div class="ins-card ins-estimate">
  <div class="ins-h">4 · Cost estimate <span class="dim ins-small">— live · network-fee-only</span></div>
  <table class="ins-math">
    <tr><td>Content</td><td><span id="m-bytes">0</span> bytes</td></tr>
    <tr><td>Reveal leaf script</td><td><span id="m-script">—</span> bytes <span class="dim">(ord envelope + taproot leaf)</span></td></tr>
    <tr><td>Reveal witness</td><td><span id="m-wit">—</span> bytes <span class="dim">(counts ÷4 toward weight)</span></td></tr>
    <tr><td>Reveal size</td><td><strong><span id="m-reveal">—</span> vB</strong> <span class="dim">(<span id="m-weight">—</span> weight units)</span></td></tr>
    <tr><td>Commit size</td><td><span id="m-commit">—</span> vB <span class="dim">(est. 1 taproot input, 2 outputs)</span></td></tr>
    <tr><td>Reveal fee</td><td><span id="m-revealfee">—</span></td></tr>
    <tr><td>Commit fee</td><td><span id="m-commitfee">—</span></td></tr>
    <tr><td>Postage</td><td><span id="m-postage">—</span> <span class="dim">(dust that lives in the inscription — yours, not a fee)</span></td></tr>
  </table>
  <div class="ins-total">Total ≈ <span id="e-total" class="green">—</span> <span id="e-total-usd" class="dim"></span></div>
  <div class="ins-small dim">Estimates assume a single taproot funding input and standard ord envelope encoding; your real commit size depends on which UTXOs Xverse selects. "Network-fee-only" means you pay just <code>commit&nbsp;fee + reveal&nbsp;fee + postage</code> — Parahawk adds nothing, and this path deliberately avoids Xverse's built-in <code>createInscription</code>, which layers a service fee on top.</div>
</div>

<div class="ins-card">
  <div class="ins-h">5 · Inscribe</div>
  <button type="button" id="ins-go" disabled>Inscribe (connect first)</button>
  <div id="ins-out" class="ins-out"></div>
</div>

<style>
.warn-hero{border:1px solid var(--amber);background:#2a1a00;color:var(--amber);padding:16px 20px;margin:0 0 26px;font-size:17px;line-height:1.55}
.ins-card{border:1px solid var(--line);background:#0a0a0a;padding:20px 22px;margin:0 0 18px}
.ins-h{color:#fff;font-size:18px;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px}
.ins-row{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap}
.ins-lab{display:flex;flex-direction:column;gap:6px;color:var(--dim);font-size:13px;text-transform:uppercase;letter-spacing:.5px}
.ins-lab textarea{font-family:inherit;font-size:16px;background:#050805;border:1px solid var(--line);color:var(--fg);padding:12px 14px;width:100%;resize:vertical}
.ins-lab textarea[disabled]{opacity:.4}
.ins-lab input[type=number]{max-width:160px}
.ins-or{color:var(--dim);text-align:center;font-size:12px;margin:12px 0;text-transform:uppercase;letter-spacing:1px}
.ins-meta{color:var(--dim);font-size:14px;margin-top:12px}
.ins-small{font-size:13px;line-height:1.55}
.ins-mini{background:#0a0a0a;border:1px solid var(--line);color:var(--dim);padding:9px 14px;font-size:13px;letter-spacing:.5px;text-transform:none;font-weight:400}
.ins-mini:hover{background:#141414;color:var(--fg)}
.ins-conn{margin-top:14px;font-size:14px;line-height:1.55;word-break:break-word}
.ins-conn code{color:var(--green)}
.ins-estimate{border-color:#33501f;border-left:3px solid var(--green)}
.ins-math{width:100%;margin:0 0 14px}
.ins-math td{padding:8px 10px;border-bottom:1px solid var(--line);font-size:15px}
.ins-math td:first-child{color:var(--dim);text-transform:uppercase;font-size:13px;letter-spacing:.5px;width:190px}
.ins-total{font-size:24px;color:#fff;margin:8px 0 12px}
.ins-out{margin-top:14px}
.ins-note{border:1px solid var(--amber);background:#2a1a00;color:var(--amber);padding:14px 16px;font-size:15px;line-height:1.55}
#ins-go[disabled]{opacity:.5;cursor:not-allowed}
</style>

<script>
(function(){
  var POSTAGE = ${POSTAGE_SATS};
  var $ = function(id){ return document.getElementById(id); };
  var enc = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
  var state = { addrPayment:'', addrOrdinals:'', file:null, btcUsd:0 };

  function nf(n){ return Number(Math.round(n)).toLocaleString('en-US'); }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── Size model (derivation lives in docs/specs/inscribe.md) ────────────────
  function pushOverhead(n){ if(n < 76) return 1; if(n < 256) return 2; return 3; }
  function varIntLen(n){ if(n < 253) return 1; if(n < 65536) return 3; return 5; }

  // Reveal tx = a taproot script-path spend of the commit output. The inscription
  // lives in the witness (discounted 4x). Leaf script is:
  //   <32B pubkey> OP_CHECKSIG  OP_FALSE OP_IF "ord" 01 <content-type> 00 <body> OP_ENDIF
  function estimateReveal(contentBytes, contentType){
    var ctLen = contentType.length; // content-types are ASCII → bytes == chars
    var script = 0;
    script += 1 + 32;   // push 32-byte internal pubkey
    script += 1;        // OP_CHECKSIG
    script += 1;        // OP_FALSE
    script += 1;        // OP_IF
    script += 1 + 3;    // push "ord"
    script += 1 + 1;    // push 0x01 (content-type tag)
    script += pushOverhead(ctLen) + ctLen; // content-type value
    script += 1;        // OP_0 (body separator)
    var full = Math.floor(contentBytes / 520);
    var rem = contentBytes - full * 520;
    var bodyOverhead = full * pushOverhead(520) + (rem > 0 ? pushOverhead(rem) : 0);
    script += bodyOverhead + contentBytes; // body pushes (<=520B chunks)
    script += 1;        // OP_ENDIF

    // Witness stack: [schnorr sig, reveal script, control block]
    var witness = 0;
    witness += 1;                          // stack item count (3)
    witness += 1 + 64;                     // 64-byte schnorr signature
    witness += varIntLen(script) + script; // the reveal script itself
    witness += 1 + 33;                     // control block (depth-1 leaf)
    witness += 2;                          // segwit marker + flag

    // Non-witness (base) part: 1 input, 1 output (postage → ordinals address)
    var base = 4 + 1 + 41 + 1 + 43 + 4; // version+vin+input+vout+p2tr-out+locktime = 94
    var weight = base * 4 + witness;
    var vbytes = Math.ceil(weight / 4);
    return { script:script, witness:witness, weight:weight, vbytes:vbytes };
  }

  // Commit tx funds the reveal: estimate 1 taproot input + 2 taproot outputs
  // (commit + change). ~11 vB overhead, ~58 vB P2TR key-path input, 43 vB/output.
  function commitVbytes(){ return 11 + 58 + 43 + 43; }

  function currentContent(){
    if(state.file){ return { bytes: state.file.size, type: state.file.type || 'application/octet-stream' }; }
    var t = $('ins-text').value || '';
    var bytes = enc ? enc.encode(t).length : t.length;
    return { bytes: bytes, type: 'text/plain;charset=utf-8' };
  }

  function recompute(){
    var c = currentContent();
    var rate = Math.max(1, Number($('ins-fee').value || ${DEFAULT_FEE_RATE}));
    var rev = estimateReveal(c.bytes, c.type);
    var cvb = commitVbytes();
    var revealFee = rev.vbytes * rate;
    var commitFee = cvb * rate;
    var total = revealFee + commitFee + POSTAGE;

    $('ins-ct').textContent = c.type;
    $('ins-bytes').textContent = nf(c.bytes);
    $('m-bytes').textContent = nf(c.bytes);
    $('m-script').textContent = nf(rev.script);
    $('m-wit').textContent = nf(rev.witness);
    $('m-reveal').textContent = nf(rev.vbytes);
    $('m-weight').textContent = nf(rev.weight);
    $('m-commit').textContent = nf(cvb);
    $('m-revealfee').textContent = nf(rev.vbytes) + ' vB × ' + rate + ' = ' + nf(revealFee) + ' sats';
    $('m-commitfee').textContent = nf(cvb) + ' vB × ' + rate + ' = ' + nf(commitFee) + ' sats';
    $('m-postage').textContent = nf(POSTAGE) + ' sats';
    $('e-total').textContent = nf(total) + ' sats';
    $('e-total-usd').textContent = state.btcUsd > 0 ? ('≈ $' + (total / 1e8 * state.btcUsd).toFixed(2)) : '';
  }

  // ── Wallet ─────────────────────────────────────────────────────────────────
  function status(html){ $('ins-conn').innerHTML = html; }

  // Feature-detect the sats-connect API surface (differs across Xverse versions).
  function pickApi(){
    var SC = window.SatsConnect;
    if(!SC) return null;
    var d = SC.default || {};
    return {
      request: (typeof d.request === 'function') ? d.request.bind(d)
             : (typeof SC.request === 'function') ? SC.request : null,
      getAddress: SC.getAddress || d.getAddress || null,
      AddressPurpose: SC.AddressPurpose || d.AddressPurpose || null,
      BitcoinNetworkType: SC.BitcoinNetworkType || d.BitcoinNetworkType || null
    };
  }

  function applyAddresses(list){
    var pay = '', ord = '';
    for(var i=0;i<list.length;i++){
      var a = list[i] || {}; var p = String(a.purpose || '').toLowerCase();
      if(p.indexOf('payment') >= 0 && !pay) pay = a.address;
      if(p.indexOf('ordinal') >= 0 && !ord) ord = a.address;
    }
    if(!pay && list[0]) pay = list[0].address;
    if(!ord) ord = pay;
    if(!pay){ status('<span class="red">No address returned by the wallet.</span>'); return; }
    state.addrPayment = pay; state.addrOrdinals = ord;
    status('<span class="green">Connected.</span><br>Ordinals: <code>' + esc(ord) + '</code><br>Payment: <code>' + esc(pay) + '</code>');
    $('ins-go').disabled = false;
    $('ins-go').textContent = 'Inscribe (experimental — logs plan only)';
  }

  function connect(){
    var api = pickApi();
    if(!api){ status('Xverse library still loading — try again in a moment, or install the Xverse extension.'); return; }
    status('Requesting addresses from Xverse…');
    // Modern API (sats-connect v2/v3): request('wallet_connect').
    if(api.request){
      Promise.resolve(api.request('wallet_connect', null)).then(function(res){
        if(res && res.status === 'success' && res.result){ applyAddresses(res.result.addresses || []); return; }
        if(res && res.status === 'error'){ throw new Error((res.error && res.error.message) || 'wallet rejected the request'); }
        legacyConnect(api);
      }).catch(function(e){ tryLegacy(api, e); });
      return;
    }
    legacyConnect(api);
  }

  function tryLegacy(api, err){
    if(api.getAddress){ legacyConnect(api); return; }
    status('Connect failed: ' + (err && err.message ? err.message : String(err)));
  }

  // Legacy API (sats-connect v1): getAddress({ payload, onFinish, onCancel }).
  function legacyConnect(api){
    if(!api.getAddress){ status('This sats-connect build exposes no known connect method.'); return; }
    var purposes = api.AddressPurpose ? [api.AddressPurpose.Payment, api.AddressPurpose.Ordinals] : ['payment','ordinals'];
    var net = api.BitcoinNetworkType ? api.BitcoinNetworkType.Mainnet : 'Mainnet';
    try {
      api.getAddress({
        payload: { purposes: purposes, message: 'Connect to Parahawk Inscribe (read-only address request).', network: { type: net } },
        onFinish: function(r){ applyAddresses((r && r.addresses) || []); },
        onCancel: function(){ status('Connection cancelled.'); }
      });
    } catch(e){ status('Connect failed: ' + (e && e.message ? e.message : String(e))); }
  }

  // ── Fee proxy (stub) ─────────────────────────────────────────────────────────
  function loadFees(){
    $('ins-feesrc').textContent = 'Fetching /api/inscribe/fees …';
    fetch('/api/inscribe/fees', { headers: { accept: 'application/json' } })
      .then(function(r){ if(!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function(j){
        var med = j.halfHourFee || j.medium || j.hourFee;
        if(med){ $('ins-fee').value = med; recompute(); }
        $('ins-feesrc').innerHTML = '<span class="green">Live</span> via /api/inscribe/fees — fastest ' +
          (j.fastestFee || '?') + ', 30-min ' + (j.halfHourFee || '?') + ', 1-hr ' + (j.hourFee || '?') + ' sat/vB.';
      })
      .catch(function(){
        $('ins-feesrc').innerHTML = '<span class="amber">/api/inscribe/fees is not implemented yet</span> — that same-origin route must proxy mempool.space (the browser CSP blocks calling mempool.space directly). Using your manual rate.';
      });
  }

  // ── Inscribe (GATED — logs the plan, signs/broadcasts nothing) ───────────────
  function onInscribe(){
    var c = currentContent();
    var rate = Math.max(1, Number($('ins-fee').value || ${DEFAULT_FEE_RATE}));
    var rev = estimateReveal(c.bytes, c.type);
    var cvb = commitVbytes();
    var plan = {
      network: 'mainnet',
      note: 'NETWORK-FEE-ONLY commit/reveal — NOT signed, NOT broadcast (experimental gate).',
      ordinalsAddress: state.addrOrdinals || null,
      paymentAddress: state.addrPayment || null,
      contentType: c.type,
      contentBytes: c.bytes,
      feeRate: rate,
      estimate: {
        revealVbytes: rev.vbytes,
        commitVbytes: cvb,
        postageSats: POSTAGE,
        revealFeeSats: rev.vbytes * rate,
        commitFeeSats: cvb * rate,
        totalSats: rev.vbytes * rate + cvb * rate + POSTAGE
      },
      intendedSteps: [
        '1. Build the reveal taproot leaf script (ord envelope) and derive the P2TR commit address.',
        '2. Build a commit PSBT funding the commit address with reveal_fee + postage; sign via sats-connect signPsbt (NOT createInscription — that adds a service fee).',
        '3. Broadcast the commit tx via same-origin proxy POST /api/inscribe/broadcast.',
        '4. Once the commit confirms, build the reveal tx (script-path spend) and sign it.',
        '5. Broadcast the reveal via /api/inscribe/broadcast; the inscription lands at ordinalsAddress.'
      ]
    };
    console.log('[inscribe] intended plan (nothing was signed or broadcast):', plan);
    $('ins-out').innerHTML = '<div class="ins-note">⚠ <strong>Not live.</strong> Nothing was signed or broadcast. The intended commit/reveal plan (addresses, sizes, fees, steps) was logged to your browser console — open DevTools → Console to inspect it. The PSBT builder and broadcaster ship after signet testing; see <code>docs/specs/inscribe.md</code>.</div>';
  }

  // ── Wire up ──────────────────────────────────────────────────────────────────
  $('ins-connect').addEventListener('click', connect);
  $('ins-go').addEventListener('click', onInscribe);
  $('ins-fees').addEventListener('click', loadFees);
  $('ins-text').addEventListener('input', recompute);
  $('ins-fee').addEventListener('input', recompute);
  $('ins-file').addEventListener('change', function(){
    state.file = (this.files && this.files[0]) ? this.files[0] : null;
    $('ins-clearfile').hidden = !state.file;
    if(state.file){ $('ins-text').setAttribute('disabled','disabled'); }
    else { $('ins-text').removeAttribute('disabled'); }
    recompute();
  });
  $('ins-clearfile').addEventListener('click', function(){
    state.file = null; $('ins-file').value = ''; this.hidden = true;
    $('ins-text').removeAttribute('disabled'); recompute();
  });

  // BTC price for the USD echo — /api/overview is same-origin (CSP-allowed).
  fetch('/api/overview').then(function(r){ return r.json(); }).then(function(o){
    if(o && o.pool && typeof o.pool.btcPriceUsd === 'number' && o.pool.btcPriceUsd > 0){
      state.btcUsd = o.pool.btcPriceUsd; recompute();
    }
  }).catch(function(){});

  recompute();
})();
</script>
`;

  return renderPage({ title: "Inscribe", active: "inscribe", body, head });
}
