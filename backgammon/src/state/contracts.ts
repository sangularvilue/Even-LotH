/**
 * All types for the backgammon game state and actions.
 */

export type CheckerColor = 'player' | 'ai';
export type Die = 1 | 2 | 3 | 4 | 5 | 6;
export type GamePhase =
  | 'waitingToRoll'
  | 'selectChecker'
  | 'selectDestination'
  | 'aiTurn'
  | 'gameOver';

/** Points 1-24 indexed [0]=point1 ... [23]=point24. Positive = player, negative = AI. */
export type PointState = number;

export interface BoardPosition {
  /** 24 points. Positive count = player checkers, negative = AI checkers. */
  points: PointState[];
  /** Checkers on the bar (hit, waiting to re-enter). */
  bar: { player: number; ai: number };
  /** Checkers borne off. */
  borneOff: { player: number; ai: number };
}

export interface DiceState {
  values: [Die, Die] | null;
  remaining: Die[];
  isDoubles: boolean;
}

export interface DiceAnimation {
  startTime: number;
  finalValues: [Die, Die];
  isDoubles: boolean;
}

export interface MoveAnimation {
  fromPt: number;
  toPt: number;
  color: CheckerColor;
  startTime: number;
}

export interface GameState {
  board: BoardPosition;
  dice: DiceState;
  phase: GamePhase;
  turn: CheckerColor;
  cursorIndex: number;
  selectedFrom: number | null;
  validDestinations: number[];
  scores: { player: number; ai: number };
  message: string;
  moveHistory: string[];
  lastMove: string | null;
  diceAnimation: DiceAnimation | null;
  moveAnimation: MoveAnimation | null;
  /** Which die is currently active: 0 = left/first, 1 = right/second (doubles: 0-3). */
  activeDieIndex: number;
}

// --- Actions ---

export type Action =
  | { type: 'SCROLL'; direction: 'up' | 'down' }
  | { type: 'TAP'; selectedIndex: number; selectedName: string }
  | { type: 'DOUBLE_TAP' }
  | { type: 'ROLL_DICE'; values: [Die, Die] }
  | { type: 'EXECUTE_MOVE'; from: number; to: number }
  | { type: 'AI_MOVE'; moves: { from: number; to: number }[] }
  | { type: 'AI_SINGLE_MOVE'; from: number; to: number }
  | { type: 'FORCE_PASS' }
  | { type: 'NEW_GAME' }
  | { type: 'FOREGROUND_ENTER' }
  | { type: 'FOREGROUND_EXIT' };

export type StoreListener = (state: GameState, prev: GameState) => void;
