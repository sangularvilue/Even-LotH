# Even-LotH

Liturgy of the Hours app for [Even Realities G2](https://www.evenrealities.com/) smart glasses.

Displays the Divine Office prayers on the glasses as a smooth-scrolling teleprompter. Prayer text is sourced from [divineoffice.org](https://divineoffice.org/).

## How it works

- A **Node.js backend** scrapes and parses prayer content from divineoffice.org
- A **companion web app** (Vite + TypeScript) runs on the phone and connects to the glasses via the Even Hub SDK
- Prayer text is pre-rendered onto an off-screen canvas and streamed to the glasses as image tiles for pixel-smooth scrolling

## Project structure

```
_shared/            Shared utilities (vite config, event helpers, styles)
liturgy/
  src/              Companion app + glasses controller
  server/           Express backend (scraper + cache)
```

## Setup

### Backend server

```bash
cd liturgy/server
npm install
npx tsx src/index.ts
```

Runs on port 3210. Endpoints:
- `GET /api/hours?date=YYYYMMDD` — list available hours
- `GET /api/hour/:slug?date=YYYYMMDD` — parsed prayer sections
- `GET /api/health` — health check

### Companion app

```bash
cd liturgy
npm install
npm run dev
```

### Testing with the emulator

```bash
npx @evenrealities/evenhub-simulator@latest http://localhost:5179
```

## Glasses controls

- **Hour list**: Scroll to navigate, tap to select
- **Reading**: Scroll up/down to move through text, tap to pause/resume auto-scroll, double-tap to exit

## Settings

Configurable from the companion UI:
- Scroll mode (manual / auto-scroll)
- Auto-scroll speed
- Font size, weight, letter spacing
- Display columns (1 = narrow/tall, 2 = wide)
- Visible hours (toggle individual hours on/off)
