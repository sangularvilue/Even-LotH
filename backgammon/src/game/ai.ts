/**
 * AI opponent — heuristic position evaluation and best-move picker.
 */

import type { BoardPosition, CheckerColor, Die } from '../state/contracts';
import { getCheckerCount, getPipCount } from './board';
import { canBearOff } from './rules';
import { enumerateTurnSequences, filterMaxDiceSequences, type TurnSequence } from './moves';

// Heuristic weights
const W_PIP = 1.0;
const W_BLOT = -15;
const W_MADE_POINT = 5;
const W_HOME_MADE = 8;
const W_HIT = 20;
const W_PRIME = 12;
const W_BORNE_OFF = 10;
const W_BEARING_READY = 25;

/**
 * Evaluate a board position from a color's perspective.
 * Higher = better for that color.
 */
export function evaluatePosition(board: BoardPosition, color: CheckerColor): number {
  const opponent: CheckerColor = color === 'player' ? 'ai' : 'player';
  let score = 0;

  // Pip count — lower is better for the evaluating color
  const myPips = getPipCount(board, color);
  const oppPips = getPipCount(board, opponent);
  score += (oppPips - myPips) * W_PIP;

  // Blots (exposed singles)
  for (let p = 1; p <= 24; p++) {
    if (getCheckerCount(board, p, color) === 1) {
      // More penalty for blots closer to opponent's home
      const danger = color === 'player' ? (25 - p) / 24 : p / 24;
      score += W_BLOT * (0.5 + danger * 0.5);
    }
  }

  // Made points (2+ checkers)
  let consecutiveBlocked = 0;
  for (let p = 1; p <= 24; p++) {
    const count = getCheckerCount(board, p, color);
    if (count >= 2) {
      // Home board points worth more
      const isHome = color === 'player' ? p <= 6 : p >= 19;
      score += isHome ? W_HOME_MADE : W_MADE_POINT;
      consecutiveBlocked++;
      // Prime bonus for consecutive blocks
      if (consecutiveBlocked >= 2) {
        score += W_PRIME;
      }
    } else {
      consecutiveBlocked = 0;
    }
  }

  // Opponent on bar
  const oppBar = color === 'player' ? board.bar.ai : board.bar.player;
  score += oppBar * W_HIT;

  // Borne off
  const myBorne = color === 'player' ? board.borneOff.player : board.borneOff.ai;
  score += myBorne * W_BORNE_OFF;

  // Bearing off readiness
  if (canBearOff(board, color)) {
    score += W_BEARING_READY;
  }

  return score;
}

/**
 * Pick the best turn sequence for the AI.
 */
export function pickBestMove(
  board: BoardPosition,
  color: CheckerColor,
  dice: Die[],
): TurnSequence | null {
  const allSequences = enumerateTurnSequences(board, color, dice);
  const validSequences = filterMaxDiceSequences(allSequences);

  if (validSequences.length === 0) return null;

  let bestScore = -Infinity;
  let bestSequence: TurnSequence | null = null;

  for (const seq of validSequences) {
    const score = evaluatePosition(seq.resultBoard, color);
    if (score > bestScore) {
      bestScore = score;
      bestSequence = seq;
    }
  }

  return bestSequence;
}

/** AI think delay in ms. */
export const AI_THINK_DELAY_MS = 500;
