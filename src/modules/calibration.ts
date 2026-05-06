import { getState, setState } from '../state/store';
import { uid } from '../utils/math';
import { isTransformValid } from '../utils/math';
import { showToast } from '../utils/toast';
import type { CalibrationPoint, CalibrationStep, CoordinateTransform } from '../state/types';

const STEP_ORDER: CalibrationStep[] = [
  'place-x1', 'await-x1-value',
  'place-x2', 'await-x2-value',
  'place-y1', 'await-y1-value',
  'place-y2', 'await-y2-value',
  'complete',
];

const STEP_PROMPTS: Partial<Record<CalibrationStep, string>> = {
  'place-x1': 'Click a known X reference point (e.g. leftmost X axis tick)',
  'await-x1-value': 'Enter the X value for X1',
  'place-x2': 'Click a second known X reference point (e.g. rightmost X axis tick)',
  'await-x2-value': 'Enter the X value for X2',
  'place-y1': 'Click a known Y reference point (e.g. bottom Y axis tick)',
  'await-y1-value': 'Enter the Y value for Y1',
  'place-y2': 'Click a second known Y reference point (e.g. top Y axis tick)',
  'await-y2-value': 'Enter the Y value for Y2',
  'complete': 'Calibration complete!',
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
    // Remove existing point with same role
    draft.calibration.points = draft.calibration.points.filter(p => p.role !== role);
    draft.calibration.points.push({ id: uid(), role, pixelX: imgX, pixelY: imgY, dataX: null, dataY: null });
    // Advance to await-value step
    const idx = STEP_ORDER.indexOf(step);
    draft.calibration.step = STEP_ORDER[idx + 1]!;
  });
}

export function handleCalibValueConfirm(role: CalibrationPoint['role'], valueStr: string): void {
  const value = parseFloat(valueStr);
  if (isNaN(value)) {
    showToast('Please enter a valid number', 'warning');
    return;
  }

  const awaitStepMap: Record<CalibrationPoint['role'], CalibrationStep> = {
    x1: 'await-x1-value', x2: 'await-x2-value',
    y1: 'await-y1-value', y2: 'await-y2-value',
  };
  const currentAwaitStep = awaitStepMap[role];

  setState(draft => {
    const pt = draft.calibration.points.find(p => p.role === role);
    if (!pt) return;
    if (role === 'x1' || role === 'x2') pt.dataX = value;
    else pt.dataY = value;

    const idx = STEP_ORDER.indexOf(currentAwaitStep);
    const nextStep = STEP_ORDER[idx + 1];
    draft.calibration.step = nextStep ?? 'complete';

    if (nextStep === 'complete' || !nextStep) {
      const transform = buildTransform(draft.calibration.points);
      if (transform && isTransformValid(transform)) {
        draft.calibration.transform = transform;
        draft.calibration.isComplete = true;
        draft.calibration.step = 'complete';
        draft.activeTool = 'pointer';
      } else {
        draft.calibration.step = 'place-x1'; // restart
      }
    }
  });

  const { isComplete } = getState().calibration;
  if (isComplete) showToast('Calibration complete!', 'success');
}

function buildTransform(points: CalibrationPoint[]): CoordinateTransform | null {
  const x1 = points.find(p => p.role === 'x1');
  const x2 = points.find(p => p.role === 'x2');
  const y1 = points.find(p => p.role === 'y1');
  const y2 = points.find(p => p.role === 'y2');

  if (!x1 || !x2 || !y1 || !y2) return null;
  if (x1.dataX === null || x2.dataX === null || y1.dataY === null || y2.dataY === null) return null;

  if (x1.pixelX === x2.pixelX) {
    showToast('X calibration points must differ in horizontal position', 'error'); return null;
  }
  if (y1.pixelY === y2.pixelY) {
    showToast('Y calibration points must differ in vertical position', 'error'); return null;
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
  const { step } = getState().calibration;
  return STEP_PROMPTS[step] ?? '';
}

export function getCalibStepIndex(): number {
  const { step } = getState().calibration;
  const placeSteps: CalibrationStep[] = ['place-x1', 'await-x1-value', 'place-x2', 'await-x2-value',
    'place-y1', 'await-y1-value', 'place-y2', 'await-y2-value'];
  const idx = placeSteps.indexOf(step);
  return idx === -1 ? (step === 'complete' ? 8 : -1) : idx;
}
