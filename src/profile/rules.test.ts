import { describe, expect, it } from "vitest";
import { canonicalAddress, checkName, isReservedName, nameKey, sameAddress, tidyName } from "./rules.js";

const ok = (raw: unknown, admin = false) => {
  const r = checkName(raw, { admin });
  if (!r.ok) throw new Error(`expected ${JSON.stringify(raw)} to pass, got: ${r.error}`);
  return r;
};
const err = (raw: unknown, admin = false) => {
  const r = checkName(raw, { admin });
  if (r.ok) throw new Error(`expected ${JSON.stringify(raw)} to fail`);
  return r.error;
};

describe("display name rules", () => {
  it("takes ordinary names", () => {
    expect(ok("badbren").name).toBe("badbren");
    expect(ok("Hash Hunter 21").name).toBe("Hash Hunter 21");
    expect(ok("sat_stacker.v2").name).toBe("sat_stacker.v2");
    expect(ok("a-b").name).toBe("a-b");
  });

  it("tidies spaces instead of refusing them", () => {
    expect(ok("  Big   Hash  ").name).toBe("Big Hash");
    expect(tidyName("a\t\tb\nc")).toBe("a b c");
  });

  it("is 3–20 characters", () => {
    expect(err("ab")).toMatch(/3–20/);
    expect(err("x".repeat(21))).toMatch(/3–20/);
    expect(ok("x".repeat(20)).name).toHaveLength(20);
    expect(err("   ")).toMatch(/3–20/);
  });

  it("is plain letters, digits, space, _ - . only", () => {
    expect(err("bad!bren")).toMatch(/only/);
    expect(err("émile")).toMatch(/only/);
    expect(err("bаdbren")).toMatch(/only/); // Cyrillic а: look-alikes can't pose as someone
    expect(err("<script>")).toMatch(/only/);
  });

  it("starts and ends with a letter or number", () => {
    expect(err("_bren")).toMatch(/Start and end/);
    expect(err("bren.")).toMatch(/Start and end/);
  });

  it("refuses anything that isn't a string", () => {
    expect(err(null)).toBeTruthy();
    expect(err(42)).toBeTruthy();
    expect(err({ name: "x" })).toBeTruthy();
  });

  it("keeps brand and role words for the owner", () => {
    for (const n of ["Parahawk", "parahawk_fan", "Admin", "the.admin", "4dm1n", "Moderator", "Owner", "mod", "M0D", "Official Bren", "Parasite Pool", "support", "staff"]) {
      expect(err(n), n).toBe("That name is reserved.");
      expect(isReservedName(n), n).toBe(true);
    }
    expect(ok("Parahawk", true).name).toBe("Parahawk");
    expect(ok("admin", true).name).toBe("admin");
  });

  it("does not over-match generic words", () => {
    // "mod"/"owner" only as whole words; brand words anywhere.
    for (const n of ["model citizen", "Modest", "Downer", "commodore", "botanist", "roots"]) expect(ok(n).name).toBeTruthy();
  });

  it("blocks slurs and strong profanity, even dressed up, without catching innocent words", () => {
    expect(err("fuckface")).toBe("Pick a different name.");
    expect(err("sh1t_miner")).toBe("Pick a different name.");
    expect(err("big dick")).toBe("Pick a different name.");
    // The owner gets no pass on these.
    expect(err("fuckface", true)).toBe("Pick a different name.");
    for (const n of ["peacock", "Dickens", "Scotty", "assembly", "cumulus", "grape juice"]) expect(ok(n).name, n).toBeTruthy();
  });

  it("compares names ignoring case and separators", () => {
    expect(nameKey("Bad.Bren")).toBe(nameKey("badbren"));
    expect(nameKey("BAD_BREN")).toBe(nameKey("bad bren"));
    expect(nameKey("bad-bren")).toBe("badbren");
    expect(ok("Bad Bren").key).toBe("badbren");
  });
});

describe("addresses", () => {
  it("lower-cases bech32 and keeps base58 exactly", () => {
    expect(canonicalAddress("BC1QABC")).toBe("bc1qabc");
    expect(canonicalAddress(" bc1pXYZ ")).toBe("bc1pxyz");
    expect(canonicalAddress("3AbCdE")).toBe("3AbCdE");
    expect(canonicalAddress("1AbCdE")).toBe("1AbCdE");
  });

  it("compares the same way", () => {
    expect(sameAddress("bc1qABC", "BC1Qabc")).toBe(true);
    expect(sameAddress("3AbC", "3abc")).toBe(false);
    expect(sameAddress(null, "bc1q")).toBe(false);
    expect(sameAddress(undefined, undefined)).toBe(false);
  });
});
