/**
 * Board position utilities and initial setup.
 *
 * Convention: positive values = player checkers, negative = AI checkers.
 * Points are 1-indexed (point 1 = index 0 in the array).
 */

import type { BoardPosition } from '../state/contracts';

/** Standard backgammon starting position. */
export function createInitialBoard(): BoardPosition {
  const points = new Array(24).fill(0) as number[];

  // Player checkers (positive): moving high to low (24 → 1)
  points[5] = 5;   // point 6: 5 player
  points[7] = 3;   // point 8: 3 player
  points[12] = 5;  // point 13: 5 player
  points[23] = 2;  // point 24: 2 player

  // AI checkers (negative): moving low to high (1 → 24)
  points[0] = -2;   // point 1: 2 AI
  points[11] = -5;  // point 12: 5 AI
  points[16] = -3;  // point 17: 3 AI
  points[18] = -5;  // point 19: 5 AI

  return {
    points,
    bar: { player: 0, ai: 0 },
    borneOff: { player: 0, ai: 0 },
  };
}

/** Deep clone a board position. */
export function cloneBoard(board: BoardPosition): BoardPosition {
  return {
    points: [...board.points],
    bar: { ...board.bar },
    borneOff: { ...board.borneOff },
  };
}

/** Get the count of a specific color's checkers on a point (1-24). Returns 0 if none or opponent's. */
export function getCheckerCount(board: BoardPosition, point: number, color: 'player' | 'ai'): number {
  const val = board.points[point - 1]!;
  if (color === 'player') return val > 0 ? val : 0;
  return val < 0 ? -val : 0;
}

/** Check if a point is owned by a color (has their checkers). */
export function isOwnedBy(board: BoardPosition, point: number, color: 'player' | 'ai'): boolean {
  return getCheckerCount(board, point, color) > 0;
}

/** Check if a point is blocked (opponent has 2+ checkers). */
export function isBlocked(board: BoardPosition, point: number, color: 'player' | 'ai'): boolean {
  const opponent = color === 'player' ? 'ai' : 'player';
  return getCheckerCount(board, point, opponent) >= 2;
}

/** Check if a point has a blot (opponent has exactly 1 checker). */
export function isBlot(board: BoardPosition, point: number, color: 'player' | 'ai'): boolean {
  const opponent = color === 'player' ? 'ai' : 'player';
  return getCheckerCount(board, point, opponent) === 1;
}

/** Get total pip count for a color. */
export function getPipCount(board: BoardPosition, color: 'player' | 'ai'): number {
  let pips = 0;
  for (let i = 0; i < 24; i++) {
    const point = i + 1;
    const count = getCheckerCount(board, point, color);
    if (count > 0) {
      // Player moves toward point 1, AI moves toward point 24
      const distance = color === 'player' ? point : (25 - point);
      pips += count * distance;
    }
  }
  // Bar checkers: distance = 25 (must re-enter)
  const barCount = color === 'player' ? board.bar.player : board.bar.ai;
  pips += barCount * 25;
  return pips;
}
