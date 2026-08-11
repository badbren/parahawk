import { describe, it, expect, beforeAll } from "vitest";

// Force the in-memory backend regardless of the local .env. config.ts pulls in
// dotenv, which does NOT override env keys that already exist, so blanking these
// BEFORE the module is first imported keeps hasSupabase() false. The import must
// be dynamic — static imports are hoisted above these assignments and would load
// config.ts (with the real .env) first.
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_KEY = "";

let traffic: typeof import("./traffic.js");
beforeAll(async () => {
  traffic = await import("./traffic.js");
});

describe("hashIp", () => {
  it("is deterministic and never echoes the raw IP", () => {
    const a = traffic.hashIp("203.0.113.7");
    expect(a).toBe(traffic.hashIp("203.0.113.7"));
    expect(a).toHaveLength(24);
    expect(a).not.toContain("203.0.113.7");
  });
  it("differs for different IPs", () => {
    expect(traffic.hashIp("203.0.113.7")).not.toBe(traffic.hashIp("203.0.113.8"));
  });
});

describe("clientIp", () => {
  it("reads the leftmost x-forwarded-for hop", () => {
    const ip = traffic.clientIp({
      headers: { "x-forwarded-for": "198.51.100.9, 70.41.3.18, 150.172.238.178" },
      socket: { remoteAddress: "10.0.0.1" },
    });
    expect(ip).toBe("198.51.100.9");
  });
  it("falls back to the socket address when no x-forwarded-for", () => {
    expect(traffic.clientIp({ headers: {}, socket: { remoteAddress: "10.0.0.1" } })).toBe("10.0.0.1");
  });
});

describe("dayKey", () => {
  it("formats a timestamp as a UTC YYYY-MM-DD", () => {
    expect(traffic.dayKey(Date.UTC(2026, 7, 10, 23, 59))).toBe("2026-08-10");
  });
});

describe("memory backend", () => {
  it("counts views + unique visitors and reports them via getTrafficSummary", async () => {
    // Two hits from one IP + one from another = 2 visitors, 3 views today.
    const reqA = { headers: { "x-forwarded-for": "203.0.113.10" }, socket: {} };
    const reqB = { headers: { "x-forwarded-for": "203.0.113.20" }, socket: {} };
    await traffic.recordVisit(reqA);
    await traffic.recordVisit(reqA);
    await traffic.recordVisit(reqB);

    const s = await traffic.getTrafficSummary();
    expect(s.backend).toBe("memory");
    expect(s.today.visitors).toBe(2);
    expect(s.today.views).toBe(3);
    expect(s.last7).toEqual({ visitors: 2, views: 3 });
    expect(s.last30.views).toBe(3);
    // 30-day series, gap-filled, oldest → newest ending today.
    expect(s.days).toHaveLength(30);
    expect(s.days[s.days.length - 1]?.day).toBe(traffic.dayKey());
    expect(s.days[0]?.views).toBe(0);
  });
});
