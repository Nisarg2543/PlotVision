import { getState, setState } from '../state/store';
import { linearPixelToData, linearDataToPixel } from '../utils/math';
import { isLogAxisType, getLogFlags, logPixelToData, logDataToPixel, polarPixelToData, ternaryPixelToData } from './axis-types';
import { uid } from '../utils/math';
import { pushHistory } from './history';
import { showToast } from '../utils/toast';
import type { DataPoint } from '../state/types';

let selectedPointId: string | null = null;

export function handleDigitizerClick(imgX: number, imgY: number): void {
  const state = getState();
  if (!state.calibration.isComplete || !state.calibration.transform) {
    showToast('Complete calibration before adding points', 'warning');
    return;
  }
  if (!state.activeDatasetId) {
    showToast('No active dataset — create one first', 'warning');
    return;
  }

  const { dataX, dataY } = pixelToData(imgX, imgY, state.calibration.transform!, state.calibration.axisType);
  const point: DataPoint = { id: uid(), pixelX: imgX, pixelY: imgY, dataX, dataY };

  pushHistory('Add point');
  setState(draft => {
    const ds = draft.datasets.find(d => d.id === draft.activeDatasetId);
    if (ds) ds.points.push(point);
  });
  selectedPointId = point.id;
}

export function setSelectedPoint(id: string | null): void {
  selectedPointId = id;
}

export function getSelectedPointId(): string | null {
  return selectedPointId;
}

export function deletePoint(datasetId: string, pointId: string): void {
  pushHistory('Delete point');
  setState(draft => {
    const ds = draft.datasets.find(d => d.id === datasetId);
    if (ds) ds.points = ds.points.filter(p => p.id !== pointId);
  });
  if (selectedPointId === pointId) selectedPointId = null;
}

export function nudgePoint(direction: string, deltaPx: number): void {
  if (!selectedPointId) return;
  const state = getState();
  let ds = state.datasets.find(d => d.points.some(p => p.id === selectedPointId));
  let pt = ds?.points.find(p => p.id === selectedPointId);
  if (!pt || !ds) return;

  let dx = 0, dy = 0;
  if (direction === 'ArrowLeft') dx = -deltaPx;
  else if (direction === 'ArrowRight') dx = deltaPx;
  else if (direction === 'ArrowUp') dy = -deltaPx;
  else if (direction === 'ArrowDown') dy = deltaPx;

  const newPx = pt.pixelX + dx;
  const newPy = pt.pixelY + dy;

  pushHistory('Nudge point');
  setState(draft => {
    const dds = draft.datasets.find(d => d.id === ds!.id);
    const ppt = dds?.points.find(p => p.id === selectedPointId);
    if (!ppt) return;
    ppt.pixelX = newPx; ppt.pixelY = newPy;
    if (draft.calibration.transform) {
      const { dataX, dataY } = pixelToData(newPx, newPy, draft.calibration.transform, draft.calibration.axisType);
      ppt.dataX = dataX; ppt.dataY = dataY;
    }
  });
}

function pixelToData(imgX: number, imgY: number, t: import('../state/types').CoordinateTransform, axisType: string) {
  if (axisType === 'polar') {
    const polar = {
      centerPx: t.x1px, centerPy: t.x1py,
      refPx: t.x2px,    refPy: t.x2py,
      rAtRef: t.x1Data,
      angleOffsetDeg: t.y1Data,
      clockwise: t.y2Data > 0,
    };
    const { r, thetaDeg } = polarPixelToData(imgX, imgY, polar);
    return { dataX: r, dataY: thetaDeg };
  }
  if (axisType === 'ternary') {
    const ternary = {
      aPx: t.x1px, aPy: t.x1py,
      bPx: t.x2px, bPy: t.x2py,
      cPx: t.y1px, cPy: t.y1py,
    };
    const { a, b, c } = ternaryPixelToData(imgX, imgY, ternary);
    // dataX = A%, dataY = B%; C% = 100 - A - B
    const scale = t.x1Data || 100;
    return { dataX: parseFloat((a * scale).toFixed(4)), dataY: parseFloat((b * scale).toFixed(4)) };
    void c;
  }
  if (isLogAxisType(axisType)) {
    const { logX, logY } = getLogFlags(axisType);
    return logPixelToData(imgX, imgY, t, logX, logY);
  }
  return linearPixelToData(imgX, imgY, t);
}

export function pushHistoryOnDragEnd(): void {
  if (selectedPointId) pushHistory('Move point');
}

export function deleteSelectedPoints(): void {
  if (!selectedPointId) return;
  const state = getState();
  const ds = state.datasets.find(d => d.points.some(p => p.id === selectedPointId));
  if (ds) deletePoint(ds.id, selectedPointId);
}

export function selectAllPointsInDataset(): void {
  // For simplicity, "select all" selects the last point (full multi-select is future scope)
  const state = getState();
  const ds = state.datasets.find(d => d.id === state.activeDatasetId);
  if (ds && ds.points.length > 0) selectedPointId = ds.points[ds.points.length - 1].id;
}

export function updatePointData(datasetId: string, pointId: string, dataX: number, dataY: number): void {
  const state = getState();
  const ds = state.datasets.find(d => d.id === datasetId);
  const pt = ds?.points.find(p => p.id === pointId);
  if (!pt || !state.calibration.transform) return;

  let pixelX: number, pixelY: number;
  if (isLogAxisType(state.calibration.axisType)) {
    const { logX, logY } = getLogFlags(state.calibration.axisType);
    ({ pixelX, pixelY } = logDataToPixel(dataX, dataY, state.calibration.transform, logX, logY));
  } else {
    ({ pixelX, pixelY } = linearDataToPixel(dataX, dataY, state.calibration.transform));
  }

  pushHistory('Edit point value');
  setState(draft => {
    const dds = draft.datasets.find(d => d.id === datasetId);
    const ppt = dds?.points.find(p => p.id === pointId);
    if (ppt) { ppt.dataX = dataX; ppt.dataY = dataY; ppt.pixelX = pixelX; ppt.pixelY = pixelY; }
  });
}
