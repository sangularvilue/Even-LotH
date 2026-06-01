/**
 * Vosk-browser STT wrapper. Two audio sources:
 *   - Browser mic  → feedAudioBuffer(), recognizer at AudioContext rate.
 *   - Glasses mic  → feedPcm(), Int16 16 kHz PCM from bridge.audioEvent.
 * vosk-browser resamples to the model's 16 kHz internally.
 */

import { createModel } from 'vosk-browser';

const MODEL_URL =
  'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz';
const GLASSES_RATE = 16000;

type Model = Awaited<ReturnType<typeof createModel>>;

export type SttCallbacks = {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onStatus: (text: string) => void;
};

export class VoskStt {
  private model: Model | null = null;
  private recognizer: any = null;
  private bufferFactory: AudioContext | null = null;

  constructor(private cb: SttCallbacks) {}

  /** sampleRate = mic AudioContext rate, or GLASSES_RATE (16000) for bridge PCM. */
  async load(sampleRate: number): Promise<void> {
    this.cb.onStatus('Loading model (~40 MB, first load only)…');
    const t0 = performance.now();
    this.model = await createModel(MODEL_URL);
    this.recognizer = new this.model.KaldiRecognizer(sampleRate);

    this.recognizer.on('result', (msg: any) => {
      const text: string = msg?.result?.text ?? '';
      if (text.trim()) this.cb.onFinal(text);
    });
    this.recognizer.on('partialresult', (msg: any) => {
      this.cb.onPartial(msg?.result?.partial ?? '');
    });

    // createBuffer's rate is independent of the context's own rate, so this
    // context is only a factory for 16 kHz buffers (glasses path) — never started.
    this.bufferFactory = new AudioContext();
    this.cb.onStatus(`Ready (model loaded in ${Math.round(performance.now() - t0)} ms).`);
  }

  /** Browser mic path: feed the ScriptProcessor's AudioBuffer straight through. */
  feedAudioBuffer(buffer: AudioBuffer): void {
    this.recognizer?.acceptWaveform(buffer);
  }

  /** Glasses path: Int16 16 kHz PCM (Uint8Array | number[] | base64). */
  feedPcm(audioPcm: Uint8Array | number[] | string): void {
    this.feedPcmBytes(pcmToBytes(audioPcm));
  }

  /** Glasses path, pre-normalized Int16 16 kHz bytes (caller batches for us). */
  feedPcmBytes(bytes: Uint8Array): void {
    if (!this.recognizer || !this.bufferFactory || bytes.byteLength < 2) return;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = Math.floor(bytes.byteLength / 2);
    const buf = this.bufferFactory.createBuffer(1, n, GLASSES_RATE);
    const channel = buf.getChannelData(0);
    for (let i = 0; i < n; i++) channel[i] = view.getInt16(i * 2, true) / 32768;

    this.recognizer.acceptWaveform(buf);
  }
}

/** audioPcm may arrive as Uint8Array, number[], or base64 string (per SDK note). */
export function pcmToBytes(audioPcm: Uint8Array | number[] | string): Uint8Array {
  if (audioPcm instanceof Uint8Array) return audioPcm;
  if (Array.isArray(audioPcm)) return Uint8Array.from(audioPcm);
  if (typeof audioPcm === 'string') {
    const binary = atob(audioPcm);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(0);
}
