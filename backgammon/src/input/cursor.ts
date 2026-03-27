/**
 * Cursor navigation — linear point ordering and smart skipping.
 */

import type { GameState, Die } from '../state/contracts';
import {
  LINEAR_POINT_ORDER, BAR_INDEX, BEAR_OFF_INDEX,
  POINT_BAR, POINT_BEAR_OFF,
} from '../state/constants';
import { getMovablePoints, getValidDestinations, getLegalMovesForDie } from '../game/moves';
import { hasCheckersOnBar } from '../game/rules';

/**
 * Get the point ID at a cursor index.
 */
export function getPointAtCursor(cursorIndex: number): number {
  return LINEAR_POINT_ORDER[cursorIndex] ?? LINEAR_POINT_ORDER[0]!;
}

/**
 * Get cursor index for a given point ID.
 */
export function getCursorForPoint(point: number): number {
  const idx = LINEAR_POINT_ORDER.indexOf(point as typeof LINEAR_POINT_ORDER[number]);
  return idx >= 0 ? idx : 0;
}

/**
 * Get the active die value from state.
 */
function getActiveDie(state: GameState): Die | null {
  const { dice, activeDieIndex } = state;
  if (!dice.values) return null;
  if (dice.isDoubles) {
    return dice.remaining.length > 0 ? dice.values[0] : null;
  }
  const val = dice.values[activeDieIndex] as Die | undefined;
  if (val && dice.remaining.includes(val)) return val;
  const otherVal = dice.values[1 - activeDieIndex] as Die | undefined;
  if (otherVal && dice.remaining.includes(otherVal)) return otherVal;
  return null;
}

/**
 * Get points that are movable with the active die only.
 */
function getMovablePointsForActiveDie(state: GameState): number[] {
  const die = getActiveDie(state);
  if (!die) return [];
  const moves = getLegalMovesForDie(state.board, state.turn, die);
  const points = new Set<number>();
  for (const m of moves) points.add(m.from);
  return [...points].sort((a, b) => a - b);
}

/**
 * Move cursor in selectChecker phase — only land on points movable with active die.
 */
export function advanceCursorSelectChecker(
  state: GameState,
  direction: 'up' | 'down',
): number {
  const movable = getMovablePointsForActiveDie(state);
  if (movable.length === 0) return state.cursorIndex;

  const movableIndices = movable.map(p => {
    if (p === 0) return BAR_INDEX;
    return getCursorForPoint(p);
  }).sort((a, b) => a - b);

  const current = state.cursorIndex;
  const step = direction === 'down' ? 1 : -1;

  if (step > 0) {
    for (const idx of movableIndices) {
      if (idx > current) return idx;
    }
    return movableIndices[0]!;
  } else {
    for (let i = movableIndices.length - 1; i >= 0; i--) {
      if (movableIndices[i]! < current) return movableIndices[i]!;
    }
    return movableIndices[movableIndices.length - 1]!;
  }
}

/**
 * Move cursor in selectDestination phase — only cycle through valid destinations.
 */
export function advanceCursorSelectDestination(
  state: GameState,
  direction: 'up' | 'down',
): number {
  const { validDestinations } = state;
  if (validDestinations.length === 0) return state.cursorIndex;

  const destIndices = validDestinations.map(d => {
    if (d === 25) return BEAR_OFF_INDEX;
    return getCursorForPoint(d);
  }).sort((a, b) => a - b);

  const current = state.cursorIndex;
  const step = direction === 'down' ? 1 : -1;

  if (step > 0) {
    for (const idx of destIndices) {
      if (idx > current) return idx;
    }
    return destIndices[0]!;
  } else {
    for (let i = destIndices.length - 1; i >= 0; i--) {
      if (destIndices[i]! < current) return destIndices[i]!;
    }
    return destIndices[destIndices.length - 1]!;
  }
}

/**
 * Get the first movable cursor position, filtered by active die.
 */
export function getFirstMovableCursor(state: GameState): number {
  const { board, turn } = state;

  if (hasCheckersOnBar(board, turn)) {
    return BAR_INDEX;
  }

  const movable = getMovablePointsForActiveDie(state);
  if (movable.length === 0) return state.cursorIndex;

  return getCursorForPoint(movable[0]!);
}
