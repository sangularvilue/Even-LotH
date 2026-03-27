/**
 * Backgammon App — bridge lifecycle, event loop, render dispatch.
 * 4 image tiles (2×2 grid), dice animation, move animation, auto-roll.
 */

import {
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import type { GameState, Action, Die, MoveAnimation } from './state/contracts';
import {
  DICE_ANIM_DURATION_MS, DICE_ANIM_FRAME_MS,
  MOVE_ANIM_DURATION_MS, MOVE_ANIM_FRAME_MS,
  AUTO_ROLL_DELAY_MS,
} from './state/constants';
import { createInitialBoard } from './game/board';
import { createStore, type Store } from './state/store';
import { composeStartupPage } from './render/composer';
import { BoardRenderer } from './render/board-renderer';
import { mapEvenHubEvent, extendTapCooldown } from './input/actions';
import { rollDice } from './game/dice';
import { pickBestMove, AI_THINK_DELAY_MS } from './game/ai';
import { appendEventLog } from './shared-log';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Parse a move string like "6>3", "BAR>20", "5>OFF" into numeric from/to. */
function parseMove(moveStr: string): { from: number; to: number } | null {
  const match = moveStr.match(/^(BAR|\d+)>(OFF|\d+)$/);
  if (!match) return null;
  const from = match[1] === 'BAR' ? 0 : parseInt(match[1]!, 10);
  const to = match[2] === 'OFF' ? 25 : parseInt(match[2]!, 10);
  return { from, to };
}

let bridge: EvenAppBridge | null = null;
let store: Store | null = null;
let boardRenderer: BoardRenderer | null = null;
let aiTimeout: ReturnType<typeof setTimeout> | null = null;
let diceAnimFrame: number | null = null;
let moveAnimFrame: number | null = null;
let autoRollTimeout: ReturnType<typeof setTimeout> | null = null;

function getInitialState(): GameState {
  return {
    board: createInitialBoard(),
    dice: { values: null, remaining: [], isDoubles: false },
    phase: 'waitingToRoll',
    turn: 'player',
    cursorIndex: 0,
    selectedFrom: null,
    validDestinations: [],
    scores: { player: 0, ai: 0 },
    message: 'Your turn!',
    moveHistory: [],
    lastMove: null,
    diceAnimation: null,
    moveAnimation: null,
    activeDieIndex: 0,
  };
}

async function sendFullRender(state: GameState): Promise<void> {
  if (!bridge || !boardRenderer) return;

  try {
    const images = boardRenderer.renderFull(state);
    for (const img of images) {
      void bridge.updateImageRawData(img);
    }
  } catch (err) {
    console.error('[BackgammonApp] Render error:', err);
  }
}

/** Run dice rolling animation, then dispatch the real roll. */
function startDiceAnimation(finalValues: [Die, Die], onDone: () => void): void {
  if (!store || !boardRenderer) return;

  const isDoubles = finalValues[0] === finalValues[1];
  const startTime = performance.now();
  let lastFrame = 0;

  function animTick(now: number): void {
    if (!store || !boardRenderer) return;

    const elapsed = now - startTime;

    if (elapsed >= DICE_ANIM_DURATION_MS) {
      if (diceAnimFrame) {
        cancelAnimationFrame(diceAnimFrame);
        diceAnimFrame = null;
      }
      onDone();
      return;
    }

    if (now - lastFrame >= DICE_ANIM_FRAME_MS) {
      lastFrame = now;

      const currentState = store.getState();
      const withAnim: GameState = {
        ...currentState,
        diceAnimation: { startTime, finalValues, isDoubles },
      };
      const images = boardRenderer.renderFull(withAnim);
      if (bridge) {
        for (const img of images) {
          void bridge.updateImageRawData(img);
        }
      }
    }

    diceAnimFrame = requestAnimationFrame(animTick);
  }

  diceAnimFrame = requestAnimationFrame(animTick);
}

/** Animate a checker moving from source to destination. */
function startMoveAnimation(
  fromPt: number,
  toPt: number,
  color: 'player' | 'ai',
  onDone: () => void,
): void {
  if (!store || !boardRenderer) { onDone(); return; }

  const startTime = performance.now();
  const anim: MoveAnimation = { fromPt, toPt, color, startTime };
  let lastFrame = 0;

  function animTick(now: number): void {
    if (!store || !boardRenderer) return;

    const elapsed = now - startTime;

    if (elapsed >= MOVE_ANIM_DURATION_MS) {
      if (moveAnimFrame) {
        cancelAnimationFrame(moveAnimFrame);
        moveAnimFrame = null;
      }
      // Final render without animation
      const currentState = store.getState();
      const clean: GameState = { ...currentState, moveAnimation: null };
      void sendFullRender(clean);
      onDone();
      return;
    }

    if (now - lastFrame >= MOVE_ANIM_FRAME_MS) {
      lastFrame = now;

      const currentState = store.getState();
      const withAnim: GameState = { ...currentState, moveAnimation: anim };
      const images = boardRenderer.renderFull(withAnim);
      if (bridge) {
        for (const img of images) {
          void bridge.updateImageRawData(img);
        }
      }
    }

    moveAnimFrame = requestAnimationFrame(animTick);
  }

  moveAnimFrame = requestAnimationFrame(animTick);
}

/** Animate AI moves one at a time sequentially. */
function animateAiMoves(
  moves: { from: number; to: number }[],
  onAllDone: () => void,
): void {
  if (!store) { onAllDone(); return; }

  let idx = 0;

  function doNext(): void {
    if (!store || idx >= moves.length) {
      onAllDone();
      return;
    }

    const move = moves[idx]!;
    idx++;

    // Start animation, then dispatch the single move, then continue
    startMoveAnimation(move.from, move.to, 'ai', () => {
      if (!store) return;
      store.dispatch({ type: 'AI_SINGLE_MOVE', from: move.from, to: move.to });

      // Small delay between moves for readability
      setTimeout(doNext, 100);
    });
  }

  doNext();
}

function cancelAutoRoll(): void {
  if (autoRollTimeout) {
    clearTimeout(autoRollTimeout);
    autoRollTimeout = null;
  }
}

function scheduleAutoRoll(): void {
  cancelAutoRoll();

  autoRollTimeout = setTimeout(() => {
    autoRollTimeout = null;
    if (!store) return;
    const state = store.getState();
    if (state.phase !== 'waitingToRoll' || state.turn !== 'player') return;
    if (diceAnimFrame || moveAnimFrame) return;

    const values = rollDice();
    appendEventLog(`Auto-roll: [${values[0]}][${values[1]}]`);

    startDiceAnimation(values, () => {
      if (!store) return;
      store.dispatch({ type: 'ROLL_DICE', values });
    });
  }, AUTO_ROLL_DELAY_MS);
}

function scheduleAiTurn(): void {
  if (aiTimeout) clearTimeout(aiTimeout);

  aiTimeout = setTimeout(() => {
    if (!store) return;
    const state = store.getState();
    if (state.phase !== 'aiTurn') return;

    // Roll dice for AI with animation
    const diceValues = rollDice();

    startDiceAnimation(diceValues, () => {
      if (!store) return;
      store.dispatch({ type: 'ROLL_DICE', values: diceValues });

      const afterRoll = store.getState();
      if (afterRoll.phase !== 'aiTurn') {
        if (afterRoll.turn === 'player') return;
      }

      // Pick best move
      setTimeout(() => {
        if (!store) return;
        const currentState = store.getState();
        if (currentState.phase !== 'aiTurn') return;

        const best = pickBestMove(
          currentState.board,
          'ai',
          currentState.dice.remaining,
        );

        if (best && best.moves.length > 0) {
          const moves = best.moves.map(m => ({ from: m.from, to: m.to }));

          // Animate each move sequentially, then switch turns
          animateAiMoves(moves, () => {
            if (!store) return;
            store.dispatch({ type: 'FORCE_PASS' });
          });
        } else {
          store.dispatch({ type: 'FORCE_PASS' });
        }
      }, AI_THINK_DELAY_MS);
    });
  }, 300);
}

function onStateChange(state: GameState, prev: GameState): void {
  void sendFullRender(state);

  if (state.phase !== prev.phase) {
    appendEventLog(`Phase: ${state.phase}`);
  }

  if (state.phase === 'aiTurn' && prev.phase !== 'aiTurn') {
    cancelAutoRoll();
    scheduleAiTurn();
  }

  // Auto-roll when it becomes player's turn to roll
  if (state.phase === 'waitingToRoll' && state.turn === 'player') {
    if (prev.phase !== 'waitingToRoll' || prev.turn !== 'player') {
      scheduleAutoRoll();
    }
  }

  // Animate player moves
  if (state.lastMove !== prev.lastMove && state.lastMove && !state.lastMove.startsWith('AI')) {
    const parsed = parseMove(state.lastMove);
    if (parsed) {
      startMoveAnimation(parsed.from, parsed.to, 'player', () => {
        // Animation done — re-render clean
        if (store) void sendFullRender(store.getState());
      });
    }
  }
}

function handleEvent(event: EvenHubEvent): void {
  if (!store) return;

  // Block input during dice animation or move animation
  if (diceAnimFrame || moveAnimFrame) return;

  const state = store.getState();
  const action = mapEvenHubEvent(event, state);

  if (!action) return;

  appendEventLog(`Input: ${action.type}${action.type === 'SCROLL' ? ` ${action.direction}` : ''}`);

  // Handle double-tap to roll dice with animation
  if (action.type === 'DOUBLE_TAP' && state.phase === 'waitingToRoll') {
    cancelAutoRoll();
    extendTapCooldown(300);
    const values = rollDice();

    startDiceAnimation(values, () => {
      if (!store) return;
      store.dispatch({ type: 'ROLL_DICE', values });
    });
    return;
  }

  // Cancel auto-roll on any manual input during waitingToRoll
  if (state.phase === 'waitingToRoll') {
    cancelAutoRoll();
  }

  store.dispatch(action);
}

export async function startBackgammonApp(setStatus: (text: string) => void): Promise<void> {
  setStatus('Connecting to Even bridge...');
  appendEventLog('Backgammon: connecting...');

  try {
    bridge = await withTimeout(waitForEvenAppBridge(), 6000);
    appendEventLog('Backgammon: bridge connected');
    setStatus('Connected! Starting game...');
  } catch (err) {
    appendEventLog('Backgammon: bridge failed, using mock mode');
    setStatus('Bridge unavailable — mock mode');
    bridge = null;
  }

  const initialState = getInitialState();
  store = createStore(initialState);
  boardRenderer = new BoardRenderer();

  store.subscribe(onStateChange);

  if (bridge) {
    try {
      const startupPage = composeStartupPage();
      await bridge.createStartUpPageContainer(startupPage);
      appendEventLog('Backgammon: startup page sent (4 image tiles)');

      const images = boardRenderer.renderFull(initialState);
      setTimeout(() => {
        if (!bridge || !boardRenderer) return;
        for (const img of images) {
          void bridge.updateImageRawData(img);
        }
        appendEventLog('Backgammon: initial board rendered');

        // Auto-roll after initial render
        scheduleAutoRoll();
      }, 200);
    } catch (err) {
      console.error('[BackgammonApp] Startup error:', err);
      appendEventLog(`Backgammon: startup error: ${err}`);
    }

    bridge.onEvenHubEvent((event: EvenHubEvent) => {
      appendEventLog(`EVT: ${JSON.stringify(event).slice(0, 120)}`);
      handleEvent(event);
    });
  } else {
    // Mock mode: schedule auto-roll after a short delay
    setTimeout(() => scheduleAutoRoll(), 500);
  }

  setStatus('Game ready! Your turn!');
  appendEventLog('Backgammon: ready');
}

/** Get current store for external access (e.g., phone companion buttons). */
export function getStore(): Store | null {
  return store;
}

/** Get current board renderer for preview access. */
export function getBoardRenderer(): BoardRenderer | null {
  return boardRenderer;
}

/** Check if dice animation is in progress. */
export function isDiceAnimating(): boolean {
  return diceAnimFrame !== null;
}

/** Check if move animation is in progress. */
export function isMoveAnimating(): boolean {
  return moveAnimFrame !== null;
}

/** Simulate a glasses action from the phone companion UI. */
export function simulateGlassesAction(action: 'SCROLL_UP' | 'SCROLL_DOWN' | 'TAP' | 'DOUBLE_TAP'): void {
  if (!store) return;
  if (diceAnimFrame || moveAnimFrame) return; // block during animation

  const state = store.getState();

  switch (action) {
    case 'SCROLL_UP':
      store.dispatch({ type: 'SCROLL', direction: 'up' });
      appendEventLog('Sim: Swipe Up');
      break;
    case 'SCROLL_DOWN':
      store.dispatch({ type: 'SCROLL', direction: 'down' });
      appendEventLog('Sim: Swipe Down');
      break;
    case 'TAP':
      store.dispatch({ type: 'TAP', selectedIndex: 0, selectedName: '' });
      appendEventLog('Sim: Tap');
      break;
    case 'DOUBLE_TAP':
      if (state.phase === 'waitingToRoll') {
        cancelAutoRoll();
        const values = rollDice();
        appendEventLog('Sim: Double Tap (rolling)');
        startDiceAnimation(values, () => {
          if (!store) return;
          store.dispatch({ type: 'ROLL_DICE', values });
        });
      } else {
        store.dispatch({ type: 'DOUBLE_TAP' });
        appendEventLog('Sim: Double Tap');
      }
      break;
  }
}
