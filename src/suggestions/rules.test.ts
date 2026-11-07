import { describe, expect, it } from "vitest";
import {
  NOTES_MAX,
  TITLE_MAX,
  TITLE_MIN,
  badgeText,
  checkSuggestion,
  cleanNotes,
  cleanTitle,
  isStatus,
} from "./rules.js";

describe("checkSuggestion", () => {
  it("accepts a title and notes, cleaned", () => {
    const r = checkSuggestion({ title: "  Dark   mode\tplease ", notes: "\r\nMake it darker.\r\n\r\n\r\n\r\n\r\nThanks  \n" });
    expect(r).toEqual({ ok: true, value: { title: "Dark mode please", notes: "Make it darker.\n\n\nThanks" } });
  });

  it("refuses anything that isn't { title, notes } strings", () => {
    for (const body of [null, undefined, "hi", 42, [], ["a", "b"]]) {
      expect(checkSuggestion(body).ok).toBe(false);
    }
    expect(checkSuggestion({ notes: "x" })).toMatchObject({ ok: false, field: "title" });
    expect(checkSuggestion({ title: "Hello", notes: 5 })).toMatchObject({ ok: false, field: "notes" });
  });

  it("holds the title to 3–120 characters after cleaning", () => {
    expect(checkSuggestion({ title: "  ab  ", notes: "x" })).toMatchObject({ ok: false, field: "title" });
    expect(checkSuggestion({ title: "a".repeat(TITLE_MIN), notes: "x" }).ok).toBe(true);
    expect(checkSuggestion({ title: "a".repeat(TITLE_MAX), notes: "x" }).ok).toBe(true);
    expect(checkSuggestion({ title: "a".repeat(TITLE_MAX + 1), notes: "x" })).toMatchObject({ ok: false, field: "title" });
  });

  it("needs notes, up to 4,000 characters", () => {
    expect(checkSuggestion({ title: "Hello", notes: " \n\t " })).toMatchObject({ ok: false, field: "notes" });
    expect(checkSuggestion({ title: "Hello", notes: "n".repeat(NOTES_MAX) }).ok).toBe(true);
    expect(checkSuggestion({ title: "Hello", notes: "n".repeat(NOTES_MAX + 1) })).toMatchObject({ ok: false, field: "notes" });
  });

  it("counts length the way the browser's maxlength does (UTF-16 units)", () => {
    // 60 emoji = 120 UTF-16 code units: right at the limit, one more is over.
    expect(checkSuggestion({ title: "🦅".repeat(60), notes: "x" }).ok).toBe(true);
    expect(checkSuggestion({ title: "🦅".repeat(61), notes: "x" }).ok).toBe(false);
  });
});

describe("cleaning", () => {
  it("strips control characters and bidi overrides", () => {
    expect(cleanTitle("Hi\u0000 there\u202E!")).toBe("Hi there !");
    expect(cleanNotes("a\u0007b\u2066c\u2069")).toBe("abc");
  });

  it("keeps a title on one line", () => {
    expect(cleanTitle("one\ntwo\r\nthree")).toBe("one two three");
  });

  it("keeps the notes' line breaks but not endless blank lines or trailing spaces", () => {
    expect(cleanNotes("line one   \nline two\n\n\n\n\nline three")).toBe("line one\nline two\n\n\nline three");
    expect(cleanNotes("\tindented")).toBe("indented");
    expect(cleanNotes("a\tb")).toBe("a  b");
  });
});

describe("isStatus / badgeText", () => {
  it("knows the three statuses", () => {
    expect(["new", "read", "done"].every(isStatus)).toBe(true);
    expect(isStatus("archived")).toBe(false);
    expect(isStatus(undefined)).toBe(false);
  });

  it("shows nothing, a number, or 9+", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-3)).toBeNull();
    expect(badgeText(Number.NaN)).toBeNull();
    expect(badgeText(1)).toBe("1");
    expect(badgeText(9)).toBe("9");
    expect(badgeText(10)).toBe("9+");
  });
});
