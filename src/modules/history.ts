import { getState, setState } from '../state/store';
import { uid } from '../utils/math';
import type { HistoryEntry } from '../state/types';

const MAX_HISTORY = 100;

export function pushHistory(description: string): void {
  const state = getState();
  const snapshot = {
    datasets: structuredClone(state.datasets),
    calibration: structuredClone(state.calibration),
  };
  const entry: HistoryEntry = { id: uid(), timestamp: Date.now(), description, snapshot };

  setState(draft => {
    // Truncate redo future
    draft.history = draft.history.slice(0, draft.historyIndex + 1);
    draft.history.push(entry);
    if (draft.history.length > MAX_HISTORY) draft.history.shift();
    draft.historyIndex = draft.history.length - 1;
  });
}

export function undo(): void {
  const { historyIndex, history } = getState();
  if (historyIndex < 0) return;

  setState(draft => {
    const target = history[historyIndex - 1];
    if (target) {
      draft.datasets = structuredClone(target.snapshot.datasets);
      draft.calibration = structuredClone(target.snapshot.calibration);
    } else {
      draft.datasets = [];
      draft.calibration = structuredClone(history[0]?.snapshot.calibration ?? draft.calibration);
      // Restore to pre-first-action by clearing datasets
      draft.datasets = [];
    }
    draft.historyIndex--;
    // Ensure activeDatasetId is still valid
    if (draft.activeDatasetId && !draft.datasets.find(d => d.id === draft.activeDatasetId)) {
      draft.activeDatasetId = draft.datasets[0]?.id ?? null;
    }
  });
}

export function redo(): void {
  const { historyIndex, history } = getState();
  if (historyIndex >= history.length - 1) return;

  setState(draft => {
    const target = history[historyIndex + 1];
    draft.datasets = structuredClone(target.snapshot.datasets);
    draft.calibration = structuredClone(target.snapshot.calibration);
    draft.historyIndex++;
    if (draft.activeDatasetId && !draft.datasets.find(d => d.id === draft.activeDatasetId)) {
      draft.activeDatasetId = draft.datasets[0]?.id ?? null;
    }
  });
}

export function canUndo(): boolean {
  return getState().historyIndex >= 0;
}

export function canRedo(): boolean {
  const { historyIndex, history } = getState();
  return historyIndex < history.length - 1;
}
