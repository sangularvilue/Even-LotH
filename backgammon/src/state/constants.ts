/**
 * Display dimensions and layout constants for the backgammon app.
 * 400×200 board using 4 image tiles (200×100 each) in a 2×2 grid.
 * No event capture container — gestures fire on onEvenHubEvent regardless.
 */

// G2 display
export const DISPLAY_WIDTH = 576;
export const DISPLAY_HEIGHT = 288;

// Image containers (max 200×100 per Even SDK)
export const IMAGE_WIDTH = 200;
export const IMAGE_HEIGHT = 100;

// 2×2 grid layout
export const TILE_COLS = 2;
export const TILE_ROWS = 2;

// Virtual canvas for board rendering (400×200)
export const BUF_W = IMAGE_WIDTH * TILE_COLS; // 400
export const BUF_H = IMAGE_HEIGHT * TILE_ROWS; // 200

// Board geometry within the 400×200 buffer
export const BOARD_MARGIN = 2;
export const SCORE_BAR_Y = 0;
export const SCORE_BAR_H = 12;
export const TOP_ROW_Y = SCORE_BAR_H + 1; // y=13
export const POINT_HEIGHT = 68;
export const MID_Y = TOP_ROW_Y + POINT_HEIGHT + 1; // y=82
export const MID_H = 30;
export const BOT_ROW_Y = MID_Y + MID_H; // y=112
export const BEAROFF_Y = BOT_ROW_Y + POINT_HEIGHT + 1; // y=181
export const BEAROFF_H = 12;
// Board ends at y=193, fits within 200px height

// Point column layout: 12 points per row, split by bar
// With 400px width we have much more room
export const POINTS_PER_SIDE = 6;
export const POINT_WIDTH = 28; // px per point column (doubled from 14)
export const BAR_WIDTH = 16;
export const LEFT_SECTION_X = BOARD_MARGIN; // 2
export const BAR_X = BOARD_MARGIN + POINTS_PER_SIDE * POINT_WIDTH; // 2 + 168 = 170
export const RIGHT_SECTION_X = BAR_X + BAR_WIDTH; // 186
export const BOARD_TOTAL_WIDTH = RIGHT_SECTION_X + POINTS_PER_SIDE * POINT_WIDTH + BOARD_MARGIN; // 186 + 168 + 2 = 356

// Checker rendering
export const CHECKER_RADIUS = 10;
export const CHECKER_SPACING = 13;
export const MAX_VISIBLE_CHECKERS = 5;

// Container IDs — 4 image tiles, no event capture needed
export const CONTAINER_ID_TL = 1; // top-left
export const CONTAINER_ID_TR = 2; // top-right
export const CONTAINER_ID_BL = 3; // bottom-left
export const CONTAINER_ID_BR = 4; // bottom-right

export const CONTAINER_NAME_TL = 'board-tl';
export const CONTAINER_NAME_TR = 'board-tr';
export const CONTAINER_NAME_BL = 'board-bl';
export const CONTAINER_NAME_BR = 'board-br';

// Position of the 400×200 board centered on 576×288 display
export const BOARD_DISPLAY_X = Math.floor((DISPLAY_WIDTH - BUF_W) / 2); // 88
export const BOARD_DISPLAY_Y = Math.floor((DISPLAY_HEIGHT - BUF_H) / 2); // 44

// Dice rendering
export const DIE_SIZE = 18;
export const DIE_GAP = 6;
export const DICE_ANIM_DURATION_MS = 800;
export const DICE_ANIM_FRAME_MS = 80;

// Move animation
export const MOVE_ANIM_DURATION_MS = 400;
export const MOVE_ANIM_FRAME_MS = 30;

// Auto-roll
export const AUTO_ROLL_DELAY_MS = 800;

/**
 * Linear point order for cursor navigation.
 * Index 0 = BAR (26), 1-24 = points 1-24, 25 = BEAR_OFF (27).
 */
export const BAR_INDEX = 0;
export const BEAR_OFF_INDEX = 25;
export const LINEAR_POINT_ORDER = [
  26, // BAR
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  27, // BEAR_OFF
] as const;

/** Special point IDs */
export const POINT_BAR = 26;
export const POINT_BEAR_OFF = 27;
