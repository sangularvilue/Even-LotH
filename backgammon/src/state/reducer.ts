/**
 * Reducer — pure (state, action) => state for the backgammon game.
 */

import type { GameState, Action, Die, CheckerColor } from './contracts';
import { LINEAR_POINT_ORDER, POINT_BAR, POINT_BEAR_OFF } from './constants';
import { createInitialBoard } from '../game/board';
import { createDiceState, consumeDie } from '../game/dice';
import { applyMove, getValidDestinations, hasAnyLegalMoves, getMovablePoints, getDieForMove, getLegalMovesForDie } from '../game/moves';
import { isGameOver, hasCheckersOnBar } from '../game/rules';
import {
  advanceCursorSelectChecker,
  advanceCursorSelectDestination,
  getFirstMovableCursor,
  getPointAtCursor,
} from '../input/cursor';

export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'SCROLL':
      return handleScroll(state, action.direction);
    case 'TAP':
      return handleTap(state);
    case 'DOUBLE_TAP':
      return handleDoubleTap(state);
    case 'ROLL_DICE':
      return handleRollDice(state, action.values);
    case 'EXECUTE_MOVE':
      return handleExecuteMove(state, action.from, action.to);
    case 'AI_MOVE':
      return handleAiMove(state, action.moves);
    case 'AI_SINGLE_MOVE':
      return handleAiSingleMove(state, action.from, action.to);
    case 'FORCE_PASS':
      return handleForcePass(state);
    case 'NEW_GAME':
      return handleNewGame(state);
    case 'FOREGROUND_ENTER':
    case 'FOREGROUND_EXIT':
      return state;
    default:
      return state;
  }
}

function handleScroll(state: GameState, direction: 'up' | 'down'): GameState {
  switch (state.phase) {
    case 'selectChecker': {
      const newCursor = advanceCursorSelectChecker(state, direction);
      if (newCursor === state.cursorIndex) return state;
      return { ...state, cursorIndex: newCursor };
    }
    case 'selectDestination': {
      const newCursor = advanceCursorSelectDestination(state, direction);
      if (newCursor === state.cursorIndex) return state;
      return { ...state, cursorIndex: newCursor };
    }
    default:
      return state;
  }
}

function getActiveDieValue(state: GameState): Die | null {
  const { dice, activeDieIndex } = state;
  if (!dice.values) return null;
  if (dice.isDoubles) {
    return dice.remaining.length > 0 ? dice.values[0] : null;
  }
  // Non-doubles: activeDieIndex 0 = values[0], 1 = values[1]
  // But check if this die is still in remaining
  const val = dice.values[activeDieIndex] as Die | undefined;
  if (val && dice.remaining.includes(val)) return val;
  // If the active die was already used, try the other one
  const otherVal = dice.values[1 - activeDieIndex] as Die | undefined;
  if (otherVal && dice.remaining.includes(otherVal)) return otherVal;
  return null;
}

function handleTap(state: GameState): GameState {
  switch (state.phase) {
    case 'selectChecker': {
      const pointId = getPointAtCursor(state.cursorIndex);
      let fromPoint: number;

      if (pointId === POINT_BAR) {
        fromPoint = 0; // bar
      } else if (pointId >= 1 && pointId <= 24) {
        fromPoint = pointId;
      } else {
        return state;
      }

      // Use only the active die to compute destination
      const activeDie = getActiveDieValue(state);
      if (!activeDie) return state;

      const moves = getLegalMovesForDie(state.board, state.turn, activeDie);
      const move = moves.find(m => m.from === fromPoint);
      if (!move) return state;

      return executePlayerMove(state, fromPoint, move.to);
    }

    case 'selectDestination': {
      // Kept for backwards compat, but shouldn't be reached in normal flow
      const pointId = getPointAtCursor(state.cursorIndex);
      let toPoint: number;

      if (pointId === POINT_BEAR_OFF) {
        toPoint = 25;
      } else if (pointId >= 1 && pointId <= 24) {
        toPoint = pointId;
      } else {
        return state;
      }

      if (!state.validDestinations.includes(toPoint)) return state;
      return executePlayerMove(state, state.selectedFrom!, toPoint);
    }

    default:
      return state;
  }
}

function handleDoubleTap(state: GameState): GameState {
  switch (state.phase) {
    case 'waitingToRoll':
      // Roll dice — actual values will be dispatched by the app layer
      return state;

    case 'selectChecker':
      // Cancel back to waiting (undo roll? No — just ignore)
      return state;

    case 'selectDestination':
      // Cancel selection, go back to selectChecker
      return {
        ...state,
        phase: 'selectChecker',
        selectedFrom: null,
        validDestinations: [],
        cursorIndex: getFirstMovableCursor(state),
      };

    case 'gameOver':
      // Signal new game
      return handleNewGame(state);

    default:
      return state;
  }
}

function handleRollDice(state: GameState, values: [Die, Die]): GameState {
  if (state.phase !== 'waitingToRoll' && state.phase !== 'aiTurn') return state;

  const dice = createDiceState(values);
  const newState: GameState = {
    ...state,
    dice,
    message: `Rolled [${values[0]}][${values[1]}]`,
  };

  // Check if any legal moves exist
  if (!hasAnyLegalMoves(newState.board, newState.turn, dice.remaining)) {
    return {
      ...newState,
      message: `Rolled [${values[0]}][${values[1]}] - No moves!`,
      phase: newState.turn === 'player' ? 'waitingToRoll' : 'aiTurn',
      turn: newState.turn === 'player' ? 'ai' : 'player',
      dice: { values: null, remaining: [], isDoubles: false },
    };
  }

  if (newState.turn === 'player') {
    const withDie: GameState = { ...newState, activeDieIndex: 0 };
    const cursor = getFirstMovableCursor(withDie);
    return {
      ...withDie,
      phase: 'selectChecker',
      cursorIndex: cursor,
    };
  }

  return {
    ...newState,
    phase: 'aiTurn',
  };
}

function executePlayerMove(state: GameState, from: number, to: number): GameState {
  const die = getDieForMove(state.turn, from, to);
  const newRemaining = consumeDie(state.dice.remaining, die);

  // If exact die not available, try bearing off with a larger die
  let remaining = newRemaining;
  if (!remaining && to === 25) {
    // Try larger dice for bearing off
    for (const d of [...state.dice.remaining].sort((a, b) => b - a)) {
      if (d >= die) {
        remaining = consumeDie(state.dice.remaining, d);
        if (remaining) break;
      }
    }
  }

  if (!remaining) return state; // Should not happen if move was valid

  const newBoard = applyMove(state.board, state.turn, { from, to, die });
  const fromLabel = from === 0 ? 'BAR' : String(from);
  const toLabel = to === 25 ? 'OFF' : String(to);
  const moveStr = `${fromLabel}>${toLabel}`;

  // Check game over
  const winner = isGameOver(newBoard);
  if (winner) {
    return {
      ...state,
      board: newBoard,
      dice: { ...state.dice, remaining },
      phase: 'gameOver',
      selectedFrom: null,
      validDestinations: [],
      message: winner === 'player' ? 'YOU WIN!' : 'AI WINS!',
      lastMove: moveStr,
      scores: {
        player: state.scores.player + (winner === 'player' ? 1 : 0),
        ai: state.scores.ai + (winner === 'ai' ? 1 : 0),
      },
      moveHistory: [...state.moveHistory, moveStr],
    };
  }

  const nextState: GameState = {
    ...state,
    board: newBoard,
    dice: { ...state.dice, remaining },
    selectedFrom: null,
    validDestinations: [],
    lastMove: moveStr,
    moveHistory: [...state.moveHistory, moveStr],
  };

  // Check if more dice remain
  if (remaining.length > 0 && hasAnyLegalMoves(newBoard, state.turn, remaining)) {
    // Advance to next die
    const nextDieIndex = state.dice.isDoubles
      ? state.activeDieIndex // doubles: same die value, index doesn't matter
      : 1 - state.activeDieIndex; // non-doubles: swap to other die
    const withDie: GameState = { ...nextState, activeDieIndex: nextDieIndex };
    const cursor = getFirstMovableCursor(withDie);
    return {
      ...withDie,
      phase: 'selectChecker',
      cursorIndex: cursor,
    };
  }

  // Turn over — switch to AI
  return {
    ...nextState,
    phase: 'aiTurn',
    turn: 'ai',
    dice: { values: null, remaining: [], isDoubles: false },
    message: 'AI turn...',
  };
}

function handleExecuteMove(state: GameState, from: number, to: number): GameState {
  return executePlayerMove(state, from, to);
}

function handleAiMove(state: GameState, moves: { from: number; to: number }[]): GameState {
  let board = state.board;
  const moveStrs: string[] = [];

  for (const m of moves) {
    const fromLabel = m.from === 0 ? 'BAR' : String(m.from);
    const toLabel = m.to === 25 ? 'OFF' : String(m.to);
    moveStrs.push(`${fromLabel}>${toLabel}`);

    const die = getDieForMove('ai', m.from, m.to);
    board = applyMove(board, 'ai', { from: m.from, to: m.to, die });
  }

  const moveStr = `AI: ${moveStrs.join(', ')}`;

  // Check game over
  const winner = isGameOver(board);
  if (winner) {
    return {
      ...state,
      board,
      phase: 'gameOver',
      turn: 'player',
      dice: { values: null, remaining: [], isDoubles: false },
      selectedFrom: null,
      validDestinations: [],
      message: winner === 'player' ? 'YOU WIN!' : 'AI WINS!',
      lastMove: moveStr,
      scores: {
        player: state.scores.player + (winner === 'player' ? 1 : 0),
        ai: state.scores.ai + (winner === 'ai' ? 1 : 0),
      },
      moveHistory: [...state.moveHistory, moveStr],
    };
  }

  return {
    ...state,
    board,
    phase: 'waitingToRoll',
    turn: 'player',
    dice: { values: null, remaining: [], isDoubles: false },
    selectedFrom: null,
    validDestinations: [],
    message: moveStr,
    lastMove: moveStr,
    moveHistory: [...state.moveHistory, moveStr],
  };
}

function handleAiSingleMove(state: GameState, from: number, to: number): GameState {
  const die = getDieForMove('ai', from, to);
  const board = applyMove(state.board, 'ai', { from, to, die });
  const fromLabel = from === 0 ? 'BAR' : String(from);
  const toLabel = to === 25 ? 'OFF' : String(to);
  const moveStr = `AI: ${fromLabel}>${toLabel}`;

  // Check game over
  const winner = isGameOver(board);
  if (winner) {
    return {
      ...state,
      board,
      phase: 'gameOver',
      turn: 'player',
      dice: { values: null, remaining: [], isDoubles: false },
      selectedFrom: null,
      validDestinations: [],
      message: winner === 'player' ? 'YOU WIN!' : 'AI WINS!',
      lastMove: moveStr,
      moveAnimation: null,
      scores: {
        player: state.scores.player + (winner === 'player' ? 1 : 0),
        ai: state.scores.ai + (winner === 'ai' ? 1 : 0),
      },
      moveHistory: [...state.moveHistory, moveStr],
    };
  }

  // Stay in aiTurn — don't switch turns (more moves may follow)
  return {
    ...state,
    board,
    lastMove: moveStr,
    moveAnimation: null,
    moveHistory: [...state.moveHistory, moveStr],
  };
}

function handleForcePass(state: GameState): GameState {
  if (state.turn === 'player') {
    return {
      ...state,
      phase: 'aiTurn',
      turn: 'ai',
      dice: { values: null, remaining: [], isDoubles: false },
      message: 'No moves - passed',
    };
  }
  return {
    ...state,
    phase: 'waitingToRoll',
    turn: 'player',
    dice: { values: null, remaining: [], isDoubles: false },
    message: 'AI passed',
  };
}

function handleNewGame(state: GameState): GameState {
  return {
    board: createInitialBoard(),
    dice: { values: null, remaining: [], isDoubles: false },
    phase: 'waitingToRoll',
    turn: 'player',
    cursorIndex: 0,
    selectedFrom: null,
    validDestinations: [],
    scores: state.scores,
    message: 'New game! Your turn!',
    moveHistory: [],
    lastMove: null,
    diceAnimation: null,
    moveAnimation: null,
    activeDieIndex: 0,
  };
}
