import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ABOUT_BODY_SHA256, ABOUT_REVISION } from "./about-meta.js";

// The page's tip block depends on LIGHTNING_ADDRESS in the environment; pin one
// so the fingerprint is the same on every machine.
vi.mock("../config.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../config.js")>();
  return { ...mod, config: { ...mod.config, lightningAddress: "hawk@parahawk.test" } };
});

/** The About page's own content: what's inside <main>, minus generated images and line-ending noise. */
async function aboutBody(): Promise<string> {
  const { renderAbout } = await import("./pages/about.js");
  const html = await renderAbout();
  const m = /<main><div class="wrap">([\s\S]*)<\/div><\/main>/.exec(html);
  if (!m) throw new Error("couldn't find the About page's <main> — did layout.ts change?");
  return m[1]!
    .replace(/\r\n/g, "\n")
    // The tip QR is generated from the address, not written by anyone.
    .replace(/src="data:[^"]*"/g, 'src="data:"');
}

describe("About page revision (the About icon's '!')", () => {
  it("has a dated revision", () => {
    expect(ABOUT_REVISION).toMatch(/^\d{4}-\d{2}-\d{2}(-\d+)?$/);
  });

  it("matches the fingerprint pinned for this revision", async () => {
    const sha = createHash("sha256").update(await aboutBody()).digest("hex");
    expect(
      sha,
      `The About page changed. Bump ABOUT_REVISION in src/web/about-meta.ts (so visitors get the "!"), then set ABOUT_BODY_SHA256 there to "${sha}".`,
    ).toBe(ABOUT_BODY_SHA256);
  });
});
