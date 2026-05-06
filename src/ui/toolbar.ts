import { getState, subscribe } from '../state/store';
import { fitToWindow, zoomBy } from '../modules/canvas-engine';
import { undo, redo, canUndo, canRedo } from '../modules/history';
import { openFilePicker } from '../modules/image-loader';
import { exportCSV, exportExcel, exportJSON, exportClipboard, exportLaTeX } from '../modules/export';
import { saveProject, openProjectPicker } from '../modules/project';

export function initToolbar(container: HTMLElement): void {
  container.innerHTML = '';

  // Logo
  const logo = document.createElement('div');
  logo.className = 'flex items-center gap-2 mr-3';
  logo.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect width="20" height="20" rx="4" fill="#22d3ee" fill-opacity="0.15"/>
      <path d="M3 15 L7 9 L11 12 L15 5" stroke="#22d3ee" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="7" cy="9" r="1.5" fill="#22d3ee"/>
      <circle cx="11" cy="12" r="1.5" fill="#22d3ee"/>
      <circle cx="15" cy="5" r="1.5" fill="#22d3ee"/>
    </svg>
    <span style="color:#e5e5e5;font-weight:600;font-size:14px;letter-spacing:-0.3px">PlotVision</span>
  `;
  container.appendChild(logo);

  // Separator
  container.appendChild(makeSep());

  // Open image
  const openBtn = makeTopbarBtn('Open Image', '📂');
  openBtn.addEventListener('click', openFilePicker);
  container.appendChild(openBtn);

  // Save project
  const saveBtn = makeTopbarBtn('Save', '💾', 'Ctrl+S');
  saveBtn.addEventListener('click', () => saveProject());
  container.appendChild(saveBtn);

  // Load project
  const loadBtn = makeTopbarBtn('Load Project', '📁');
  loadBtn.addEventListener('click', openProjectPicker);
  container.appendChild(loadBtn);

  // Separator
  container.appendChild(makeSep());

  // Undo / Redo
  const undoBtn = makeTopbarBtn('Undo', '↩', 'Ctrl+Z');
  undoBtn.id = 'btn-undo';
  undoBtn.addEventListener('click', () => undo());
  container.appendChild(undoBtn);

  const redoBtn = makeTopbarBtn('Redo', '↪', 'Ctrl+Shift+Z');
  redoBtn.id = 'btn-redo';
  redoBtn.addEventListener('click', () => redo());
  container.appendChild(redoBtn);

  container.appendChild(makeSep());

  // Zoom controls
  const zoomOutBtn = makeTopbarBtn('Zoom Out', '−', '−');
  zoomOutBtn.addEventListener('click', () => zoomBy(1 / 1.3));
  container.appendChild(zoomOutBtn);

  const zoomInBtn = makeTopbarBtn('Zoom In', '+', '+');
  zoomInBtn.addEventListener('click', () => zoomBy(1.3));
  container.appendChild(zoomInBtn);

  const fitBtn = makeTopbarBtn('Fit to Window', '⊡', '0');
  fitBtn.addEventListener('click', fitToWindow);
  container.appendChild(fitBtn);

  // Spacer
  const spacer = document.createElement('div');
  spacer.className = 'flex-1';
  container.appendChild(spacer);

  // Export dropdown
  const exportWrap = document.createElement('div');
  exportWrap.className = 'relative';
  const exportBtn = makeTopbarBtn('Export', '⬇');
  exportWrap.appendChild(exportBtn);

  const menu = document.createElement('div');
  menu.className = 'dropdown-menu hidden';
  menu.innerHTML = `
    <div class="dropdown-item" data-action="csv">Export CSV (all)</div>
    <div class="dropdown-item" data-action="csv-active">Export CSV (active)</div>
    <div class="dropdown-item" data-action="excel">Export Excel (.xlsx)</div>
    <div class="dropdown-item" data-action="json">Export JSON</div>
    <div class="dropdown-item" data-action="clipboard">Copy to Clipboard</div>
    <div class="dropdown-item" data-action="latex">Export LaTeX</div>
  `;
  exportWrap.appendChild(menu);

  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  });
  menu.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).dataset.action;
    menu.classList.add('hidden');
    if (action === 'csv') exportCSV();
    else if (action === 'csv-active') exportCSV(getState().activeDatasetId ?? undefined);
    else if (action === 'excel') exportExcel();
    else if (action === 'json') exportJSON();
    else if (action === 'clipboard') exportClipboard();
    else if (action === 'latex') exportLaTeX();
  });
  document.addEventListener('click', () => menu.classList.add('hidden'));
  container.appendChild(exportWrap);

  container.appendChild(makeSep());

  // Help / shortcuts
  const helpBtn = makeTopbarBtn('Shortcuts', '?', '?');
  helpBtn.addEventListener('click', openShortcutsModal);
  container.appendChild(helpBtn);

  // Subscribe to state for undo/redo button states
  subscribe(() => {
    const undoEl = document.getElementById('btn-undo') as HTMLButtonElement | null;
    const redoEl = document.getElementById('btn-redo') as HTMLButtonElement | null;
    if (undoEl) undoEl.disabled = !canUndo();
    if (redoEl) redoEl.disabled = !canRedo();
  });

  // Shortcuts modal setup
  setupShortcutsModal();
}

function makeTopbarBtn(label: string, emoji: string, shortcut?: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'topbar-btn';
  btn.title = label + (shortcut ? ` (${shortcut})` : '');
  btn.innerHTML = `<span>${emoji}</span><span>${label}</span>`;
  return btn;
}

function makeSep(): HTMLElement {
  const s = document.createElement('div');
  s.style.cssText = 'width:1px;height:20px;background:#2a2a2a;margin:0 4px;flex-shrink:0';
  return s;
}

function openShortcutsModal(): void {
  document.getElementById('shortcuts-modal')?.classList.remove('hidden');
}

function setupShortcutsModal(): void {
  const content = document.getElementById('shortcuts-content');
  if (!content) return;

  const shortcuts = [
    ['V', 'Pointer tool'], ['C', 'Calibrate tool'], ['A', 'Add point'],
    ['T', 'Auto-trace tool'], ['M', 'Measure tool'], ['E', 'Eraser'],
    ['Space + drag', 'Pan canvas'], ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z', 'Redo'],
    ['Ctrl+S', 'Save project'], ['Ctrl+E', 'Export CSV'], ['Ctrl+A', 'Select all'],
    ['+', 'Zoom in'], ['-', 'Zoom out'], ['0', 'Fit to window'],
    ['Delete', 'Delete point'], ['Tab', 'Cycle dataset'],
    ['↑↓←→', 'Nudge point 1px'], ['Shift+↑↓←→', 'Nudge 10px'], ['?', 'Show shortcuts'],
  ];

  content.innerHTML = shortcuts.map(([k, desc]) => `
    <div class="flex items-center justify-between py-1 gap-4">
      <span style="color:#71717a;font-size:12px">${desc}</span>
      <kbd style="background:#0d0d0d;border:1px solid #2a2a2a;border-radius:3px;padding:1px 5px;font-family:monospace;font-size:11px;color:#e5e5e5;white-space:nowrap">${k}</kbd>
    </div>
  `).join('');

  document.getElementById('shortcuts-close')?.addEventListener('click', () => {
    document.getElementById('shortcuts-modal')?.classList.add('hidden');
  });
  document.getElementById('shortcuts-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      (e.currentTarget as HTMLElement).classList.add('hidden');
    }
  });
}
