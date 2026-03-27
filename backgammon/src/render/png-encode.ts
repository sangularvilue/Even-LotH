/**
 * Encode 1-bit monochrome pixels to PNG via canvas.
 * Adapted from chess app (simplified — single-slot).
 */

const REUSED_CANVAS_COUNT = 4;
const reusedCanvases: (HTMLCanvasElement | null)[] = new Array(REUSED_CANVAS_COUNT).fill(null);
const reusedImageData: (ImageData | null)[] = new Array(REUSED_CANVAS_COUNT).fill(null);
const reusedImageDataDims: { w: number; h: number }[] = new Array(REUSED_CANVAS_COUNT).fill(null).map(() => ({ w: 0, h: 0 }));
const EMPTY_PNG_BYTES = new Uint8Array(0);

function getCanvasSlot(slot: number, width: number, height: number): { canvas: HTMLCanvasElement; imageData: ImageData; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const s = slot % REUSED_CANVAS_COUNT;
  let canvas = reusedCanvases[s];
  if (!canvas) {
    canvas = document.createElement('canvas');
    reusedCanvases[s] = canvas;
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const dims = reusedImageDataDims[s];
  let imageData = reusedImageData[s];
  if (!imageData || !dims || dims.w !== width || dims.h !== height) {
    imageData = ctx.createImageData(width, height);
    reusedImageData[s] = imageData;
    reusedImageDataDims[s] = { w: width, h: height };
  }
  return { canvas, imageData, ctx };
}

function canvasToBlobPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return await blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsArrayBuffer(blob);
  });
}

/** 1-bit pixels (0 or 1), row-major, width*height. Returns PNG file bytes. */
export function encodePixelsToPng(
  pixels: Uint8Array,
  width: number,
  height: number,
  slot: number = 0,
): Promise<Uint8Array> {
  const slotCtx = getCanvasSlot(slot, width, height);
  if (!slotCtx) return Promise.resolve(EMPTY_PNG_BYTES);
  const { canvas, imageData, ctx } = slotCtx;
  for (let i = 0; i < width * height; i++) {
    const v = pixels[i] ? 255 : 0;
    imageData.data[i * 4] = v;
    imageData.data[i * 4 + 1] = v;
    imageData.data[i * 4 + 2] = v;
    imageData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return (async () => {
    const blob = await canvasToBlobPng(canvas);
    if (!blob) return EMPTY_PNG_BYTES;
    return new Uint8Array(await blobToArrayBuffer(blob));
  })();
}
