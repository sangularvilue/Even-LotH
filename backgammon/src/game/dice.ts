/**
 * Dice rolling and remaining-die tracking.
 */

import type { Die, DiceState } from '../state/contracts';

/** Roll two dice. */
export function rollDice(): [Die, Die] {
  const d1 = (Math.floor(Math.random() * 6) + 1) as Die;
  const d2 = (Math.floor(Math.random() * 6) + 1) as Die;
  return [d1, d2];
}

/** Create initial dice state from a roll. Doubles give 4 moves. */
export function createDiceState(values: [Die, Die]): DiceState {
  const isDoubles = values[0] === values[1];
  const remaining = isDoubles
    ? [values[0], values[0], values[0], values[0]]
    : [...values];
  return { values, remaining, isDoubles };
}

/** Consume a die value from remaining. Returns new remaining array, or null if die not available. */
export function consumeDie(remaining: Die[], die: Die): Die[] | null {
  const idx = remaining.indexOf(die);
  if (idx === -1) return null;
  const next = [...remaining];
  next.splice(idx, 1);
  return next;
}

/** Check if any dice remain. */
export function hasDiceRemaining(dice: DiceState): boolean {
  return dice.remaining.length > 0;
}
