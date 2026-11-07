import { describe, expect, it } from "vitest";
import { LATEST_RELEASE, RELEASES, type Release } from "../changelog-data.js";
import { changelogBody } from "./changelog.js";

describe("big releases' data", () => {
  it("keeps `changes` equal to the sections joined in order, and no section is empty", () => {
    for (const r of RELEASES.filter((x) => x.sections)) {
      expect(r.changes).toEqual(r.sections!.flatMap((s) => s.changes));
      for (const s of r.sections!) {
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.changes.length).toBeGreaterThan(0);
      }
    }
  });

  it("writes plain text: no angle brackets that would turn into HTML tags", () => {
    for (const r of RELEASES) {
      for (const t of [r.name, r.summary, ...r.changes.map((c) => c.text), ...(r.highlights ?? []).flatMap((h) => [h.title, h.text])]) {
        expect(t).not.toMatch(/[<>]/);
      }
    }
  });
});

describe("changelogBody", () => {
  it("shows the running 2.0 release as a hero with every section and a correct count", () => {
    const html = changelogBody();
    expect(LATEST_RELEASE.version).toBe("2.0");
    expect(html).toContain('class="cl-hero"');
    expect(html).toContain(`<span class="cl-hero-ver">v${LATEST_RELEASE.version}</span>`);
    expect(html).toContain(`<b>${LATEST_RELEASE.changes.length}</b> updates in <b>${LATEST_RELEASE.sections!.length}</b> sections`);
    for (const s of LATEST_RELEASE.sections!) expect(html).toContain(s.title);
    for (const h of LATEST_RELEASE.highlights!) expect(html).toContain(h.title);
    // Shown once, as the hero — not again in the timeline below it.
    expect(html.match(/class="cl-rel cur"/g)).toBeNull();
    expect(html).toContain("Earlier releases");
  });

  it("renders older releases as the plain timeline entries they always were", () => {
    const html = changelogBody();
    for (const r of RELEASES.filter((x) => x !== LATEST_RELEASE)) {
      expect(html).toContain(`<span class="cl-ver">v${r.version}</span>`);
      expect(html).toContain(`<span class="cl-name">${r.name}</span>`);
    }
  });

  it("falls back to the old page when the running release is a small one", () => {
    const small: Release = { version: "9.9", name: "Small", date: "2030-01-01", current: true, summary: "s", changes: [{ tag: "New", text: "one thing" }] };
    const html = changelogBody([small], small);
    expect(html).not.toContain('class="cl-hero"');
    expect(html).toContain('class="cl-now"');
    expect(html).toContain('class="cl-rel cur"');
  });

  it("uses the orange theme, never hard-coded white", () => {
    expect(changelogBody()).not.toMatch(/#fff\b|#ffffff\b/i);
  });
});
