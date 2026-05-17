import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('../utils/confirm', () => ({ showConfirm: vi.fn().mockResolvedValue(true) }));

import { getState, setState } from '../state/store';
import {
  addDataset, renameDataset, toggleDatasetVisibility, duplicateDataset,
  sortDatasetPoints, mergeDatasets, importPointsFromCSV,
  flagOutliers, clearOutliers, removeOutliers,
  normalizeDataset, removeDataset, clearDatasetPoints,
} from './datasets';
import type { DataPoint } from '../state/types';
import { uid } from '../utils/math';

function resetState() {
  setState(draft => {
    draft.datasets = [];
    draft.activeDatasetId = null;
    draft.history = [];
    draft.historyIndex = -1;
  });
}

function makePoint(dataX: number, dataY: number): DataPoint {
  return { id: uid(), pixelX: 0, pixelY: 0, dataX, dataY };
}

beforeEach(resetState);

// ── addDataset ────────────────────────────────────────────────────────────────

describe('addDataset', () => {
  it('adds a dataset to state', () => {
    addDataset();
    expect(getState().datasets).toHaveLength(1);
  });

  it('sets activeDatasetId to the new id', () => {
    const id = addDataset();
    expect(getState().activeDatasetId).toBe(id);
  });

  it('uses default name "Dataset 1"', () => {
    addDataset();
    expect(getState().datasets[0].name).toBe('Dataset 1');
  });

  it('respects a custom name', () => {
    addDataset('My Series');
    expect(getState().datasets[0].name).toBe('My Series');
  });

  it('respects a custom color', () => {
    addDataset(undefined, '#ff0000');
    expect(getState().datasets[0].color).toBe('#ff0000');
  });

  it('starts with an empty points array', () => {
    addDataset();
    expect(getState().datasets[0].points).toEqual([]);
  });

  it('returns unique ids for each dataset', () => {
    const a = addDataset();
    const b = addDataset();
    expect(a).not.toBe(b);
  });
});

// ── renameDataset ─────────────────────────────────────────────────────────────

describe('renameDataset', () => {
  it('renames the dataset', () => {
    const id = addDataset('Old');
    renameDataset(id, 'New');
    expect(getState().datasets[0].name).toBe('New');
  });

  it('trims whitespace', () => {
    const id = addDataset();
    renameDataset(id, '  Trimmed  ');
    expect(getState().datasets[0].name).toBe('Trimmed');
  });

  it('ignores empty strings', () => {
    const id = addDataset('Keep');
    renameDataset(id, '');
    expect(getState().datasets[0].name).toBe('Keep');
  });

  it('ignores whitespace-only strings', () => {
    const id = addDataset('Keep');
    renameDataset(id, '   ');
    expect(getState().datasets[0].name).toBe('Keep');
  });
});

// ── toggleDatasetVisibility ───────────────────────────────────────────────────

describe('toggleDatasetVisibility', () => {
  it('hides a visible dataset', () => {
    const id = addDataset();
    toggleDatasetVisibility(id);
    expect(getState().datasets[0].visible).toBe(false);
  });

  it('shows a hidden dataset', () => {
    const id = addDataset();
    toggleDatasetVisibility(id);
    toggleDatasetVisibility(id);
    expect(getState().datasets[0].visible).toBe(true);
  });
});

// ── sortDatasetPoints ─────────────────────────────────────────────────────────

describe('sortDatasetPoints', () => {
  it('sorts by X ascending', () => {
    const id = addDataset();
    setState(draft => {
      draft.datasets[0].points = [makePoint(3, 0), makePoint(1, 0), makePoint(2, 0)];
    });
    sortDatasetPoints(id, 'x');
    const xs = getState().datasets[0].points.map(p => p.dataX);
    expect(xs).toEqual([1, 2, 3]);
  });

  it('sorts by Y ascending', () => {
    const id = addDataset();
    setState(draft => {
      draft.datasets[0].points = [makePoint(0, 9), makePoint(0, 3), makePoint(0, 6)];
    });
    sortDatasetPoints(id, 'y');
    const ys = getState().datasets[0].points.map(p => p.dataY);
    expect(ys).toEqual([3, 6, 9]);
  });
});

// ── duplicateDataset ──────────────────────────────────────────────────────────

describe('duplicateDataset', () => {
  it('creates a copy with " (copy)" suffix', () => {
    const id = addDataset('Original');
    duplicateDataset(id);
    const names = getState().datasets.map(d => d.name);
    expect(names).toContain('Original (copy)');
  });

  it('copy has same point count', () => {
    const id = addDataset();
    setState(draft => {
      draft.datasets[0].points = [makePoint(1, 2), makePoint(3, 4)];
    });
    duplicateDataset(id);
    expect(getState().datasets[1].points).toHaveLength(2);
  });

  it('copy has new ids for all points', () => {
    const id = addDataset();
    const origPtId = uid();
    setState(draft => {
      draft.datasets[0].points = [{ id: origPtId, pixelX: 0, pixelY: 0, dataX: 1, dataY: 2 }];
    });
    duplicateDataset(id);
    const copyPtId = getState().datasets[1].points[0].id;
    expect(copyPtId).not.toBe(origPtId);
  });

  it('sets activeDatasetId to the copy', () => {
    const id = addDataset();
    duplicateDataset(id);
    const copyId = getState().datasets[1].id;
    expect(getState().activeDatasetId).toBe(copyId);
  });
});

// ── mergeDatasets ─────────────────────────────────────────────────────────────

describe('mergeDatasets', () => {
  it('moves source points into target', () => {
    const srcId = addDataset('Source');
    const tgtId = addDataset('Target');
    setState(draft => {
      draft.datasets[0].points = [makePoint(1, 1)];
      draft.datasets[1].points = [makePoint(2, 2)];
    });
    mergeDatasets(srcId, tgtId);
    const tgt = getState().datasets.find(d => d.id === tgtId)!;
    expect(tgt.points).toHaveLength(2);
  });

  it('removes the source dataset', () => {
    const srcId = addDataset('Source');
    addDataset('Target');
    mergeDatasets(srcId, getState().datasets[1].id);
    expect(getState().datasets.find(d => d.id === srcId)).toBeUndefined();
  });
});

// ── importPointsFromCSV ───────────────────────────────────────────────────────

describe('importPointsFromCSV', () => {
  it('parses comma-separated values', () => {
    const id = addDataset();
    const count = importPointsFromCSV(id, '1,2\n3,4\n5,6');
    expect(count).toBe(3);
    expect(getState().datasets[0].points).toHaveLength(3);
  });

  it('parses tab-separated values', () => {
    const id = addDataset();
    const count = importPointsFromCSV(id, '1\t2\n3\t4');
    expect(count).toBe(2);
  });

  it('parses semicolon-separated values', () => {
    const id = addDataset();
    expect(importPointsFromCSV(id, '1;2\n3;4')).toBe(2);
  });

  it('skips header rows with non-numeric first token', () => {
    const id = addDataset();
    const count = importPointsFromCSV(id, 'X,Y\n1,2\n3,4');
    expect(count).toBe(2);
  });

  it('skips malformed lines', () => {
    const id = addDataset();
    const count = importPointsFromCSV(id, '1,2\nbad,line\n3,4');
    expect(count).toBe(2);
  });

  it('stores correct dataX and dataY values', () => {
    const id = addDataset();
    importPointsFromCSV(id, '7.5,3.14');
    const pt = getState().datasets[0].points[0];
    expect(pt.dataX).toBeCloseTo(7.5);
    expect(pt.dataY).toBeCloseTo(3.14);
  });

  it('returns 0 and adds nothing for empty/invalid input', () => {
    const id = addDataset();
    expect(importPointsFromCSV(id, 'X,Y\nheader,only')).toBe(0);
    expect(getState().datasets[0].points).toHaveLength(0);
  });

  it('appends to existing points', () => {
    const id = addDataset();
    setState(draft => { draft.datasets[0].points = [makePoint(0, 0)]; });
    importPointsFromCSV(id, '1,1');
    expect(getState().datasets[0].points).toHaveLength(2);
  });
});

// ── flagOutliers ──────────────────────────────────────────────────────────────

describe('flagOutliers', () => {
  // [1,1,1,1,1,1,1,1,1,100]: mean≈10.9, std≈29.7 → z(100)≈3.0 > 2.5
  const ys = [1, 1, 1, 1, 1, 1, 1, 1, 1, 100];

  it('flags the outlier point', () => {
    const id = addDataset();
    setState(draft => { draft.datasets[0].points = ys.map((y, x) => makePoint(x, y)); });
    flagOutliers(id);
    const outlierPts = getState().datasets[0].points.filter(p => p.outlier);
    expect(outlierPts).toHaveLength(1);
    expect(outlierPts[0].dataY).toBe(100);
  });

  it('returns the count of flagged points', () => {
    const id = addDataset();
    setState(draft => { draft.datasets[0].points = ys.map((y, x) => makePoint(x, y)); });
    expect(flagOutliers(id)).toBe(1);
  });

  it('returns 0 for fewer than 3 points', () => {
    const id = addDataset();
    setState(draft => { draft.datasets[0].points = [makePoint(0, 0), makePoint(1, 1)]; });
    expect(flagOutliers(id)).toBe(0);
  });

  it('returns 0 when all values are identical (std=0)', () => {
    const id = addDataset();
    setState(draft => { draft.datasets[0].points = [makePoint(0,5), makePoint(1,5), makePoint(2,5)]; });
    expect(flagOutliers(id)).toBe(0);
  });

  it('flags nothing when all points are within threshold', () => {
    const id = addDataset();
    setState(draft => { draft.datasets[0].points = [1,2,3,4,5].map((y, x) => makePoint(x, y)); });
    expect(flagOutliers(id, 2.5)).toBe(0);
  });
});

// ── clearOutliers ─────────────────────────────────────────────────────────────

describe('clearOutliers', () => {
  it('sets outlier to false on all points', () => {
    const id = addDataset();
    const ys = [1, 1, 1, 1, 1, 1, 1, 1, 1, 100];
    setState(draft => { draft.datasets[0].points = ys.map((y, x) => makePoint(x, y)); });
    flagOutliers(id);
    clearOutliers(id);
    const outlierPts = getState().datasets[0].points.filter(p => p.outlier);
    expect(outlierPts).toHaveLength(0);
  });
});

// ── removeOutliers ────────────────────────────────────────────────────────────

describe('removeOutliers', () => {
  it('removes flagged points and returns count', () => {
    const id = addDataset();
    const ys = [1, 1, 1, 1, 1, 1, 1, 1, 1, 100];
    setState(draft => { draft.datasets[0].points = ys.map((y, x) => makePoint(x, y)); });
    flagOutliers(id);
    const removed = removeOutliers(id);
    expect(removed).toBe(1);
    expect(getState().datasets[0].points).toHaveLength(9);
  });

  it('returns 0 when no points are flagged', () => {
    const id = addDataset();
    setState(draft => { draft.datasets[0].points = [makePoint(1,1), makePoint(2,2)]; });
    expect(removeOutliers(id)).toBe(0);
  });
});

// ── normalizeDataset ──────────────────────────────────────────────────────────

describe('normalizeDataset', () => {
  function setupDataset() {
    const id = addDataset('Source');
    setState(draft => {
      draft.datasets[0].points = [0, 5, 10].map(v => makePoint(v, v));
    });
    return id;
  }

  it('minmax: creates a new dataset with "(min-max)" suffix', () => {
    const id = setupDataset();
    normalizeDataset(id, 'minmax');
    const names = getState().datasets.map(d => d.name);
    expect(names).toContain('Source (min-max)');
  });

  it('minmax: all output X values in [0, 1]', () => {
    const id = setupDataset();
    normalizeDataset(id, 'minmax');
    const normalized = getState().datasets.find(d => d.name.includes('min-max'))!;
    normalized.points.forEach(p => {
      expect(p.dataX).toBeGreaterThanOrEqual(0);
      expect(p.dataX).toBeLessThanOrEqual(1);
    });
  });

  it('minmax: all output Y values in [0, 1]', () => {
    const id = setupDataset();
    normalizeDataset(id, 'minmax');
    const normalized = getState().datasets.find(d => d.name.includes('min-max'))!;
    normalized.points.forEach(p => {
      expect(p.dataY).toBeGreaterThanOrEqual(0);
      expect(p.dataY).toBeLessThanOrEqual(1);
    });
  });

  it('minmax: does not modify the original dataset', () => {
    const id = setupDataset();
    const origPoints = structuredClone(getState().datasets[0].points);
    normalizeDataset(id, 'minmax');
    expect(getState().datasets[0].points).toEqual(origPoints);
  });

  it('zscore: creates a new dataset with "(z-score)" suffix', () => {
    const id = setupDataset();
    normalizeDataset(id, 'zscore');
    expect(getState().datasets.some(d => d.name.includes('z-score'))).toBe(true);
  });

  it('zscore: output Y has mean ≈ 0', () => {
    const id = setupDataset();
    normalizeDataset(id, 'zscore');
    const normalized = getState().datasets.find(d => d.name.includes('z-score'))!;
    const yMean = normalized.points.reduce((s, p) => s + p.dataY, 0) / normalized.points.length;
    expect(yMean).toBeCloseTo(0, 5);
  });

  it('sets activeDatasetId to the new normalized dataset', () => {
    const id = setupDataset();
    normalizeDataset(id, 'minmax');
    const newDs = getState().datasets.find(d => d.name.includes('min-max'))!;
    expect(getState().activeDatasetId).toBe(newDs.id);
  });

  it('does nothing for a dataset with fewer than 2 points', () => {
    const id = addDataset();
    setState(draft => { draft.datasets[0].points = [makePoint(1, 1)]; });
    normalizeDataset(id, 'minmax');
    expect(getState().datasets).toHaveLength(1);
  });
});

// ── removeDataset (async) ─────────────────────────────────────────────────────

describe('removeDataset', () => {
  it('removes the dataset when confirmed', async () => {
    const id = addDataset();
    await removeDataset(id);
    expect(getState().datasets.find(d => d.id === id)).toBeUndefined();
  });

  it('does nothing for a non-existent id', async () => {
    addDataset();
    await removeDataset('nonexistent');
    expect(getState().datasets).toHaveLength(1);
  });
});

// ── clearDatasetPoints (async) ────────────────────────────────────────────────

describe('clearDatasetPoints', () => {
  it('removes all points when confirmed', async () => {
    const id = addDataset();
    setState(draft => { draft.datasets[0].points = [makePoint(1, 1), makePoint(2, 2)]; });
    await clearDatasetPoints(id);
    expect(getState().datasets[0].points).toHaveLength(0);
  });

  it('does nothing when points array is already empty', async () => {
    const id = addDataset();
    await clearDatasetPoints(id);
    expect(getState().datasets[0].points).toHaveLength(0);
  });
});
