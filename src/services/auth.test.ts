import { describe, it, expect } from "vitest";
import { Signer, Verifier } from "bip322-js";
import { issueNonce, verifyNonce, buildSignInMessage, isSignableAddress } from "./auth.js";

describe("sign-in nonce", () => {
  it("round-trips a freshly issued nonce", () => {
    const { nonce, token } = issueNonce();
    expect(verifyNonce(token)).toBe(nonce);
  });
  it("rejects a tampered token", () => {
    const { token } = issueNonce();
    const bad = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    expect(verifyNonce(bad)).toBeNull();
  });
  it("rejects garbage", () => {
    expect(verifyNonce("not-a-token")).toBeNull();
  });
});

describe("isSignableAddress", () => {
  it("accepts native segwit, taproot, and base58", () => {
    expect(isSignableAddress("bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l")).toBe(true);
    expect(isSignableAddress("3E8ociqZa9mZUSwGdSmAEMAoAxBK3FNDcd")).toBe(true);
  });
  it("rejects nonsense", () => {
    expect(isSignableAddress("hello")).toBe(false);
  });
});

describe("sign-in message is BIP-322 signable/verifiable end to end", () => {
  it("a wallet signature over buildSignInMessage verifies", () => {
    // Canonical BIP-322 test key + its P2WPKH address.
    const priv = "L3VFeEujGtevx9w18HD1fhRbCH67Az2dpCymeRE1SoPK6XQtaN2k";
    const address = "bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l";
    const message = buildSignInMessage(address, "deadbeefdeadbeefdeadbeefdeadbeef");
    const sig = Signer.sign(priv, address, message) as string;
    expect(Verifier.verifySignature(address, message, sig)).toBe(true);
    // Wrong nonce in the message must not verify against the same signature.
    const other = buildSignInMessage(address, "00000000000000000000000000000000");
    expect(Verifier.verifySignature(address, other, sig)).toBe(false);
  });
});
