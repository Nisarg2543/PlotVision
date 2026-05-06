import { setState, getState } from '../state/store';
import { setImageBitmap, fitToWindow, render } from './canvas-engine';
import { readFileAsArrayBuffer } from '../utils/file';
import { showToast } from '../utils/toast';

// PDF document stored here (not cloneable)
let pdfDoc: any = null;

declare const pdfjsLib: any;

export function initImageLoader(container: HTMLElement): void {
  // Set PDF.js worker source
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js';
  }

  // Drag-drop
  container.addEventListener('dragover', e => {
    e.preventDefault();
    document.getElementById('drop-overlay')?.classList.remove('hidden');
    document.getElementById('empty-state')?.classList.add('hidden');
  });
  container.addEventListener('dragleave', e => {
    if (!container.contains(e.relatedTarget as Node)) {
      document.getElementById('drop-overlay')?.classList.add('hidden');
      if (!getState().image.filename) {
        document.getElementById('empty-state')?.classList.remove('hidden');
      }
    }
  });
  container.addEventListener('drop', e => {
    e.preventDefault();
    document.getElementById('drop-overlay')?.classList.add('hidden');
    const file = e.dataTransfer?.files[0];
    if (file) loadFile(file);
  });

  // Clipboard paste
  document.addEventListener('paste', (e: ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imgItem = items.find(i => i.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      const blob = imgItem.getAsFile();
      if (blob) loadFile(blob);
    }
  });

  // Empty state open button
  document.getElementById('empty-open-btn')?.addEventListener('click', openFilePicker);
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

async function loadFile(file: File | Blob): Promise<void> {
  const name = (file as File).name ?? 'pasted-image';
  const type = file.type;

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
}

export async function goToPage(pageNum: number): Promise<void> {
  const state = getState();
  if (!pdfDoc || pageNum < 1 || pageNum > state.image.totalPages) return;
  await renderPDFPage(pdfDoc, pageNum, state.image.filename);
}

export function getPDFDoc(): any {
  return pdfDoc;
}
