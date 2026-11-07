/**
 * The practice ledger — ore mined, Whites won, and the tiers burned up from
 * them, per identity.
 *
 * This is a **practice** record, and everything that reads it says so. No
 * contract is deployed, nothing here is an NFT, and none of it carries over to
 * the real collection when it ships. It exists so the loop is real to play —
 * runs accumulate, ore adds up, a claim is something you actually reach — and
 * so the reward moment can be seen before any of it is live.
 *
 * Keyed by wallet when one is connected and by the browser otherwise, so
 * signing in shows that wallet's own progress. When the real thing ships, the
 * same interface gets a Supabase-backed implementation and nothing above it
 * changes (same reasoning as session/store.ts).
 */
import { ORE_PER_WHITE, TIERS, nextTier, type TierId } from "../../econ/tokenomics";
import type { KeyValueStore } from "./store";
import type { WalletAccount } from "./wallet";

/** One practice piece — won, claimed or burned up into. Not minted, and never presented as minted. */
export interface PracticeClaim {
  /** Short hex serial, stable once assigned. */
  id: string;
  /** Unix ms it was claimed. */
  at: number;
  /** Ore spent to claim it (0 when it was won outright or made by burning). */
  ore: number;
  /** Its tier. Records saved before tiers existed are Whites. */
  tier: TierId;
  /** Unix ms it was burned into the next tier; absent while it is held. */
  burnedAt?: number;
  /** The two pieces burned to make this one. */
  from?: [string, string];
}

export interface LedgerState {
  /** Runs completed. */
  runs: number;
  /** Ore banked and not yet spent on a claim. */
  ore: number;
  /** Every bit of ore ever mined, including what has been spent. */
  lifetimeOre: number;
  claims: PracticeClaim[];
  /** Best single run. */
  bestRun: number;
}

export interface PracticeLedger {
  state(): LedgerState;
  /** Record a finished run. Returns the new state. */
  addRun(ore: number): LedgerState;
  /** True when there is enough ore to claim a White. */
  canClaim(): boolean;
  /** Spend ORE_PER_WHITE and mint a practice White. Null when there is not enough ore. */
  claim(): PracticeClaim | null;
  /** Hand this identity `count` practice Whites outright — a finished run's reward. */
  award(count: number): PracticeClaim[];
  /** Pieces still held (not burned), oldest first. */
  held(): PracticeClaim[];
  /**
   * Burn two held pieces of the same tier into one of the next. Throws an Error
   * a person can read when the pair is not allowed: the same piece twice, one
   * already burned, two different tiers, or the top of the ladder.
   */
  burn(a: string, b: string): PracticeClaim;
  /** Wipe this identity's practice record. */
  reset(): void;
  subscribe(fn: (s: LedgerState) => void): () => void;
  /** Point the ledger at a different identity (sign-in, sign-out, account switch). */
  setIdentity(account: WalletAccount | null): void;
}

const EMPTY: LedgerState = { runs: 0, ore: 0, lifetimeOre: 0, claims: [], bestRun: 0 };

/** Storage key for an identity. Guests share one per browser. */
function keyFor(account: WalletAccount | null): string {
  return account ? `practice.${account.chain}.${account.address.toLowerCase()}` : "practice.guest";
}

/**
 * A serial that looks like what the real thing will use. Derived from the claim
 * itself rather than randomly, so re-reading a stored ledger never renumbers it.
 */
function serial(index: number, at: number): string {
  const mix = (index * 2654435761 + at) >>> 0;
  return "#" + mix.toString(16).padStart(8, "0").slice(0, 8);
}

const TIER_IDS: ReadonlySet<string> = new Set(TIERS.map((t) => t.id));

/** Anything read back from storage is untrusted — a hand-edited value must not crash the desktop. */
function sanitize(raw: unknown): LedgerState {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY };
  // `blacks` is the same list from before the collection became the Snipers;
  // a record saved then is read as claims, and saved back in the new shape.
  const o = raw as Partial<LedgerState> & { blacks?: unknown };
  const num = (v: unknown, max = Number.MAX_SAFE_INTEGER) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0;
  const list: unknown = Array.isArray(o.claims) ? o.claims : o.blacks;
  const claims = Array.isArray(list)
    ? list
        .filter((c): c is PracticeClaim => typeof c === "object" && c !== null && typeof (c as PracticeClaim).id === "string")
        .map((c): PracticeClaim => {
          const out: PracticeClaim = { id: c.id.slice(0, 12), at: num(c.at), ore: num(c.ore), tier: TIER_IDS.has(c.tier) ? c.tier : "white" };
          if (typeof c.burnedAt === "number" && c.burnedAt > 0) out.burnedAt = num(c.burnedAt);
          if (Array.isArray(c.from) && c.from.length === 2 && c.from.every((f) => typeof f === "string")) {
            out.from = [c.from[0]!.slice(0, 12), c.from[1]!.slice(0, 12)];
          }
          return out;
        })
    : [];
  return {
    runs: num(o.runs),
    ore: num(o.ore),
    lifetimeOre: num(o.lifetimeOre),
    bestRun: num(o.bestRun),
    claims,
  };
}

export function createPracticeLedger(store: KeyValueStore, account: WalletAccount | null = null): PracticeLedger {
  let key = keyFor(account);
  let state: LedgerState = sanitize(store.get(key));
  const listeners = new Set<(s: LedgerState) => void>();

  const emit = () => { for (const fn of [...listeners]) fn(state); };
  const persist = () => { store.set(key, state); };

  return {
    state: () => state,

    addRun(ore) {
      const banked = Number.isFinite(ore) && ore > 0 ? Math.round(ore) : 0;
      state = {
        ...state,
        runs: state.runs + 1,
        ore: state.ore + banked,
        lifetimeOre: state.lifetimeOre + banked,
        bestRun: Math.max(state.bestRun, banked),
      };
      persist();
      emit();
      return state;
    },

    canClaim: () => state.ore >= ORE_PER_WHITE,

    claim() {
      if (state.ore < ORE_PER_WHITE) return null;
      const at = Date.now();
      const claim: PracticeClaim = { id: serial(state.claims.length, at), at, ore: ORE_PER_WHITE, tier: "white" };
      state = { ...state, ore: state.ore - ORE_PER_WHITE, claims: [...state.claims, claim] };
      persist();
      emit();
      return claim;
    },

    award(count) {
      const n = Number.isFinite(count) ? Math.max(0, Math.min(10, Math.floor(count))) : 0;
      if (n === 0) return [];
      const at = Date.now();
      const won = Array.from({ length: n }, (_, i): PracticeClaim =>
        ({ id: serial(state.claims.length + i, at), at, ore: 0, tier: "white" }));
      state = { ...state, claims: [...state.claims, ...won] };
      persist();
      emit();
      return won;
    },

    held: () => state.claims.filter((c) => c.burnedAt === undefined),

    burn(a, b) {
      if (a === b) throw new Error("Pick two different pieces.");
      const x = state.claims.find((c) => c.id === a);
      const y = state.claims.find((c) => c.id === b);
      if (!x || !y) throw new Error("That piece is not in this wallet.");
      if (x.burnedAt !== undefined || y.burnedAt !== undefined) throw new Error("One of those has already been burned.");
      if (x.tier !== y.tier) throw new Error("Both pieces have to be the same tier.");
      const up = nextTier(x.tier);
      if (!up) throw new Error("Prismatic is the top of the ladder — there is nothing to burn up into.");
      const at = Date.now();
      const made: PracticeClaim = { id: serial(state.claims.length, at), at, ore: 0, tier: up.id, from: [x.id, y.id] };
      state = {
        ...state,
        claims: [...state.claims.map((c) => (c.id === a || c.id === b ? { ...c, burnedAt: at } : c)), made],
      };
      persist();
      emit();
      return made;
    },

    reset() {
      state = { ...EMPTY };
      store.remove(key);
      emit();
    },

    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },

    setIdentity(next) {
      const nextKey = keyFor(next);
      if (nextKey === key) return;
      key = nextKey;
      state = sanitize(store.get(key));
      emit();
    },
  };
}
