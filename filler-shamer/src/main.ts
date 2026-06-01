/**
 * Filler-Word Shamer — entry point.
 *
 * One deployed page, two runtimes:
 *   • Glasses (EvenHub bridge present): audio from glasses mic, ticker on the
 *     glasses display. The visible HTML is headless here.
 *   • Browser (no bridge): mic via getUserMedia, cable-news chyron on screen.
 *     Used to develop and to test before loading on the glasses.
 */

import './styles.css';
import { VoskStt } from './stt';
import { GlassesRenderer } from './glasses';
import { TickerChyron } from './ticker';
import { countFillers, mergeCounts, totalCount, topFillers, emptyCounts } from './filler';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="stage">
    <header class="brand">
      <span class="rec">● REC</span>
      <span class="title">FILLER-WORD SHAMER</span>
      <span class="tally" id="tally">0</span>
    </header>
    <main class="center" id="center">
      <button id="start" class="start-btn">▶ Start Listening</button>
      <p id="status" class="status">Initializing…</p>
      <p id="top" class="top"></p>
    </main>
    <div class="chyron" id="viewport">
      <div class="chyron-label">NOW&nbsp;HEARING</div>
      <div class="chyron-track" id="track"></div>
    </div>
  </div>
`;

const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const tallyEl = document.querySelector<HTMLSpanElement>('#tally')!;
const topEl = document.querySelector<HTMLParagraphElement>('#top')!;
const startBtn = document.querySelector<HTMLButtonElement>('#start')!;
const viewport = document.querySelector<HTMLDivElement>('#viewport')!;
const track = document.querySelector<HTMLDivElement>('#track')!;

const setStatus = (s: string) => { statusEl.textContent = s; };
const ticker = new TickerChyron(viewport, track);
const counts = emptyCounts();

// The CSS chyron only renders in a real browser. On the glasses the DOM is
// headless, so we leave it off there to free the main thread for Vosk.
let useTicker = false;

function refreshTally(): void {
  const total = totalCount(counts);
  tallyEl.textContent = String(total);
  const top = topFillers(counts, 4);
  topEl.textContent = top.length ? `worst: ${top.join('   ')}` : '';
}

const stt = new VoskStt({
  onStatus: setStatus,
  onPartial: (text) => { if (useTicker) ticker.setPartial(text); },
  onFinal: (text) => {
    if (useTicker) ticker.addFinal(text);
    mergeCounts(counts, countFillers(text));
    refreshTally();
    glasses.renderCounts(counts);
  },
});

const glasses = new GlassesRenderer(stt, (s) => console.log('[glasses]', s));

/* ── Browser mic path ─────────────────────────────────── */
let micStarted = false;
async function startMic(): Promise<void> {
  if (micStarted) return;
  micStarted = true;
  startBtn.disabled = true;
  try {
    const ctx = new AudioContext();
    await ctx.resume();
    await stt.load(ctx.sampleRate);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => stt.feedAudioBuffer(e.inputBuffer);

    // Mute the through-signal so the mic isn't echoed to the speakers, but
    // still connect to destination so onaudioprocess fires in all browsers.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);

    useTicker = true;
    ticker.start();
    startBtn.remove();
    setStatus('Listening — speak and watch the ticker.');
  } catch (err) {
    micStarted = false;
    startBtn.disabled = false;
    setStatus(`Mic error: ${err}`);
  }
}
startBtn.addEventListener('click', () => void startMic());

/* ── Boot ─────────────────────────────────────────────── */
async function boot(): Promise<void> {
  const bridged = await glasses.connect();
  if (bridged) {
    startBtn.remove();
    await stt.load(16000); // glasses mic is 16 kHz; chyron stays off (headless)
    setStatus('Glasses connected — listening.');
  } else {
    setStatus('Tap “Start Listening” to grant mic access.');
  }
}
void boot();
