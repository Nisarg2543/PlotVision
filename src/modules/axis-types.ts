/**
 * Extended coordinate transforms for non-linear axis types.
 * XY Linear is in calibration.ts / math.ts.
 * This module adds: log, polar, ternary, date-x.
 */
import type { CoordinateTransform } from '../state/types';

// ── XY Log ────────────────────────────────────────────────────────────────────
// Semi-log or log-log: data values are in log10 space

export function logPixelToData(
  pixelX: number, pixelY: number, t: CoordinateTransform,
  logX = true, logY = true
): { dataX: number; dataY: number } {
  let dataX: number;
  let dataY: number;

  if (logX && t.x1Data > 0 && t.x2Data > 0) {
    const log1 = Math.log10(t.x1Data), log2 = Math.log10(t.x2Data);
    const logVal = log1 + (pixelX - t.x1px) * (log2 - log1) / (t.x2px - t.x1px);
    dataX = Math.pow(10, logVal);
  } else {
    dataX = t.x1Data + (pixelX - t.x1px) * (t.x2Data - t.x1Data) / (t.x2px - t.x1px);
  }

  if (logY && t.y1Data > 0 && t.y2Data > 0) {
    const log1 = Math.log10(t.y1Data), log2 = Math.log10(t.y2Data);
    const logVal = log1 + (pixelY - t.y1py) * (log2 - log1) / (t.y2py - t.y1py);
    dataY = Math.pow(10, logVal);
  } else {
    dataY = t.y1Data + (pixelY - t.y1py) * (t.y2Data - t.y1Data) / (t.y2py - t.y1py);
  }

  return { dataX, dataY };
}

export function logDataToPixel(
  dataX: number, dataY: number, t: CoordinateTransform,
  logX = true, logY = true
): { pixelX: number; pixelY: number } {
  let pixelX: number;
  let pixelY: number;

  if (logX && t.x1Data > 0 && t.x2Data > 0 && dataX > 0) {
    const log1 = Math.log10(t.x1Data), log2 = Math.log10(t.x2Data);
    pixelX = t.x1px + (Math.log10(dataX) - log1) * (t.x2px - t.x1px) / (log2 - log1);
  } else {
    pixelX = t.x1px + (dataX - t.x1Data) * (t.x2px - t.x1px) / (t.x2Data - t.x1Data);
  }

  if (logY && t.y1Data > 0 && t.y2Data > 0 && dataY > 0) {
    const log1 = Math.log10(t.y1Data), log2 = Math.log10(t.y2Data);
    pixelY = t.y1py + (Math.log10(dataY) - log1) * (t.y2py - t.y1py) / (log2 - log1);
  } else {
    pixelY = t.y1py + (dataY - t.y1Data) * (t.y2py - t.y1py) / (t.y2Data - t.y1Data);
  }

  return { pixelX, pixelY };
}

// ── Polar ─────────────────────────────────────────────────────────────────────
// Extra calibration data stored in transform's x1/x2/y1/y2 fields reinterpreted:
// x1px,y1py = center pixel; x2px,y2py = reference radius pixel; x1Data = r at ref; y1Data = angle offset (deg)

export interface PolarTransform {
  centerPx: number; centerPy: number;
  refPx: number;    refPy: number;
  rAtRef: number;           // data value of radius at reference pixel
  angleOffsetDeg: number;   // 0 = right (east)
  clockwise: boolean;
}

export function polarPixelToData(
  pixelX: number, pixelY: number, t: PolarTransform
): { r: number; thetaDeg: number } {
  const dx = pixelX - t.centerPx;
  const dy = -(pixelY - t.centerPy); // flip Y (canvas Y is inverted)
  const refDx = t.refPx - t.centerPx;
  const refDy = -(t.refPy - t.centerPy);
  const refPixelRadius = Math.sqrt(refDx ** 2 + refDy ** 2);
  const pixelRadius = Math.sqrt(dx ** 2 + dy ** 2);
  const r = (pixelRadius / refPixelRadius) * t.rAtRef;

  let theta = Math.atan2(dy, dx) * (180 / Math.PI);
  theta = theta - t.angleOffsetDeg;
  if (t.clockwise) theta = -theta;
  theta = ((theta % 360) + 360) % 360;

  return { r, thetaDeg: theta };
}

// ── Ternary ───────────────────────────────────────────────────────────────────
// Three corner points (A, B, C) in pixel space → barycentric A+B+C=1 coordinates

export interface TernaryTransform {
  aPx: number; aPy: number;
  bPx: number; bPy: number;
  cPx: number; cPy: number;
}

export function ternaryPixelToData(
  pixelX: number, pixelY: number, t: TernaryTransform
): { a: number; b: number; c: number } {
  // Barycentric coordinates
  const denom = (t.bPy - t.cPy) * (t.aPx - t.cPx) + (t.cPx - t.bPx) * (t.aPy - t.cPy);
  const a = ((t.bPy - t.cPy) * (pixelX - t.cPx) + (t.cPx - t.bPx) * (pixelY - t.cPy)) / denom;
  const b = ((t.cPy - t.aPy) * (pixelX - t.cPx) + (t.aPx - t.cPx) * (pixelY - t.cPy)) / denom;
  const c = 1 - a - b;
  return { a: Math.max(0, a), b: Math.max(0, b), c: Math.max(0, c) };
}

// ── Date/Time X ───────────────────────────────────────────────────────────────
// Calibration points have dataX stored as unix timestamp (ms)

export function datePixelToData(
  pixelX: number, t: CoordinateTransform
): { timestamp: number; dateStr: string } {
  const ts = t.x1Data + (pixelX - t.x1px) * (t.x2Data - t.x1Data) / (t.x2px - t.x1px);
  return { timestamp: ts, dateStr: new Date(ts).toISOString() };
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
// Used by calibration/digitizer to call correct transform based on axisType

export type ExtendedAxisType = 'xy-log-x' | 'xy-log-y' | 'xy-log-xy';

export function isLogAxisType(axisType: string): boolean {
  return axisType.startsWith('xy-log');
}

export function getLogFlags(axisType: string): { logX: boolean; logY: boolean } {
  return {
    logX: axisType === 'xy-log-x' || axisType === 'xy-log-xy',
    logY: axisType === 'xy-log-y' || axisType === 'xy-log-xy',
  };
}
