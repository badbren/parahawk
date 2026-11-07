import { beforeEach, describe, expect, it, vi } from "vitest";

const { publicNamesFor } = vi.hoisted(() => ({
  publicNamesFor: vi.fn<(addresses: readonly string[]) => Promise<Map<string, string>>>(),
}));
vi.mock("../profile/names.js", () => ({ publicNamesFor }));

import { nameTag, profilePath, walletCell, walletNames } from "./addr.js";

const FULL = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const MASKED = "bc1qxy…0wlh";
const resolve = (m: string) => (m === MASKED ? FULL : null);

describe("walletCell", () => {
  it("renders exactly as before when there are no names", () => {
    expect(walletCell(FULL)).toBe(`<a href="/address/${FULL}">bc1qxy2kgdyg…0wlh</a>`);
    expect(walletCell(FULL, resolve, new Map())).toBe(`<a href="/address/${FULL}">bc1qxy2kgdyg…0wlh</a>`);
  });

  it("puts the owner's name in parentheses after the wallet, linking to their profile", () => {
    const cell = walletCell(FULL, undefined, new Map([[FULL, "badbren"]]));
    expect(cell).toBe(
      `<a href="/address/${FULL}">bc1qxy2kgdyg…0wlh</a> <a class="pname" href="/u/${FULL}" data-ph-open="/u/${FULL}" title="badbren's profile">(badbren)</a>`,
    );
  });

  it("finds the name for a masked address through the resolver", () => {
    const cell = walletCell(MASKED, resolve, new Map([[FULL, "badbren"]]));
    expect(cell).toContain(`<a href="/address/${FULL}">${MASKED}</a>`);
    expect(cell).toContain("(badbren)</a>");
  });

  it("leaves an unresolvable masked address dim, with no name", () => {
    expect(walletCell(MASKED, undefined, new Map([[FULL, "badbren"]]))).toBe(`<span class="dim">${MASKED}</span>`);
  });

  it("escapes the name and encodes the profile path", () => {
    const evil = `bc1q"><img src=x onerror=alert(1)>`;
    const tag = nameTag(evil, new Map([[evil, `<b>"x"</b> & 'y'`]]));
    expect(tag).not.toContain("<b>");
    expect(tag).not.toContain("<img");
    expect(tag).toContain("(&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; &#39;y&#39;)");
    expect(tag).toContain(`href="${profilePath(evil)}"`);
    expect(profilePath(evil)).toBe(`/u/${encodeURIComponent(evil)}`);
    expect(profilePath(evil)).not.toMatch(/[<>"' ]/);
  });

  it("nameTag is empty when the wallet has no public name", () => {
    expect(nameTag(FULL)).toBe("");
    expect(nameTag(null, new Map([[FULL, "badbren"]]))).toBe("");
    expect(nameTag(FULL, new Map([["bc1qother", "someone"]]))).toBe("");
  });
});

describe("walletNames", () => {
  beforeEach(() => { publicNamesFor.mockReset(); });

  it("looks up each full address once, resolving masked ones first", async () => {
    publicNamesFor.mockImplementation(async () => new Map([[FULL, "badbren"]]));
    const names = await walletNames([FULL, MASKED, null, undefined, "", "bc1qnope…zzzz"], resolve);
    expect(publicNamesFor).toHaveBeenCalledTimes(1);
    expect(publicNamesFor.mock.calls[0]![0]).toEqual([FULL]);
    expect(names.get(FULL)).toBe("badbren");
  });

  it("skips the lookup when there is nothing to look up", async () => {
    expect((await walletNames([null, MASKED])).size).toBe(0);
    expect(publicNamesFor).not.toHaveBeenCalled();
  });

  it("renders without names when the lookup fails", async () => {
    publicNamesFor.mockImplementation(async () => { throw new Error("db down"); });
    expect((await walletNames([FULL])).size).toBe(0);
  });

  it("never holds a page up: a slow lookup gives up after the wait", async () => {
    publicNamesFor.mockImplementation(() => new Promise<Map<string, string>>(() => { /* never answers */ }));
    const t0 = Date.now();
    const names = await walletNames([FULL], undefined, 25);
    expect(names.size).toBe(0);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
