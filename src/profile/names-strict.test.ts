import { afterEach, describe, expect, it } from "vitest";
import { profilesFor, profilesForStrict, useProfileStore } from "./names.js";
import type { ProfileStore } from "./store.js";

const SOMEONE = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

/** A store whose reads all fail — the database is down. */
const down = { refsFor: async () => { throw new Error("db down"); } } as unknown as ProfileStore;

afterEach(() => useProfileStore(null));

describe("profile lookups when the store is down", () => {
  it("profilesFor guesses 'no profile' — fine for a name next to a wallet", async () => {
    useProfileStore(down);
    expect((await profilesFor([SOMEONE])).size).toBe(0);
  });

  it("profilesForStrict refuses to guess, so Chat can't show a private person as public", async () => {
    useProfileStore(down);
    await expect(profilesForStrict([SOMEONE])).rejects.toThrow("db down");
  });
});
