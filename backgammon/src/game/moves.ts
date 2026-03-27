/**
 * Legal move generation and turn sequence enumeration.
 */

import type { BoardPosition, CheckerColor, Die } from '../state/contracts';
import { cloneBoard, getCheckerCount, isBlocked, isBlot } from './board';
import { canBearOff, hasCheckersOnBar, highestOccupiedHomePoint } from './rules';

export interface Move {
  from: number; // point 1-24, or 0 for bar
  to: number;   // point 1-24, or 25 for bear-off
  die: Die;
}

/**
 * Get all legal moves for a single die value.
 */
export function getLegalMovesForDie(
  board: BoardPosition,
  color: CheckerColor,
  die: Die,
): Move[] {
  const moves: Move[] = [];
  const onBar = hasCheckersOnBar(board, color);

  if (onBar) {
    // Must re-enter from bar first
    const entryPoint = color === 'player' ? (25 - die) : die;
    if (!isBlocked(board, entryPoint, color)) {
      moves.push({ from: 0, to: entryPoint, die });
    }
    return moves; // Can only move from bar when checkers are there
  }

  const bearingOff = canBearOff(board, color);

  for (let point = 1; point <= 24; point++) {
    if (getCheckerCount(board, point, color) === 0) continue;

    // Regular move
    const dest = color === 'player' ? point - die : point + die;

    if (dest >= 1 && dest <= 24) {
      if (!isBlocked(board, dest, color)) {
        moves.push({ from: point, to: dest, die });
      }
    } else if (bearingOff) {
      // Bearing off
      if (color === 'player' && dest <= 0) {
        // Exact bear off or highest checker
        if (dest === 0 || point === highestOccupiedHomePoint(board, 'player')) {
          moves.push({ from: point, to: 25, die });
        }
      } else if (color === 'ai' && dest >= 25) {
        if (dest === 25 || point === highestOccupiedHomePoint(board, 'ai')) {
          moves.push({ from: point, to: 25, die });
        }
      }
    }
  }

  return moves;
}

/**
 * Apply a single move to a board (mutates a clone).
 */
export function applyMove(board: BoardPosition, color: CheckerColor, move: Move): BoardPosition {
  const b = cloneBoard(board);
  const sign = color === 'player' ? 1 : -1;

  // Remove from source
  if (move.from === 0) {
    // From bar
    if (color === 'player') b.bar.player--;
    else b.bar.ai--;
  } else {
    b.points[move.from - 1] -= sign;
  }

  // Place at destination
  if (move.to === 25) {
    // Bear off
    if (color === 'player') b.borneOff.player++;
    else b.borneOff.ai++;
  } else {
    // Check for hit (blot)
    if (isBlot(board, move.to, color)) {
      // Hit opponent's blot
      if (color === 'player') {
        b.points[move.to - 1] = 0; // Remove AI checker
        b.bar.ai++;
      } else {
        b.points[move.to - 1] = 0; // Remove player checker
        b.bar.player++;
      }
    }
    b.points[move.to - 1] += sign;
  }

  return b;
}

/**
 * Get all valid destinations for a checker at a given point, considering all remaining dice.
 */
export function getValidDestinations(
  board: BoardPosition,
  color: CheckerColor,
  fromPoint: number,
  remainingDice: Die[],
): number[] {
  const destinations = new Set<number>();
  const uniqueDice = [...new Set(remainingDice)];

  for (const die of uniqueDice) {
    const moves = getLegalMovesForDie(board, color, die);
    for (const move of moves) {
      if (move.from === fromPoint) {
        destinations.add(move.to);
      }
    }
  }

  return [...destinations].sort((a, b) => a - b);
}

/**
 * Check if any legal moves exist for the current dice.
 */
export function hasAnyLegalMoves(
  board: BoardPosition,
  color: CheckerColor,
  remainingDice: Die[],
): boolean {
  const uniqueDice = [...new Set(remainingDice)];
  for (const die of uniqueDice) {
    if (getLegalMovesForDie(board, color, die).length > 0) return true;
  }
  return false;
}

/**
 * Get all points that have movable checkers.
 */
export function getMovablePoints(
  board: BoardPosition,
  color: CheckerColor,
  remainingDice: Die[],
): number[] {
  const points = new Set<number>();
  const uniqueDice = [...new Set(remainingDice)];

  for (const die of uniqueDice) {
    const moves = getLegalMovesForDie(board, color, die);
    for (const move of moves) {
      points.add(move.from);
    }
  }

  return [...points].sort((a, b) => a - b);
}

/**
 * Get the die value needed for a specific move (from -> to).
 */
export function getDieForMove(
  color: CheckerColor,
  from: number,
  to: number,
): Die {
  if (to === 25) {
    // Bear-off: die = distance to edge
    return (color === 'player' ? from : 25 - from) as Die;
  }
  if (from === 0) {
    // From bar
    return (color === 'player' ? 25 - to : to) as Die;
  }
  return Math.abs(to - from) as Die;
}

export interface TurnSequence {
  moves: Move[];
  resultBoard: BoardPosition;
}

/**
 * Enumerate all possible complete turn sequences (using as many dice as possible).
 * This is needed for AI evaluation and to enforce the rule that you must use
 * both dice if possible, and the larger die if only one can be used.
 */
export function enumerateTurnSequences(
  board: BoardPosition,
  color: CheckerColor,
  remainingDice: Die[],
  movesSoFar: Move[] = [],
): TurnSequence[] {
  if (remainingDice.length === 0) {
    return [{ moves: [...movesSoFar], resultBoard: cloneBoard(board) }];
  }

  const sequences: TurnSequence[] = [];
  const triedDice = new Set<Die>();

  for (let i = 0; i < remainingDice.length; i++) {
    const die = remainingDice[i]!;
    if (triedDice.has(die)) continue;
    triedDice.add(die);

    const legalMoves = getLegalMovesForDie(board, color, die);
    if (legalMoves.length === 0) continue;

    const nextRemaining = [...remainingDice];
    nextRemaining.splice(i, 1);

    for (const move of legalMoves) {
      const newBoard = applyMove(board, color, move);
      const subSequences = enumerateTurnSequences(
        newBoard,
        color,
        nextRemaining,
        [...movesSoFar, move],
      );
      sequences.push(...subSequences);
    }
  }

  // If no moves possible with any remaining die, this is a terminal state
  if (sequences.length === 0) {
    sequences.push({ moves: [...movesSoFar], resultBoard: cloneBoard(board) });
  }

  return sequences;
}

/**
 * Filter turn sequences to keep only those that use the maximum number of dice.
 * Backgammon rules: you must use as many dice as possible.
 * If you can use either die but not both, you must use the larger one.
 */
export function filterMaxDiceSequences(sequences: TurnSequence[]): TurnSequence[] {
  if (sequences.length === 0) return [];

  const maxMoves = Math.max(...sequences.map(s => s.moves.length));
  let best = sequences.filter(s => s.moves.length === maxMoves);

  // If exactly one die can be used and the two dice differ, must use the larger
  if (maxMoves === 1 && best.length > 0) {
    const maxDie = Math.max(...best.map(s => s.moves[0]!.die));
    const withMaxDie = best.filter(s => s.moves[0]!.die === maxDie);
    if (withMaxDie.length > 0) best = withMaxDie;
  }

  return best;
}
