/**
 * Bottom workflow dock — replaces the right sidebar + left tool panel.
 * Shows 4 step tabs: Load → Set Scale → Get Data → Measure
 * Each step renders its content from dedicated step-*.ts modules.
 */

import { getState, subscribe } from '../state/store';
import { Icons } from './icons';
import { renderStepScale } from './step-scale';
import { renderStepData } from './step-data';
import { renderStepMeasure } from './step-measure';
import { setActiveTool } from '../modules/canvas-engine';
import { startCalibration } from '../modules/calibration';
import { startScaleBar } from '../modules/scale-bar';
import { startPerspective } from '../modules/perspective';
import { goToPage } from '../modules/image-loader';
import { setState } from '../state/store';
import {
  isBatchActive, getQueue, getCurrentIndex, cancelBatch, clearBatch,
  skipCurrent, markCurrentDone, onBatchProgress,
  getReuseCalibration, setReuseCalibration,
} from '../modules/batch';
import type { Tool } from '../state/types';

type DockStep = 'load' | 'scale' | 'data' | 'measure';

let activeStep: DockStep = 'load';
let collapsed = false;
let dockDebounce: ReturnType<typeof setTimeout> | null = null;
let dockNavEl: HTMLElement | null = null;
let dockContentEl: HTMLElement | null = null;

const DOCK_HEIGHT = 300;

export function initDock(): void {
  const dockEl    = document.getElementById('dock');
  dockNavEl       = document.getElementById('dock-nav');
  dockContentEl   = document.getElementById('dock-content');
  if (!dockEl || !dockNavEl || !dockContentEl) return;

  dockEl.style.height = `${DOCK_HEIGHT}px`;

  renderNav();
  renderContent();

  // Re-render on state change (debounced)
  subscribe(() => {
    if (dockDebounce) clearTimeout(dockDebounce);
    dockDebounce = setTimeout(() => { renderNav(); renderContent(); }, 60);
  });

  // Also re-render when batch progress changes
  onBatchProgress(() => { renderNav(); renderContent(); });
}

function setStep(step: DockStep): void {
  activeStep = step;
  renderNav();
  renderContent();
}

function renderNav(): void {
  if (!dockNavEl) return;
  const state = getState();
  const hasImage = state.image.width > 0;
  const hasScale = state.calibration.isComplete;

  dockNavEl.innerHTML = '';

  // Collapse toggle
  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'dock-collapse-btn';
  collapseBtn.title = collapsed ? 'Expand panel' : 'Collapse panel';
  collapseBtn.innerHTML = collapsed ? Icons.chevronUp : Icons.chevronDown;
  collapseBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    const dock = document.getElementById('dock');
    if (dock) {
      dock.style.height = collapsed ? '40px' : `${DOCK_HEIGHT}px`;
      dock.classList.toggle('collapsed', collapsed);
    }
    renderNav();
  });
  dockNavEl.appendChild(collapseBtn);

  const steps: { id: DockStep; label: string; locked?: boolean }[] = [
    { id: 'load',    label: '1 · Load',         locked: false },
    { id: 'scale',   label: '2 · Set the Scale', locked: !hasImage },
    { id: 'data',    label: '3 · Get Data',       locked: !hasImage },
    { id: 'measure', label: '4 · Measure',        locked: !hasImage },
  ];

  steps.forEach((step, i) => {
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'dock-step-arrow';
      arrow.textContent = '›';
      dockNavEl!.appendChild(arrow);
    }

    const btn = document.createElement('button');
    btn.className = 'dock-step';
    if (step.id === activeStep) btn.classList.add('active');
    if (step.locked) { btn.disabled = true; }
    else {
      const isDone = step.id === 'load' ? hasImage
                   : step.id === 'scale' ? hasScale
                   : false;
      if (isDone && step.id !== activeStep) btn.classList.add('done');
    }

    const num = document.createElement('span');
    num.className = 'dock-step-num';
    const isDone = step.id === 'load' ? hasImage
                 : step.id === 'scale' ? hasScale
                 : false;
    num.innerHTML = isDone && step.id !== activeStep
      ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`
      : String(i + 1);
    btn.appendChild(num);
    btn.appendChild(document.createTextNode(' ' + step.label.split(' · ')[1]));

    btn.addEventListener('click', () => setStep(step.id));
    dockNavEl!.appendChild(btn);
  });

  // Spacer + tool strip in nav
  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  dockNavEl.appendChild(spacer);

  // Current tool indicator
  const toolLabel = document.createElement('span');
  toolLabel.style.cssText = 'font-size:11px;color:var(--color-muted);padding:0 8px;';
  const toolNames: Record<string, string> = {
    'pointer': 'Pointer', 'calibrate': 'Calibrate', 'add-point': 'Add Point',
    'auto-trace': 'Trace', 'measure': 'Measure', 'eraser': 'Eraser',
    'pan': 'Pan', 'pie': 'Pie', 'scale-bar': 'Scale Bar',
    'perspective': 'Perspective', 'roi': 'Focus Area', 'template': 'Find Symbol',
  };
  toolLabel.textContent = toolNames[state.activeTool] ?? state.activeTool;
  dockNavEl.appendChild(toolLabel);
}

function renderContent(): void {
  if (!dockContentEl) return;
  dockContentEl.innerHTML = '';

  if (collapsed) return;

  if (activeStep === 'load') {
    renderStepLoad(dockContentEl);
  } else if (activeStep === 'scale') {
    renderToolStrip(dockContentEl, 'scale');
    renderStepScale(dockContentEl);
  } else if (activeStep === 'data') {
    renderToolStrip(dockContentEl, 'data');
    renderStepData(dockContentEl);
  } else if (activeStep === 'measure') {
    renderToolStrip(dockContentEl, 'measure');
    renderStepMeasure(dockContentEl);
  }
}

/** Step 1 — Load (shown inside dock when no image or as status when image loaded) */
function renderStepLoad(container: HTMLElement): void {
  const state = getState();

  const wrap = document.createElement('div');
  wrap.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;gap:32px;padding:16px 32px;';

  if (state.image.width === 0) {
    // No image — show load CTA
    const textCol = document.createElement('div');
    textCol.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-width:340px;';

    const heading = document.createElement('p');
    heading.style.cssText = 'font-size:16px;font-weight:700;color:var(--color-text);letter-spacing:-0.3px;';
    heading.textContent = 'Open a chart to get started';
    textCol.appendChild(heading);

    const sub = document.createElement('p');
    sub.style.cssText = 'font-size:12px;color:var(--color-muted);line-height:1.6;';
    sub.textContent = 'Drag & drop a PNG, JPG, or PDF onto the canvas above — or paste from your clipboard with Ctrl+V.';
    textCol.appendChild(sub);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:4px;';

    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-primary btn-sm';
    openBtn.style.cssText = 'width:auto;gap:5px;';
    openBtn.innerHTML = `${Icons.folder} Open File`;
    openBtn.addEventListener('click', () => {
      document.getElementById('empty-open-btn')?.click();
    });
    btnRow.appendChild(openBtn);

    const demoBtn = document.createElement('button');
    demoBtn.className = 'btn btn-ghost btn-sm';
    demoBtn.style.width = 'auto';
    demoBtn.textContent = 'Try a demo chart';
    demoBtn.addEventListener('click', () => {
      document.getElementById('empty-demo-btn')?.click();
    });
    btnRow.appendChild(demoBtn);

    textCol.appendChild(btnRow);

    // Batch reuse calibration toggle
    const reuseRow = document.createElement('div');
    reuseRow.style.cssText = 'display:flex;align-items:center;gap:7px;margin-top:4px;';
    const reuseCheck = document.createElement('input');
    reuseCheck.type = 'checkbox';
    reuseCheck.checked = getReuseCalibration();
    reuseCheck.style.cssText = 'accent-color:var(--color-accent);cursor:pointer;width:14px;height:14px;';
    reuseCheck.addEventListener('change', () => setReuseCalibration(reuseCheck.checked));
    const reuseLabel = document.createElement('span');
    reuseLabel.style.cssText = 'font-size:11px;color:var(--color-text-2);';
    reuseLabel.textContent = 'Use same scale for all images in batch';
    reuseRow.appendChild(reuseCheck); reuseRow.appendChild(reuseLabel);
    textCol.appendChild(reuseRow);

    wrap.appendChild(textCol);

    // Illustration
    const illus = document.createElement('div');
    illus.innerHTML = `<svg width="120" height="90" viewBox="0 0 120 90" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="8" width="104" height="74" rx="8" fill="var(--color-surface-3)" stroke="var(--color-border)" stroke-width="1.5"/>
      <line x1="24" y1="68" x2="24" y2="20" stroke="var(--color-border-2)" stroke-width="1.5"/>
      <line x1="24" y1="68" x2="100" y2="68" stroke="var(--color-border-2)" stroke-width="1.5"/>
      <polyline points="30,58 44,42 58,50 72,30 86,36 98,22" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="30" cy="58" r="3" fill="var(--color-accent)"/>
      <circle cx="58" cy="50" r="3" fill="var(--color-accent)"/>
      <circle cx="86" cy="36" r="3" fill="var(--color-accent)"/>
    </svg>`;
    wrap.appendChild(illus);

  } else {
    // Image loaded
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:12px;min-width:280px;';

    // ── Batch progress UI ──────────────────────────────────────
    if (isBatchActive()) {
      const bQueue = getQueue();
      const bIdx   = getCurrentIndex();
      const done   = bQueue.filter(i => i.status === 'done' || i.status === 'skipped').length;
      const pct    = Math.round((done / bQueue.length) * 100);

      const batchSec = document.createElement('div');
      batchSec.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

      const bHeader = document.createElement('div');
      bHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
      const bTitle = document.createElement('span');
      bTitle.style.cssText = 'font-size:12px;font-weight:600;color:var(--color-text);';
      bTitle.textContent = `Batch: ${bIdx + 1} / ${bQueue.length}`;
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-danger btn-sm';
      cancelBtn.style.width = 'auto';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => { cancelBatch(); clearBatch(); });
      bHeader.appendChild(bTitle); bHeader.appendChild(cancelBtn);
      batchSec.appendChild(bHeader);

      // Progress bar
      const track = document.createElement('div');
      track.style.cssText = 'height:6px;border-radius:4px;background:var(--color-border);overflow:hidden;';
      const fill = document.createElement('div');
      fill.style.cssText = `height:100%;border-radius:4px;background:var(--color-accent);width:${pct}%;transition:width 0.3s ease;`;
      track.appendChild(fill);
      batchSec.appendChild(track);

      // Current file
      const curFile = bQueue[bIdx];
      if (curFile) {
        const fileRow = document.createElement('div');
        fileRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:var(--color-text-2);';
        fileRow.innerHTML = `${Icons.imageIcon} <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${curFile.file.name}</span>`;
        batchSec.appendChild(fileRow);
      }

      // Queue list (last 5 items)
      const listWrap = document.createElement('div');
      listWrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;max-height:80px;overflow-y:auto;';
      const statusIcon: Record<string, string> = {
        pending: '○', active: '→', done: '✓', skipped: '⚠',
      };
      const statusColor: Record<string, string> = {
        pending: 'var(--color-muted)', active: 'var(--color-accent)',
        done: 'var(--color-success)', skipped: 'var(--color-warning)',
      };
      bQueue.slice(Math.max(0, bIdx - 2), bIdx + 4).forEach(item => {
        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:6px;font-size:11px;color:${statusColor[item.status]};`;
        row.innerHTML = `<span style="flex-shrink:0;">${statusIcon[item.status]}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.file.name}</span>`;
        listWrap.appendChild(row);
      });
      batchSec.appendChild(listWrap);

      // Actions
      const actRow = document.createElement('div');
      actRow.style.cssText = 'display:flex;gap:6px;';
      const skipBtn = document.createElement('button');
      skipBtn.className = 'btn btn-ghost btn-sm';
      skipBtn.style.width = 'auto';
      skipBtn.textContent = 'Skip this image';
      skipBtn.addEventListener('click', skipCurrent);
      const doneBtn = document.createElement('button');
      doneBtn.className = 'btn btn-success btn-sm';
      doneBtn.style.flex = '1';
      doneBtn.textContent = 'Done → Next image';
      doneBtn.addEventListener('click', markCurrentDone);
      actRow.appendChild(skipBtn); actRow.appendChild(doneBtn);
      batchSec.appendChild(actRow);

      col.appendChild(batchSec);
    } else {
      // Single image status
      const dot = document.createElement('span');
      dot.className = 'status-dot ok';
      dot.textContent = `Loaded: ${state.image.filename || 'chart'}`;
      col.appendChild(dot);

      if (state.image.totalPages > 1) {
        const pdfRow = document.createElement('div');
        pdfRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
        const prevBtn = document.createElement('button');
        prevBtn.className = 'btn btn-ghost btn-sm';
        prevBtn.style.width = 'auto';
        prevBtn.innerHTML = `${Icons.arrowLeft} Prev`;
        prevBtn.disabled = state.image.currentPage <= 1;
        prevBtn.addEventListener('click', () => { goToPage(state.image.currentPage - 1); });
        const pageInfo = document.createElement('span');
        pageInfo.style.cssText = 'font-family:var(--font-mono);font-size:12px;color:var(--color-text-2);';
        pageInfo.textContent = `Page ${state.image.currentPage} / ${state.image.totalPages}`;
        const nextBtn = document.createElement('button');
        nextBtn.className = 'btn btn-ghost btn-sm';
        nextBtn.style.width = 'auto';
        nextBtn.innerHTML = `Next ${Icons.chevronRight}`;
        nextBtn.disabled = state.image.currentPage >= state.image.totalPages;
        nextBtn.addEventListener('click', () => { goToPage(state.image.currentPage + 1); });
        pdfRow.appendChild(prevBtn); pdfRow.appendChild(pageInfo); pdfRow.appendChild(nextBtn);
        col.appendChild(pdfRow);
      }

      const nextStepBtn = document.createElement('button');
      nextStepBtn.className = 'btn btn-primary btn-sm';
      nextStepBtn.style.width = 'auto';
      nextStepBtn.innerHTML = state.calibration.isComplete
        ? `Continue to Get Data ${Icons.chevronRight}`
        : `Next: Set the Scale ${Icons.chevronRight}`;
      nextStepBtn.addEventListener('click', () => setStep(state.calibration.isComplete ? 'data' : 'scale'));
      col.appendChild(nextStepBtn);
    }

    wrap.appendChild(col);
  }

  container.appendChild(wrap);
}

/** Contextual tool strip — left edge of dock for scale/data/measure steps */
function renderToolStrip(container: HTMLElement, context: 'scale' | 'data' | 'measure'): void {
  const state = getState();
  const strip = document.createElement('div');
  strip.className = 'dock-tool-strip';

  type ToolDef = { tool: Tool; icon: string; tip: string; action?: () => void };

  const TOOL_SETS: Record<string, ToolDef[]> = {
    scale: [
      { tool: 'pointer',    icon: Icons.pointer,    tip: 'Pointer (V)' },
      { tool: 'calibrate',  icon: Icons.crosshair,  tip: 'Calibrate (C)', action: () => startCalibration() },
      { tool: 'scale-bar',  icon: Icons.scaleBar,   tip: 'Scale Bar (B)', action: () => startScaleBar() },
      { tool: 'perspective', icon: Icons.perspective, tip: 'Fix Perspective (P)',
        action: () => startPerspective() },
      { tool: 'pan',        icon: Icons.hand,       tip: 'Pan (Space)' },
    ],
    data: [
      { tool: 'pointer',    icon: Icons.pointer,    tip: 'Pointer (V)' },
      { tool: 'add-point',  icon: Icons.plus,       tip: 'Add Point (A)' },
      { tool: 'auto-trace', icon: Icons.sparkles,   tip: 'Trace (T)' },
      { tool: 'eraser',     icon: Icons.eraser,     tip: 'Eraser (E)' },
      { tool: 'roi',        icon: Icons.crop,       tip: 'Focus Area (R)',
        action: () => setState(d => { d.activeTool = 'roi'; }) },
      { tool: 'pan',        icon: Icons.hand,       tip: 'Pan (Space)' },
    ],
    measure: [
      { tool: 'pointer',    icon: Icons.pointer,    tip: 'Pointer (V)' },
      { tool: 'measure',    icon: Icons.ruler,      tip: 'Measure (M)' },
      { tool: 'pan',        icon: Icons.hand,       tip: 'Pan (Space)' },
    ],
  };

  const tools = TOOL_SETS[context] ?? [];
  tools.forEach(({ tool, icon, tip, action }) => {
    const btn = document.createElement('button');
    btn.className = 'dock-tool-btn' + (state.activeTool === tool ? ' active' : '');
    btn.innerHTML = icon;
    btn.setAttribute('data-tip', tip);
    btn.title = tip;
    btn.addEventListener('click', () => {
      if (action) action();
      else setActiveTool(tool);
    });
    strip.appendChild(btn);
  });

  container.appendChild(strip);
}
