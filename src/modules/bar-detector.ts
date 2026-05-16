/**
 * Bar chart detection.
 * Finds vertical or horizontal bars matching a target color and returns one
 * DataPoint per bar (X center, top/left edge in data coordinates).
 */
import { getState } from '../state/store';
import { getProcessedImageData, getImageBitmap } from './canvas-engine';
import { buildColorMask } from './auto-trace';
import { linearPixelToData } from '../utils/math';
import { isLogAxisType, getLogFlags, logPixelToData } from './axis-types';
import { uid } from '../utils/math';
import type { DataPoint } from '../state/types';

export interface BarDetectorSettings {
  targetColor: string;
  tolerance: number;        // 0–100
  direction: 'vertical' | 'horizontal';
  minBarWidth: number;      // minimum bar width in pixels (avoids noise)
  bgColor: string | null;
  bgTolerance: number;
}

export const defaultBarSettings: BarDetectorSettings = {
  targetColor: '#2563eb',
  tolerance: 30,
  direction: 'vertical',
  minBarWidth: 5,
  bgColor: null,
  bgTolerance: 20,
};

export interface BarDetectorResult {
  points: DataPoint[];
  previewData: Uint8ClampedArray;
  width: number;
  height: number;
}

export function detectBars(settings: BarDetectorSettings): BarDetectorResult | null {
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

  const transform = state.calibration.transform!;
  const axisType = state.calibration.axisType;
  const useLog = isLogAxisType(axisType);
  const { logX, logY } = useLog ? getLogFlags(axisType) : { logX: false, logY: false };

  const convert = (px: number, py: number) =>
    useLog ? logPixelToData(px, py, transform, logX, logY) : linearPixelToData(px, py, transform);

  const points: DataPoint[] = [];
  const preview = new Uint8ClampedArray(W * H * 4);

  if (settings.direction === 'vertical') {
    // For each column: find topmost foreground pixel and whether column has any foreground
    const colHasFg = new Uint8Array(W);
    const colTop   = new Int32Array(W).fill(-1);
    const colBot   = new Int32Array(W).fill(-1);

    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (mask[y * W + x]) {
          colHasFg[x] = 1;
          if (colTop[x] === -1) colTop[x] = y;
          colBot[x] = y;
        }
      }
    }

    // Group contiguous foreground columns into bars
    let barStart = -1;
    const flush = (barEnd: number) => {
      const width = barEnd - barStart;
      if (width < settings.minBarWidth) return;
      const xCenter = Math.round((barStart + barEnd) / 2);
      // Median top edge across bar's columns
      const tops: number[] = [];
      const bots: number[] = [];
      for (let x = barStart; x < barEnd; x++) {
        if (colTop[x] !== -1) { tops.push(colTop[x]); bots.push(colBot[x]); }
      }
      if (tops.length === 0) return;
      tops.sort((a, b) => a - b);
      bots.sort((a, b) => a - b);
      const topY = tops[Math.floor(tops.length / 2)];
      const botY = bots[Math.floor(bots.length / 2)];

      const { dataX, dataY } = convert(xCenter, topY);
      const { dataY: dataYBot } = convert(xCenter, botY);
      points.push({ id: uid(), pixelX: xCenter, pixelY: topY, dataX, dataY,
        label: `h=${(dataY - dataYBot).toFixed(3)}` });

      // Highlight bar in preview
      for (let x = barStart; x < barEnd; x++) {
        for (let y = topY; y <= botY; y++) {
          const i = y * W + x;
          preview[i*4]=37; preview[i*4+1]=99; preview[i*4+2]=235; preview[i*4+3]=120;
        }
        // Top edge highlight
        if (colTop[x] !== -1) {
          const i = colTop[x] * W + x;
          preview[i*4]=255; preview[i*4+1]=255; preview[i*4+2]=255; preview[i*4+3]=230;
        }
      }
    };

    for (let x = 0; x <= W; x++) {
      if (x < W && colHasFg[x]) {
        if (barStart === -1) barStart = x;
      } else {
        if (barStart !== -1) { flush(x); barStart = -1; }
      }
    }

  } else {
    // Horizontal bars: scan row by row
    const rowHasFg  = new Uint8Array(H);
    const rowLeft   = new Int32Array(H).fill(-1);
    const rowRight  = new Int32Array(H).fill(-1);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (mask[y * W + x]) {
          rowHasFg[y] = 1;
          if (rowLeft[y] === -1) rowLeft[y] = x;
          rowRight[y] = x;
        }
      }
    }

    let barStart = -1;
    const flush = (barEnd: number) => {
      const height = barEnd - barStart;
      // For horizontal bars the "bar width" is the row-span (height in pixels)
      if (height < settings.minBarWidth) return;
      const yCenter = Math.round((barStart + barEnd) / 2);
      const rights: number[] = [];
      const lefts: number[] = [];
      for (let y = barStart; y < barEnd; y++) {
        if (rowRight[y] !== -1) { rights.push(rowRight[y]); lefts.push(rowLeft[y]); }
      }
      if (rights.length === 0) return;
      rights.sort((a, b) => a - b);
      lefts.sort((a, b) => a - b);
      const rightX = rights[Math.floor(rights.length / 2)];
      const leftX  = lefts[Math.floor(lefts.length / 2)];

      const { dataX, dataY } = convert(rightX, yCenter);
      points.push({ id: uid(), pixelX: rightX, pixelY: yCenter, dataX, dataY });

      for (let y = barStart; y < barEnd; y++) {
        for (let x = leftX; x <= rightX; x++) {
          const i = y * W + x;
          preview[i*4]=37; preview[i*4+1]=99; preview[i*4+2]=235; preview[i*4+3]=120;
        }
        if (rowRight[y] !== -1) {
          const i = y * W + rowRight[y];
          preview[i*4]=255; preview[i*4+1]=255; preview[i*4+2]=255; preview[i*4+3]=230;
        }
      }
    };

    for (let y = 0; y <= H; y++) {
      if (y < H && rowHasFg[y]) {
        if (barStart === -1) barStart = y;
      } else {
        if (barStart !== -1) { flush(y); barStart = -1; }
      }
    }
  }

  return { points, previewData: preview, width: W, height: H };
}

/**
 * Detect all bar layers in a stacked/grouped bar chart.
 * Samples N most-distinct colors from the image, runs bar detection per color,
 * and returns only colors that produced at least minBarsPerLayer bars.
 */
export interface BarLayer {
  color: string;
  result: BarDetectorResult;
}

export function detectAllBarLayers(
  direction: 'vertical' | 'horizontal' = 'vertical',
  tolerance = 28,
  minBarsPerLayer = 2
): BarLayer[] {
  const bitmap = getImageBitmap();
  if (!bitmap) return [];

  const offscreen = document.createElement('canvas');
  const maxSide = 300;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  offscreen.width = Math.round(bitmap.width * scale);
  offscreen.height = Math.round(bitmap.height * scale);
  const offCtx = offscreen.getContext('2d')!;
  offCtx.drawImage(bitmap, 0, 0, offscreen.width, offscreen.height);
  const { data: px, width: W, height: H } = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);

  // Sample colors from a grid, skip near-white / near-black / near-gray backgrounds
  const colorCounts = new Map<string, number>();
  const step = 5;
  for (let y = step; y < H - step; y += step) {
    for (let x = step; x < W - step; x += step) {
      const i = (y * W + x) * 4;
      const r = px[i], g = px[i+1], b = px[i+2];
      // Skip near-achromatic colors (low saturation)
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const saturation = max > 0 ? (max - min) / max : 0;
      if (saturation < 0.2 || max > 240 || max < 20) continue;
      // Quantize to 32-step buckets for clustering
      const qr = Math.round(r / 32) * 32;
      const qg = Math.round(g / 32) * 32;
      const qb = Math.round(b / 32) * 32;
      const key = `#${qr.toString(16).padStart(2,'0')}${qg.toString(16).padStart(2,'0')}${qb.toString(16).padStart(2,'0')}`;
      colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1);
    }
  }

  // Take top 8 most-common saturated colors
  const candidateColors = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([c]) => c);

  const layers: BarLayer[] = [];
  for (const color of candidateColors) {
    const settings: BarDetectorSettings = {
      targetColor: color,
      tolerance,
      direction,
      minBarWidth: 4,
      bgColor: null,
      bgTolerance: 20,
    };
    const result = detectBars(settings);
    if (result && result.points.length >= minBarsPerLayer) {
      layers.push({ color, result });
    }
  }

  return layers;
}
