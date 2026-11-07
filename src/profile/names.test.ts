import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addressForRef,
  avatarUrlOf,
  displayNamesFor,
  profilesFor,
  publicNamesFor,
  rememberName,
  rememberProfile,
  shortAddress,
  useProfileStore,
} from "./names.js";
import { MemoryProfileStore, type ProfileStore } from "./store.js";

const ALICE = "bc1qalice0000000000000000000000000000000";
const BOB = "bc1qbob00000000000000000000000000000000000";
const CARL = "bc1qcarl0000000000000000000000000000000000";
const opts = { now: Date.now(), dailyLimit: Infinity };
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));

afterEach(() => useProfileStore(null));

describe("displayNamesFor", () => {
  it("returns only the addresses with names, keyed as passed", async () => {
    const s = new MemoryProfileStore();
    await s.setName(ALICE, "Alice", opts);
    useProfileStore(s);
    const names = await displayNamesFor([ALICE, BOB, ALICE.toUpperCase()]);
    expect(names.get(ALICE)).toBe("Alice");
    expect(names.get(ALICE.toUpperCase())).toBe("Alice");
    expect(names.has(BOB)).toBe(false);
  });

  it("caches lookups, and a change saved here shows at once", async () => {
    const s = new MemoryProfileStore();
    await s.setName(ALICE, "Alice", opts);
    useProfileStore(s);
    const spy = vi.spyOn(s, "refsFor");
    await displayNamesFor([ALICE, BOB]);
    await displayNamesFor([ALICE, BOB]);
    expect(spy).toHaveBeenCalledTimes(1);
    rememberName(ALICE, "Alice Two");
    expect((await displayNamesFor([ALICE])).get(ALICE)).toBe("Alice Two");
    rememberProfile(await s.setName(BOB, "Bob", opts));
    expect((await displayNamesFor([BOB])).get(BOB)).toBe("Bob");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("includes private people (Chat shows their name, just never their wallet)", async () => {
    const s = new MemoryProfileStore();
    await s.setName(ALICE, "Alice", opts);
    await s.setPrivate(ALICE, true, Date.now());
    useProfileStore(s);
    expect((await displayNamesFor([ALICE])).get(ALICE)).toBe("Alice");
  });

  it("never throws: a broken store means no names", async () => {
    const broken = {
      kind: "memory",
      refsFor: async () => { throw new Error("database down"); },
    } as unknown as ProfileStore;
    useProfileStore(broken);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(displayNamesFor([ALICE])).resolves.toEqual(new Map());
    await expect(profilesFor([ALICE])).resolves.toEqual(new Map());
    await expect(publicNamesFor([ALICE])).resolves.toEqual(new Map());
    warn.mockRestore();
  });

  it("skips the store entirely for an empty list", async () => {
    const s = new MemoryProfileStore();
    useProfileStore(s);
    const spy = vi.spyOn(s, "refsFor");
    expect((await displayNamesFor([])).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("publicNamesFor (names next to wallets)", () => {
  it("leaves out everyone who turned privacy on", async () => {
    const s = new MemoryProfileStore();
    await s.setName(ALICE, "Alice", opts);
    await s.setName(BOB, "Bob", opts);
    await s.setPrivate(BOB, true, Date.now());
    useProfileStore(s);
    expect([...await publicNamesFor([ALICE, BOB, CARL])]).toEqual([[ALICE, "Alice"]]);
  });
});

describe("profilesFor", () => {
  it("returns name, privacy, uid and picture URL for profiles only", async () => {
    const s = new MemoryProfileStore();
    const a = await s.setName(ALICE, "Alice", opts);
    const withPic = await s.setAvatar(ALICE, { type: "image/png", bytes: PNG }, Date.now());
    await s.setPrivate(BOB, true, Date.now());
    useProfileStore(s);
    const refs = await profilesFor([ALICE, BOB, CARL]);
    expect(refs.get(ALICE)).toEqual({ name: "Alice", isPrivate: false, uid: a.uid, avatarUrl: avatarUrlOf(withPic) });
    expect(refs.get(ALICE)?.avatarUrl).toBe(`/api/profile/avatar/${a.uid}?v=${withPic.avatarVersion}`);
    expect(refs.get(BOB)).toMatchObject({ name: null, isPrivate: true, avatarUrl: null });
    expect(refs.has(CARL)).toBe(false);
  });
});

describe("addressForRef", () => {
  it("resolves ~uid to the wallet behind it, and says whether it is private", async () => {
    const s = new MemoryProfileStore();
    const bob = await s.setPrivate(BOB, true, Date.now());
    useProfileStore(s);
    expect(await addressForRef(`~${bob.uid}`)).toEqual({ address: BOB, isPrivate: true });
    expect(await addressForRef("~000000000000")).toBeNull();
    expect(await addressForRef("~not-a-uid")).toBeNull();
  });

  it("resolves any well-formed wallet, profile or not", async () => {
    const s = new MemoryProfileStore();
    await s.setPrivate(BOB, true, Date.now());
    useProfileStore(s);
    expect(await addressForRef(ALICE.toUpperCase())).toEqual({ address: ALICE, isPrivate: false });
    expect(await addressForRef(BOB)).toEqual({ address: BOB, isPrivate: true });
    expect(await addressForRef("<script>")).toBeNull();
    expect(await addressForRef("")).toBeNull();
  });
});

describe("shortAddress", () => {
  it("keeps the ends", () => {
    expect(shortAddress(ALICE)).toBe("bc1qal…0000");
    expect(shortAddress("bc1qshort")).toBe("bc1qshort");
  });
});
