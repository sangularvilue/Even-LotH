/**
 * Glasses bridge integration. When the EvenHub bridge is present (app loaded
 * in the glasses WebView), this captures the glasses mic via audioControl and
 * renders a live filler tally on the 576×288 display.
 *
 * Display: a header line with the running total, plus the filler words laid out
 * as a word→count list split across TWO columns (page 1 left, page 2 right) to
 * use the wide display efficiently. It re-renders only when a filler is detected
 * (throttled), so BLE traffic stays low — unlike the old per-frame marquee,
 * which fell minutes behind and flooded the link.
 *
 * Incoming PCM is batched (~250 ms) before being handed to Vosk to cut
 * per-call worker overhead in the WebView.
 */

import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import { pcmToBytes, type VoskStt } from './stt';
import type { FillerCounts } from './filler';

const DISPLAY_WIDTH = 576;
const DISPLAY_HEIGHT = 288;
const HEADER_HEIGHT = 40;
const COL_WIDTH = DISPLAY_WIDTH / 2;     // 288 per page
const LINES_PER_COL = 8;                  // rows per page (tune on hardware)
const COL_CHARS = 20;                     // chars per row for dot-leader fit (tune)

const HEADER_ID = 1;
const LEFT_ID = 2;
const RIGHT_ID = 3;

const FEED_MS = 250;       // PCM batch / flush interval
const RENDER_MS = 300;     // min interval between display updates

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(v => { clearTimeout(timer); resolve(v); },
           e => { clearTimeout(timer); reject(e); });
  });
}

/** "like ········ 5" — word left, count right, dot leaders between. */
function fillerLine(word: string, count: number, width: number): string {
  const cnt = String(count);
  const w = word.length > width - cnt.length - 2 ? word.slice(0, width - cnt.length - 2) : word;
  const dots = Math.max(1, width - w.length - cnt.length - 2);
  return `${w} ${'.'.repeat(dots)} ${cnt}`;
}

export class GlassesRenderer {
  private bridge: EvenAppBridge | null = null;

  // PCM batching
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private feedTimer: ReturnType<typeof setInterval> | null = null;

  // Display throttle
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private latestCounts: FillerCounts | null = null;

  constructor(private stt: VoskStt, private log: (s: string) => void) {}

  /** Returns true if the glasses bridge was found and wired up. */
  async connect(): Promise<boolean> {
    try {
      this.bridge = await withTimeout(waitForEvenAppBridge(), 6000);
    } catch {
      this.log('No glasses bridge — browser/mic mode.');
      return false;
    }

    await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
      containerTotalNum: 3,
      textObject: [
        new TextContainerProperty({
          containerID: HEADER_ID, containerName: 'header',
          content: 'FILLERS: 0',
          xPosition: 0, yPosition: 0,
          width: DISPLAY_WIDTH, height: HEADER_HEIGHT,
          borderWidth: 0, paddingLength: 4, isEventCapture: 1,
        }),
        new TextContainerProperty({
          containerID: LEFT_ID, containerName: 'colL',
          content: '',
          xPosition: 0, yPosition: HEADER_HEIGHT,
          width: COL_WIDTH, height: DISPLAY_HEIGHT - HEADER_HEIGHT,
          borderWidth: 0, paddingLength: 4, isEventCapture: 0,
        }),
        new TextContainerProperty({
          containerID: RIGHT_ID, containerName: 'colR',
          content: '',
          xPosition: COL_WIDTH, yPosition: HEADER_HEIGHT,
          width: COL_WIDTH, height: DISPLAY_HEIGHT - HEADER_HEIGHT,
          borderWidth: 0, paddingLength: 4, isEventCapture: 0,
        }),
      ],
    }));

    await this.bridge.audioControl(true);
    this.bridge.onEvenHubEvent((event: EvenHubEvent) => {
      if (event.audioEvent) this.enqueuePcm(event.audioEvent.audioPcm);
    });

    this.feedTimer = setInterval(() => this.flushPcm(), FEED_MS);
    this.log('Glasses connected — listening.');
    return true;
  }

  /** Update the tally + word list. Throttled to RENDER_MS. */
  renderCounts(counts: FillerCounts): void {
    this.latestCounts = counts;
    if (this.renderTimer || !this.bridge) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      if (this.latestCounts) void this.paint(this.latestCounts);
    }, RENDER_MS);
  }

  private enqueuePcm(audioPcm: Uint8Array | number[] | string): void {
    const bytes = pcmToBytes(audioPcm);
    if (bytes.byteLength) {
      this.pending.push(bytes);
      this.pendingBytes += bytes.byteLength;
    }
  }

  private flushPcm(): void {
    if (!this.pendingBytes) return;
    const merged = new Uint8Array(this.pendingBytes);
    let off = 0;
    for (const chunk of this.pending) { merged.set(chunk, off); off += chunk.length; }
    this.pending = [];
    this.pendingBytes = 0;
    this.stt.feedPcmBytes(merged);
  }

  private async paint(counts: FillerCounts): Promise<void> {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, n]) => s + n, 0);
    const shown = entries.slice(0, LINES_PER_COL * 2);
    const left = shown.slice(0, LINES_PER_COL);
    const right = shown.slice(LINES_PER_COL);

    const leftText = left.map(([w, c]) => fillerLine(w, c, COL_CHARS)).join('\n');
    const rightText = right.map(([w, c]) => fillerLine(w, c, COL_CHARS)).join('\n');

    await this.upgrade(HEADER_ID, 'header', `FILLERS: ${total}`);
    await this.upgrade(LEFT_ID, 'colL', leftText);
    await this.upgrade(RIGHT_ID, 'colR', rightText);
  }

  private async upgrade(id: number, name: string, content: string): Promise<void> {
    try {
      await this.bridge!.textContainerUpgrade(new TextContainerUpgrade({
        containerID: id, containerName: name,
        contentOffset: 0, contentLength: content.length, content,
      }));
    } catch (err) {
      this.log(`upgrade ${name} failed: ${err}`);
    }
  }

  dispose(): void {
    if (this.feedTimer) clearInterval(this.feedTimer);
    if (this.renderTimer) clearTimeout(this.renderTimer);
    if (this.bridge) void this.bridge.audioControl(false);
  }
}
