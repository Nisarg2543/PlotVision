import { setState, getState } from '../state/store';
import { setImageBitmap, fitToWindow, render } from './canvas-engine';
import { readFileAsArrayBuffer } from '../utils/file';
import { showToast } from '../utils/toast';
import { detectChartType, getChartTypeLabel } from './auto-detect';
import { showLoading, hideLoading } from '../ui/loading-overlay';

// PDF document stored here (not cloneable)
let pdfDoc: any = null;

declare const pdfjsLib: any;

// Named handlers for cleanup
let pasteHandler: ((e: ClipboardEvent) => void) | null = null;
let dragoverHandler: ((e: DragEvent) => void) | null = null;
let dragleaveHandler: ((e: DragEvent) => void) | null = null;
let dropHandler: ((e: DragEvent) => void) | null = null;
let loaderContainer: HTMLElement | null = null;

export function initImageLoader(container: HTMLElement): void {
  loaderContainer = container;

  // Set PDF.js worker source
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js';
  }

  // Drag-drop
  dragoverHandler = (e: DragEvent) => {
    e.preventDefault();
    document.getElementById('drop-overlay')?.classList.remove('hidden');
    document.getElementById('empty-state')?.classList.add('hidden');
  };
  dragleaveHandler = (e: DragEvent) => {
    if (!container.contains(e.relatedTarget as Node)) {
      document.getElementById('drop-overlay')?.classList.add('hidden');
      if (!getState().image.filename) {
        document.getElementById('empty-state')?.classList.remove('hidden');
      }
    }
  };
  dropHandler = (e: DragEvent) => {
    e.preventDefault();
    document.getElementById('drop-overlay')?.classList.add('hidden');
    const file = e.dataTransfer?.files[0];
    if (file) loadFile(file);
  };
  container.addEventListener('dragover', dragoverHandler);
  container.addEventListener('dragleave', dragleaveHandler);
  container.addEventListener('drop', dropHandler);

  // Clipboard paste
  pasteHandler = (e: ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imgItem = items.find(i => i.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      const blob = imgItem.getAsFile();
      if (blob) loadFile(blob);
    }
  };
  document.addEventListener('paste', pasteHandler);

  // Empty state buttons
  document.getElementById('empty-open-btn')?.addEventListener('click', openFilePicker);
  document.getElementById('empty-demo-btn')?.addEventListener('click', () => void loadDemoChart());
}

export function destroyImageLoader(): void {
  if (pasteHandler)    { document.removeEventListener('paste', pasteHandler);          pasteHandler = null; }
  if (dragoverHandler && loaderContainer)  { loaderContainer.removeEventListener('dragover', dragoverHandler);   dragoverHandler = null; }
  if (dragleaveHandler && loaderContainer) { loaderContainer.removeEventListener('dragleave', dragleaveHandler); dragleaveHandler = null; }
  if (dropHandler && loaderContainer)      { loaderContainer.removeEventListener('drop', dropHandler);           dropHandler = null; }
}

export function openFilePicker(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.pdf,application/pdf';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) loadFile(file);
  };
  input.click();
}

const MAX_FILE_MB = 50;

async function loadFile(file: File | Blob): Promise<void> {
  const name = (file as File).name ?? 'pasted-image';
  const type = file.type;

  // File size guard
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    showToast(`File too large — max ${MAX_FILE_MB} MB (this file is ${(file.size / 1024 / 1024).toFixed(0)} MB)`, 'error', 5000);
    return;
  }

  showLoading('Loading image…');
  try {
    if (type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
      const buffer = await readFileAsArrayBuffer(file);
      await loadPDF(buffer, name);
    } else {
      const bitmap = await createImageBitmap(file);
      handleBitmapLoaded(bitmap, name, 1, 1);
    }
  } catch (err) {
    showToast(`Failed to load file: ${(err as Error).message}`, 'error');
  } finally {
    hideLoading();
  }
}

async function loadPDF(buffer: ArrayBuffer, filename: string): Promise<void> {
  if (typeof pdfjsLib === 'undefined') {
    showToast('PDF.js not loaded — cannot open PDF', 'error');
    return;
  }
  showToast('Loading PDF…', 'info', 1500);
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  pdfDoc = doc;
  await renderPDFPage(doc, 1, filename);
}

async function renderPDFPage(doc: any, pageNum: number, filename: string): Promise<void> {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2.0 });

  // Use regular canvas (not OffscreenCanvas) for broadest PDF.js compat
  const offscreen = document.createElement('canvas');
  offscreen.width = viewport.width;
  offscreen.height = viewport.height;
  const offCtx = offscreen.getContext('2d')!;

  await page.render({ canvasContext: offCtx, viewport }).promise;
  const bitmap = await createImageBitmap(offscreen);
  handleBitmapLoaded(bitmap, filename, pageNum, doc.numPages);
}

function handleBitmapLoaded(
  bmp: ImageBitmap, filename: string,
  page: number, totalPages: number
): void {
  setImageBitmap(bmp);
  document.getElementById('empty-state')?.classList.add('hidden');

  setState(draft => {
    draft.image.width = bmp.width;
    draft.image.height = bmp.height;
    draft.image.filename = filename;
    draft.image.currentPage = page;
    draft.image.totalPages = totalPages;
  });

  fitToWindow();
  render();
  showToast(`Loaded: ${filename}${totalPages > 1 ? ` (page ${page}/${totalPages})` : ''}`, 'success');

  // Auto-detect chart type in background after initial render
  setTimeout(() => {
    try {
      const offscreen = document.createElement('canvas');
      const maxSide = 400;
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      offscreen.width = Math.round(bmp.width * scale);
      offscreen.height = Math.round(bmp.height * scale);
      const ctx = offscreen.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0, offscreen.width, offscreen.height);
      const imgData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
      const result = detectChartType(imgData);
      if (result.type !== 'unknown' && result.confidence > 0.35) {
        showToast(
          `Detected: ${getChartTypeLabel(result.type)} (${(result.confidence * 100).toFixed(0)}% confidence)`,
          'info',
          4000
        );
      }
    } catch {
      // Detection errors are non-fatal
    }
  }, 150);
}

export async function goToPage(pageNum: number): Promise<void> {
  const state = getState();
  if (!pdfDoc || pageNum < 1 || pageNum > state.image.totalPages) return;
  await renderPDFPage(pdfDoc, pageNum, state.image.filename);
}

export function getPDFDoc(): any {
  return pdfDoc;
}

export async function loadDemoChart(): Promise<void> {
  try {
    const resp = await fetch('/demo-chart.svg');
    if (!resp.ok) throw new Error('Demo chart not found');
    const blob = await resp.blob();
    // Render SVG via <img> → canvas → ImageBitmap for broadest compat
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to render demo chart'));
      img.src = url;
    });
    const offscreen = document.createElement('canvas');
    offscreen.width = img.naturalWidth || 780;
    offscreen.height = img.naturalHeight || 580;
    offscreen.getContext('2d')!.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const bitmap = await createImageBitmap(offscreen);
    handleBitmapLoaded(bitmap, 'demo-chart.svg', 1, 1);
  } catch (err) {
    showToast(`Could not load demo chart: ${(err as Error).message}`, 'error');
  }
}
