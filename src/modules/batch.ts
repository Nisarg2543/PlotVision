/**
 * Batch processing — queue multiple images for sequential digitization.
 * User loads a batch of files; PlotVision steps through them one at a time,
 * applying the same calibration to each image (for identically-formatted charts).
 */
import { setState, resetCalibrationState } from '../state/store';
import { setImageBitmap, fitToWindow, render } from './canvas-engine';
import { addDataset } from './datasets';
import { showToast } from '../utils/toast';
import { readFileAsArrayBuffer } from '../utils/file';
import { uid } from '../utils/math';

// Render scale for PDF batch items. Higher = better quality but uses more memory.
const PDF_RENDER_SCALE = 2.0;

export interface BatchItem {
  id: string;
  file: File;
  status: 'pending' | 'active' | 'done' | 'skipped';
  datasetId?: string;
}

let queue: BatchItem[] = [];
let currentIndex = -1;
let cancelled = false;
let reuseCalibration = false;
let progressListeners: Array<() => void> = [];

export function setReuseCalibration(v: boolean): void { reuseCalibration = v; }
export function getReuseCalibration(): boolean { return reuseCalibration; }

export function getQueue(): BatchItem[] { return queue; }
export function getCurrentIndex(): number { return currentIndex; }
export function isBatchActive(): boolean { return queue.length > 0 && currentIndex < queue.length; }
export function isBatchCancelled(): boolean { return cancelled; }

/** Subscribe to batch progress updates (fires on each image advance or cancel) */
export function onBatchProgress(fn: () => void): () => void {
  progressListeners.push(fn);
  return () => { progressListeners = progressListeners.filter(f => f !== fn); };
}

function notifyProgress(): void {
  progressListeners.forEach(fn => fn());
}

export function cancelBatch(): void {
  cancelled = true;
  notifyProgress();
}

/** Load a set of files into the batch queue */
export async function loadBatch(files: File[]): Promise<void> {
  if (files.length === 0) return;

  queue = files.map(f => ({ id: uid(), file: f, status: 'pending' }));
  currentIndex = -1;
  cancelled = false;
  showToast(`Batch loaded: ${files.length} images`, 'info');
  notifyProgress();
  await advanceBatch();
}

/** Move to the next image in the batch */
export async function advanceBatch(): Promise<void> {
  if (cancelled) { notifyProgress(); return; }
  currentIndex++;
  if (currentIndex >= queue.length) {
    showToast('Batch complete!', 'success', 4000);
    notifyProgress();
    return;
  }

  const item = queue[currentIndex];
  item.status = 'active';
  notifyProgress();

  try {
    let bitmap: ImageBitmap;

    if (item.file.type === 'application/pdf' || item.file.name.toLowerCase().endsWith('.pdf')) {
      // Render first page of PDF
      const pdfjsLib = (window as any).pdfjsLib;
      if (!pdfjsLib) { showToast('PDF.js not loaded', 'error'); return; }
      const buf = await readFileAsArrayBuffer(item.file);
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      const offscreen = document.createElement('canvas');
      offscreen.width  = Math.round(viewport.width);
      offscreen.height = Math.round(viewport.height);
      if (offscreen.width === 0 || offscreen.height === 0) {
        throw new Error('PDF page rendered to zero-size canvas');
      }
      await page.render({ canvasContext: offscreen.getContext('2d')!, viewport }).promise;
      bitmap = await createImageBitmap(offscreen);
      page.cleanup();
      try { await doc.destroy(); } catch (e) {}
    } else {
      bitmap = await createImageBitmap(item.file);
    }

    setImageBitmap(bitmap);
    setState(draft => {
      // Snapshot calibration before overwriting image (for reuse)
      const prevCalib = reuseCalibration ? { ...draft.calibration } : null;
      draft.image.width    = bitmap.width;
      draft.image.height   = bitmap.height;
      draft.image.filename = item.file.name;
      draft.image.currentPage = 1;
      draft.image.totalPages  = 1;
      if (prevCalib) {
        draft.calibration = prevCalib;
      } else {
        draft.calibration = resetCalibrationState();
      }
    });

    // Create a dedicated dataset for this batch item
    const dsName = item.file.name.replace(/\.[^.]+$/, '');
    const dsId = addDataset(dsName);
    item.datasetId = dsId;
    setState(draft => { draft.activeDatasetId = dsId; });

    fitToWindow();
    render();
    notifyProgress();
    showToast(`Batch ${currentIndex + 1}/${queue.length}: ${item.file.name}`, 'info', 2500);
  } catch (err) {
    item.status = 'skipped';
    notifyProgress();
    showToast(`Skipped "${item.file.name}": ${(err as Error).message}`, 'warning');
    void advanceBatch();
  }
}

export function skipCurrent(): void {
  if (currentIndex >= 0 && currentIndex < queue.length) {
    queue[currentIndex].status = 'skipped';
  }
  void advanceBatch();
}

export function markCurrentDone(): void {
  if (currentIndex >= 0 && currentIndex < queue.length) {
    queue[currentIndex].status = 'done';
  }
  void advanceBatch();
}

export function clearBatch(): void {
  queue = [];
  currentIndex = -1;
  cancelled = false;
  notifyProgress();
}

/** Open a multi-file picker for batch loading */
export function openBatchPicker(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*,.pdf,application/pdf';
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    if (files.length > 0) loadBatch(files);
  };
  input.click();
}
