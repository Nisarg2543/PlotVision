import { getState, subscribe } from '../state/store';
import { fitToWindow, zoomBy } from '../modules/canvas-engine';
import { undo, redo, canUndo, canRedo } from '../modules/history';
import { openFilePicker } from '../modules/image-loader';
import { saveProject, openProjectPicker } from '../modules/project';
import { exportCSV, exportExcel, exportJSON, exportClipboard, exportLaTeX } from '../modules/export';
import { openBatchPicker, isBatchActive, markCurrentDone, skipCurrent, getQueue, getCurrentIndex } from '../modules/batch';

const I = {
  logo:    `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect width="18" height="18" rx="4" fill="#22d3ee" fill-opacity="0.15"/><path d="M3 13.5 6.5 8 10 10.5 13.5 4.5" stroke="#22d3ee" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.5" cy="8" r="1.2" fill="#22d3ee"/><circle cx="10" cy="10.5" r="1.2" fill="#22d3ee"/><circle cx="13.5" cy="4.5" r="1.2" fill="#22d3ee"/></svg>`,
  open:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  save:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
  load:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  undo:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`,
  redo:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>`,
  zoomIn:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
  zoomOut: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
  fit:     `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`,
  export:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  help:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  chevron: `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`,
};

function mkBtn(icon: string, label: string, title: string, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `tb-btn ${cls}`.trim();
  b.title = title;
  b.innerHTML = label ? `${icon}<span>${label}</span>` : icon;
  return b;
}

function mkDivider(): HTMLElement {
  const d = document.createElement('div');
  d.className = 'tb-divider';
  return d;
}

export function initToolbar(container: HTMLElement): void {
  container.innerHTML = '';

  // Logo
  const logo = document.createElement('div');
  logo.className = 'tb-logo';
  logo.innerHTML = `${I.logo}<span class="tb-logo-text">PlotVision</span>`;
  container.appendChild(logo);
  container.appendChild(mkDivider());

  // Open image
  const openBtn = mkBtn(I.open, 'Open', 'Open image or PDF');
  openBtn.addEventListener('click', openFilePicker);
  container.appendChild(openBtn);

  // Save project
  const saveBtn = mkBtn(I.save, 'Save', 'Save project — Ctrl+S');
  saveBtn.id = 'tb-save';
  saveBtn.addEventListener('click', () => saveProject());
  container.appendChild(saveBtn);

  // Load project
  const loadBtn = mkBtn(I.load, 'Load', 'Load .pvz project — Ctrl+O');
  loadBtn.addEventListener('click', openProjectPicker);
  container.appendChild(loadBtn);

  // Batch
  const batchBtn = mkBtn(
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>`,
    'Batch', 'Load multiple images for batch processing'
  );
  batchBtn.id = 'tb-batch';
  batchBtn.addEventListener('click', () => {
    if (isBatchActive()) openBatchStatusModal();
    else openBatchPicker();
  });
  container.appendChild(batchBtn);

  container.appendChild(mkDivider());

  // Undo / Redo
  const undoBtn = mkBtn(I.undo, 'Undo', 'Undo — Ctrl+Z');
  undoBtn.id = 'tb-undo';
  undoBtn.addEventListener('click', undo);
  container.appendChild(undoBtn);

  const redoBtn = mkBtn(I.redo, 'Redo', 'Redo — Ctrl+Shift+Z');
  redoBtn.id = 'tb-redo';
  redoBtn.addEventListener('click', redo);
  container.appendChild(redoBtn);

  container.appendChild(mkDivider());

  // Zoom
  const zoomInBtn = mkBtn(I.zoomIn, '', 'Zoom in (+)');
  zoomInBtn.addEventListener('click', () => zoomBy(1.3));
  container.appendChild(zoomInBtn);

  const zoomOutBtn = mkBtn(I.zoomOut, '', 'Zoom out (−)');
  zoomOutBtn.addEventListener('click', () => zoomBy(1 / 1.3));
  container.appendChild(zoomOutBtn);

  const fitBtn = mkBtn(I.fit, 'Fit', 'Fit to window (0)');
  fitBtn.addEventListener('click', fitToWindow);
  container.appendChild(fitBtn);

  // Spacer
  const spacer = document.createElement('div');
  spacer.className = 'tb-spacer';
  container.appendChild(spacer);

  // Export
  const exportBtn = mkBtn(I.export + I.chevron, 'Export', 'Export data', 'tb-btn-accent');
  exportBtn.style.gap = '5px';
  exportBtn.addEventListener('click', openExportModal);
  container.appendChild(exportBtn);

  container.appendChild(mkDivider());

  // Help
  const helpBtn = mkBtn(I.help, '', 'Keyboard shortcuts (?)');
  helpBtn.addEventListener('click', () => {
    (document.getElementById('shortcuts-modal') as HTMLElement).style.display = 'flex';
  });
  container.appendChild(helpBtn);

  // Keep undo/redo synced
  const syncUndoRedo = () => {
    (document.getElementById('tb-undo') as HTMLButtonElement).disabled = !canUndo();
    (document.getElementById('tb-redo') as HTMLButtonElement).disabled = !canRedo();
  };
  syncUndoRedo();
  subscribe(syncUndoRedo);

  buildShortcutsModal();
}

function openExportModal(): void {
  const modal = document.getElementById('export-modal') as HTMLElement;
  const body  = document.getElementById('export-modal-body') as HTMLElement;
  const state = getState();
  const activeDs = state.datasets.find(d => d.id === state.activeDatasetId);

  body.innerHTML = '';
  body.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:14px 18px 18px;';

  const rows: { label: string; sub: string; action: () => void; disabled?: boolean }[] = [
    { label: 'CSV — All datasets',   sub: 'Comma-separated, one row per point',    action: () => exportCSV() },
    { label: 'CSV — Active dataset', sub: activeDs ? `"${activeDs.name}"` : 'No dataset selected', action: () => activeDs ? exportCSV(activeDs.id) : undefined, disabled: !activeDs },
    { label: 'Excel (.xlsx)',        sub: 'Each dataset on a separate sheet',       action: () => exportExcel() },
    { label: 'JSON',                 sub: 'Structured with calibration metadata',   action: () => exportJSON() },
    { label: 'Copy to Clipboard',    sub: 'Tab-separated, paste into Excel/Sheets', action: () => exportClipboard() },
    { label: 'LaTeX table',          sub: '\\tabular environment',                 action: () => exportLaTeX() },
  ];

  for (const row of rows) {
    const btn = document.createElement('button');
    btn.disabled = !!row.disabled;
    btn.style.cssText = `display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;padding:10px 12px;border-radius:7px;border:1px solid var(--color-border);background:var(--color-bg);cursor:${row.disabled ? 'not-allowed' : 'pointer'};opacity:${row.disabled ? '0.4' : '1'};transition:border-color 0.12s,background 0.12s;text-align:left;`;
    btn.innerHTML = `<span style="font-size:12px;font-weight:600;color:var(--color-text);">${row.label}</span><span style="font-size:11px;color:var(--color-muted);">${row.sub}</span>`;
    if (!row.disabled) {
      btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--color-border-2)'; btn.style.background = 'var(--color-faint)'; });
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--color-border)';   btn.style.background = 'var(--color-bg)'; });
      btn.addEventListener('click', () => { row.action(); modal.style.display = 'none'; });
    }
    body.appendChild(btn);
  }

  modal.style.display = 'flex';
  document.getElementById('export-modal-close')!.onclick = () => { modal.style.display = 'none'; };
  modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };
}

function openBatchStatusModal(): void {
  const queue = getQueue();
  const idx   = getCurrentIndex();

  // Build an inline modal showing queue status
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.display = 'flex';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.width = '420px';

  const statusColors: Record<string, string> = { pending: '#555', active: '#22d3ee', done: '#34d399', skipped: '#f59e0b' };

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Batch Queue (${idx + 1} / ${queue.length})</span>
      <button class="modal-close" id="batch-modal-close">×</button>
    </div>
    <div style="max-height:300px;overflow-y:auto;padding:12px 18px;display:flex;flex-direction:column;gap:6px;">
      ${queue.map((item, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;background:${i === idx ? 'color-mix(in srgb,#22d3ee 6%,transparent)' : 'var(--color-bg)'};border:1px solid ${i === idx ? '#22d3ee33' : 'var(--color-border)'};">
          <div style="width:8px;height:8px;border-radius:50%;background:${statusColors[item.status]};flex-shrink:0;"></div>
          <span style="flex:1;font-size:12px;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.file.name}</span>
          <span style="font-size:10px;color:var(--color-muted);text-transform:uppercase;letter-spacing:0.05em;">${item.status}</span>
        </div>
      `).join('')}
    </div>
    <div style="display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--color-border);">
      <button id="batch-skip"  class="btn btn-ghost  btn-sm" style="width:auto;">Skip this image</button>
      <button id="batch-done"  class="btn btn-success btn-sm" style="flex:1;">Done → Next image</button>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  modal.querySelector('#batch-modal-close')!.addEventListener('click', close);
  modal.querySelector('#batch-skip')!.addEventListener('click', () => { skipCurrent(); close(); });
  modal.querySelector('#batch-done')!.addEventListener('click', () => { markCurrentDone(); close(); });
}

function buildShortcutsModal(): void {
  const content = document.getElementById('shortcuts-content')!;
  const shortcuts: [string, string][] = [
    ['V', 'Pointer tool'],       ['C', 'Calibrate'],
    ['A', 'Add point'],          ['T', 'Auto-trace'],
    ['M', 'Measure'],            ['E', 'Eraser'],
    ['Space+drag', 'Pan'],       ['0', 'Fit to window'],
    ['+', 'Zoom in'],            ['−', 'Zoom out'],
    ['Ctrl+Z', 'Undo'],          ['Ctrl+Shift+Z', 'Redo'],
    ['Ctrl+S', 'Save project'],  ['Ctrl+O', 'Load project'],
    ['Ctrl+E', 'Export CSV'],    ['Ctrl+A', 'Select all'],
    ['Delete', 'Delete point'],  ['Tab', 'Cycle dataset'],
    ['↑↓←→', 'Nudge 1px'],      ['Shift+↑↓←→', 'Nudge 10px'],
    ['?', 'Shortcuts'],          ['Esc', 'Close dialogs'],
  ];

  content.innerHTML = shortcuts.map(([key, desc]) => `
    <div class="shortcut-row">
      <span class="shortcut-desc">${desc}</span>
      <kbd>${key}</kbd>
    </div>
  `).join('');

  document.getElementById('shortcuts-close')!.onclick = () => {
    (document.getElementById('shortcuts-modal') as HTMLElement).style.display = 'none';
  };
  document.getElementById('shortcuts-modal')!.addEventListener('click', e => {
    if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).style.display = 'none';
  });
}
