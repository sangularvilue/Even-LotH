/**
 * Cable-news chyron. Committed words scroll right-to-left at constant speed;
 * the in-progress (partial) utterance rides at the tail and flows in from the
 * right. Only the trailing partial span is ever mutated, so committed words
 * never jitter. Off-screen words on the left are pruned each frame.
 */

import { isFillerWord } from './filler';

export class TickerChyron {
  private words: HTMLElement[] = [];
  private partialEl: HTMLElement | null = null;
  private trackX: number;
  private lastTs = 0;
  private running = false;

  constructor(
    private viewport: HTMLElement,
    private track: HTMLElement,
    private speed = 90, // px/sec
  ) {
    this.trackX = viewport.clientWidth;
    this.apply();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTs = 0;
    requestAnimationFrame(this.loop);
  }

  /** Commit a final utterance: freeze the partial into permanent word spans. */
  addFinal(text: string): void {
    this.clearPartial();
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const span = document.createElement('span');
      span.className = 'tick-word' + (isFillerWord(word) ? ' tick-filler' : '');
      span.textContent = word;
      this.track.appendChild(span);
      this.words.push(span);
    }
  }

  /** Live preview of the current utterance, shown dim at the tail. */
  setPartial(text: string): void {
    if (!text.trim()) return;
    if (!this.partialEl) {
      this.partialEl = document.createElement('span');
      this.partialEl.className = 'tick-word tick-partial';
      this.track.appendChild(this.partialEl);
    }
    this.partialEl.textContent = text;
  }

  private clearPartial(): void {
    if (this.partialEl) {
      this.partialEl.remove();
      this.partialEl = null;
    }
  }

  private loop = (ts: number): void => {
    if (!this.running) return;
    if (this.lastTs) {
      const dt = (ts - this.lastTs) / 1000;
      this.trackX -= this.speed * dt;

      // Prune words fully scrolled off the left edge; compensate trackX so the
      // remaining words don't visually jump when the flow shifts left.
      while (this.words.length) {
        const first = this.words[0];
        const right = first.offsetLeft + first.offsetWidth + this.trackX;
        if (right < 0) {
          const w = first.offsetWidth;
          // account for the trailing space/margin between inline words
          const gap = this.words[1] ? this.words[1].offsetLeft - (first.offsetLeft + w) : 0;
          first.remove();
          this.words.shift();
          this.trackX += w + gap;
        } else break;
      }

      // Nothing left on screen → reset so new speech enters from the right.
      if (!this.words.length && !this.partialEl) {
        this.trackX = this.viewport.clientWidth;
      }
      this.apply();
    }
    this.lastTs = ts;
    requestAnimationFrame(this.loop);
  };

  private apply(): void {
    this.track.style.transform = `translateX(${this.trackX}px)`;
  }
}
