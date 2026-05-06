import { getState } from '../state/store';
import { linearPixelToData, distance } from '../utils/math';
import { render } from './canvas-engine';

export type MeasureMode = 'distance' | 'angle' | 'area';

export interface MeasurePoint { pixelX: number; pixelY: number; dataX: number; dataY: number; }

let measureMode: MeasureMode = 'distance';
let measurePoints: MeasurePoint[] = [];
let active = false;

export function getMeasureMode(): MeasureMode { return measureMode; }
export function setMeasureMode(m: MeasureMode): void { measureMode = m; reset(); }
export function getMeasurePoints(): MeasurePoint[] { return measurePoints; }
export function isMeasureActive(): boolean { return active; }

export function startMeasure(): void {
  active = true;
  measurePoints = [];
}

export function reset(): void {
  measurePoints = [];
  active = true;
  render();
}

export function handleMeasureClick(imgX: number, imgY: number): void {
  const state = getState();
  const transform = state.calibration.transform;

  const pt: MeasurePoint = {
    pixelX: imgX, pixelY: imgY,
    dataX: transform ? linearPixelToData(imgX, imgY, transform).dataX : imgX,
    dataY: transform ? linearPixelToData(imgX, imgY, transform).dataY : imgY,
  };

  const maxPoints = measureMode === 'distance' ? 2 : measureMode === 'angle' ? 3 : Infinity;

  if (measurePoints.length >= maxPoints) {
    measurePoints = [pt]; // restart
  } else {
    measurePoints.push(pt);
  }
  render();
}

export function getMeasureResult(): string {
  const pts = measurePoints;
  if (pts.length < 2) return '';
  const state = getState();
  const hasCalib = state.calibration.isComplete;

  if (measureMode === 'distance' && pts.length === 2) {
    const dx = pts[1].dataX - pts[0].dataX;
    const dy = pts[1].dataY - pts[0].dataY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (hasCalib) return `Distance: ${d.toPrecision(5)} (data units)`;
    const px = distance(pts[0].pixelX, pts[0].pixelY, pts[1].pixelX, pts[1].pixelY);
    return `Distance: ${px.toFixed(1)} px`;
  }

  if (measureMode === 'angle' && pts.length === 3) {
    const ax = pts[0].dataX - pts[1].dataX, ay = pts[0].dataY - pts[1].dataY;
    const bx = pts[2].dataX - pts[1].dataX, by = pts[2].dataY - pts[1].dataY;
    const dot = ax * bx + ay * by;
    const mag = Math.sqrt(ax * ax + ay * ay) * Math.sqrt(bx * bx + by * by);
    const angle = Math.acos(Math.min(1, Math.max(-1, dot / mag))) * (180 / Math.PI);
    return `Angle: ${angle.toFixed(2)}°`;
  }

  if (measureMode === 'area' && pts.length >= 3) {
    // Shoelace formula
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].dataX * pts[j].dataY;
      area -= pts[j].dataX * pts[i].dataY;
    }
    area = Math.abs(area) / 2;
    return `Area: ${area.toPrecision(5)} (sq data units) — ${pts.length} vertices`;
  }

  return '';
}

// Called by canvas-engine during renderFrame to draw measure overlays
export function drawMeasureOverlay(
  ctx: CanvasRenderingContext2D,
  zoom: number, panX: number, panY: number,
  imageToCanvasFn: (x: number, y: number, z: number, px: number, py: number) => { canvasX: number; canvasY: number }
): void {
  if (!active || measurePoints.length === 0) return;

  const canvasPts = measurePoints.map(p => imageToCanvasFn(p.pixelX, p.pixelY, zoom, panX, panY));

  ctx.strokeStyle = '#f59e0b';
  ctx.fillStyle = '#f59e0b';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);

  // Draw lines between points
  ctx.beginPath();
  ctx.moveTo(canvasPts[0].canvasX, canvasPts[0].canvasY);
  for (let i = 1; i < canvasPts.length; i++) {
    ctx.lineTo(canvasPts[i].canvasX, canvasPts[i].canvasY);
  }
  if (measureMode === 'area' && canvasPts.length >= 3) {
    ctx.closePath();
    ctx.fillStyle = 'rgba(245,158,11,0.12)';
    ctx.fill();
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw point markers
  for (const cp of canvasPts) {
    ctx.beginPath();
    ctx.arc(cp.canvasX, cp.canvasY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#f59e0b';
    ctx.fill();
  }

  // Draw result label near last point
  const result = getMeasureResult();
  if (result && canvasPts.length > 0) {
    const last = canvasPts[canvasPts.length - 1];
    ctx.font = '12px Geist, system-ui';
    const tw = ctx.measureText(result).width;
    ctx.fillStyle = '#161616';
    ctx.fillRect(last.canvasX + 10, last.canvasY - 18, tw + 8, 20);
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.strokeRect(last.canvasX + 10, last.canvasY - 18, tw + 8, 20);
    ctx.fillStyle = '#f59e0b';
    ctx.fillText(result, last.canvasX + 14, last.canvasY - 3);
  }
}
