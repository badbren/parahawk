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
