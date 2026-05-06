import { getState, setState } from '../state/store';
import { pushHistory } from './history';
import { showToast } from '../utils/toast';
import { uid } from '../utils/math';
import type { Dataset } from '../state/types';

const PALETTE = [
  '#22d3ee', '#f59e0b', '#34d399', '#f87171',
  '#a78bfa', '#fb923c', '#60a5fa', '#e879f9',
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

export function removeDataset(id: string): void {
  const state = getState();
  const ds = state.datasets.find(d => d.id === id);
  if (!ds) return;

  if (!confirm(`Delete dataset "${ds.name}"? This cannot be undone easily.`)) return;

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
  setState(draft => {
    const ds = draft.datasets.find(d => d.id === id);
    if (ds) ds.name = name.trim() || ds.name;
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

export function clearDatasetPoints(id: string): void {
  const ds = getState().datasets.find(d => d.id === id);
  if (!ds || ds.points.length === 0) return;
  if (!confirm(`Clear all ${ds.points.length} points in "${ds.name}"?`)) return;

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

export function cycleActiveDataset(): void {
  const state = getState();
  if (state.datasets.length === 0) return;
  const idx = state.datasets.findIndex(d => d.id === state.activeDatasetId);
  const next = state.datasets[(idx + 1) % state.datasets.length];
  setState(draft => { draft.activeDatasetId = next.id; });
}
