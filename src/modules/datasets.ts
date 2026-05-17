import { getState, setState } from '../state/store';
import { pushHistory } from './history';
import { showToast } from '../utils/toast';
import { showConfirm } from '../utils/confirm';
import { uid } from '../utils/math';
import type { Dataset, CurveFit } from '../state/types';

// Perceptually distinct colors visible on both light and dark backgrounds
const PALETTE = [
  '#2563eb', '#d97706', '#16a34a', '#dc2626',
  '#7c3aed', '#0891b2', '#db2777', '#65a30d',
];

let paletteIndex = 0;

export function addDataset(name?: string, color?: string): string {
  const id = uid();
  const datasetColor = color ?? PALETTE[paletteIndex % PALETTE.length];
  paletteIndex++;
  const count = getState().datasets.length + 1;
  const dataset: Dataset = {
    id,
    name: name ?? `Dataset ${count}`,
    color: datasetColor,
    visible: true,
    points: [],
  };
  setState(draft => {
    draft.datasets.push(dataset);
    draft.activeDatasetId = id;
  });
  return id;
}

export async function removeDataset(id: string): Promise<void> {
  const state = getState();
  const ds = state.datasets.find(d => d.id === id);
  if (!ds) return;

  const ok = await showConfirm(`Delete dataset "${ds.name}"? This will remove all its points.`, 'Delete', true);
  if (!ok) return;

  pushHistory('Delete dataset');
  setState(draft => {
    draft.datasets = draft.datasets.filter(d => d.id !== id);
    if (draft.activeDatasetId === id) {
      draft.activeDatasetId = draft.datasets[0]?.id ?? null;
    }
  });
  showToast(`Deleted "${ds.name}"`, 'info');
}

export function setActiveDataset(id: string): void {
  setState(draft => { draft.activeDatasetId = id; });
}

export function toggleDatasetVisibility(id: string): void {
  setState(draft => {
    const ds = draft.datasets.find(d => d.id === id);
    if (ds) ds.visible = !ds.visible;
  });
}

export function renameDataset(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  setState(draft => {
    const ds = draft.datasets.find(d => d.id === id);
    if (ds) ds.name = trimmed;
  });
}

export function setDatasetColor(id: string, color: string): void {
  setState(draft => {
    const ds = draft.datasets.find(d => d.id === id);
    if (ds) ds.color = color;
  });
}

export function duplicateDataset(id: string): void {
  const state = getState();
  const src = state.datasets.find(d => d.id === id);
  if (!src) return;

  const newId = uid();
  const clone: Dataset = {
    ...structuredClone(src),
    id: newId,
    name: src.name + ' (copy)',
    points: src.points.map(p => ({ ...p, id: uid() })),
  };
  setState(draft => {
    const idx = draft.datasets.findIndex(d => d.id === id);
    draft.datasets.splice(idx + 1, 0, clone);
    draft.activeDatasetId = newId;
  });
  showToast(`Duplicated "${src.name}"`, 'success');
}

export function sortDatasetPoints(id: string, by: 'x' | 'y'): void {
  pushHistory('Sort points');
  setState(draft => {
    const ds = draft.datasets.find(d => d.id === id);
    if (ds) ds.points.sort((a, b) => by === 'x' ? a.dataX - b.dataX : a.dataY - b.dataY);
  });
}

export async function clearDatasetPoints(id: string): Promise<void> {
  const ds = getState().datasets.find(d => d.id === id);
  if (!ds || ds.points.length === 0) return;

  const ok = await showConfirm(
    `Clear all ${ds.points.length} points in "${ds.name}"?`,
    'Clear all', true
  );
  if (!ok) return;

  pushHistory('Clear dataset');
  setState(draft => {
    const d = draft.datasets.find(d => d.id === id);
    if (d) d.points = [];
  });
}

export function mergeDatasets(sourceId: string, targetId: string): void {
  const state = getState();
  const src = state.datasets.find(d => d.id === sourceId);
  const tgt = state.datasets.find(d => d.id === targetId);
  if (!src || !tgt) return;

  pushHistory('Merge datasets');
  setState(draft => {
    const dstDs = draft.datasets.find(d => d.id === targetId)!;
    const srcDs = draft.datasets.find(d => d.id === sourceId)!;
    dstDs.points = [...dstDs.points, ...srcDs.points.map(p => ({ ...p, id: uid() }))];
    draft.datasets = draft.datasets.filter(d => d.id !== sourceId);
    draft.activeDatasetId = targetId;
  });
  showToast(`Merged "${src.name}" into "${tgt.name}"`, 'success');
}

export function importPointsFromCSV(datasetId: string, csv: string): number {
  const lines = csv.split(/[\n\r]+/).filter(l => l.trim() && !l.startsWith('#'));
  const points: import('../state/types').DataPoint[] = [];

  for (const line of lines) {
    // Skip header rows (non-numeric first token)
    const parts = line.split(/[,\t;]/).map(s => s.trim().replace(/^["']|["']$/g, ''));
    if (parts.length < 2) continue;
    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);
    if (isNaN(x) || isNaN(y)) continue;
    const label = parts[2] ?? undefined;
    points.push({ id: uid(), pixelX: 0, pixelY: 0, dataX: x, dataY: y, label });
  }

  if (points.length === 0) return 0;

  pushHistory('Import points from CSV');
  setState(draft => {
    const ds = draft.datasets.find(d => d.id === datasetId);
    if (ds) ds.points = [...ds.points, ...points];
  });
  return points.length;
}

/**
 * Flag points that are statistical outliers (|z-score| > zThreshold) on Y axis.
 * Sets point.outlier = true/false. Call again with zThreshold=Infinity to clear.
 */
export function flagOutliers(datasetId: string, zThreshold = 2.5): number {
  const state = getState();
  const ds = state.datasets.find(d => d.id === datasetId);
  if (!ds || ds.points.length < 3) return 0;

  const ys = ds.points.map(p => p.dataY);
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const std = Math.sqrt(ys.reduce((s, v) => s + (v - mean) ** 2, 0) / ys.length);
  if (std === 0) return 0;

  let count = 0;
  setState(draft => {
    const dsDraft = draft.datasets.find(d => d.id === datasetId)!;
    dsDraft.points.forEach(p => {
      p.outlier = Math.abs((p.dataY - mean) / std) > zThreshold;
      if (p.outlier) count++;
    });
  });
  return count;
}

export function clearOutliers(datasetId: string): void {
  setState(draft => {
    const ds = draft.datasets.find(d => d.id === datasetId);
    if (ds) ds.points.forEach(p => { p.outlier = false; });
  });
}

export function removeOutliers(datasetId: string): number {
  const state = getState();
  const ds = state.datasets.find(d => d.id === datasetId);
  if (!ds) return 0;
  const toRemove = ds.points.filter(p => p.outlier).length;
  if (toRemove === 0) return 0;
  pushHistory('Remove outliers');
  setState(draft => {
    const dsDraft = draft.datasets.find(d => d.id === datasetId)!;
    dsDraft.points = dsDraft.points.filter(p => !p.outlier);
  });
  return toRemove;
}

export function cycleActiveDataset(): void {
  const state = getState();
  if (state.datasets.length === 0) return;
  const idx = state.datasets.findIndex(d => d.id === state.activeDatasetId);
  const next = state.datasets[(idx + 1) % state.datasets.length];
  setState(draft => { draft.activeDatasetId = next.id; });
}

export function setDatasetFit(datasetId: string, fit: CurveFit | null): void {
  pushHistory('Set curve fit');
  setState(draft => {
    const ds = draft.datasets.find(d => d.id === datasetId);
    if (ds) (ds as any).curveFit = fit ?? undefined;
  });
}

export function toggleFitVisibility(datasetId: string): void {
  setState(draft => {
    const ds = draft.datasets.find(d => d.id === datasetId) as any;
    if (ds?.curveFit) ds.curveFit.visible = !ds.curveFit.visible;
  });
}

export function normalizeDataset(datasetId: string, mode: 'minmax' | 'zscore'): void {
  const state = getState();
  const ds = state.datasets.find(d => d.id === datasetId);
  if (!ds || ds.points.length < 2) return;

  const xs = ds.points.map(p => p.dataX);
  const ys = ds.points.map(p => p.dataY);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const xStd = Math.sqrt(xs.reduce((s, v) => s + (v - xMean) ** 2, 0) / xs.length) || 1;
  const yStd = Math.sqrt(ys.reduce((s, v) => s + (v - yMean) ** 2, 0) / ys.length) || 1;

  const newId = uid();
  const newPts = ds.points.map(p => {
    let nx = p.dataX, ny = p.dataY;
    if (mode === 'minmax') {
      nx = xMax !== xMin ? (p.dataX - xMin) / (xMax - xMin) : 0;
      ny = yMax !== yMin ? (p.dataY - yMin) / (yMax - yMin) : 0;
    } else {
      nx = (p.dataX - xMean) / xStd;
      ny = (p.dataY - yMean) / yStd;
    }
    return { ...p, id: uid(), dataX: nx, dataY: ny };
  });

  const suffix = mode === 'minmax' ? '(min-max)' : '(z-score)';
  pushHistory('Normalize dataset');
  setState(draft => {
    draft.datasets.push({
      id: newId,
      name: `${ds.name} ${suffix}`,
      color: ds.color,
      visible: true,
      points: newPts,
    });
    draft.activeDatasetId = newId;
  });
  showToast(`Created normalized series "${ds.name} ${suffix}"`, 'success');
}
