/**
 * Selectors — derived display text for the board overlay.
 */

import type { GameState } from './contracts';

/** Short turn label rendered on the board itself. */
export function getTurnLabel(state: GameState): string {
  switch (state.phase) {
    case 'waitingToRoll':
      return 'ROLL DICE';
    case 'selectChecker':
    case 'selectDestination':
      return 'YOUR TURN';
    case 'aiTurn':
      return 'AI...';
    case 'gameOver':
      return 'GAME OVER';
  }
}
