import { getState, setState } from '../state/store';
import { uid, isTransformValid, distance } from '../utils/math';
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
  'place-x1':            'Click X1 — a known point on the X axis (e.g. leftmost tick)',
  'await-x1-value':      'Enter the X value at X1',
  'place-x2':            'Click X2 — a second known point on the X axis',
  'await-x2-value':      'Enter the X value at X2',
  'place-y1':            'Click Y1 — a known point on the Y axis (e.g. bottom tick)',
  'await-y1-value':      'Enter the Y value at Y1',
  'place-y2':            'Click Y2 — a second known point on the Y axis',
  'await-y2-value':      'Enter the Y value at Y2',
  'complete':            'Calibration complete ✓',
  'polar-place-center':  'Click the polar origin (center of the chart)',
  'polar-place-ref':     'Click a reference point at a known radius',
  'polar-await-r':       'Enter the radius value at the reference point',
  'ternary-place-a':     'Click vertex A (top corner of the ternary triangle)',
  'ternary-place-b':     'Click vertex B (bottom-left corner)',
  'ternary-place-c':     'Click vertex C (bottom-right corner)',
};

// Polar calibration scratch state (pixel coords of center + ref point)
let polarCenterPx = 0, polarCenterPy = 0;
let polarRefPx = 0, polarRefPy = 0;

// Ternary calibration scratch state
let ternaryAPx = 0, ternaryAPy = 0;
let ternaryBPx = 0, ternaryBPy = 0;

// Bar Chart calibration scratch state (2-point Y calibration)
let barY1Px = 0, barY1Py = 0;
let barY2Px = 0, barY2Py = 0;

// Circular Chart Recorder scratch state (8-step wizard)
let circCenterPx = 0, circCenterPy = 0;
let circR1Px = 0, circR1Py = 0, circR1Val = 0;
let circR2Px = 0, circR2Py = 0;
let circT1Px = 0, circT1Py = 0, circT1Val = 0;
let circT2Px = 0, circT2Py = 0;

export function startCalibration(): void {
  const { axisType } = getState().calibration;
  let firstStep: CalibrationStep = 'place-x1';
  if (axisType === 'polar' || axisType === 'log-polar') firstStep = 'polar-place-center';
  if (axisType === 'ternary') firstStep = 'ternary-place-a';
  if (axisType === 'bar-chart') firstStep = 'bar-place-y1';
  if (axisType === 'circular') firstStep = 'circ-place-center';

  setState(draft => {
    draft.calibration.step = firstStep;
    draft.calibration.points = [];
    draft.calibration.isComplete = false;
    draft.calibration.transform = null;
    draft.activeTool = 'calibrate';
  });
}

export function handleCalibClick(imgX: number, imgY: number): void {
  const { step, axisType } = getState().calibration;

  // Polar calibration clicks
  if (step === 'polar-place-center') {
    polarCenterPx = imgX; polarCenterPy = imgY;
    setState(d => { d.calibration.step = 'polar-place-ref'; });
    return;
  }
  if (step === 'polar-place-ref') {
    polarRefPx = imgX; polarRefPy = imgY;
    setState(d => { d.calibration.step = 'polar-await-r'; });
    return;
  }

  // Ternary calibration clicks
  if (step === 'ternary-place-a') {
    ternaryAPx = imgX; ternaryAPy = imgY;
    setState(d => { d.calibration.step = 'ternary-place-b'; });
    return;
  }
  if (step === 'ternary-place-b') {
    ternaryBPx = imgX; ternaryBPy = imgY;
    setState(d => { d.calibration.step = 'ternary-place-c'; });
    return;
  }
  if (step === 'ternary-place-c') {
    // Three vertices placed — build transform immediately (no value input needed)
    const cPx = imgX, cPy = imgY;
    const transform: CoordinateTransform = {
      axisType: 'ternary',
      x1px: ternaryAPx, x1py: ternaryAPy, x1Data: 100,
      x2px: ternaryBPx, x2py: ternaryBPy, x2Data: 100,
      y1px: cPx,        y1py: cPy,         y1Data: 100,
      y2px: 0, y2py: 0, y2Data: 0,
    };
    setState(d => {
      d.calibration.transform = transform;
      d.calibration.isComplete = true;
      d.calibration.step = 'complete';
      d.activeTool = 'pointer';
    });
    showToast('Ternary calibration complete!', 'success');
    return;
  }

  // Bar Chart calibration clicks (2-point Y only)
  if (step === 'bar-place-y1') {
    barY1Px = imgX; barY1Py = imgY;
    setState(d => { d.calibration.step = 'bar-await-y1-value'; });
    return;
  }
  if (step === 'bar-place-y2') {
    barY2Px = imgX; barY2Py = imgY;
    setState(d => { d.calibration.step = 'bar-await-y2-value'; });
    return;
  }

  // Circular Chart Recorder calibration clicks (8-step)
  if (step === 'circ-place-center') { circCenterPx = imgX; circCenterPy = imgY; setState(d => { d.calibration.step = 'circ-place-r1'; }); return; }
  if (step === 'circ-place-r1')     { circR1Px = imgX; circR1Py = imgY;         setState(d => { d.calibration.step = 'circ-await-r1'; }); return; }
  if (step === 'circ-place-r2')     { circR2Px = imgX; circR2Py = imgY;         setState(d => { d.calibration.step = 'circ-await-r2'; }); return; }
  if (step === 'circ-place-t1')     { circT1Px = imgX; circT1Py = imgY;         setState(d => { d.calibration.step = 'circ-await-t1'; }); return; }
  if (step === 'circ-place-t2')     { circT2Px = imgX; circT2Py = imgY;         setState(d => { d.calibration.step = 'circ-await-t2'; }); return; }

  // Standard XY calibration clicks
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
    draft.calibration.step = STEP_ORDER[idx + 1] ?? 'complete';
  });
  void axisType; // suppress unused-var warning
}

export function handleCalibValueConfirm(role: CalibrationPoint['role'], valueStr: string): void {
  const value = parseFloat(valueStr);
  if (isNaN(value) || !isFinite(value)) {
    showToast('Please enter a valid finite number', 'warning');
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

export function handleBarChartValueConfirm(which: 'y1' | 'y2', valueStr: string): void {
  const value = parseFloat(valueStr);
  if (isNaN(value)) { showToast('Enter a valid number', 'warning'); return; }
  if (which === 'y1') {
    setState(d => {
      d.calibration.points = d.calibration.points.filter(p => p.role !== 'y1');
      d.calibration.points.push({ id: uid(), role: 'y1', pixelX: barY1Px, pixelY: barY1Py, dataX: null, dataY: value });
      d.calibration.step = 'bar-place-y2';
    });
  } else {
    // Build a "bar-chart" transform using the Y axis only; X axis mapped to pixel X (category mode)
    const transform: CoordinateTransform = {
      axisType: 'bar-chart',
      x1px: 0, x1py: 0, x1Data: 0,
      x2px: 1, x2py: 0, x2Data: 1,   // X: 1 pixel = 1 category unit (overridden at digitize time)
      y1px: barY1Px, y1py: barY1Py, y1Data: getState().calibration.points.find(p => p.role === 'y1')?.dataY ?? 0,
      y2px: barY2Px, y2py: barY2Py, y2Data: value,
    };
    setState(d => {
      d.calibration.transform = transform;
      d.calibration.isComplete = true;
      d.calibration.step = 'complete';
      d.activeTool = 'pointer';
    });
    showToast('Bar chart calibration complete — click bars to digitize values', 'success');
  }
}

// Circular value confirms — one function per await step
export function handleCircularR1Confirm(val: number): void {
  if (isNaN(val)) { showToast('Enter a valid number', 'warning'); return; }
  circR1Val = val;
  setState(d => { d.calibration.step = 'circ-place-r2'; });
}

export function handleCircularR2Confirm(val: number): void {
  if (isNaN(val)) { showToast('Enter a valid number', 'warning'); return; }
  // Store outer radius value temporarily in a calibration point slot
  setState(d => {
    d.calibration.points = d.calibration.points.filter(p => p.role !== 'x2');
    d.calibration.points.push({ id: uid(), role: 'x2', pixelX: circR2Px, pixelY: circR2Py, dataX: val, dataY: 0 });
    d.calibration.step = 'circ-place-t1';
  });
}

export function handleCircularT1Confirm(val: number): void {
  if (isNaN(val)) { showToast('Enter a valid number', 'warning'); return; }
  circT1Val = val;
  setState(d => { d.calibration.step = 'circ-place-t2'; });
}

export function handleCircularT2Confirm(t2Val: number, clockwise: boolean): void {
  if (isNaN(t2Val)) { showToast('Enter a valid number', 'warning'); return; }
  const outerValPt = getState().calibration.points.find(p => p.role === 'x2');
  const r2Val = outerValPt?.dataX ?? 0;
  const transform: CoordinateTransform = {
    axisType: 'circular',
    x1px: circR1Px, x1py: circR1Py, x1Data: circR1Val,           // inner radius ref + value
    x2px: circR2Px, x2py: circR2Py, x2Data: r2Val,               // outer radius ref + value
    y1px: circT1Px, y1py: circT1Py, y1Data: circT1Val,           // time ref 1 + value
    y2px: circT2Px, y2py: circT2Py, y2Data: t2Val * (clockwise ? -1 : 1), // time ref 2 (neg = CW)
    extra: { centerPx: circCenterPx, centerPy: circCenterPy },
  };
  setState(d => {
    d.calibration.transform = transform;
    d.calibration.isComplete = true;
    d.calibration.step = 'complete';
    d.activeTool = 'pointer';
  });
  showToast('Circular chart calibration complete!', 'success');
}

export function handlePolarRConfirm(rValue: number): void {
  if (isNaN(rValue) || rValue <= 0) {
    showToast('Enter a positive radius value', 'warning');
    return;
  }
  const d = distance(polarCenterPx, polarCenterPy, polarRefPx, polarRefPy);
  if (d < 1) {
    showToast('Center and reference points are too close', 'warning');
    return;
  }
  // angle offset: angle from east (positive X) to the reference point
  const angleOffsetDeg = Math.atan2(
    -(polarRefPy - polarCenterPy), // flip Y (canvas Y-down)
    polarRefPx - polarCenterPx
  ) * (180 / Math.PI);

  const { axisType: currentAxisType } = getState().calibration;
  const transform: CoordinateTransform = {
    axisType: (currentAxisType === 'log-polar' ? 'log-polar' : 'polar') as import('../state/types').AxisType,
    x1px: polarCenterPx, x1py: polarCenterPy, x1Data: rValue,
    x2px: polarRefPx,    x2py: polarRefPy,    x2Data: 0,
    y1px: 0, y1py: 0, y1Data: angleOffsetDeg,
    y2px: 0, y2py: 0, y2Data: 0,   // 0 = CCW; 1 = CW
  };
  setState(d => {
    d.calibration.transform = transform;
    d.calibration.isComplete = true;
    d.calibration.step = 'complete';
    d.activeTool = 'pointer';
  });
  showToast('Polar calibration complete!', 'success');
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
