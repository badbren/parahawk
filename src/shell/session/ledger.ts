/**
 * The practice ledger — ore mined and Blacks claimed, per identity.
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
import { ORE_PER_BLACK } from "../../econ/tokenomics";
import type { KeyValueStore } from "./store";
import type { WalletAccount } from "./wallet";

/** A Black claimed in practice. Not an NFT, and never presented as one. */
export interface PracticeBlack {
  /** Short hex serial, stable once assigned. */
  id: string;
  /** Unix ms it was claimed. */
  at: number;
  /** Ore spent to claim it. */
  ore: number;
}

export interface LedgerState {
  /** Runs completed. */
  runs: number;
  /** Ore banked and not yet spent on a claim. */
  ore: number;
  /** Every bit of ore ever mined, including what has been spent. */
  lifetimeOre: number;
  blacks: PracticeBlack[];
  /** Best single run. */
  bestRun: number;
}

export interface PracticeLedger {
  state(): LedgerState;
  /** Record a finished run. Returns the new state. */
  addRun(ore: number): LedgerState;
  /** True when there is enough ore to claim a Black. */
  canClaim(): boolean;
  /** Spend ORE_PER_BLACK and mint a practice Black. Null when there is not enough ore. */
  claim(): PracticeBlack | null;
  /** Wipe this identity's practice record. */
  reset(): void;
  subscribe(fn: (s: LedgerState) => void): () => void;
  /** Point the ledger at a different identity (sign-in, sign-out, account switch). */
  setIdentity(account: WalletAccount | null): void;
}

const EMPTY: LedgerState = { runs: 0, ore: 0, lifetimeOre: 0, blacks: [], bestRun: 0 };

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

/** Anything read back from storage is untrusted — a hand-edited value must not crash the desktop. */
function sanitize(raw: unknown): LedgerState {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY };
  const o = raw as Partial<LedgerState>;
  const num = (v: unknown, max = Number.MAX_SAFE_INTEGER) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0;
  const blacks = Array.isArray(o.blacks)
    ? o.blacks
        .filter((b): b is PracticeBlack => typeof b === "object" && b !== null && typeof (b as PracticeBlack).id === "string")
        .map((b) => ({ id: b.id.slice(0, 12), at: num(b.at), ore: num(b.ore) }))
    : [];
  return {
    runs: num(o.runs),
    ore: num(o.ore),
    lifetimeOre: num(o.lifetimeOre),
    bestRun: num(o.bestRun),
    blacks,
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

    canClaim: () => state.ore >= ORE_PER_BLACK,

    claim() {
      if (state.ore < ORE_PER_BLACK) return null;
      const at = Date.now();
      const black: PracticeBlack = { id: serial(state.blacks.length, at), at, ore: ORE_PER_BLACK };
      state = { ...state, ore: state.ore - ORE_PER_BLACK, blacks: [...state.blacks, black] };
      persist();
      emit();
      return black;
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
