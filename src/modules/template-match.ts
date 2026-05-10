/**
 * Template Matching — user selects a rectangular marker from the image;
 * normalized cross-correlation finds all similar instances.
 */
import { getState, setState } from '../state/store';
import { getProcessedImageData, getImageBitmap, render } from './canvas-engine';
import { linearPixelToData, uid } from '../utils/math';
import { isLogAxisType, getLogFlags, logPixelToData } from './axis-types';
import { showToast } from '../utils/toast';
import type { DataPoint } from '../state/types';

export type TemplateStep = 'idle' | 'selecting' | 'done';

interface TemplateState {
  step: TemplateStep;
  x1: number; y1: number;
  x2: number; y2: number;
  templateData: Uint8ClampedArray | null;
  tw: number; th: number;
}

const INIT: TemplateState = { step: 'idle', x1: 0, y1: 0, x2: 0, y2: 0, templateData: null, tw: 0, th: 0 };
let tmState: TemplateState = { ...INIT };

// Drag-in-progress bounds (image coords)
let dragging = false;

export function getTemplateStep(): TemplateStep { return tmState.step; }
export function hasTemplate(): boolean { return tmState.templateData !== null; }
export function getTemplateBounds(): { x1: number; y1: number; x2: number; y2: number } | null {
  if (tmState.step === 'idle' && !tmState.templateData) return null;
  return { x1: tmState.x1, y1: tmState.y1, x2: tmState.x2, y2: tmState.y2 };
}

export function startTemplateSelect(): void {
  setState(d => { d.activeTool = 'template'; });
  tmState = { ...INIT, step: 'selecting' };
  dragging = false;
}

export function handleTemplateDragStart(imgX: number, imgY: number): void {
  dragging = true;
  tmState.x1 = imgX; tmState.y1 = imgY;
  tmState.x2 = imgX; tmState.y2 = imgY;
  render();
}

export function handleTemplateDragMove(imgX: number, imgY: number): void {
  if (!dragging) return;
  tmState.x2 = imgX; tmState.y2 = imgY;
  render();
}

export function handleTemplateDragEnd(imgX: number, imgY: number): void {
  if (!dragging) return;
  dragging = false;
  tmState.x2 = imgX; tmState.y2 = imgY;

  // Capture template pixels from the processed image
  const bitmap = getImageBitmap();
  if (!bitmap) { tmState = { ...INIT }; return; }

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = bitmap.width; srcCanvas.height = bitmap.height;
  srcCanvas.getContext('2d')!.drawImage(bitmap, 0, 0);

  const x1 = Math.round(Math.min(tmState.x1, tmState.x2));
  const y1 = Math.round(Math.min(tmState.y1, tmState.y2));
  const x2 = Math.round(Math.max(tmState.x1, tmState.x2));
  const y2 = Math.round(Math.max(tmState.y1, tmState.y2));
  const tw = x2 - x1, th = y2 - y1;

  if (tw < 3 || th < 3) { tmState = { ...INIT }; showToast('Template too small — drag a larger region', 'warning'); return; }

  const templateData = srcCanvas.getContext('2d')!.getImageData(x1, y1, tw, th).data;
  tmState = { step: 'done', x1, y1, x2, y2, templateData: new Uint8ClampedArray(templateData), tw, th };
  setState(d => { d.activeTool = 'pointer'; });
  showToast(`Template captured (${tw}×${th}px) — click "Find Matches"`, 'success');
  render();
}

export function resetTemplate(): void {
  tmState = { ...INIT };
  setState(d => { d.activeTool = 'pointer'; });
  render();
}

export interface TemplateMatchResult {
  points: DataPoint[];
  previewData: Uint8ClampedArray;
  width: number;
  height: number;
}

export function runTemplateMatch(threshold = 0.7, minSpacing = 10): TemplateMatchResult | null {
  if (!tmState.templateData) { showToast('Select a template first', 'warning'); return null; }

  const state = getState();
  if (!state.calibration.isComplete || !state.calibration.transform) {
    showToast('Complete calibration first', 'warning'); return null;
  }

  const processed = getProcessedImageData();
  const bitmap = getImageBitmap();
  if (!processed && !bitmap) return null;

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = bitmap!.width; srcCanvas.height = bitmap!.height;
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.drawImage(bitmap!, 0, 0);
  const { data: pixels, width: W, height: H } = srcCtx.getImageData(0, 0, bitmap!.width, bitmap!.height);

  const { templateData: tmPx, tw, th } = tmState;

  // Compute template mean (grayscale)
  let tmSum = 0;
  for (let i = 0; i < tw * th; i++) {
    tmSum += tmPx[i*4] * 0.299 + tmPx[i*4+1] * 0.587 + tmPx[i*4+2] * 0.114;
  }
  const tmMean = tmSum / (tw * th);
  let tmStd = 0;
  for (let i = 0; i < tw * th; i++) {
    const g = tmPx[i*4] * 0.299 + tmPx[i*4+1] * 0.587 + tmPx[i*4+2] * 0.114;
    tmStd += (g - tmMean) ** 2;
  }
  tmStd = Math.sqrt(tmStd / (tw * th));

  // NCC sliding window — downsample search step for speed
  const step = Math.max(1, Math.floor(Math.min(tw, th) / 4));
  const corrMap: number[][] = [];

  for (let y = 0; y <= H - th; y += step) {
    for (let x = 0; x <= W - tw; x += step) {
      // Compute NCC at (x, y)
      let sum = 0, imgSum = 0, imgSumSq = 0;
      for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
          const pi = ((y + ty) * W + (x + tx)) * 4;
          const ti = (ty * tw + tx) * 4;
          const ig = pixels[pi] * 0.299 + pixels[pi+1] * 0.587 + pixels[pi+2] * 0.114;
          const tg = tmPx[ti] * 0.299 + tmPx[ti+1] * 0.587 + tmPx[ti+2] * 0.114;
          sum += ig * (tg - tmMean);
          imgSum += ig; imgSumSq += ig * ig;
        }
      }
      const n = tw * th;
      const imgMean = imgSum / n;
      const imgStd = Math.sqrt(imgSumSq / n - imgMean * imgMean);
      const ncc = tmStd > 0 && imgStd > 0 ? (sum / n - imgMean * tmMean) / (imgStd * tmStd) : 0;
      corrMap.push([x + tw / 2, y + th / 2, ncc]);
    }
  }

  // Non-maximum suppression: pick peaks above threshold, min spacing apart
  corrMap.sort((a, b) => b[2] - a[2]);
  const peaks: [number, number][] = [];
  for (const [cx, cy, ncc] of corrMap) {
    if (ncc < threshold) break;
    if (peaks.some(([px, py]) => Math.sqrt((px-cx)**2 + (py-cy)**2) < minSpacing)) continue;
    peaks.push([cx, cy]);
  }

  if (peaks.length === 0) { showToast('No matches found — lower the threshold', 'warning'); return null; }

  const transform = state.calibration.transform!;
  const axisType = state.calibration.axisType;
  const useLog = isLogAxisType(axisType);
  const { logX, logY } = useLog ? getLogFlags(axisType) : { logX: false, logY: false };

  const points: DataPoint[] = peaks.map(([cx, cy]) => {
    const { dataX, dataY } = useLog ? logPixelToData(cx, cy, transform, logX, logY) : linearPixelToData(cx, cy, transform);
    return { id: uid(), pixelX: cx, pixelY: cy, dataX, dataY };
  });

  const preview = new Uint8ClampedArray(W * H * 4);
  for (const [cx, cy] of peaks) {
    for (let dy = -th/2; dy <= th/2; dy++) {
      for (let dx = -tw/2; dx <= tw/2; dx++) {
        const px = Math.round(cx + dx), py = Math.round(cy + dy);
        if (px >= 0 && px < W && py >= 0 && py < H) {
          const i = (py * W + px) * 4;
          preview[i] = 34; preview[i+1] = 211; preview[i+2] = 238; preview[i+3] = 100;
        }
      }
    }
    // Center marker
    for (let r = -3; r <= 3; r++) {
      const hx = Math.round(cx) + r, vy = Math.round(cy) + r;
      if (hx >= 0 && hx < W) { const i = (Math.round(cy)*W+hx)*4; preview[i]=255; preview[i+1]=255; preview[i+2]=0; preview[i+3]=255; }
      if (vy >= 0 && vy < H) { const i = (vy*W+Math.round(cx))*4; preview[i]=255; preview[i+1]=255; preview[i+2]=0; preview[i+3]=255; }
    }
  }

  return { points, previewData: preview, width: W, height: H };
}

export interface TemplateOverlay {
  step: TemplateStep;
  x1: number; y1: number; x2: number; y2: number;
  hasTemplate: boolean;
}

export function getTemplateOverlay(): TemplateOverlay | null {
  if (tmState.step === 'idle' && !tmState.templateData) return null;
  return { step: tmState.step, x1: tmState.x1, y1: tmState.y1, x2: tmState.x2, y2: tmState.y2, hasTemplate: !!tmState.templateData };
}

(window as unknown as Record<string, unknown>).__templateMod = { getTemplateOverlay };
