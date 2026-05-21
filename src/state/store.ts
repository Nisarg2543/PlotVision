import type { AppState, CalibrationState } from './types';

function createInitialCalibration(): CalibrationState {
  return {
    axisType: 'xy-linear',
    step: 'idle',
    points: [],
    isComplete: false,
    transform: null,
    showGrid: false,
  };
}

function createInitialState(): AppState {
  return {
    image: { width: 0, height: 0, filename: '', currentPage: 1, totalPages: 1 },
    canvas: {
      zoom: 1,
      panX: 0,
      panY: 0,
      imageFilters: { brightness: 100, contrast: 100, grayscale: false, invert: false, sharpen: false, threshold: null, autoContrast: false, denoise: false, gridRemoval: false },
      roi: null,
    },
    calibration: createInitialCalibration(),
    datasets: [],
    activeDatasetId: null,
    activeTool: 'pointer',
    history: [],
    historyIndex: -1,
    ui: { previewMode: 'scatter' },
    exportOptions: { precision: 'auto', digits: 6, sort: 'none', dateFmt: 'yyyy-mm-dd HH:ii:ss' },
    ai: { apiKey: '', provider: 'openai' },
  };
}

type Listener = (state: AppState) => void;

const listeners = new Set<Listener>();
let state: AppState = createInitialState();

export function getState(): AppState {
  return state;
}

export function setState(updater: (draft: AppState) => void): void {
  // structuredClone cannot clone ImageBitmap — but AppState has none (bitmap lives in canvas-engine)
  const next = structuredClone(state);
  updater(next);
  state = next;
  listeners.forEach(fn => fn(state));
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetCalibrationState(): CalibrationState {
  return createInitialCalibration();
}
