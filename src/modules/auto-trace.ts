import { getState, setState } from '../state/store';
import { getImageBitmap, render } from './canvas-engine';
import { rgbToLab, deltaE } from '../utils/color';
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
};

let currentSettings: AutoTraceSettings = { ...defaultAutoTraceSettings };

export function getAutoTraceSettings(): AutoTraceSettings {
  return currentSettings;
}

export function setAutoTraceSettings(s: Partial<AutoTraceSettings>): void {
  currentSettings = { ...currentSettings, ...s };
}

// Pick color from image at given pixel coords
export function pickColorAtPixel(imgX: number, imgY: number): string {
  const bitmap = getImageBitmap();
  if (!bitmap) return '#ff0000';
  const offscreen = document.createElement('canvas');
  offscreen.width = bitmap.width;
  offscreen.height = bitmap.height;
  const ctx = offscreen.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const px = Math.round(imgX), py = Math.round(imgY);
  const d = ctx.getImageData(px, py, 1, 1).data;
  return `#${[d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// Run the trace algorithm — returns traced pixel list
export function runAutoTrace(settings: AutoTraceSettings): { points: DataPoint[]; previewData: Uint8ClampedArray; width: number; height: number } | null {
  const bitmap = getImageBitmap();
  if (!bitmap) { showToast('Load an image first', 'warning'); return null; }

  const state = getState();
  if (!state.calibration.isComplete || !state.calibration.transform) {
    showToast('Complete calibration before auto-tracing', 'warning');
    return null;
  }

  // Rasterize image into pixel array
  const offscreen = document.createElement('canvas');
  offscreen.width = bitmap.width;
  offscreen.height = bitmap.height;
  const ctx = offscreen.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const pixels = imgData.data;
  const W = bitmap.width, H = bitmap.height;

  // Parse target color to LAB
  const hex = settings.targetColor.replace('#', '');
  const tr = parseInt(hex.slice(0, 2), 16);
  const tg = parseInt(hex.slice(2, 4), 16);
  const tb = parseInt(hex.slice(4, 6), 16);
  const targetLab = rgbToLab(tr, tg, tb);

  // deltaE threshold: tolerance 0–100 → ~0–50 deltaE
  const threshold = settings.tolerance * 0.5;

  // Build foreground mask using LAB deltaE
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
    const lab = rgbToLab(r, g, b);
    mask[i] = deltaE(targetLab, lab) < threshold ? 1 : 0;
  }

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

  // Smooth curve
  const smoothed = smoothCurve(columnYs, settings.smoothing);

  // Downsample by sampling interval
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

  // Build preview image data (highlight foreground pixels in cyan)
  const preview = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    if (mask[i]) {
      preview[i * 4] = 34; preview[i * 4 + 1] = 211; preview[i * 4 + 2] = 238; preview[i * 4 + 3] = 180;
    }
  }
  // Highlight traced center line in bright cyan
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

export function commitAutoTrace(points: DataPoint[]): void {
  const state = getState();
  if (!state.activeDatasetId) { showToast('No active dataset', 'warning'); return; }
  if (points.length === 0) { showToast('No points detected — try adjusting tolerance', 'warning'); return; }

  pushHistory('Auto-trace');
  setState(draft => {
    const ds = draft.datasets.find(d => d.id === draft.activeDatasetId);
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
