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
  input.accept = '.pvz,.tar,application/json,application/x-tar';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.name.endsWith('.tar')) void loadProjectTar(file);
    else loadProject(file);
  };
  input.click();
}

/** Parse a ustar .tar file and return a map of filename → bytes */
function parseTar(buf: Uint8Array): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.slice(offset, offset + 512);
    // filename: bytes 0-99
    const name = new TextDecoder().decode(header.slice(0, 100)).replace(/\0/g, '').trim();
    if (!name) break; // end-of-archive sentinel
    // file size: bytes 124-135 (octal string)
    const sizeStr = new TextDecoder().decode(header.slice(124, 136)).replace(/\0/g, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    offset += 512; // skip header
    if (size > 0) files[name] = buf.slice(offset, offset + size);
    offset += Math.ceil(size / 512) * 512; // data blocks (512-byte aligned)
  }
  return files;
}

export async function loadProjectTar(file: File): Promise<void> {
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const entries = parseTar(buf);

    const jsonBytes = entries['project.json'];
    if (!jsonBytes) { showToast('Invalid .tar — missing project.json', 'error'); return; }

    const json = JSON.parse(new TextDecoder().decode(jsonBytes));
    // json may be the full PVZFile or the exportProjectTar format with calibration + datasets
    const calibration = json.calibration;
    const datasets = json.datasets;
    const exportOptions = json.exportOptions;
    if (!calibration || !datasets) { showToast('Invalid project.json in .tar', 'error'); return; }

    const imgBytes = entries['image.png'];
    if (imgBytes) {
      const blob = new Blob([imgBytes.buffer as ArrayBuffer], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      setImageBitmap(bitmap);
      document.getElementById('empty-state')?.classList.add('hidden');
    }

    setState(draft => {
      draft.calibration = calibration;
      draft.datasets = datasets;
      if (exportOptions) draft.exportOptions = exportOptions;
      draft.image.filename = json.filename || file.name;
      draft.activeDatasetId = datasets[0]?.id ?? null;
      draft.history = [];
      draft.historyIndex = -1;
    });

    fitToWindow();
    render();
    showToast(`Loaded project from .tar: ${file.name}`, 'success');
  } catch (err) {
    showToast(`Failed to load .tar: ${(err as Error).message}`, 'error');
  }
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
