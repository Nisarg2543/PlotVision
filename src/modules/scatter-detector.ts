/**
 * Scatter plot detection via connected-component labeling.
 * Finds discrete markers (circles, squares, triangles) by color,
 * computes their centroids, and returns one DataPoint per marker.
 */
import { getState } from '../state/store';
import { getProcessedImageData, getImageBitmap } from './canvas-engine';
import { buildColorMask } from './auto-trace';
import { linearPixelToData, uid } from '../utils/math';
import { isLogAxisType, getLogFlags, logPixelToData } from './axis-types';
import type { DataPoint } from '../state/types';

export interface ScatterDetectorSettings {
  targetColor: string;
  tolerance: number;      // 0–100
  minBlobArea: number;    // minimum blob size in pixels² (filters noise)
  maxBlobArea: number;    // maximum blob size in pixels² (filters thick lines)
  minSpacing: number;     // minimum pixel distance between output centroids
  bgColor: string | null;
  bgTolerance: number;
}

export const defaultScatterSettings: ScatterDetectorSettings = {
  targetColor: '#2563eb',
  tolerance: 30,
  minBlobArea: 8,
  maxBlobArea: 600,
  minSpacing: 6,
  bgColor: null,
  bgTolerance: 20,
};

export interface ScatterDetectorResult {
  points: DataPoint[];
  previewData: Uint8ClampedArray;
  width: number;
  height: number;
}

export function detectScatterPoints(settings: ScatterDetectorSettings): ScatterDetectorResult | null {
  const state = getState();
  if (!state.calibration.isComplete || !state.calibration.transform) return null;

  const processed = getProcessedImageData();
  const bitmap = getImageBitmap();
  if (!processed && !bitmap) return null;

  const W = processed?.width  ?? bitmap!.width;
  const H = processed?.height ?? bitmap!.height;

  let pixels: Uint8ClampedArray;
  if (processed) {
    pixels = processed.data;
  } else {
    const offscreen = document.createElement('canvas');
    offscreen.width = W; offscreen.height = H;
    offscreen.getContext('2d')!.drawImage(bitmap!, 0, 0);
    pixels = offscreen.getContext('2d')!.getImageData(0, 0, W, H).data;
  }

  const roi = state.canvas.roi;
  const mask = buildColorMask(pixels, W, H, settings.targetColor, settings.tolerance, settings.bgColor, settings.bgTolerance, roi);

  // Connected-component labeling via BFS flood fill
  const labels = new Int32Array(W * H).fill(-1);
  const blobPixels: number[][] = []; // blobPixels[label] = list of pixel indices

  for (let startIdx = 0; startIdx < W * H; startIdx++) {
    if (!mask[startIdx] || labels[startIdx] !== -1) continue;

    const label = blobPixels.length;
    blobPixels.push([]);
    const queue: number[] = [startIdx];
    labels[startIdx] = label;

    while (queue.length > 0) {
      const idx = queue.pop()!;
      blobPixels[label].push(idx);
      const x = idx % W, y = Math.floor(idx / W);

      // 8-connected neighbours (diagonals included — prevents splitting markers
      // that are connected only corner-to-corner)
      const neighbours = [
        y > 0                       ? idx - W     : -1,
        y < H - 1                   ? idx + W     : -1,
        x > 0                       ? idx - 1     : -1,
        x < W - 1                   ? idx + 1     : -1,
        y > 0     && x > 0          ? idx - W - 1 : -1,
        y > 0     && x < W - 1      ? idx - W + 1 : -1,
        y < H - 1 && x > 0          ? idx + W - 1 : -1,
        y < H - 1 && x < W - 1      ? idx + W + 1 : -1,
      ];
      for (const n of neighbours) {
        if (n >= 0 && mask[n] && labels[n] === -1) {
          labels[n] = label;
          queue.push(n);
        }
      }
    }
  }

  // Filter blobs by area and compute centroids
  const centroids: { cx: number; cy: number }[] = [];
  for (const pxList of blobPixels) {
    const area = pxList.length;
    if (area < settings.minBlobArea || area > settings.maxBlobArea) continue;

    let sumX = 0, sumY = 0;
    for (const idx of pxList) {
      sumX += idx % W;
      sumY += Math.floor(idx / W);
    }
    centroids.push({ cx: sumX / area, cy: sumY / area });
  }

  // Deduplicate: remove centroids too close to an already-accepted one
  const accepted: { cx: number; cy: number }[] = [];
  const minD2 = settings.minSpacing * settings.minSpacing;
  for (const c of centroids) {
    const tooClose = accepted.some(a => {
      const dx = a.cx - c.cx, dy = a.cy - c.cy;
      return dx * dx + dy * dy < minD2;
    });
    if (!tooClose) accepted.push(c);
  }

  // Convert centroids to data coordinates
  const transform = state.calibration.transform!;
  const axisType = state.calibration.axisType;
  const useLog = isLogAxisType(axisType);
  const { logX, logY } = useLog ? getLogFlags(axisType) : { logX: false, logY: false };

  const convert = (px: number, py: number) =>
    useLog ? logPixelToData(px, py, transform, logX, logY) : linearPixelToData(px, py, transform);

  const points: DataPoint[] = accepted.map(({ cx, cy }) => {
    const { dataX, dataY } = convert(cx, cy);
    return { id: uid(), pixelX: cx, pixelY: cy, dataX, dataY };
  });

  // Build preview: highlight all foreground pixels + crosshair at each centroid
  const preview = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    if (mask[i]) {
      preview[i*4]=37; preview[i*4+1]=99; preview[i*4+2]=235; preview[i*4+3]=100;
    }
  }
  // Mark accepted centroids with a bright cross
  for (const { cx, cy } of accepted) {
    const x = Math.round(cx), y = Math.round(cy);
    for (let d = -4; d <= 4; d++) {
      if (x + d >= 0 && x + d < W) {
        const i = y * W + (x + d);
        preview[i*4]=255; preview[i*4+1]=255; preview[i*4+2]=255; preview[i*4+3]=230;
      }
      if (y + d >= 0 && y + d < H) {
        const i = (y + d) * W + x;
        preview[i*4]=255; preview[i*4+1]=255; preview[i*4+2]=255; preview[i*4+3]=230;
      }
    }
  }

  return { points, previewData: preview, width: W, height: H };
}
