/**
 * What to call a player on the leaderboard: their Parahawk display name when
 * they have one (src/profile/names.ts, looked up by game-routes.ts for each
 * board it serves), the short address otherwise.
 */
export function displayNameFor(address: string): string {
  return address.length > 13 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** A namer for one board: looked-up display names first, the short address for everyone else. */
export function withNames(names: ReadonlyMap<string, string>): (address: string) => string {
  return (address) => names.get(address) ?? displayNameFor(address);
}
