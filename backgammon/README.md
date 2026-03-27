# Even Backgammon

Single-player backgammon vs AI for **Even G2 smart glasses**.

## Display

The game renders a 400×200 monochrome board using a 2×2 grid of image tiles (each 200×100), centered on the 576×288 glasses display. All rendering is done to a pixel buffer and encoded as 1-bit BMPs for the Even Hub SDK.

```
┌──────────────────────────────────────┐
│         ┌──────┬──────┐              │
│  88px   │  TL  │  TR  │  88px       │
│  gap    │200×100│200×100│ gap        │
│         ├──────┼──────┤              │
│         │  BL  │  BR  │              │
│         │200×100│200×100│            │
│         └──────┴──────┘              │
│              576×288                 │
└──────────────────────────────────────┘
```

## Controls

Glasses input (swipe up/down + tap):

- **Swipe up/down** — move cursor between points that have legal moves for the active die
- **Tap** — move the highlighted checker by the active die value (auto-selects destination)
- **Double-tap** — roll dice (also auto-rolls after 800ms)

The active die is shown with a highlight box. After using the first die, the second die becomes active automatically. For doubles, all four uses cycle through in order.

## Features

- Animated dice rolling and checker movement (quadratic bezier arcs)
- Auto-roll: dice roll automatically after 800ms on the player's turn
- AI opponent with positional evaluation (prime detection, blot penalty, race scoring)
- AI moves animate sequentially so you can follow the action
- Cursor-inversion highlight for clear visibility on monochrome display
- Phone companion UI with simulator buttons (Swipe Up/Down, Tap, Double Tap)

## Development

```bash
npm install
npm run dev        # Vite dev server on port 5180
```

Use the [Even Hub Simulator](https://github.com/nicojo/even-hub-sim) to test without physical glasses. The simulator requires an event capture container for input, so use the phone companion buttons for testing. On real glasses, swipe/tap input works directly.

## Build & Package

```bash
npm run build
npx @evenrealities/evenhub-cli pack app.json dist
```

## Tech Stack

- TypeScript, Vite
- Even Hub SDK (`@evenrealities/even_hub_sdk`)
- No canvas/DOM rendering — pure pixel buffer manipulation
- 1-bit BMP encoding for monochrome display
