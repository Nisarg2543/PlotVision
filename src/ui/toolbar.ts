import { getState, setState, subscribe } from '../state/store';
import { esc } from '../utils/sanitize';
import { startTour } from './onboarding';
import { fitToWindow, zoomBy } from '../modules/canvas-engine';
import { undo, redo, canUndo, canRedo } from '../modules/history';
import { openFilePicker } from '../modules/image-loader';
import { saveProject, openProjectPicker } from '../modules/project';
import { exportCSV, exportExcel, exportJSON, exportClipboard, exportLaTeX, exportPlotly, exportProjectTar, exportSVG, exportPNGOverlay, exportComparison } from '../modules/export';
import { openBatchPicker, isBatchActive, markCurrentDone, skipCurrent, getQueue, getCurrentIndex } from '../modules/batch';
import { Icons } from './icons';
import { trapFocus } from '../utils/modal';
import { openSettingsModal } from './settings-modal';

function mkBtn(inner: string, label: string, title: string, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `tb-btn ${cls}`.trim();
  b.title = title;
  b.innerHTML = label ? `${inner}<span>${label}</span>` : inner;
  return b;
}

function mkDivider(): HTMLElement {
  const d = document.createElement('div');
  d.className = 'tb-divider';
  return d;
}

export function initToolbar(container: HTMLElement): void {
  container.innerHTML = '';

  // Logo — indigo themed
  const logo = document.createElement('div');
  logo.className = 'tb-logo';
  logo.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect width="20" height="20" rx="5" fill="#6366f1" fill-opacity="0.15"/>
      <path d="M4 14.5 7.5 9 11 11.5 14.5 5" stroke="#6366f1" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="7.5" cy="9" r="1.3" fill="#6366f1"/>
      <circle cx="11" cy="11.5" r="1.3" fill="#6366f1"/>
      <circle cx="14.5" cy="5" r="1.3" fill="#6366f1"/>
    </svg>
    <span class="tb-logo-text">PlotVision</span>
  `;
  container.appendChild(logo);
  container.appendChild(mkDivider());

  // Open image
  const openBtn = mkBtn(Icons.folder, 'Open', 'Open image or PDF (Ctrl+O to load project)');
  openBtn.addEventListener('click', openFilePicker);
  container.appendChild(openBtn);

  // Save project
  const saveBtn = mkBtn(Icons.save, 'Save', 'Save project — Ctrl+S');
  saveBtn.id = 'tb-save';
  saveBtn.addEventListener('click', () => saveProject());
  container.appendChild(saveBtn);

  // Load project
  const loadBtn = mkBtn(Icons.upload, 'Load', 'Load .pvz project — Ctrl+O');
  loadBtn.addEventListener('click', openProjectPicker);
  container.appendChild(loadBtn);

  // Batch
  const batchBtn = mkBtn(Icons.batch, 'Batch', 'Load multiple images for batch processing');
  batchBtn.id = 'tb-batch';
  batchBtn.addEventListener('click', () => {
    if (isBatchActive()) openBatchStatusModal();
    else openBatchPicker();
  });
  container.appendChild(batchBtn);

  container.appendChild(mkDivider());

  // Undo / Redo
  const undoBtn = mkBtn(Icons.undo, '', 'Undo — Ctrl+Z');
  undoBtn.id = 'tb-undo';
  undoBtn.title = 'Undo (Ctrl+Z)';
  undoBtn.addEventListener('click', undo);
  container.appendChild(undoBtn);

  const redoBtn = mkBtn(Icons.redo, '', 'Redo — Ctrl+Shift+Z');
  redoBtn.id = 'tb-redo';
  redoBtn.title = 'Redo (Ctrl+Shift+Z)';
  redoBtn.addEventListener('click', redo);
  container.appendChild(redoBtn);

  container.appendChild(mkDivider());

  // Zoom
  const zoomInBtn = mkBtn(Icons.zoomIn, '', 'Zoom in (+)');
  zoomInBtn.addEventListener('click', () => zoomBy(1.3));
  container.appendChild(zoomInBtn);

  const zoomOutBtn = mkBtn(Icons.zoomOut, '', 'Zoom out (−)');
  zoomOutBtn.addEventListener('click', () => zoomBy(1 / 1.3));
  container.appendChild(zoomOutBtn);

  const fitBtn = mkBtn(Icons.fit, 'Fit', 'Fit to window (0)');
  fitBtn.addEventListener('click', fitToWindow);
  container.appendChild(fitBtn);

  // Spacer
  const spacer = document.createElement('div');
  spacer.className = 'tb-spacer';
  container.appendChild(spacer);

  // Compare / Reference
  const compareBtn = mkBtn(Icons.compare, 'Compare', 'Save or load a reference session for comparison');
  compareBtn.id = 'tb-compare';
  compareBtn.addEventListener('click', openCompareMenu);
  container.appendChild(compareBtn);

  // Export — accent button
  const exportBtn = mkBtn(Icons.download + Icons.chevronDown, 'Export', 'Export data', 'tb-btn-accent');
  exportBtn.addEventListener('click', openExportModal);
  container.appendChild(exportBtn);

  container.appendChild(mkDivider());

  // Dark mode toggle
  const isDark = () => document.body.classList.contains('dark');
  const darkBtn = mkBtn(isDark() ? Icons.sun : Icons.moon, '', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
  darkBtn.setAttribute('aria-label', isDark() ? 'Light mode' : 'Dark mode');
  darkBtn.addEventListener('click', () => {
    const nowDark = document.body.classList.toggle('dark');
    localStorage.setItem('plotvision-theme', nowDark ? 'dark' : 'light');
    // Update icon
    darkBtn.innerHTML = nowDark ? Icons.sun : Icons.moon;
    darkBtn.title = nowDark ? 'Switch to light mode' : 'Switch to dark mode';
  });
  container.appendChild(darkBtn);

  // Feedback
  const feedbackBtn = mkBtn(Icons.message, '', 'Send feedback');
  feedbackBtn.setAttribute('aria-label', 'Send feedback');
  feedbackBtn.addEventListener('click', () => {
    window.open('https://github.com/Nisarg2543/PlotVision/issues/new?labels=feedback&title=Feedback%3A+', '_blank', 'noopener,noreferrer');
  });
  container.appendChild(feedbackBtn);

  // Tour
  const tourBtn = mkBtn(Icons.info, 'Tour', 'Take the guided tour');
  tourBtn.setAttribute('aria-label', 'Take the guided tour');
  tourBtn.addEventListener('click', () => {
    localStorage.removeItem('plotvision-onboarded-v1');
    startTour();
  });
  container.appendChild(tourBtn);

  // Help / Shortcuts
  const helpBtn = mkBtn(Icons.help, '', 'Keyboard shortcuts (?)');
  helpBtn.setAttribute('aria-label', 'Keyboard shortcuts');
  helpBtn.addEventListener('click', () => {
    (document.getElementById('shortcuts-modal') as HTMLElement).style.display = 'flex';
  });
  container.appendChild(helpBtn);

  // Settings
  const settingsBtn = mkBtn(Icons.settings, '', 'Settings');
  settingsBtn.setAttribute('aria-label', 'Settings');
  settingsBtn.addEventListener('click', () => {
    openSettingsModal();
  });
  container.appendChild(settingsBtn);

  // Keep undo/redo synced with state
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

  const totalPoints = state.datasets.reduce((sum, d) => sum + d.points.length, 0);
  const dsCount = state.datasets.length;
  const baseFilename = state.image.filename.replace(/\.[^.]+$/, '') || 'plotvision';

  body.innerHTML = '';

  // Summary strip
  const summary = document.createElement('div');
  summary.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 18px;border-bottom:1px solid var(--color-border);background:var(--color-surface-3);font-size:11px;color:var(--color-muted);gap:12px;';
  summary.innerHTML = `
    <span><strong style="color:var(--color-text);font-family:var(--font-mono);">${totalPoints}</strong> points &nbsp;·&nbsp; <strong style="color:var(--color-text);font-family:var(--font-mono);">${dsCount}</strong> series</span>
    <span style="font-family:var(--font-mono);color:var(--color-text-2);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;" title="${esc(baseFilename)}">${esc(baseFilename)}</span>
  `;
  body.appendChild(summary);

  const btnWrap = document.createElement('div');
  btnWrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;padding:12px 18px 16px;';

  const hasReference = !!getState().reference;
  const rows: { label: string; sub: string; action: () => void; disabled?: boolean }[] = [
    { label: 'CSV — All series',      sub: `${totalPoints} points across all series`,         action: () => exportCSV() },
    { label: 'CSV — Active series',   sub: activeDs ? `"${esc(activeDs.name)}" · ${activeDs.points.length} pts` : 'No series selected', action: () => activeDs ? exportCSV(activeDs.id) : undefined, disabled: !activeDs },
    { label: 'Excel (.xlsx)',         sub: 'Each series on a separate sheet',                  action: () => exportExcel() },
    { label: 'JSON',                  sub: 'Structured with calibration metadata',             action: () => exportJSON() },
    { label: 'Copy to Clipboard',     sub: 'Tab-separated, paste into Excel / Google Sheets', action: () => exportClipboard() },
    { label: 'LaTeX table',           sub: '\\tabular{cc} environment',                       action: () => exportLaTeX() },
    { label: 'Plotly HTML',           sub: 'Interactive chart — open in any browser',         action: () => exportPlotly() },
    { label: 'SVG',                   sub: 'Points as vector graphics (pixel coordinates)',   action: () => exportSVG() },
    { label: 'PNG with points',       sub: 'Original image + all points drawn on top',        action: () => void exportPNGOverlay() },
    { label: 'CSV — With reference',  sub: hasReference ? 'Current + saved reference, with Source column' : 'Save a reference first via Compare', action: () => exportComparison(), disabled: !hasReference },
    { label: 'Project bundle (.tar)', sub: 'Image + calibration + all data bundled',          action: () => void exportProjectTar() },
  ];

  for (const row of rows) {
    const btn = document.createElement('button');
    btn.disabled = !!row.disabled;
    btn.style.cssText = `display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;padding:9px 12px;border-radius:9px;border:1.5px solid var(--color-border);background:var(--color-surface);cursor:${row.disabled ? 'not-allowed' : 'pointer'};opacity:${row.disabled ? '0.4' : '1'};transition:border-color 0.12s,background 0.12s;text-align:left;`;
    const lblEl = document.createElement('span'); lblEl.style.cssText = 'font-size:12px;font-weight:600;color:var(--color-text);'; lblEl.textContent = row.label;
    const subEl = document.createElement('span'); subEl.style.cssText = 'font-size:11px;color:var(--color-muted);'; subEl.textContent = row.sub;
    btn.appendChild(lblEl); btn.appendChild(subEl);
    if (!row.disabled) {
      btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--color-accent)'; btn.style.background = 'var(--color-accent-dim)'; });
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--color-border)'; btn.style.background = 'var(--color-surface)'; });
      btn.addEventListener('click', () => { row.action(); modal.style.display = 'none'; });
    }
    btnWrap.appendChild(btn);
  }
  body.appendChild(btnWrap);

  modal.style.display = 'flex';
  const closeExport = () => { modal.style.display = 'none'; releaseExport(); };
  document.getElementById('export-modal-close')!.onclick = closeExport;
  modal.onclick = e => { if (e.target === modal) closeExport(); };
  const releaseExport = trapFocus(modal.querySelector('.modal') as HTMLElement, closeExport);
}

function openBatchStatusModal(): void {
  const queue = getQueue();
  const idx   = getCurrentIndex();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.display = 'flex';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.width = '440px';

  const statusColors: Record<string, string> = {
    pending: 'var(--color-muted)', active: 'var(--color-accent)',
    done: 'var(--color-success)', skipped: 'var(--color-warning)',
  };

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Batch Queue (${idx + 1} / ${queue.length})</span>
      <button class="modal-close" id="batch-modal-close">×</button>
    </div>
    <div style="max-height:300px;overflow-y:auto;padding:12px 18px;display:flex;flex-direction:column;gap:6px;">
      ${queue.map((item, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:${i === idx ? 'var(--color-accent-dim)' : 'var(--color-bg)'};border:1.5px solid ${i === idx ? 'var(--color-accent)' : 'var(--color-border)'};">
          <div style="width:8px;height:8px;border-radius:50%;background:${statusColors[item.status]};flex-shrink:0;"></div>
          <span style="flex:1;font-size:12px;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.file.name}</span>
          <span style="font-size:10px;color:var(--color-muted);text-transform:uppercase;letter-spacing:0.05em;">${item.status}</span>
        </div>
      `).join('')}
    </div>
    <div style="display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--color-border);">
      <button id="batch-skip" class="btn btn-ghost  btn-sm" style="width:auto;">Skip this image</button>
      <button id="batch-done" class="btn btn-success btn-sm" style="flex:1;">Done → Next image</button>
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
  const content = document.getElementById('shortcuts-content');
  if (!content) return;
  const shortcuts: [string, string][] = [
    ['V', 'Pointer tool'],       ['C', 'Set scale (calibrate)'],
    ['A', 'Add point'],          ['T', 'Trace tool'],
    ['M', 'Measure'],            ['E', 'Eraser'],
    ['B', 'Scale bar'],          ['P', 'Fix perspective'],
    ['R', 'Focus area (RoI)'],   ['Space+drag', 'Pan'],
    ['0', 'Fit to window'],      ['+/−', 'Zoom in / out'],
    ['Ctrl+Z', 'Undo'],          ['Ctrl+Shift+Z', 'Redo'],
    ['Ctrl+S', 'Save project'],  ['Ctrl+O', 'Load project'],
    ['Ctrl+E', 'Export CSV'],    ['Tab', 'Cycle series'],
    ['Delete', 'Delete point'],  ['↑↓←→', 'Nudge 1px'],
    ['Shift+↑↓←→', 'Nudge 10px'], ['?', 'Shortcuts'],
    ['Esc', 'Close dialogs'],
  ];

  content.innerHTML = shortcuts.map(([key, desc]) => `
    <div class="shortcut-row">
      <span class="shortcut-desc">${desc}</span>
      <kbd>${key}</kbd>
    </div>
  `).join('');

  const shortcutsModal = document.getElementById('shortcuts-modal') as HTMLElement;
  const closeShortcuts = () => { shortcutsModal.style.display = 'none'; };
  document.getElementById('shortcuts-close')!.onclick = closeShortcuts;
  shortcutsModal.addEventListener('click', e => { if (e.target === shortcutsModal) closeShortcuts(); });
  // Set up Escape key trap once (modal reuses same DOM)
  shortcutsModal.addEventListener('keydown', e => { if (e.key === 'Escape') closeShortcuts(); }, { capture: true });
}

function openCompareMenu(): void {
  const state = getState();
  const hasRef = !!state.reference;
  const btn = document.getElementById('tb-compare') as HTMLElement;

  // Remove any existing dropdown
  document.querySelector('.compare-dropdown')?.remove();

  const drop = document.createElement('div');
  drop.className = 'dropdown compare-dropdown';
  drop.style.cssText = 'position:fixed;z-index:500;min-width:240px;';

  const rect = btn.getBoundingClientRect();
  drop.style.left = `${rect.left}px`;
  drop.style.top  = `${rect.bottom + 4}px`;

  const items: { label: string; sub: string; action: () => void; destructive?: boolean }[] = [
    {
      label: 'Save as Reference',
      sub: `${state.datasets.length} series → save as Image A`,
      action: () => {
        setState(d => {
          d.reference = {
            label: state.image.filename || 'Reference',
            datasets: JSON.parse(JSON.stringify(state.datasets)),
          };
        });
        import('../utils/toast').then(m => m.showToast('Reference saved — load a new image for Image B', 'success', 4000));
        drop.remove();
      },
    },
    ...(hasRef ? [{
      label: 'Clear reference',
      sub: `Currently saved: "${state.reference!.label}"`,
      action: () => {
        setState(d => { d.reference = undefined; });
        import('../utils/toast').then(m => m.showToast('Reference cleared', 'info'));
        drop.remove();
      },
      destructive: true,
    }] : []),
    {
      label: 'Export with reference (CSV)',
      sub: hasRef ? 'Combines current + reference with Source column' : 'Save a reference first',
      action: () => { exportComparison(); drop.remove(); },
    },
  ];

  for (const item of items) {
    const el = document.createElement('div');
    el.style.cssText = `padding:9px 13px;cursor:pointer;${item.destructive ? 'color:var(--color-error);' : ''}`;
    el.innerHTML = `
      <div style="font-size:12px;font-weight:600;color:${item.destructive ? 'var(--color-error)' : 'var(--color-text)'};">${item.label}</div>
      <div style="font-size:10px;color:var(--color-muted);">${item.sub}</div>
    `;
    el.addEventListener('mouseenter', () => { el.style.background = 'var(--color-faint)'; });
    el.addEventListener('mouseleave', () => { el.style.background = ''; });
    el.addEventListener('click', item.action);
    drop.appendChild(el);
  }

  document.body.appendChild(drop);
  const close = (e: MouseEvent) => {
    if (!drop.contains(e.target as Node) && e.target !== btn) {
      drop.remove();
      document.removeEventListener('click', close, true);
    }
  };
  setTimeout(() => document.addEventListener('click', close, true), 10);
}
