/**
 * Scale Bar Calibration — two-point line over a physical scale bar.
 * User places two endpoints on the scale bar, enters the real-world value + unit.
 * Provides convertPixelDistance() for real-world measurement reporting.
 */
import { setState } from '../state/store';
import { distance } from '../utils/math';
import { render } from './canvas-engine';
import { showToast } from '../utils/toast';

export type ScaleBarStep = 'idle' | 'place-p1' | 'place-p2' | 'done';

interface ScaleBarState {
  step: ScaleBarStep;
  p1x: number; p1y: number;
  p2x: number; p2y: number;
  realValue: number;
  unit: string;
  pixelsPerUnit: number;
  isSet: boolean;
}

const INITIAL: ScaleBarState = {
  step: 'idle',
  p1x: 0, p1y: 0,
  p2x: 0, p2y: 0,
  realValue: 1,
  unit: '',
  pixelsPerUnit: 0,
  isSet: false,
};

let sbState: ScaleBarState = { ...INITIAL };

export function getScaleBarStep(): ScaleBarStep { return sbState.step; }
export function isScaleBarSet(): boolean { return sbState.isSet; }
export function getScaleBarUnit(): string { return sbState.unit; }
export function getPixelsPerUnit(): number { return sbState.pixelsPerUnit; }

export function startScaleBar(): void {
  sbState = { ...INITIAL, step: 'place-p1' };
  setState(d => { d.activeTool = 'scale-bar'; });
}

export function resetScaleBar(): void {
  sbState = { ...INITIAL };
  setState(d => { d.activeTool = 'pointer'; });
}

export function handleScaleBarClick(imgX: number, imgY: number): void {
  if (sbState.step === 'place-p1') {
    sbState.p1x = imgX; sbState.p1y = imgY;
    sbState.step = 'place-p2';
  } else if (sbState.step === 'place-p2') {
    sbState.p2x = imgX; sbState.p2y = imgY;
    sbState.step = 'done';
  }
  render();
}

export function commitScaleBar(realValue: number, unit: string): void {
  if (sbState.step !== 'done') {
    showToast('Place both scale bar endpoints first', 'warning');
    return;
  }
  const px = distance(sbState.p1x, sbState.p1y, sbState.p2x, sbState.p2y);
  if (px < 1) {
    showToast('Endpoints too close together', 'warning');
    return;
  }
  sbState.realValue = realValue;
  sbState.unit = unit;
  sbState.pixelsPerUnit = px / realValue;
  sbState.isSet = true;
  setState(d => { d.activeTool = 'pointer'; });
  showToast(`Scale set: 1 ${unit} = ${sbState.pixelsPerUnit.toFixed(2)} px`, 'success');
  render();
}

export function convertPixelDistance(pixelDist: number): number {
  if (!sbState.isSet || sbState.pixelsPerUnit === 0) return pixelDist;
  return pixelDist / sbState.pixelsPerUnit;
}

export interface ScaleBarOverlay {
  step: ScaleBarStep;
  p1x: number; p1y: number;
  p2x: number; p2y: number;
  isSet: boolean;
  unit: string;
  pixelsPerUnit: number;
}

export function getScaleBarOverlay(): ScaleBarOverlay | null {
  if (sbState.step === 'idle' && !sbState.isSet) return null;
  return {
    step: sbState.step,
    p1x: sbState.p1x, p1y: sbState.p1y,
    p2x: sbState.p2x, p2y: sbState.p2y,
    isSet: sbState.isSet,
    unit: sbState.unit,
    pixelsPerUnit: sbState.pixelsPerUnit,
  };
}

// Bridge: lets canvas-engine read overlay without importing this module
(window as unknown as Record<string, unknown>).__scaleBarMod = {
  getScaleBarOverlay,
  isScaleBarSet,
  getPixelsPerUnit,
  getScaleBarUnit,
  convertPixelDistance,
};
