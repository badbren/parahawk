import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startActivityTracker } from "./activity";
import type { ServerIdentity, ServerSession } from "./me";

function fakeMe(address: string | null): ServerSession & { set(a: string | null): void } {
  let me: ServerIdentity = { address, admin: false };
  const listeners = new Set<(m: ServerIdentity) => void>();
  return {
    current: () => me,
    isAdmin: () => false,
    refresh: async () => me,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(a) { me = { address: a, admin: false }; for (const fn of listeners) fn(me); },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("startActivityTracker", () => {
  it("pings once a minute while signed in and visible", async () => {
    const post = vi.fn(async () => undefined);
    const t = startActivityTracker(fakeMe("bc1qalice"), { post, isVisible: () => true, onVisibilityChange: () => () => {} });
    await vi.advanceTimersByTimeAsync(60_000 * 3);
    expect(post).toHaveBeenCalledTimes(3);
    t.stop();
    await vi.advanceTimersByTimeAsync(60_000 * 3);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("sends nothing while hidden or signed out", async () => {
    const post = vi.fn(async () => undefined);
    let visible = false;
    const me = fakeMe(null);
    let onVis: () => void = () => {};
    const t = startActivityTracker(me, { post, isVisible: () => visible, onVisibilityChange: (fn) => { onVis = fn; return () => {}; } });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(post).not.toHaveBeenCalled();

    me.set("bc1qalice"); // signed in, but the tab is hidden
    await vi.advanceTimersByTimeAsync(60_000);
    expect(post).not.toHaveBeenCalled();

    visible = true; onVis(); // back to the tab: a ping straight away
    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(1);
    t.stop();
  });

  it("starts a streak the moment someone signs in", async () => {
    const post = vi.fn(async () => undefined);
    const me = fakeMe(null);
    const t = startActivityTracker(me, { post, isVisible: () => true, onVisibilityChange: () => () => {} });
    me.set("bc1qalice");
    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(1);
    t.stop();
  });

  it("never stacks pings behind a slow network", async () => {
    let release: () => void = () => {};
    const post = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const t = startActivityTracker(fakeMe("bc1qalice"), { post, isVisible: () => true, onVisibilityChange: () => () => {} });
    await vi.advanceTimersByTimeAsync(60_000 * 4);
    expect(post).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(post).toHaveBeenCalledTimes(2);
    t.stop();
  });
});
