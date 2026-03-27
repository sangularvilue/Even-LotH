/**
 * Backgammon rules: bearing off conditions, hit/re-enter, game-over detection.
 */

import type { BoardPosition, CheckerColor } from '../state/contracts';
import { getCheckerCount } from './board';

/**
 * Check if a color can bear off (all 15 checkers in home board or already borne off).
 * Player home board = points 1-6. AI home board = points 19-24.
 */
export function canBearOff(board: BoardPosition, color: CheckerColor): boolean {
  const barCount = color === 'player' ? board.bar.player : board.bar.ai;
  if (barCount > 0) return false;

  // Check no checkers outside home board
  if (color === 'player') {
    // Player home = points 1-6, so no checkers on 7-24
    for (let point = 7; point <= 24; point++) {
      if (getCheckerCount(board, point, 'player') > 0) return false;
    }
  } else {
    // AI home = points 19-24, so no checkers on 1-18
    for (let point = 1; point <= 18; point++) {
      if (getCheckerCount(board, point, 'ai') > 0) return false;
    }
  }
  return true;
}

/**
 * Check if a color has checkers on the bar.
 */
export function hasCheckersOnBar(board: BoardPosition, color: CheckerColor): boolean {
  return color === 'player' ? board.bar.player > 0 : board.bar.ai > 0;
}

/**
 * Check if the game is over (one side has borne off all 15 checkers).
 */
export function isGameOver(board: BoardPosition): CheckerColor | null {
  if (board.borneOff.player >= 15) return 'player';
  if (board.borneOff.ai >= 15) return 'ai';
  return null;
}

/**
 * Get the highest occupied point in a color's home board.
 * Used for bearing off with a die larger than the furthest checker.
 */
export function highestOccupiedHomePoint(board: BoardPosition, color: CheckerColor): number {
  if (color === 'player') {
    // Player home = points 1-6, highest = 6
    for (let p = 6; p >= 1; p--) {
      if (getCheckerCount(board, p, 'player') > 0) return p;
    }
  } else {
    // AI home = points 19-24, lowest point number = highest distance
    for (let p = 19; p <= 24; p++) {
      if (getCheckerCount(board, p, 'ai') > 0) return p;
    }
  }
  return 0;
}
