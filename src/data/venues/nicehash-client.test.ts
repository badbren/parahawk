import { describe, it, expect } from "vitest";
import { nhSign } from "./nicehash-client.js";

const creds = { orgId: "org-123", apiKey: "KEYabc", apiSecret: "SECRETxyz" };

/**
 * Regression-lock the NiceHash request-signing format. These vectors were
 * computed from the documented scheme:
 *   HMAC-SHA256(secret, apiKey \0 time \0 nonce \0\0 orgId \0\0 method \0 path \0 query [\0 body])
 * If the byte concatenation ever changes, these break — which is the point:
 * a silent signing change would make every real order fail auth.
 */
describe("NiceHash request signing", () => {
  it("signs a GET (no body) to a stable value", () => {
    const sig = nhSign(creds, "1700000000000", "nonce-1", "GET", "/main/api/v2/accounting/account2/BTC", "", "");
    expect(sig).toBe("KEYabc:c0650e8df3a6c3baae36a1cf50e0862e808332d32e8484881b2cb809c8edc13c");
  });

  it("signs a POST (with body) to a stable value", () => {
    const sig = nhSign(creds, "1700000000000", "nonce-1", "POST", "/main/api/v2/hashpower/order", "", JSON.stringify({ a: 1 }));
    expect(sig).toBe("KEYabc:f43787a54cf5c6250b686e7dc34883e2cb3de09c8068f510fa975e050fcb53a0");
  });

  it("a different secret produces a different signature", () => {
    const a = nhSign(creds, "1700000000000", "n", "GET", "/x", "", "");
    const b = nhSign({ ...creds, apiSecret: "other" }, "1700000000000", "n", "GET", "/x", "", "");
    expect(a).not.toBe(b);
  });

  it("the signature changes when the body changes (tamper-evident)", () => {
    const a = nhSign(creds, "1700000000000", "n", "POST", "/x", "", JSON.stringify({ a: 1 }));
    const b = nhSign(creds, "1700000000000", "n", "POST", "/x", "", JSON.stringify({ a: 2 }));
    expect(a).not.toBe(b);
  });
});
