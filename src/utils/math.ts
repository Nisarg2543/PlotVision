import type { CoordinateTransform } from '../state/types';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function canvasToImage(
  canvasX: number, canvasY: number,
  zoom: number, panX: number, panY: number
): { imgX: number; imgY: number } {
  return {
    imgX: (canvasX - panX) / zoom,
    imgY: (canvasY - panY) / zoom,
  };
}

export function imageToCanvas(
  imgX: number, imgY: number,
  zoom: number, panX: number, panY: number
): { canvasX: number; canvasY: number } {
  return {
    canvasX: imgX * zoom + panX,
    canvasY: imgY * zoom + panY,
  };
}

export function linearPixelToData(
  pixelX: number, pixelY: number,
  t: CoordinateTransform
): { dataX: number; dataY: number } {
  const dataX = t.x1Data + (pixelX - t.x1px) * (t.x2Data - t.x1Data) / (t.x2px - t.x1px);
  const dataY = t.y1Data + (pixelY - t.y1py) * (t.y2Data - t.y1Data) / (t.y2py - t.y1py);
  return { dataX, dataY };
}

export function linearDataToPixel(
  dataX: number, dataY: number,
  t: CoordinateTransform
): { pixelX: number; pixelY: number } {
  const pixelX = t.x1px + (dataX - t.x1Data) * (t.x2px - t.x1px) / (t.x2Data - t.x1Data);
  const pixelY = t.y1py + (dataY - t.y1Data) * (t.y2py - t.y1py) / (t.y2Data - t.y1Data);
  return { pixelX, pixelY };
}

export function isTransformValid(t: CoordinateTransform): boolean {
  return t.x1px !== t.x2px && t.y1py !== t.y2py &&
    t.x1Data !== t.x2Data && t.y1Data !== t.y2Data;
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

export function niceGridInterval(range: number, targetLines: number): number {
  const rough = range / targetLines;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / mag;
  let nice: number;
  if (normalized < 1.5) nice = 1;
  else if (normalized < 3.5) nice = 2;
  else if (normalized < 7.5) nice = 5;
  else nice = 10;
  return nice * mag;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
