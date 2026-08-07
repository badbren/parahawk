import { createHmac, randomUUID } from "node:crypto";

/**
 * Minimal NiceHash API v2 client — signs requests with the user's own key to
 * place hashpower orders from their own balance. Parahawk never holds funds;
 * this only ever acts on the user's account, and only for order/pool operations
 * (the key is scoped so it can't withdraw).
 *
 * SAFETY: state-changing calls (create pool/order, refill, cancel) are gated by
 * `live`. When live=false (the default everywhere until ORDERING_LIVE=true) they
 * return a dry-run result and touch nothing. Read-only calls (server time,
 * balances) always run — we use the balance check as a safe way to verify a
 * freshly-linked key actually authenticates before any money moves.
 *
 * Request signing follows NiceHash's documented scheme exactly:
 *   HMAC-SHA256(secret,
 *     apiKey \0 time \0 nonce \0\0 orgId \0\0 method \0 path \0 query [\0 body])
 * and is regression-locked in nicehash-client.test.ts.
 */

const NH_BASE = "https://api2.nicehash.com";

export interface NhCreds {
  orgId: string;
  apiKey: string;
  apiSecret: string;
}

/** Build the NiceHash X-Auth value: `apiKey:hexHmac`. Pure + tested. */
export function nhSign(
  creds: NhCreds,
  time: string,
  nonce: string,
  method: string,
  path: string,
  query: string,
  body: string,
): string {
  const h = createHmac("sha256", creds.apiSecret);
  h.update(
    creds.apiKey +
      "\0" +
      time +
      "\0" +
      nonce +
      "\0\0" +
      (creds.orgId ?? "") +
      "\0\0" +
      method +
      "\0" +
      path +
      "\0" +
      (query ?? ""),
  );
  if (body) h.update("\0" + body);
  return creds.apiKey + ":" + h.digest("hex");
}

async function nhServerTime(): Promise<string> {
  const res = await fetch(`${NH_BASE}/api/v2/time`);
  if (!res.ok) throw new Error(`NiceHash time ${res.status}`);
  const j = (await res.json()) as { serverTime: number };
  return String(j.serverTime);
}

interface NhRequest {
  creds: NhCreds;
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: string;
  body?: unknown;
}

async function nhFetch<T>({ creds, method, path, query = "", body }: NhRequest): Promise<T> {
  const time = await nhServerTime();
  const nonce = randomUUID();
  const bodyStr = body === undefined ? "" : JSON.stringify(body);
  const auth = nhSign(creds, time, nonce, method, path, query, bodyStr);
  const url = `${NH_BASE}${path}${query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      "X-Time": time,
      "X-Nonce": nonce,
      "X-Organization-Id": creds.orgId,
      "X-Request-Id": randomUUID(),
      "X-Auth": auth,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: bodyStr || undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    // Never surface the raw body to clients (could echo request context); the
    // caller logs server-side and shows a generic message.
    throw new Error(`NiceHash ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export interface NhBalance {
  total: number; // BTC available
  currency: string;
}

/**
 * Read-only auth check: fetch the account's BTC balance. Safe to call the moment
 * a key is linked — proves the key authenticates and is scoped correctly before
 * any order is ever placed.
 */
export async function nhCheckAuth(creds: NhCreds): Promise<NhBalance> {
  const j = await nhFetch<{ total?: { available?: string; currency?: string } }>({
    creds,
    method: "GET",
    path: "/main/api/v2/accounting/account2/BTC",
  });
  return {
    total: Number(j.total?.available ?? 0),
    currency: j.total?.currency ?? "BTC",
  };
}

export interface PoolSpec {
  name: string;
  stratumHostname: string;
  stratumPort: number;
  username: string; // <bc1q>.<worker>
  password: string; // "x"
}

export interface OrderSpec {
  poolId: string;
  priceBtcPerPhDay: number; // limit price
  limitPhs: number; // speed limit (PH/s)
  amountBtc: number; // total spend
  type: "STANDARD" | "FIXED";
}

export interface DryRunnable {
  dryRun: boolean;
}

/** Create a pool entry pointed at the target stratum (e.g. Parasite high-diff). */
export async function nhCreatePool(
  creds: NhCreds,
  spec: PoolSpec,
  live: boolean,
): Promise<{ id: string } & DryRunnable> {
  if (!live) return { id: "DRYRUN-POOL", dryRun: true };
  const j = await nhFetch<{ id: string }>({
    creds,
    method: "POST",
    path: "/main/api/v2/pool",
    body: {
      name: spec.name,
      algorithm: "SHA256",
      stratumHostname: spec.stratumHostname,
      stratumPort: spec.stratumPort,
      username: spec.username,
      password: spec.password,
    },
  });
  return { id: j.id, dryRun: false };
}

/**
 * Place a hashpower order. NiceHash prices SHA-256 in BTC/PH/day; `limit` is the
 * speed cap in PH/s. Marked async-verify: the exact marketFactor fields are
 * confirmed against a live account during the first test order before this is
 * trusted for real spends.
 */
export async function nhPlaceOrder(
  creds: NhCreds,
  spec: OrderSpec,
  live: boolean,
): Promise<{ id: string } & DryRunnable> {
  if (!live) return { id: "DRYRUN-ORDER", dryRun: true };
  const j = await nhFetch<{ id: string }>({
    creds,
    method: "POST",
    path: "/main/api/v2/hashpower/order",
    body: {
      market: "EU", // resolved per-account before go-live
      algorithm: "SHA256",
      amount: spec.amountBtc,
      price: spec.priceBtcPerPhDay,
      limit: spec.limitPhs,
      poolId: spec.poolId,
      type: spec.type,
    },
  });
  return { id: j.id, dryRun: false };
}
