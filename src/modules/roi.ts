/**
 * Region of Interest (RoI) — user draws a bounding box on the canvas to
 * constrain all extraction algorithms to a sub-region of the image.
 */
import { getState, setState } from '../state/store';
import { render } from './canvas-engine';
import type { Roi } from '../state/types';

export function getRoi(): Roi | null {
  return getState().canvas.roi;
}

export function setRoi(roi: Roi | null): void {
  setState(d => { d.canvas.roi = roi; });
  render();
}

export function clearRoi(): void {
  setState(d => { d.canvas.roi = null; d.activeTool = 'pointer'; });
  render();
}

/** Returns true if pixel (px, py) is inside the current RoI (or if no RoI is set). */
export function isInRoi(px: number, py: number): boolean {
  const roi = getState().canvas.roi;
  if (!roi) return true;
  const x1 = Math.min(roi.x1, roi.x2), x2 = Math.max(roi.x1, roi.x2);
  const y1 = Math.min(roi.y1, roi.y2), y2 = Math.max(roi.y1, roi.y2);
  return px >= x1 && px <= x2 && py >= y1 && py <= y2;
}

/** Normalised RoI bounds in image pixel space. */
export function getRoiBounds(): { x1: number; y1: number; x2: number; y2: number } | null {
  const roi = getState().canvas.roi;
  if (!roi) return null;
  return {
    x1: Math.round(Math.min(roi.x1, roi.x2)),
    y1: Math.round(Math.min(roi.y1, roi.y2)),
    x2: Math.round(Math.max(roi.x1, roi.x2)),
    y2: Math.round(Math.max(roi.y1, roi.y2)),
  };
}
