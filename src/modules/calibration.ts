import { getState, setState } from '../state/store';
import { uid, isTransformValid } from '../utils/math';
import { isLogAxisType, getLogFlags } from './axis-types';
import { showToast } from '../utils/toast';
import type { CalibrationPoint, CalibrationStep, CoordinateTransform } from '../state/types';

// 'complete' is intentionally the terminal sentinel, not a place/await step
const STEP_ORDER: CalibrationStep[] = [
  'place-x1', 'await-x1-value',
  'place-x2', 'await-x2-value',
  'place-y1', 'await-y1-value',
  'place-y2', 'await-y2-value',
];

const STEP_PROMPTS: Partial<Record<CalibrationStep, string>> = {
  'place-x1':      'Click X1 — a known point on the X axis (e.g. leftmost tick)',
  'await-x1-value':'Enter the X value at X1',
  'place-x2':      'Click X2 — a second known point on the X axis',
  'await-x2-value':'Enter the X value at X2',
  'place-y1':      'Click Y1 — a known point on the Y axis (e.g. bottom tick)',
  'await-y1-value':'Enter the Y value at Y1',
  'place-y2':      'Click Y2 — a second known point on the Y axis',
  'await-y2-value':'Enter the Y value at Y2',
  'complete':      'Calibration complete ✓',
};

export function startCalibration(): void {
  setState(draft => {
    draft.calibration.step = 'place-x1';
    draft.calibration.points = [];
    draft.calibration.isComplete = false;
    draft.calibration.transform = null;
    draft.activeTool = 'calibrate';
  });
}

export function handleCalibClick(imgX: number, imgY: number): void {
  const { step } = getState().calibration;
  const placeSteps: CalibrationStep[] = ['place-x1', 'place-x2', 'place-y1', 'place-y2'];
  if (!placeSteps.includes(step)) return;

  const roleMap: Partial<Record<CalibrationStep, CalibrationPoint['role']>> = {
    'place-x1': 'x1', 'place-x2': 'x2', 'place-y1': 'y1', 'place-y2': 'y2',
  };
  const role = roleMap[step]!;

  setState(draft => {
    draft.calibration.points = draft.calibration.points.filter(p => p.role !== role);
    draft.calibration.points.push({ id: uid(), role, pixelX: imgX, pixelY: imgY, dataX: null, dataY: null });
    const idx = STEP_ORDER.indexOf(step);
    // Advance to the next step (always an await-value step)
    draft.calibration.step = STEP_ORDER[idx + 1] ?? 'complete';
  });
}

export function handleCalibValueConfirm(role: CalibrationPoint['role'], valueStr: string): void {
  const value = parseFloat(valueStr);
  if (isNaN(value)) {
    showToast('Please enter a valid number', 'warning');
    return;
  }

  // Warn if log axis requires positive values
  const { axisType } = getState().calibration;
  if (isLogAxisType(axisType)) {
    const { logX, logY } = getLogFlags(axisType);
    const isXRole = role === 'x1' || role === 'x2';
    const isYRole = role === 'y1' || role === 'y2';
    if ((isXRole && logX && value <= 0) || (isYRole && logY && value <= 0)) {
      showToast('Log-scale calibration values must be positive (> 0)', 'error');
      return;
    }
  }

  const awaitStepMap: Record<CalibrationPoint['role'], CalibrationStep> = {
    x1: 'await-x1-value', x2: 'await-x2-value',
    y1: 'await-y1-value', y2: 'await-y2-value',
  };
  const currentAwaitStep = awaitStepMap[role];
  const idx = STEP_ORDER.indexOf(currentAwaitStep);
  const isLastStep = idx === STEP_ORDER.length - 1;

  setState(draft => {
    const pt = draft.calibration.points.find(p => p.role === role);
    if (!pt) return;
    if (role === 'x1' || role === 'x2') pt.dataX = value;
    else pt.dataY = value;

    if (isLastStep) {
      // All 4 points confirmed — try to build transform
      const transform = buildTransform(draft.calibration.points);
      if (transform && isTransformValid(transform)) {
        draft.calibration.transform = transform;
        draft.calibration.isComplete = true;
        draft.calibration.step = 'complete';
        draft.activeTool = 'pointer';
      } else {
        // Invalid calibration — restart wizard
        draft.calibration.step = 'place-x1';
        draft.calibration.points = [];
      }
    } else {
      // Move to the next place step
      draft.calibration.step = STEP_ORDER[idx + 1] ?? 'complete';
    }
  });

  if (getState().calibration.isComplete) {
    showToast('Calibration complete!', 'success');
  }
}

function buildTransform(points: CalibrationPoint[]): CoordinateTransform | null {
  const x1 = points.find(p => p.role === 'x1');
  const x2 = points.find(p => p.role === 'x2');
  const y1 = points.find(p => p.role === 'y1');
  const y2 = points.find(p => p.role === 'y2');

  if (!x1 || !x2 || !y1 || !y2) return null;
  if (x1.dataX === null || x2.dataX === null || y1.dataY === null || y2.dataY === null) return null;

  if (x1.pixelX === x2.pixelX) {
    showToast('X1 and X2 must differ horizontally', 'error'); return null;
  }
  if (y1.pixelY === y2.pixelY) {
    showToast('Y1 and Y2 must differ vertically', 'error'); return null;
  }
  if (x1.dataX === x2.dataX) {
    showToast('X1 and X2 values must be different', 'error'); return null;
  }
  if (y1.dataY === y2.dataY) {
    showToast('Y1 and Y2 values must be different', 'error'); return null;
  }

  return {
    axisType: 'xy-linear',
    x1px: x1.pixelX, x1py: x1.pixelY, x1Data: x1.dataX,
    x2px: x2.pixelX, x2py: x2.pixelY, x2Data: x2.dataX,
    y1px: y1.pixelX, y1py: y1.pixelY, y1Data: y1.dataY,
    y2px: y2.pixelX, y2py: y2.pixelY, y2Data: y2.dataY,
  };
}

export function handleCalibDrag(id: string, imgX: number, imgY: number): void {
  setState(draft => {
    const pt = draft.calibration.points.find(p => p.id === id);
    if (!pt) return;
    pt.pixelX = imgX; pt.pixelY = imgY;
    if (draft.calibration.isComplete) {
      const t = buildTransform(draft.calibration.points);
      if (t && isTransformValid(t)) draft.calibration.transform = t;
    }
  });
}

export function resetCalibration(): void {
  setState(draft => {
    draft.calibration.step = 'idle';
    draft.calibration.points = [];
    draft.calibration.isComplete = false;
    draft.calibration.transform = null;
    draft.calibration.showGrid = false;
    draft.activeTool = 'pointer';
  });
  showToast('Calibration reset', 'info');
}

export function getWizardPrompt(): string {
  return STEP_PROMPTS[getState().calibration.step] ?? '';
}

export function getCalibStepIndex(): number {
  const { step } = getState().calibration;
  if (step === 'complete') return STEP_ORDER.length;
  const idx = STEP_ORDER.indexOf(step);
  return idx === -1 ? 0 : idx;
}
