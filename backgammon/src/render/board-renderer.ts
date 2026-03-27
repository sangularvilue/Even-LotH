/**
 * Board renderer — draws backgammon board as four 200×100 images (2×2 grid).
 * 400×200 virtual pixel buffer split into quadrants.
 * Includes dice pip faces, on-board turn/score text, cursor inversion, move animation.
 */

import type { GameState, Die, MoveAnimation } from '../state/contracts';
import { ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';
import {
  BUF_W, BUF_H, IMAGE_WIDTH, IMAGE_HEIGHT,
  CONTAINER_ID_TL, CONTAINER_ID_TR, CONTAINER_ID_BL, CONTAINER_ID_BR,
  CONTAINER_NAME_TL, CONTAINER_NAME_TR, CONTAINER_NAME_BL, CONTAINER_NAME_BR,
  BOARD_MARGIN, SCORE_BAR_H,
  TOP_ROW_Y, POINT_HEIGHT, BOT_ROW_Y,
  BEAROFF_Y, BEAROFF_H,
  POINTS_PER_SIDE, POINT_WIDTH, BAR_WIDTH, BOARD_TOTAL_WIDTH,
  LEFT_SECTION_X, BAR_X, RIGHT_SECTION_X,
  CHECKER_RADIUS, CHECKER_SPACING, MAX_VISIBLE_CHECKERS,
  MID_Y, MID_H, DIE_SIZE, DIE_GAP,
  POINT_BAR, POINT_BEAR_OFF,
  MOVE_ANIM_DURATION_MS,
} from '../state/constants';
import { drawText, measureText } from './font';
import {
  BMP_HEADER_SIZE, BMP_SIGNATURE, BMP_DIB_HEADER_SIZE,
  BMP_PPM, BMP_COLORS_USED,
  getBmpRowStride, getBmpPixelDataSize, getBmpFileSize,
} from './bmp-constants';
import { getTurnLabel } from '../state/selectors';

const BMP_ROW_STRIDE = getBmpRowStride(IMAGE_WIDTH);
const BMP_PIXEL_DATA_SIZE = getBmpPixelDataSize(IMAGE_WIDTH, IMAGE_HEIGHT);
const BMP_FILE_SIZE = getBmpFileSize(IMAGE_WIDTH, IMAGE_HEIGHT);

function initBmpBuffer(): Uint8Array {
  const buf = new ArrayBuffer(BMP_FILE_SIZE);
  const view = new DataView(buf);
  const data = new Uint8Array(buf);

  view.setUint8(0, BMP_SIGNATURE[0]); view.setUint8(1, BMP_SIGNATURE[1]);
  view.setUint32(2, BMP_FILE_SIZE, true);
  view.setUint32(6, 0, true);
  view.setUint32(10, BMP_HEADER_SIZE, true);
  view.setUint32(14, BMP_DIB_HEADER_SIZE, true);
  view.setInt32(18, IMAGE_WIDTH, true);
  view.setInt32(22, IMAGE_HEIGHT, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 1, true);
  view.setUint32(30, 0, true);
  view.setUint32(34, BMP_PIXEL_DATA_SIZE, true);
  view.setUint32(38, BMP_PPM, true);
  view.setUint32(42, BMP_PPM, true);
  view.setUint32(46, BMP_COLORS_USED, true);
  view.setUint32(50, BMP_COLORS_USED, true);
  view.setUint32(54, 0x00000000, true);
  view.setUint32(58, 0x00ffffff, true);
  return data;
}

/**
 * Extract a 200×100 tile from the full 400×200 buffer into a tile-sized pixel array.
 * tileX: 0 or 200 (left or right column)
 * tileY: 0 or 100 (top or bottom row)
 */
function extractTile(fullPixels: Uint8Array, tileX: number, tileY: number, out: Uint8Array): void {
  for (let row = 0; row < IMAGE_HEIGHT; row++) {
    const srcOffset = (tileY + row) * BUF_W + tileX;
    const dstOffset = row * IMAGE_WIDTH;
    for (let col = 0; col < IMAGE_WIDTH; col++) {
      out[dstOffset + col] = fullPixels[srcOffset + col]!;
    }
  }
}

function encodeBmpPixels(bmpBuffer: Uint8Array, pixels: Uint8Array): void {
  bmpBuffer.fill(0, BMP_HEADER_SIZE);
  for (let y = 0; y < IMAGE_HEIGHT; y++) {
    const srcRow = IMAGE_HEIGHT - 1 - y;
    const dstOffset = BMP_HEADER_SIZE + y * BMP_ROW_STRIDE;
    for (let x = 0; x < IMAGE_WIDTH; x++) {
      if (pixels[srcRow * IMAGE_WIDTH + x]) {
        const byteIdx = dstOffset + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        bmpBuffer[byteIdx]! |= 1 << bitIdx;
      }
    }
  }
}

function setPixel(pixels: Uint8Array, x: number, y: number, value: number): void {
  if (x >= 0 && x < BUF_W && y >= 0 && y < BUF_H) {
    pixels[y * BUF_W + x] = value;
  }
}

function drawHLine(pixels: Uint8Array, x: number, y: number, len: number, value: number): void {
  for (let i = 0; i < len; i++) setPixel(pixels, x + i, y, value);
}

function drawVLine(pixels: Uint8Array, x: number, y: number, len: number, value: number): void {
  for (let i = 0; i < len; i++) setPixel(pixels, x, y + i, value);
}

function drawRect(pixels: Uint8Array, x: number, y: number, w: number, h: number, value: number): void {
  drawHLine(pixels, x, y, w, value);
  drawHLine(pixels, x, y + h - 1, w, value);
  drawVLine(pixels, x, y, h, value);
  drawVLine(pixels, x + w - 1, y, h, value);
}

/** Invert all pixels in the given region (0↔1). */
function invertRegion(pixels: Uint8Array, rx: number, ry: number, rw: number, rh: number): void {
  for (let dy = 0; dy < rh; dy++) {
    for (let dx = 0; dx < rw; dx++) {
      const px = rx + dx;
      const py = ry + dy;
      if (px >= 0 && px < BUF_W && py >= 0 && py < BUF_H) {
        const idx = py * BUF_W + px;
        pixels[idx] = pixels[idx] ? 0 : 1;
      }
    }
  }
}

function getPointX(point: number): number {
  let col: number;
  if (point >= 13 && point <= 18) {
    col = point - 13;
    return LEFT_SECTION_X + col * POINT_WIDTH;
  } else if (point >= 19 && point <= 24) {
    col = point - 19;
    return RIGHT_SECTION_X + col * POINT_WIDTH;
  } else if (point >= 7 && point <= 12) {
    col = 12 - point;
    return LEFT_SECTION_X + col * POINT_WIDTH;
  } else if (point >= 1 && point <= 6) {
    col = 6 - point;
    return RIGHT_SECTION_X + col * POINT_WIDTH;
  }
  return 0;
}

function isTopRow(point: number): boolean {
  return point >= 13 && point <= 24;
}

function drawFilledCircle(pixels: Uint8Array, cx: number, cy: number, r: number): void {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) {
        setPixel(pixels, cx + dx, cy + dy, 1);
      }
    }
  }
}

function drawHollowCircle(pixels: Uint8Array, cx: number, cy: number, r: number): void {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) {
        setPixel(pixels, cx + dx, cy + dy, 1);
      }
    }
  }
  const ir = r - 2;
  for (let dy = -ir; dy <= ir; dy++) {
    for (let dx = -ir; dx <= ir; dx++) {
      if (dx * dx + dy * dy <= ir * ir) {
        setPixel(pixels, cx + dx, cy + dy, 0);
      }
    }
  }
}

function drawDigitOnChecker(pixels: Uint8Array, cx: number, cy: number, count: number): void {
  const text = String(count);
  const tw = text.length * 6;
  drawText(pixels, BUF_W, cx - Math.floor(tw / 2), cy - 3, text);
}

/**
 * Draw a single die face with pip dots.
 * If `greyed`, draw dashed outline only (consumed die).
 */
function drawDieFace(pixels: Uint8Array, cx: number, cy: number, value: Die, greyed: boolean): void {
  const half = Math.floor(DIE_SIZE / 2);
  const left = cx - half;
  const top = cy - half;

  if (greyed) {
    for (let i = 0; i < DIE_SIZE; i++) {
      if (i % 3 === 0) {
        setPixel(pixels, left + i, top, 1);
        setPixel(pixels, left + i, top + DIE_SIZE - 1, 1);
        setPixel(pixels, left, top + i, 1);
        setPixel(pixels, left + DIE_SIZE - 1, top + i, 1);
      }
    }
    return;
  }

  drawRect(pixels, left, top, DIE_SIZE, DIE_SIZE, 1);
  // Round corners
  setPixel(pixels, left, top, 0);
  setPixel(pixels, left + DIE_SIZE - 1, top, 0);
  setPixel(pixels, left, top + DIE_SIZE - 1, 0);
  setPixel(pixels, left + DIE_SIZE - 1, top + DIE_SIZE - 1, 0);

  const pipR = 1;
  const gx = Math.floor(DIE_SIZE / 4);
  const p = {
    TL: { x: cx - gx, y: cy - gx },
    TR: { x: cx + gx, y: cy - gx },
    ML: { x: cx - gx, y: cy },
    MC: { x: cx,      y: cy },
    MR: { x: cx + gx, y: cy },
    BL: { x: cx - gx, y: cy + gx },
    BR: { x: cx + gx, y: cy + gx },
  };

  const layouts: Record<number, { x: number; y: number }[]> = {
    1: [p.MC],
    2: [p.TR, p.BL],
    3: [p.TR, p.MC, p.BL],
    4: [p.TL, p.TR, p.BL, p.BR],
    5: [p.TL, p.TR, p.MC, p.BL, p.BR],
    6: [p.TL, p.ML, p.BL, p.TR, p.MR, p.BR],
  };

  for (const pip of (layouts[value] || [])) {
    for (let dy = -pipR; dy <= pipR; dy++) {
      for (let dx = -pipR; dx <= pipR; dx++) {
        if (dx * dx + dy * dy <= pipR * pipR + 1) {
          setPixel(pixels, pip.x + dx, pip.y + dy, 1);
        }
      }
    }
  }
}

/** Get the (cx, cy) center of the top checker at a given point. */
export function getCheckerPosition(
  point: number,
  count: number,
  isPlayerColor: boolean,
): { x: number; y: number } {
  if (point === 0) {
    // Bar
    const barCx = BAR_X + Math.floor(BAR_WIDTH / 2);
    const cy = isPlayerColor
      ? BOT_ROW_Y + Math.floor(POINT_HEIGHT / 2)
      : TOP_ROW_Y + Math.floor(POINT_HEIGHT / 2);
    return { x: barCx, y: cy };
  }
  if (point === 25) {
    // Bear-off area
    const cy = BEAROFF_Y + Math.floor(BEAROFF_H / 2);
    const cx = isPlayerColor
      ? BOARD_TOTAL_WIDTH - 40
      : LEFT_SECTION_X + 40;
    return { x: cx, y: cy };
  }

  const x = getPointX(point) + Math.floor(POINT_WIDTH / 2);
  const top = isTopRow(point);
  const visIdx = Math.min(count, MAX_VISIBLE_CHECKERS) - 1;
  const cy = top
    ? TOP_ROW_Y + CHECKER_RADIUS + 1 + visIdx * CHECKER_SPACING
    : BOT_ROW_Y + POINT_HEIGHT - CHECKER_RADIUS - 1 - visIdx * CHECKER_SPACING;

  return { x, y: cy };
}

export class BoardRenderer {
  private workPixels: Uint8Array = new Uint8Array(BUF_W * BUF_H);
  private tilePixels: Uint8Array = new Uint8Array(IMAGE_WIDTH * IMAGE_HEIGHT);

  getPixels(): Uint8Array { return this.workPixels; }

  private cachedTLBmp: Uint8Array = initBmpBuffer();
  private cachedTRBmp: Uint8Array = initBmpBuffer();
  private cachedBLBmp: Uint8Array = initBmpBuffer();
  private cachedBRBmp: Uint8Array = initBmpBuffer();

  renderFull(state: GameState): ImageRawDataUpdate[] {
    const pixels = this.workPixels;
    pixels.fill(0);

    this.drawBoard(pixels);
    this.drawCheckers(pixels, state);
    this.drawScoreBar(pixels, state);
    this.drawBearOff(pixels, state);
    this.drawDiceInMiddle(pixels, state);

    // Draw cursor last: selected source first, then destination dots, then cursor with inversion
    this.drawCursor(pixels, state);

    // Draw move animation on top
    if (state.moveAnimation) {
      this.drawMoveAnimation(pixels, state.moveAnimation, state);
    }

    // Split into 4 quadrant tiles
    extractTile(pixels, 0, 0, this.tilePixels);
    encodeBmpPixels(this.cachedTLBmp, this.tilePixels);

    extractTile(pixels, IMAGE_WIDTH, 0, this.tilePixels);
    encodeBmpPixels(this.cachedTRBmp, this.tilePixels);

    extractTile(pixels, 0, IMAGE_HEIGHT, this.tilePixels);
    encodeBmpPixels(this.cachedBLBmp, this.tilePixels);

    extractTile(pixels, IMAGE_WIDTH, IMAGE_HEIGHT, this.tilePixels);
    encodeBmpPixels(this.cachedBRBmp, this.tilePixels);

    return [
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_TL,
        containerName: CONTAINER_NAME_TL,
        imageData: this.cachedTLBmp.slice(),
      }),
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_TR,
        containerName: CONTAINER_NAME_TR,
        imageData: this.cachedTRBmp.slice(),
      }),
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_BL,
        containerName: CONTAINER_NAME_BL,
        imageData: this.cachedBLBmp.slice(),
      }),
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_BR,
        containerName: CONTAINER_NAME_BR,
        imageData: this.cachedBRBmp.slice(),
      }),
    ];
  }

  private drawBoard(pixels: Uint8Array): void {
    drawRect(pixels, 0, SCORE_BAR_H, BOARD_TOTAL_WIDTH, BEAROFF_Y + BEAROFF_H - SCORE_BAR_H, 1);
    drawVLine(pixels, BAR_X, SCORE_BAR_H, BEAROFF_Y + BEAROFF_H - SCORE_BAR_H, 1);
    drawVLine(pixels, BAR_X + BAR_WIDTH - 1, SCORE_BAR_H, BEAROFF_Y + BEAROFF_H - SCORE_BAR_H, 1);
    drawHLine(pixels, 0, MID_Y, BOARD_TOTAL_WIDTH, 1);
    drawHLine(pixels, 0, MID_Y + MID_H - 1, BOARD_TOTAL_WIDTH, 1);

    for (let point = 1; point <= 24; point++) {
      this.drawTriangle(pixels, point);
    }
  }

  private drawTriangle(pixels: Uint8Array, point: number): void {
    const x = getPointX(point);
    const top = isTopRow(point);
    const filled = point % 2 === 1;
    const baseY = top ? TOP_ROW_Y : BOT_ROW_Y + POINT_HEIGHT;
    const halfW = Math.floor(POINT_WIDTH / 2);
    const midX = x + halfW;

    for (let i = 0; i < POINT_HEIGHT; i++) {
      const progress = i / POINT_HEIGHT;
      const width = Math.max(1, Math.round(halfW * (1 - progress)));
      const y = top ? baseY + i : baseY - i;

      if (filled) {
        for (let dx = -width; dx <= width; dx++) {
          if ((midX + dx + y) % 2 === 0) {
            setPixel(pixels, midX + dx, y, 1);
          }
        }
      } else {
        setPixel(pixels, midX - width, y, 1);
        setPixel(pixels, midX + width, y, 1);
      }
    }
  }

  private drawCheckers(pixels: Uint8Array, state: GameState): void {
    const board = state.board;
    const anim = state.moveAnimation;

    for (let point = 1; point <= 24; point++) {
      const val = board.points[point - 1]!;
      if (val === 0) continue;

      const isPlayer = val > 0;
      let count = Math.abs(val);

      // During move animation, draw one fewer checker at the destination
      if (anim && anim.toPt === point) {
        const animIsPlayer = anim.color === 'player';
        if (animIsPlayer === isPlayer) {
          count = Math.max(0, count - 1);
          if (count === 0) continue;
        }
      }

      const x = getPointX(point) + Math.floor(POINT_WIDTH / 2);
      const top = isTopRow(point);
      const visibleCount = Math.min(count, MAX_VISIBLE_CHECKERS);

      for (let i = 0; i < visibleCount; i++) {
        const cy = top
          ? TOP_ROW_Y + CHECKER_RADIUS + 1 + i * CHECKER_SPACING
          : BOT_ROW_Y + POINT_HEIGHT - CHECKER_RADIUS - 1 - i * CHECKER_SPACING;

        if (isPlayer) {
          drawFilledCircle(pixels, x, cy, CHECKER_RADIUS);
        } else {
          drawHollowCircle(pixels, x, cy, CHECKER_RADIUS);
        }

        if (i === 0 && count > MAX_VISIBLE_CHECKERS) {
          const ir = CHECKER_RADIUS - 2;
          for (let dy = -ir; dy <= ir; dy++) {
            for (let dx = -ir; dx <= ir; dx++) {
              if (dx * dx + dy * dy <= ir * ir) {
                setPixel(pixels, x + dx, cy + dy, isPlayer ? 0 : 1);
              }
            }
          }
          drawDigitOnChecker(pixels, x, cy, count);
        }
      }
    }

    // Bar checkers
    const barCx = BAR_X + Math.floor(BAR_WIDTH / 2);
    if (board.bar.player > 0) {
      const cy = BOT_ROW_Y + Math.floor(POINT_HEIGHT / 2);
      drawFilledCircle(pixels, barCx, cy, CHECKER_RADIUS - 1);
      if (board.bar.player > 1) {
        drawDigitOnChecker(pixels, barCx, cy, board.bar.player);
      }
    }
    if (board.bar.ai > 0) {
      const cy = TOP_ROW_Y + Math.floor(POINT_HEIGHT / 2);
      drawHollowCircle(pixels, barCx, cy, CHECKER_RADIUS - 1);
      if (board.bar.ai > 1) {
        drawDigitOnChecker(pixels, barCx, cy, board.bar.ai);
      }
    }
  }

  private drawScoreBar(pixels: Uint8Array, state: GameState): void {
    const turnLabel = getTurnLabel(state);
    drawText(pixels, BUF_W, BOARD_MARGIN + 1, 1, turnLabel);

    const scoreText = `P:${state.scores.player} AI:${state.scores.ai}`;
    const scoreW = measureText(scoreText);
    drawText(pixels, BUF_W, BOARD_TOTAL_WIDTH - scoreW - 4, 1, scoreText);
  }

  private drawBearOff(pixels: Uint8Array, state: GameState): void {
    const board = state.board;
    const aiText = `AI:${board.borneOff.ai}`;
    drawText(pixels, BUF_W, LEFT_SECTION_X + 1, BEAROFF_Y + 1, aiText);

    const playerText = `OFF:${board.borneOff.player}`;
    const pw = measureText(playerText);
    drawText(pixels, BUF_W, BOARD_TOTAL_WIDTH - pw - 4, BEAROFF_Y + 1, playerText);
  }

  drawDiceInMiddle(pixels: Uint8Array, state: GameState): void {
    const anim = state.diceAnimation;
    const diceCy = MID_Y + Math.floor(MID_H / 2);

    // Center of left and right board sections (avoiding the bar)
    const leftCx = Math.floor(BAR_X / 2);
    const rightCx = Math.floor((RIGHT_SECTION_X + BOARD_TOTAL_WIDTH) / 2);

    if (anim) {
      if (anim.isDoubles) {
        // 2 random dice on each side
        for (let i = 0; i < 2; i++) {
          const lx = leftCx + (i - 0.5) * (DIE_SIZE + DIE_GAP);
          const rx = rightCx + (i - 0.5) * (DIE_SIZE + DIE_GAP);
          drawDieFace(pixels, Math.round(lx), diceCy, (Math.floor(Math.random() * 6) + 1) as Die, false);
          drawDieFace(pixels, Math.round(rx), diceCy, (Math.floor(Math.random() * 6) + 1) as Die, false);
        }
      } else {
        // 1 random die on each side
        drawDieFace(pixels, leftCx, diceCy, (Math.floor(Math.random() * 6) + 1) as Die, false);
        drawDieFace(pixels, rightCx, diceCy, (Math.floor(Math.random() * 6) + 1) as Die, false);
      }
      return;
    }

    if (!state.dice.values) return;

    const dieVal = state.dice.values;
    const remaining = state.dice.remaining;

    const activeIdx = state.activeDieIndex;
    const isPlayerTurn = state.phase === 'selectChecker' || state.phase === 'selectDestination';
    const half = Math.floor(DIE_SIZE / 2);

    if (state.dice.isDoubles) {
      const totalMoves = 4;
      const used = totalMoves - remaining.length;
      // 2 dice on each side
      for (let i = 0; i < 2; i++) {
        const lx = Math.round(leftCx + (i - 0.5) * (DIE_SIZE + DIE_GAP));
        const rx = Math.round(rightCx + (i - 0.5) * (DIE_SIZE + DIE_GAP));
        drawDieFace(pixels, lx, diceCy, dieVal[0], i < used);
        drawDieFace(pixels, rx, diceCy, dieVal[0], (i + 2) < used);
      }
      // Highlight the next unused die
      if (isPlayerTurn && used < 4) {
        const highlightIdx = used; // 0,1 = left pair; 2,3 = right pair
        let hx: number;
        if (highlightIdx < 2) {
          hx = Math.round(leftCx + (highlightIdx - 0.5) * (DIE_SIZE + DIE_GAP));
        } else {
          hx = Math.round(rightCx + (highlightIdx - 2 - 0.5) * (DIE_SIZE + DIE_GAP));
        }
        const pad = 3;
        drawRect(pixels, hx - half - pad, diceCy - half - pad, DIE_SIZE + pad * 2, DIE_SIZE + pad * 2, 1);
      }
    } else {
      // Die 0 on left, die 1 on right
      const greyed0 = !remaining.includes(dieVal[0]!);
      const greyed1 = !remaining.includes(dieVal[1]!);
      drawDieFace(pixels, leftCx, diceCy, dieVal[0]!, greyed0);
      drawDieFace(pixels, rightCx, diceCy, dieVal[1]!, greyed1);

      // Highlight the active die
      if (isPlayerTurn && remaining.length > 0) {
        const hx = activeIdx === 0 ? leftCx : rightCx;
        const pad = 3;
        drawRect(pixels, hx - half - pad, diceCy - half - pad, DIE_SIZE + pad * 2, DIE_SIZE + pad * 2, 1);
      }
    }
  }

  private drawCursor(pixels: Uint8Array, state: GameState): void {
    if (state.phase !== 'selectChecker' && state.phase !== 'selectDestination') return;

    const { cursorIndex, selectedFrom, validDestinations } = state;
    const LINEAR_POINT_ORDER = [
      26, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 27,
    ];
    const pointId = LINEAR_POINT_ORDER[cursorIndex]!;

    // 1. Draw selected source (solid border)
    if (selectedFrom !== null && selectedFrom >= 1 && selectedFrom <= 24) {
      this.drawPointHighlight(pixels, selectedFrom, 'selected');
    }

    // 2. Draw valid destination dots
    if (state.phase === 'selectDestination') {
      for (const dest of validDestinations) {
        if (dest >= 1 && dest <= 24) {
          this.drawPointHighlight(pixels, dest, 'destination');
        }
      }
    }

    // 3. Draw cursor with inversion (last, on top)
    if (pointId >= 1 && pointId <= 24) {
      this.drawPointHighlight(pixels, pointId, 'cursor');
    } else if (pointId === POINT_BAR) {
      const bx = BAR_X + 1;
      const by = TOP_ROW_Y;
      const bw = BAR_WIDTH - 2;
      const bh = POINT_HEIGHT * 2 + (BOT_ROW_Y - TOP_ROW_Y - POINT_HEIGHT);
      drawRect(pixels, bx, by, bw, bh, 1);
      invertRegion(pixels, bx + 1, by + 1, bw - 2, bh - 2);
    } else if (pointId === POINT_BEAR_OFF) {
      const bx = RIGHT_SECTION_X - 1;
      const by = BEAROFF_Y - 1;
      const bw = POINTS_PER_SIDE * POINT_WIDTH + 2;
      const bh = BEAROFF_H + 2;
      drawRect(pixels, bx, by, bw, bh, 1);
      invertRegion(pixels, bx + 1, by + 1, bw - 2, bh - 2);
    }
  }

  private drawPointHighlight(
    pixels: Uint8Array,
    point: number,
    style: 'cursor' | 'selected' | 'destination',
  ): void {
    const x = getPointX(point);
    const top = isTopRow(point);
    const y = top ? TOP_ROW_Y : BOT_ROW_Y;

    if (style === 'cursor') {
      // 2px solid border around the point column
      for (let border = 0; border < 2; border++) {
        drawRect(pixels, x - 1 - border, y - 1 - border, POINT_WIDTH + 2 + border * 2, POINT_HEIGHT + 2 + border * 2, 1);
      }
      // Invert all pixels inside the region
      invertRegion(pixels, x, y, POINT_WIDTH, POINT_HEIGHT);
    } else if (style === 'selected') {
      drawRect(pixels, x - 1, y - 1, POINT_WIDTH + 2, POINT_HEIGHT + 2, 1);
    } else {
      // 5×5 solid dot at the tip of the point
      const dotY = top ? y + POINT_HEIGHT - 4 : y + 4;
      const dotX = x + Math.floor(POINT_WIDTH / 2);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setPixel(pixels, dotX + dx, dotY + dy, 1);
        }
      }
    }
  }

  /** Draw the moving checker at its interpolated position during animation. */
  private drawMoveAnimation(pixels: Uint8Array, anim: MoveAnimation, state: GameState): void {
    const elapsed = performance.now() - anim.startTime;
    const t = Math.min(1, elapsed / MOVE_ANIM_DURATION_MS);

    const isPlayer = anim.color === 'player';

    // Source position
    const fromCount = this.getCheckerCountAtPoint(anim.fromPt, state, anim.color);
    const fromPos = getCheckerPosition(anim.fromPt, Math.max(1, fromCount + 1), isPlayer);

    // Destination position
    const toCount = this.getOriginalCheckerCountAtPoint(anim.toPt, state, anim.color);
    const toPos = getCheckerPosition(anim.toPt, Math.max(1, toCount), isPlayer);

    // Quadratic bezier arc — control point 20px above midpoint
    const midX = (fromPos.x + toPos.x) / 2;
    const midY = (fromPos.y + toPos.y) / 2;
    const cpY = midY - 20;

    const cx = Math.round((1 - t) * (1 - t) * fromPos.x + 2 * (1 - t) * t * midX + t * t * toPos.x);
    const cy = Math.round((1 - t) * (1 - t) * fromPos.y + 2 * (1 - t) * t * cpY + t * t * toPos.y);

    if (isPlayer) {
      drawFilledCircle(pixels, cx, cy, CHECKER_RADIUS);
    } else {
      drawHollowCircle(pixels, cx, cy, CHECKER_RADIUS);
    }
  }

  private getCheckerCountAtPoint(point: number, state: GameState, color: string): number {
    if (point === 0) {
      return color === 'player' ? state.board.bar.player : state.board.bar.ai;
    }
    if (point === 25) {
      return color === 'player' ? state.board.borneOff.player : state.board.borneOff.ai;
    }
    const val = state.board.points[point - 1] || 0;
    if (color === 'player') return val > 0 ? val : 0;
    return val < 0 ? -val : 0;
  }

  private getOriginalCheckerCountAtPoint(point: number, state: GameState, color: string): number {
    const count = this.getCheckerCountAtPoint(point, state, color);
    return Math.max(1, count);
  }
}
