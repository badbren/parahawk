import { describe, expect, it } from "vitest";
import { CHAT_MAX_CHARS, CHAT_MAX_LINES, charCount, cleanBody, splitLinks } from "./rules.js";

const body = (raw: unknown) => {
  const r = cleanBody(raw);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.body;
};

describe("cleanBody", () => {
  it("refuses nothing, non-strings and whitespace", () => {
    for (const raw of [undefined, null, 42, {}, "", "   ", "\n\n\t  \n"]) expect(cleanBody(raw).ok, JSON.stringify(raw)).toBe(false);
  });

  it("trims, normalises newlines and tabs, and drops trailing spaces on each line", () => {
    expect(body("  hello  ")).toBe("hello");
    expect(body("a\r\nb\rc")).toBe("a\nb\nc");
    expect(body("a\tb")).toBe("a b");
    expect(body("one   \ntwo  ")).toBe("one\ntwo");
  });

  it("collapses runs of blank lines to one", () => {
    expect(body("a\n\n\n\n\nb")).toBe("a\n\nb");
    expect(body("a\n  \n \n\nb")).toBe("a\n\nb");
  });

  it("strips control characters, bidi overrides and invisible spaces — keeps emoji joiners", () => {
    expect(body("he\u0000ll\u0007o\u007f\u0085")).toBe("hello");
    expect(body("abc‮def⁦")).toBe("abcdef");
    expect(body("zero​width﻿")).toBe("zerowidth");
    const family = "👩‍👩‍👧";
    expect(body(family)).toBe(family);
  });

  it("allows exactly the limit, counted in characters people see (emoji count once)", () => {
    expect(body("a".repeat(CHAT_MAX_CHARS))).toHaveLength(CHAT_MAX_CHARS);
    expect(cleanBody("a".repeat(CHAT_MAX_CHARS + 1)).ok).toBe(false);
    expect(cleanBody("😀".repeat(CHAT_MAX_CHARS)).ok).toBe(true);
    expect(cleanBody("😀".repeat(CHAT_MAX_CHARS + 1)).ok).toBe(false);
  });

  it("measures after tidying, so padding never pushes a message over", () => {
    expect(cleanBody(`   ${"a".repeat(CHAT_MAX_CHARS)}   \n\n\n`).ok).toBe(true);
  });

  it("caps the number of lines", () => {
    expect(cleanBody(Array(CHAT_MAX_LINES).fill("x").join("\n")).ok).toBe(true);
    const r = cleanBody(Array(CHAT_MAX_LINES + 1).fill("x").join("\n"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/lines/);
  });
});

describe("charCount", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(charCount("a😀b")).toBe(3);
    expect(charCount("")).toBe(0);
  });
});

describe("splitLinks", () => {
  const links = (t: string) => splitLinks(t).filter((p) => p.kind === "link").map((p) => (p.kind === "link" ? [p.text, p.href] : null));

  it("returns plain text untouched", () => {
    expect(splitLinks("no links here")).toEqual([{ kind: "text", text: "no links here" }]);
    expect(splitLinks("")).toEqual([]);
  });

  it("finds http(s) links and keeps the text around them", () => {
    expect(splitLinks("see https://parahawk.space/history now")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "https://parahawk.space/history", href: "https://parahawk.space/history" },
      { kind: "text", text: " now" },
    ]);
    expect(links("a http://x.io b https://y.io/c?d=1#e")).toEqual([
      ["http://x.io", "http://x.io/"],
      ["https://y.io/c?d=1#e", "https://y.io/c?d=1#e"],
    ]);
  });

  it("leaves sentence punctuation out of the link", () => {
    expect(links("go to https://mempool.space.")).toEqual([["https://mempool.space", "https://mempool.space/"]]);
    expect(links("(https://mempool.space/tx/ab)")).toEqual([["https://mempool.space/tx/ab", "https://mempool.space/tx/ab"]]);
    expect(splitLinks("(https://x.io/a)").map((p) => p.text).join("")).toBe("(https://x.io/a)");
  });

  it("keeps brackets that belong to the link", () => {
    expect(links("https://en.wikipedia.org/wiki/Hash_(disambiguation)")).toEqual([
      ["https://en.wikipedia.org/wiki/Hash_(disambiguation)", "https://en.wikipedia.org/wiki/Hash_(disambiguation)"],
    ]);
  });

  it("never links anything that isn't http(s)", () => {
    expect(links("javascript:alert(1) data:text/html,hi ftp://x.io mailto:a@b.c")).toEqual([]);
    expect(links("https://")).toEqual([]);
    expect(splitLinks("javascript:alert(1)")).toEqual([{ kind: "text", text: "javascript:alert(1)" }]);
  });

  it("puts the pieces back together as the original text", () => {
    const t = "1 https://a.io, 2 (http://b.io/x_(y)) 3 https://c.io!";
    expect(splitLinks(t).map((p) => p.text).join("")).toBe(t);
  });
});
