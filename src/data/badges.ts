/**
 * Parasite Pool "Achievements" (badges). The API exposes only the raw type keys
 * under /api/account/<addr> metadata.badges.types ({total, bucket, unique}); it
 * has no definitions endpoint, so the friendly name, icon and how-to-earn text
 * live here. Icons/labels mirror the on-dashboard achievement panel (crossed
 * pickaxes = block, gold medal = block finder, avocado = Bravocado, factory =
 * Refinery). Descriptions are best-effort — labelled "as reported by Parasite".
 */
export interface BadgeDef {
  key: string;
  emoji: string;
  name: string;
  howto: string;
}

/** Display order = rarity/prestige, roughly. */
export const BADGE_DEFS: BadgeDef[] = [
  { key: "block_winner", emoji: "🥇", name: "Block Finder", howto: "Your own share solved a block for the pool — the rarest achievement." },
  { key: "bravocado", emoji: "🥑", name: "Bravocado", howto: "Land a 10T+ difficulty share and you earn a Bravocado (a 'cado' ordinal)." },
  { key: "block", emoji: "⛏️", name: "Block Contributor", howto: "Land a share in a block the pool finds — one per block you take part in." },
  { key: "refinery", emoji: "🏭", name: "Refinery", howto: "Rent hashrate through Parasite's Refinery rental order book." },
  { key: "loyalty", emoji: "🎖️", name: "Loyalty", howto: "Keep contributing shares across many blocks over time." },
  { key: "dispenser", emoji: "🎁", name: "Dispenser", howto: "Interact with the OMB Bravocado dispenser." },
  { key: "miner", emoji: "⚙️", name: "Miner", howto: "Point hashrate at the pool and start submitting shares." },
];

export const BADGE_BY_KEY: Record<string, BadgeDef> = Object.fromEntries(
  BADGE_DEFS.map((b) => [b.key, b]),
);

/**
 * A display def for ANY badge key. Hand-labelled keys (BADGE_DEFS) get their
 * custom emoji/name; anything else Parasite reports gets a generated label so no
 * achievement is ever invisible on /badges (e.g. "3 different asset types
 * collected"). To give a surfaced key a nicer emoji + description, add it to
 * BADGE_DEFS above.
 */
export function badgeDefFor(key: string): BadgeDef {
  return (
    BADGE_BY_KEY[key] ?? {
      key,
      emoji: "🏷️",
      name: key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      howto: "A Parasite achievement — surfaced automatically as Parahawk indexes wallets that hold it.",
    }
  );
}

/**
 * The pool's real Block Finders — the wallets whose own share actually solved a
 * Parasite block (the rarest achievement). Curated + authoritative: Parasite
 * exposes no block-finder feed, and its per-wallet `block_winner` badge counter
 * over-reports (it tagged ~26 wallets), so we list the verified winners here by
 * exact address. Tiny and rarely changes — 5 blocks found to date. See
 * services/badges.getBlockFinders.
 */
export interface BlockFinderDef {
  address: string; // full bc1… mining address
  blocks?: number; // how many blocks this wallet solved (badge shows ×N)
  heights?: number[]; // solved-block heights, if known
  note?: string;
}

/**
 * Verified block finders — 4 wallets, 5 blocks to date (one wallet solved 2).
 * Confirmed by exact address from each wallet's Parasite "Won block N" trophy.
 * Add new winners here as the pool finds more blocks.
 */
export const BLOCK_FINDERS: BlockFinderDef[] = [
  { address: "bc1qcgdpuu5txzr28n52kmu33avqpefh2sw2dq6j8q", blocks: 2 }, // double winner
  { address: "bc1qnd2xkan4kmdh6x89z2s7096n6nlkhcm2x29vkv", heights: [958527] },
  { address: "bc1q2l474n3qqpnmkg0y82ydt9f9jkyhz6dhqv04lt", heights: [945601] },
  { address: "bc1qsmdhm009ukwayz90dkyydaw9qyk9zvvmz8ttae", heights: [938713] },
];
