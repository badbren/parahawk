/**
 * What an inscription costs — the size model behind the Inscribe window's
 * estimate. Pure (no DOM, no Node), so the desktop and the tests share it.
 *
 * An inscription is two transactions (docs/specs/inscribe.md):
 *   commit — pays from your wallet into a one-off taproot address that commits
 *            to the inscription script;
 *   reveal — spends that output through the script, which puts the content in
 *            the witness (4× cheaper per byte than the rest of a transaction)
 *            and sends the inscription, with its postage, to your ordinals address.
 *
 * Xverse builds and pays both. These numbers are our ESTIMATE of what it will
 * ask for; the Xverse pop-up shows the exact total before anything is approved.
 */

/** Sats that ride inside the inscription's own output — yours, not a fee. Xverse picks the real value. */
export const POSTAGE_SATS = 546;

/** Bitcoin's largest single data push; the body goes in chunks of this size. */
const MAX_PUSH = 520;

/** Reveal tx outside the witness: version 4 + vin 1 + input 41 + vout 1 + taproot output 43 + locktime 4. */
const REVEAL_BASE_BYTES = 94;

/** Opcode bytes in front of an n-byte push. */
function pushOverhead(n: number): number {
  if (n < 76) return 1; // OP_PUSHBYTES_n
  if (n < 256) return 2; // OP_PUSHDATA1
  return 3; // OP_PUSHDATA2
}

function varIntLen(n: number): number {
  return n < 253 ? 1 : n < 65536 ? 3 : 5;
}

export interface RevealSize {
  /** Bytes of the tapscript leaf (the ord envelope). */
  script: number;
  /** Witness bytes, including the segwit marker + flag. */
  witness: number;
  weight: number;
  vbytes: number;
}

/**
 * The reveal transaction: one script-path input, one taproot output. Leaf script:
 *   <32-byte key> OP_CHECKSIG OP_FALSE OP_IF "ord" 01 <content-type> 00 <body…> OP_ENDIF
 */
export function revealSize(contentBytes: number, contentType: string): RevealSize {
  const body = Math.max(0, Math.floor(contentBytes));
  const ctLen = new TextEncoder().encode(contentType).length;
  const full = Math.floor(body / MAX_PUSH);
  const rem = body - full * MAX_PUSH;

  const script =
    1 + 32 + // the key
    1 + // OP_CHECKSIG
    1 + // OP_FALSE
    1 + // OP_IF
    1 + 3 + // "ord"
    1 + 1 + // tag 1 (content type)
    pushOverhead(ctLen) + ctLen +
    1 + // OP_0, the body separator
    full * pushOverhead(MAX_PUSH) + (rem > 0 ? pushOverhead(rem) : 0) + body +
    1; // OP_ENDIF

  // Witness stack [signature, script, control block], plus the segwit marker + flag.
  const witness = 1 + (1 + 64) + (varIntLen(script) + script) + (1 + 33) + 2;
  const weight = REVEAL_BASE_BYTES * 4 + witness;
  return { script, witness, weight, vbytes: Math.ceil(weight / 4) };
}

export type AddressKind = "p2tr" | "p2wpkh" | "p2sh-p2wpkh" | "p2pkh" | "unknown";

/** What kind of output an address is, from its prefix — enough to size an input or output. */
export function addressKind(address: string | null | undefined): AddressKind {
  if (!address) return "unknown";
  const lower = address.toLowerCase();
  if (/^(bc|tb|bcrt)1p/.test(lower)) return "p2tr";
  if (/^(bc|tb|bcrt)1q/.test(lower)) return "p2wpkh";
  if (/^[23]/.test(address)) return "p2sh-p2wpkh"; // Xverse's classic payment address is wrapped segwit
  if (/^[1mn]/.test(address)) return "p2pkh";
  return "unknown";
}

const INPUT_VB: Record<AddressKind, number> = { p2tr: 57.5, p2wpkh: 68, "p2sh-p2wpkh": 91, p2pkh: 148, unknown: 68 };
const OUTPUT_VB: Record<AddressKind, number> = { p2tr: 43, p2wpkh: 31, "p2sh-p2wpkh": 32, p2pkh: 34, unknown: 31 };

/**
 * The commit transaction: one input from the payment address, the taproot
 * commit output and change back to the payment address. Real coin selection can
 * take more inputs — another reason Xverse's total is the one that counts.
 */
export function commitVbytes(paymentAddress?: string | null): number {
  const kind = addressKind(paymentAddress);
  const overhead = kind === "p2pkh" ? 10 : 10.5;
  return Math.ceil(overhead + INPUT_VB[kind] + OUTPUT_VB.p2tr + OUTPUT_VB[kind]);
}

export interface InscriptionCost {
  reveal: RevealSize;
  commitVbytes: number;
  /** The fee rate the numbers below use, sat/vB (at least 1). */
  feeRate: number;
  revealFee: number;
  commitFee: number;
  postage: number;
  /** commitFee + revealFee + postage, in sats. */
  total: number;
}

export function inscriptionCost(opts: {
  contentBytes: number;
  contentType: string;
  feeRate: number;
  paymentAddress?: string | null;
}): InscriptionCost {
  const feeRate = Number.isFinite(opts.feeRate) ? Math.max(1, opts.feeRate) : 1;
  const reveal = revealSize(opts.contentBytes, opts.contentType);
  const cvb = commitVbytes(opts.paymentAddress);
  const revealFee = Math.ceil(reveal.vbytes * feeRate);
  const commitFee = Math.ceil(cvb * feeRate);
  return {
    reveal,
    commitVbytes: cvb,
    feeRate,
    revealFee,
    commitFee,
    postage: POSTAGE_SATS,
    total: revealFee + commitFee + POSTAGE_SATS,
  };
}
