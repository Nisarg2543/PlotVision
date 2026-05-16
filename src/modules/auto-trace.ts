import { getState, setState } from '../state/store';
import { getImageBitmap, render, getProcessedImageData } from './canvas-engine';
import { rgbToLab, deltaE, hexToRgb } from '../utils/color';
import { linearPixelToData, linearDataToPixel, uid } from '../utils/math';
import { isLogAxisType, getLogFlags, logPixelToData, logDataToPixel } from './axis-types';
import { pushHistory } from './history';
import { showToast } from '../utils/toast';
import { track } from '../utils/analytics';
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
  roi?: { x1: number; y1: number; x2: number; y2: number } | null,
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

  // Normalise RoI bounds
  const rx1 = roi ? Math.round(Math.min(roi.x1, roi.x2)) : 0;
  const ry1 = roi ? Math.round(Math.min(roi.y1, roi.y2)) : 0;
  const rx2 = roi ? Math.round(Math.max(roi.x1, roi.x2)) : W - 1;
  const ry2 = roi ? Math.round(Math.max(roi.y1, roi.y2)) : H - 1;

  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (roi && (x < rx1 || x > rx2 || y < ry1 || y > ry2)) continue;
      const i = y * W + x;
      const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
      const lab = rgbToLab(r, g, b);
      if (bgLab && deltaE(bgLab, lab) < bgThresh) { mask[i] = 0; continue; }
      mask[i] = deltaE(targetLab, lab) < threshold ? 1 : 0;
    }
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

/** Run the curve trace algorithm off the main thread via Web Worker. */
export function runAutoTraceAsync(
  settings: AutoTraceSettings,
  onResult: (result: { points: DataPoint[]; previewData: Uint8ClampedArray; width: number; height: number } | null) => void
): void {
  const imgPx = getImagePixels();
  if (!imgPx) { showToast('Load an image first', 'warning'); onResult(null); return; }
  const state = getState();
  if (!state.calibration.isComplete || !state.calibration.transform) {
    showToast('Complete calibration before auto-tracing', 'warning'); onResult(null); return;
  }
  const { pixels, W, H } = imgPx;

  // Shallow-copy pixels so we can transfer without affecting the original
  const pixelsCopy = new Uint8ClampedArray(pixels.buffer.slice(0));

  const worker = new Worker(new URL('../workers/detector-worker.ts', import.meta.url), { type: 'module' });

  worker.onmessage = (e) => {
    worker.terminate();
    const { columnYs, preview } = e.data;
    const result = buildPointsFromColumnYs(columnYs, preview, W, H, settings, state);
    onResult(result);
  };
  worker.onerror = (e: ErrorEvent) => {
    console.warn('[detector-worker] crashed:', e.message, e.filename, `line ${e.lineno}`);
    worker.terminate();
    onResult(runAutoTrace(settings));
  };

  worker.postMessage({
    type: 'trace',
    payload: {
      pixels: pixelsCopy, W, H,
      settings: {
        targetColor: settings.targetColor, tolerance: settings.tolerance,
        bgColor: settings.bgColor, bgTolerance: settings.bgTolerance,
        samplingInterval: settings.samplingInterval, smoothing: settings.smoothing,
        roi: state.canvas.roi,
      },
    },
  }, [pixelsCopy.buffer]);
}

function buildPointsFromColumnYs(
  columnYs: (number | null)[],
  preview: Uint8ClampedArray,
  W: number, H: number,
  settings: AutoTraceSettings,
  state: ReturnType<typeof getState>
): { points: DataPoint[]; previewData: Uint8ClampedArray; width: number; height: number } {
  const rawPoints: DataPoint[] = [];
  const transform = state.calibration.transform!;
  const axisType = state.calibration.axisType;
  const useLog = isLogAxisType(axisType);
  const { logX, logY } = useLog ? getLogFlags(axisType) : { logX: false, logY: false };
  for (let x = 0; x < W; x += settings.samplingInterval) {
    const y = columnYs[x];
    if (y === null || y === undefined) continue;
    const { dataX, dataY } = useLog ? logPixelToData(x, y, transform, logX, logY) : linearPixelToData(x, y, transform);
    rawPoints.push({ id: uid(), pixelX: x, pixelY: Math.round(y), dataX, dataY });
  }
  return { points: rawPoints, previewData: preview, width: W, height: H };
}

/** Run the curve trace algorithm — synchronous fallback. */
export function runAutoTrace(settings: AutoTraceSettings): { points: DataPoint[]; previewData: Uint8ClampedArray; width: number; height: number } | null {
  const imgPx = getImagePixels();
  if (!imgPx) { showToast('Load an image first', 'warning'); return null; }

  const state = getState();
  if (!state.calibration.isComplete || !state.calibration.transform) {
    showToast('Complete calibration before auto-tracing', 'warning');
    return null;
  }

  const { pixels, W, H } = imgPx;

  const roi = getState().canvas.roi;
  const mask = buildColorMask(pixels, W, H, settings.targetColor, settings.tolerance, settings.bgColor, settings.bgTolerance, roi);

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

/**
 * X Step with Interpolation — samples at fixed X pixel intervals, applies cubic
 * spline interpolation to fill gaps, and outputs one point per interval.
 */
export function runXStepTrace(
  settings: AutoTraceSettings,
  xStepPx: number
): { points: DataPoint[]; previewData: Uint8ClampedArray; width: number; height: number } | null {
  const imgPx = getImagePixels();
  if (!imgPx) return null;
  const state = getState();
  if (!state.calibration.isComplete || !state.calibration.transform) {
    showToast('Complete calibration first', 'warning'); return null;
  }
  const { pixels, W, H } = imgPx;
  const roi = getState().canvas.roi;
  const mask = buildColorMask(pixels, W, H, settings.targetColor, settings.tolerance, settings.bgColor, settings.bgTolerance, roi);

  // Collect (x, medianY) samples at each xStep interval
  const sampledXs: number[] = [];
  const sampledYs: number[] = [];
  for (let x = 0; x < W; x += Math.max(1, Math.round(xStepPx))) {
    const fgYs: number[] = [];
    for (let y = 0; y < H; y++) { if (mask[y * W + x]) fgYs.push(y); }
    if (fgYs.length > 0) {
      fgYs.sort((a, b) => a - b);
      sampledXs.push(x);
      sampledYs.push(fgYs[Math.floor(fgYs.length / 2)]);
    }
  }

  if (sampledXs.length < 2) { showToast('Not enough points found — try adjusting tolerance', 'warning'); return null; }

  // Cubic spline interpolation
  const splineYs = cubicSplineInterpolate(sampledXs, sampledYs, W);

  const transform = state.calibration.transform!;
  const axisType = state.calibration.axisType;
  const useLog = isLogAxisType(axisType);
  const { logX, logY } = useLog ? getLogFlags(axisType) : { logX: false, logY: false };

  const points: DataPoint[] = [];
  for (let x = 0; x < W; x += Math.max(1, Math.round(xStepPx))) {
    const y = splineYs[x];
    if (y === null || isNaN(y)) continue;
    const { dataX, dataY } = useLog ? logPixelToData(x, y, transform, logX, logY) : linearPixelToData(x, y, transform);
    points.push({ id: uid(), pixelX: x, pixelY: y, dataX, dataY });
  }

  const preview = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    if (mask[i]) { preview[i*4]=37; preview[i*4+1]=99; preview[i*4+2]=235; preview[i*4+3]=140; }
  }
  for (let x = 0; x < W; x++) {
    const y = splineYs[x];
    if (y !== null && !isNaN(y)) {
      const yi = Math.round(y);
      for (let dy = -1; dy <= 1; dy++) {
        const py = yi + dy;
        if (py >= 0 && py < H) {
          const i = py * W + x;
          preview[i*4]=255; preview[i*4+1]=255; preview[i*4+2]=255; preview[i*4+3]=220;
        }
      }
    }
  }
  return { points, previewData: preview, width: W, height: H };
}

/**
 * Custom Independents — user provides comma-separated data X values.
 * At each corresponding pixel X, finds the vertical centroid of foreground pixels.
 */
export function runCustomIndependents(
  settings: AutoTraceSettings,
  xDataValues: number[]
): { points: DataPoint[]; previewData: Uint8ClampedArray; width: number; height: number } | null {
  const imgPx = getImagePixels();
  if (!imgPx) return null;
  const state = getState();
  if (!state.calibration.isComplete || !state.calibration.transform) {
    showToast('Complete calibration first', 'warning'); return null;
  }
  const { pixels, W, H } = imgPx;
  const transform = state.calibration.transform!;
  const axisType = state.calibration.axisType;
  const useLog = isLogAxisType(axisType);
  const { logX, logY } = useLog ? getLogFlags(axisType) : { logX: false, logY: false };

  const roi = state.canvas.roi;
  const mask = buildColorMask(pixels, W, H, settings.targetColor, settings.tolerance, settings.bgColor, settings.bgTolerance, roi);
  const points: DataPoint[] = [];

  for (const xData of xDataValues) {
    let pixX: number;
    if (useLog) {
      const { pixelX } = logDataToPixel(xData, 0, transform, logX, logY);
      pixX = Math.round(pixelX);
    } else {
      const { pixelX } = linearDataToPixel(xData, 0, transform);
      pixX = Math.round(pixelX);
    }
    if (pixX < 0 || pixX >= W) continue;

    // Search ±2 pixel columns
    const fgYs: number[] = [];
    for (let dx = -2; dx <= 2; dx++) {
      const cx = pixX + dx;
      if (cx < 0 || cx >= W) continue;
      for (let y = 0; y < H; y++) { if (mask[y * W + cx]) fgYs.push(y); }
    }
    if (fgYs.length === 0) continue;
    fgYs.sort((a, b) => a - b);
    const yPix = fgYs[Math.floor(fgYs.length / 2)];
    const { dataX, dataY } = useLog ? logPixelToData(pixX, yPix, transform, logX, logY) : linearPixelToData(pixX, yPix, transform);
    points.push({ id: uid(), pixelX: pixX, pixelY: yPix, dataX, dataY });
  }

  const preview = new Uint8ClampedArray(W * H * 4);
  for (const pt of points) {
    for (let dy = -3; dy <= 3; dy++) {
      const py = pt.pixelY + dy;
      if (py >= 0 && py < H) { const i = (py * W + pt.pixelX) * 4; preview[i]=255; preview[i+1]=200; preview[i+2]=0; preview[i+3]=230; }
    }
  }
  return { points, previewData: preview, width: W, height: H };
}

/** Cubic spline interpolation — fills in Y values at every integer X from 0 to maxX */
function cubicSplineInterpolate(xs: number[], ys: number[], maxX: number): (number | null)[] {
  const n = xs.length;
  if (n < 2) return new Array(maxX).fill(null);

  // Natural cubic spline via Thomas algorithm
  const h = xs.slice(1).map((x, i) => x - xs[i]);
  const alpha = ys.slice(1).map((y, i) => i === 0 ? 0 : 3 * ((ys[i+1] - y) / h[i] - (y - ys[i-1]) / h[i-1]));

  const l = new Array(n).fill(1);
  const mu = new Array(n).fill(0);
  const z = new Array(n).fill(0);

  for (let i = 1; i < n - 1; i++) {
    l[i] = 2 * (xs[i+1] - xs[i-1]) - h[i-1] * mu[i-1];
    if (l[i] === 0) continue;
    mu[i] = h[i] / l[i];
    z[i] = (alpha[i] - h[i-1] * z[i-1]) / l[i];
  }

  const c = new Array(n).fill(0);
  const b = new Array(n).fill(0);
  const d = new Array(n).fill(0);

  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j+1];
    b[j] = (ys[j+1] - ys[j]) / h[j] - h[j] * (c[j+1] + 2*c[j]) / 3;
    d[j] = (c[j+1] - c[j]) / (3 * h[j]);
  }

  const result: (number | null)[] = new Array(maxX).fill(null);
  for (let x = 0; x < maxX; x++) {
    // Find enclosing segment, clamping to boundary segments outside the knot range
    let seg = 0;
    if (x >= xs[n - 1]) {
      seg = n - 2; // clamp to last segment for slight extrapolation
    } else {
      for (let i = 0; i < n - 1; i++) { if (x >= xs[i] && x <= xs[i+1]) { seg = i; break; } }
    }
    const dx = x - xs[seg];
    result[x] = ys[seg] + b[seg]*dx + c[seg]*dx*dx + d[seg]*dx*dx*dx;
  }
  return result;
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
  track('auto-trace-committed', { points: points.length });
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
