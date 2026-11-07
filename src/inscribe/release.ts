/**
 * Who may actually inscribe from the Inscribe window right now. Pure (no DOM).
 *
 * The tool is finished, but the owner is doing 20 test inscriptions on mainnet
 * before it opens to everyone (owner, 2026-11-06: "basically the step where
 * they'd pay for xverse is where we stop… Admin will inscribe 20x before
 * releasing"). Until then the whole window works for everyone — wallet, content,
 * fee, cost — and only the owner's press goes through to Xverse; anyone else
 * stops at the step where Xverse would ask them to pay. Nothing is greyed out.
 *
 * TO OPEN IT TO EVERYONE: set INSCRIBE_OPEN_TO_ALL to true. The "finished"
 * banner and the stop note both go away with it.
 */
export const INSCRIBE_OPEN_TO_ALL = false;

/** How many test inscriptions the owner does before release (shown in the copy). */
export const TEST_INSCRIPTIONS_BEFORE_RELEASE = 20;

/**
 * True when this person's press goes through to Xverse (and they pay). The
 * owner check is the server session's (session/me.ts) — the only side that can
 * say "this is the owner".
 */
export function mayInscribe(isOwner: boolean, openToAll: boolean = INSCRIBE_OPEN_TO_ALL): boolean {
  return openToAll || isOwner;
}
