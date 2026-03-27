/**
 * Phone companion UI for Backgammon.
 */

import './styles.css';
import { startBackgammonApp, getStore, getBoardRenderer, isDiceAnimating, isMoveAnimating, simulateGlassesAction } from './backgammon-app';
import { rollDice } from './game/dice';
import { appendEventLog } from './shared-log';
import { BUF_W, BUF_H, DISPLAY_WIDTH, DISPLAY_HEIGHT, BOARD_DISPLAY_X, BOARD_DISPLAY_Y } from './state/constants';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('Missing #app');

appRoot.innerHTML = `
  <section class="card">
    <h1 class="title">Backgammon</h1>
    <p class="subtitle">Single-player backgammon vs AI for Even G2 glasses.</p>
  </section>

  <section class="card">
    <div class="row">
      <button id="connect-btn" class="btn btn-primary" type="button">Connect glasses</button>
      <button id="preview-btn" class="btn" type="button">Open Preview</button>
    </div>
    <p id="status" class="status-line">Ready to connect</p>
  </section>

  <section class="card">
    <p class="log-title">Glasses Controls</p>
    <div class="row">
      <button id="sim-up" class="btn" type="button">Swipe Up</button>
      <button id="sim-down" class="btn" type="button">Swipe Down</button>
      <button id="sim-tap" class="btn" type="button">Tap</button>
      <button id="sim-dtap" class="btn" type="button">Double Tap</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button id="roll-btn" class="btn" type="button">Roll Dice</button>
      <button id="new-game-btn" class="btn" type="button">New Game</button>
    </div>
  </section>

  <section class="card">
    <p class="log-title">Event Log</p>
    <pre id="event-log" aria-live="polite"></pre>
  </section>
`;

const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const connectBtn = document.querySelector<HTMLButtonElement>('#connect-btn')!;
const previewBtn = document.querySelector<HTMLButtonElement>('#preview-btn')!;
const rollBtn = document.querySelector<HTMLButtonElement>('#roll-btn')!;
const newGameBtn = document.querySelector<HTMLButtonElement>('#new-game-btn')!;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

/* ── Preview window ──────────────────────────────────── */

let previewWin: Window | null = null;
let previewCanvas: HTMLCanvasElement | null = null;
let previewAnimFrame = 0;

function openPreviewWindow(): void {
  if (previewWin && !previewWin.closed) {
    previewWin.focus();
    return;
  }

  const SCALE = 2;
  const winW = DISPLAY_WIDTH * SCALE + 40;
  const winH = DISPLAY_HEIGHT * SCALE + 80;

  previewWin = window.open('', 'backgammon-preview',
    `width=${winW},height=${winH},resizable=yes`);
  if (!previewWin) {
    appendEventLog('Preview: popup blocked — allow popups');
    return;
  }

  previewWin.document.title = 'Backgammon — Glasses Preview';
  previewWin.document.body.style.cssText =
    'margin:0;background:#000;display:flex;flex-direction:column;align-items:center;padding:12px;font-family:monospace;';

  // Title
  const title = previewWin.document.createElement('div');
  title.textContent = 'Even G2 Glasses Preview (576x288)';
  title.style.cssText = 'color:#0f0;font-size:13px;margin-bottom:8px;';
  previewWin.document.body.appendChild(title);

  // Glasses display container
  const displayContainer = previewWin.document.createElement('div');
  displayContainer.style.cssText =
    `width:${DISPLAY_WIDTH * SCALE}px;height:${DISPLAY_HEIGHT * SCALE}px;position:relative;border:2px solid #0a0;background:#000;`;
  previewWin.document.body.appendChild(displayContainer);

  // Board canvas — centered in the display
  previewCanvas = previewWin.document.createElement('canvas');
  previewCanvas.width = BUF_W;
  previewCanvas.height = BUF_H;
  previewCanvas.style.cssText =
    `position:absolute;left:${BOARD_DISPLAY_X * SCALE}px;top:${BOARD_DISPLAY_Y * SCALE}px;width:${BUF_W * SCALE}px;height:${BUF_H * SCALE}px;image-rendering:pixelated;`;
  displayContainer.appendChild(previewCanvas);

  appendEventLog('Preview: window opened');
  startPreviewLoop();
}

function startPreviewLoop(): void {
  if (previewAnimFrame) cancelAnimationFrame(previewAnimFrame);

  function tick(): void {
    if (!previewWin || previewWin.closed) {
      previewCanvas = null;
      previewWin = null;
      return;
    }

    const store = getStore();
    const renderer = getBoardRenderer();

    if (store && renderer && previewCanvas) {
      const ctx = previewCanvas.getContext('2d');
      if (ctx) {
        const pixels = renderer.getPixels();
        const imgData = ctx.createImageData(BUF_W, BUF_H);
        const data = imgData.data;
        for (let i = 0; i < BUF_W * BUF_H; i++) {
          const bright = pixels[i] ? 255 : 0;
          data[i * 4] = 0;           // R
          data[i * 4 + 1] = bright;  // G (green monochrome)
          data[i * 4 + 2] = 0;       // B
          data[i * 4 + 3] = 255;     // A
        }
        ctx.putImageData(imgData, 0, 0);
      }
    }

    previewAnimFrame = requestAnimationFrame(tick);
  }

  previewAnimFrame = requestAnimationFrame(tick);
}

/* ── Button handlers ──────────────────────────────────── */

connectBtn.addEventListener('click', () => {
  void startBackgammonApp(setStatus);
});

previewBtn.addEventListener('click', () => {
  openPreviewWindow();
});

// Glasses simulator controls
document.querySelector('#sim-up')!.addEventListener('click', () => simulateGlassesAction('SCROLL_UP'));
document.querySelector('#sim-down')!.addEventListener('click', () => simulateGlassesAction('SCROLL_DOWN'));
document.querySelector('#sim-tap')!.addEventListener('click', () => simulateGlassesAction('TAP'));
document.querySelector('#sim-dtap')!.addEventListener('click', () => simulateGlassesAction('DOUBLE_TAP'));

rollBtn.addEventListener('click', () => {
  const store = getStore();
  if (!store) {
    appendEventLog('Not connected');
    return;
  }
  if (isDiceAnimating()) {
    appendEventLog('Dice are rolling...');
    return;
  }
  const state = store.getState();
  if (state.phase === 'waitingToRoll') {
    const values = rollDice();
    store.dispatch({ type: 'ROLL_DICE', values });
    appendEventLog(`Rolled: [${values[0]}][${values[1]}]`);
  } else {
    appendEventLog(`Can't roll in phase: ${state.phase}`);
  }
});

newGameBtn.addEventListener('click', () => {
  const store = getStore();
  if (!store) {
    appendEventLog('Not connected');
    return;
  }
  store.dispatch({ type: 'NEW_GAME' });
  appendEventLog('New game started');
});

