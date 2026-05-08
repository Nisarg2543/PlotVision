import { getState, setState } from '../state/store';
import { getImageBitmap, render, getProcessedImageData } from './canvas-engine';
import { rgbToLab, deltaE, hexToRgb } from '../utils/color';
import { linearPixelToData, uid } from '../utils/math';
import { isLogAxisType, getLogFlags, logPixelToData } from './axis-types';
import { pushHistory } from './history';
import { showToast } from '../utils/toast';
import type { DataPoint } from '../state/types';

export interface AutoTraceSettings {
  targetColor: string;       // hex
  tolerance: number;         // 0–100, maps to deltaE threshold (~0–50)
  smoothing: 'none' | 'light' | 'heavy';
  samplingInterval: number;  // pixels between output points
  previewOnly: boolean;
  bgColor: string | null;    // optional background color to exclude
  bgTolerance: number;       // 0–100, tolerance for background exclusion
}

// Highlighted pixels drawn on overlay during preview
let previewPixels: Uint8ClampedArray | null = null;
let previewWidth = 0;
let previewHeight = 0;

export const defaultAutoTraceSettings: AutoTraceSettings = {
  targetColor: '#ff0000',
  tolerance: 30,
  smoothing: 'light',
  samplingInterval: 3,
  previewOnly: false,
  bgColor: null,
  bgTolerance: 20,
};

let currentSettings: AutoTraceSettings = { ...defaultAutoTraceSettings };

export function getAutoTraceSettings(): AutoTraceSettings { return currentSettings; }

export function setAutoTraceSettings(s: Partial<AutoTraceSettings>): void {
  currentSettings = { ...currentSettings, ...s };
}

/**
 * Build a binary foreground mask (1=match, 0=background) from image pixel data.
 * Shared utility used by auto-trace, bar-detector, and scatter-detector.
 *
 * @param pixels  Raw RGBA pixel array (from ImageData.data)
 * @param W       Image width
 * @param H       Image height
 * @param targetHex  Target color in hex
 * @param tolerance  0–100, maps to ΔE threshold
 * @param bgHex   Optional background color to exclude (pixels matching bg are forced to 0)
 * @param bgTolerance  0–100 tolerance for bg exclusion
 */
export function buildColorMask(
  pixels: Uint8ClampedArray,
  W: number,
  H: number,
  targetHex: string,
  tolerance: number,
  bgHex: string | null = null,
  bgTolerance = 20,
): Uint8Array {
  const { r: tr, g: tg, b: tb } = hexToRgb(targetHex);
  const targetLab = rgbToLab(tr, tg, tb);
  const threshold = tolerance * 0.5;

  let bgLab: [number, number, number] | null = null;
  let bgThresh = 0;
  if (bgHex) {
    const { r: br, g: bg, b: bb } = hexToRgb(bgHex);
    bgLab = rgbToLab(br, bg, bb);
    bgThresh = bgTolerance * 0.5;
  }

  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
    const lab = rgbToLab(r, g, b);
    if (bgLab && deltaE(bgLab, lab) < bgThresh) { mask[i] = 0; continue; }
    mask[i] = deltaE(targetLab, lab) < threshold ? 1 : 0;
  }
  return mask;
}

/** Get image pixels — uses processed (filtered) data when available, falls back to raw bitmap. */
function getImagePixels(): { pixels: Uint8ClampedArray; W: number; H: number } | null {
  // Prefer processed image (has pixel filters applied)
  const processed = getProcessedImageData();
  if (processed) return { pixels: processed.data, W: processed.width, H: processed.height };

  const bitmap = getImageBitmap();
  if (!bitmap) return null;
  const offscreen = document.createElement('canvas');
  offscreen.width = bitmap.width; offscreen.height = bitmap.height;
  offscreen.getContext('2d')!.drawImage(bitmap, 0, 0);
  const imgData = offscreen.getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height);
  return { pixels: imgData.data, W: bitmap.width, H: bitmap.height };
}

/** Pick color from the processed image at given pixel coords. */
export function pickColorAtPixel(imgX: number, imgY: number): string {
  const processed = getProcessedImageData();
  if (processed) {
    const x = Math.min(Math.max(Math.round(imgX), 0), processed.width - 1);
    const y = Math.min(Math.max(Math.round(imgY), 0), processed.height - 1);
    const i = (y * processed.width + x) * 4;
    const d = processed.data;
    return `#${[d[i], d[i+1], d[i+2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  }
  const bitmap = getImageBitmap();
  if (!bitmap) return '#ff0000';
  const offscreen = document.createElement('canvas');
  offscreen.width = bitmap.width; offscreen.height = bitmap.height;
  const ctx = offscreen.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const px = Math.round(imgX), py = Math.round(imgY);
  const d = ctx.getImageData(px, py, 1, 1).data;
  return `#${[d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Run the curve trace algorithm — returns traced points + preview overlay. */
export function runAutoTrace(settings: AutoTraceSettings): { points: DataPoint[]; previewData: Uint8ClampedArray; width: number; height: number } | null {
  const imgPx = getImagePixels();
  if (!imgPx) { showToast('Load an image first', 'warning'); return null; }

  const state = getState();
  if (!state.calibration.isComplete || !state.calibration.transform) {
    showToast('Complete calibration before auto-tracing', 'warning');
    return null;
  }

  const { pixels, W, H } = imgPx;

  const mask = buildColorMask(pixels, W, H, settings.targetColor, settings.tolerance, settings.bgColor, settings.bgTolerance);

  // For each column, find median Y of foreground pixels
  const columnYs: (number | null)[] = new Array(W).fill(null);
  for (let x = 0; x < W; x++) {
    const fgYs: number[] = [];
    for (let y = 0; y < H; y++) {
      if (mask[y * W + x]) fgYs.push(y);
    }
    if (fgYs.length > 0) {
      fgYs.sort((a, b) => a - b);
      columnYs[x] = fgYs[Math.floor(fgYs.length / 2)];
    }
  }

  const smoothed = smoothCurve(columnYs, settings.smoothing);

  const rawPoints: DataPoint[] = [];
  const transform = state.calibration.transform!;
  const axisType = state.calibration.axisType;
  const useLog = isLogAxisType(axisType);
  const { logX, logY } = useLog ? getLogFlags(axisType) : { logX: false, logY: false };

  for (let x = 0; x < W; x += settings.samplingInterval) {
    const y = smoothed[x];
    if (y === null) continue;
    const { dataX, dataY } = useLog
      ? logPixelToData(x, y, transform, logX, logY)
      : linearPixelToData(x, y, transform);
    rawPoints.push({ id: uid(), pixelX: x, pixelY: y, dataX, dataY });
  }

  // Build preview overlay — foreground pixels in blue, traced center line in white
  const preview = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    if (mask[i]) {
      preview[i * 4] = 37; preview[i * 4 + 1] = 99; preview[i * 4 + 2] = 235; preview[i * 4 + 3] = 160;
    }
  }
  for (let x = 0; x < W; x++) {
    const y = smoothed[x];
    if (y !== null) {
      const yi = Math.round(y);
      for (let dy = -1; dy <= 1; dy++) {
        const py = yi + dy;
        if (py >= 0 && py < H) {
          const i = py * W + x;
          preview[i * 4] = 255; preview[i * 4 + 1] = 255; preview[i * 4 + 2] = 255; preview[i * 4 + 3] = 230;
        }
      }
    }
  }

  return { points: rawPoints, previewData: preview, width: W, height: H };
}

function smoothCurve(ys: (number | null)[], mode: AutoTraceSettings['smoothing']): (number | null)[] {
  if (mode === 'none') return ys;
  const window = mode === 'light' ? 5 : 15;
  const result: (number | null)[] = new Array(ys.length).fill(null);
  for (let x = 0; x < ys.length; x++) {
    const half = Math.floor(window / 2);
    const vals: number[] = [];
    for (let dx = -half; dx <= half; dx++) {
      const nx = x + dx;
      if (nx >= 0 && nx < ys.length && ys[nx] !== null) vals.push(ys[nx]!);
    }
    result[x] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return result;
}

export function commitAutoTrace(points: DataPoint[], datasetId?: string): void {
  const state = getState();
  const targetId = datasetId ?? state.activeDatasetId;
  if (!targetId) { showToast('No active dataset', 'warning'); return; }
  if (points.length === 0) { showToast('No points detected — try adjusting tolerance', 'warning'); return; }

  pushHistory('Auto-trace');
  setState(draft => {
    const ds = draft.datasets.find(d => d.id === targetId);
    if (ds) ds.points = [...ds.points, ...points];
  });
  clearPreview();
  showToast(`Added ${points.length} traced points`, 'success');
}

export function clearPreview(): void {
  previewPixels = null;
  render();
}

export function getPreviewData(): { data: Uint8ClampedArray; width: number; height: number } | null {
  if (!previewPixels) return null;
  return { data: previewPixels, width: previewWidth, height: previewHeight };
}

export function setPreviewData(data: Uint8ClampedArray, width: number, height: number): void {
  previewPixels = data;
  previewWidth = width;
  previewHeight = height;
}
