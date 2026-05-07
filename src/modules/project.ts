import { getState, setState } from '../state/store';
import { setImageBitmap, fitToWindow, render, getImageBitmap } from './canvas-engine';
import { showToast } from '../utils/toast';
import { downloadBlob } from '../utils/file';
import type { AppState } from '../state/types';

const FORMAT_VERSION = 1;

interface PVZFile {
  version: number;
  savedAt: string;
  image: AppState['image'];
  canvas: AppState['canvas'];
  calibration: AppState['calibration'];
  datasets: AppState['datasets'];
  ui: AppState['ui'];
  // Image pixels are stored as a base64 data URL
  imageDataURL?: string;
}

export async function saveProject(): Promise<void> {
  const state = getState();

  let imageDataURL: string | undefined;
  const bitmap = getImageBitmap();
  if (bitmap) {
    const offscreen = document.createElement('canvas');
    offscreen.width = bitmap.width;
    offscreen.height = bitmap.height;
    offscreen.getContext('2d')!.drawImage(bitmap, 0, 0);
    imageDataURL = offscreen.toDataURL('image/png');
  }

  const pvz: PVZFile = {
    version: FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    image: structuredClone(state.image),
    canvas: structuredClone(state.canvas),
    calibration: structuredClone(state.calibration),
    datasets: structuredClone(state.datasets),
    ui: structuredClone(state.ui),
    imageDataURL,
  };

  const json = JSON.stringify(pvz);
  const blob = new Blob([json], { type: 'application/json' });
  const filename = (state.image.filename.replace(/\.[^.]+$/, '') || 'plotvision') + '.pvz';
  downloadBlob(blob, filename);
  showToast('Project saved', 'success');
}

export async function loadProject(file: File): Promise<void> {
  try {
    const text = await file.text();
    const pvz: PVZFile = JSON.parse(text);

    if (!pvz.version || pvz.version > FORMAT_VERSION) {
      showToast('Unsupported .pvz version', 'error');
      return;
    }

    // Restore image bitmap from data URL
    if (pvz.imageDataURL) {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to decode image'));
        img.src = pvz.imageDataURL!;
      });
      const bitmap = await createImageBitmap(img);
      setImageBitmap(bitmap);
      document.getElementById('empty-state')?.classList.add('hidden');
    }

    setState(draft => {
      draft.image = pvz.image;
      draft.calibration = pvz.calibration;
      draft.datasets = pvz.datasets;
      draft.ui = pvz.ui;
      draft.canvas = pvz.canvas;
      draft.activeDatasetId = pvz.datasets[0]?.id ?? null;
      draft.history = [];
      draft.historyIndex = -1;
    });

    fitToWindow();
    render();
    showToast(`Loaded: ${file.name}`, 'success');
  } catch (err) {
    showToast(`Failed to load project: ${(err as Error).message}`, 'error');
  }
}

export function openProjectPicker(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pvz,application/json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) loadProject(file);
  };
  input.click();
}

// Auto-save to sessionStorage so browser refresh doesn't lose work
const AUTOSAVE_KEY = 'plotvision-autosave';

export function setupAutosave(): void {
  // Warn on tab close if there's unsaved data
  window.addEventListener('beforeunload', (e) => {
    const state = getState();
    const hasData = state.datasets.some(d => d.points.length > 0);
    if (hasData) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Save to sessionStorage every 30s
  setInterval(() => {
    const state = getState();
    const hasData = state.datasets.some(d => d.points.length > 0);
    if (!hasData) return;
    try {
      const snapshot = {
        calibration: state.calibration,
        datasets: state.datasets,
        image: state.image,
      };
      sessionStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
    } catch { /* quota exceeded, ignore */ }
  }, 30_000);
}
