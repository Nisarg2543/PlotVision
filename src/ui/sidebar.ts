import { getState, setState, subscribe } from '../state/store';
import {
  addDataset, removeDataset, setActiveDataset, toggleDatasetVisibility,
  renameDataset, setDatasetColor, duplicateDataset, sortDatasetPoints, clearDatasetPoints,
} from '../modules/datasets';
import { handleCalibValueConfirm, resetCalibration, getWizardPrompt, startCalibration, handlePolarRConfirm } from '../modules/calibration';
import { updatePointData, deletePoint as deleteDataPoint } from '../modules/digitizer';
import { goToPage } from '../modules/image-loader';
import { getAutoTraceSettings, setAutoTraceSettings, runAutoTrace, commitAutoTrace, clearPreview, setPreviewData } from '../modules/auto-trace';
import { defaultBarSettings, detectBars, detectAllBarLayers } from '../modules/bar-detector';
import { defaultScatterSettings, detectScatterPoints } from '../modules/scatter-detector';
import type { BarDetectorSettings } from '../modules/bar-detector';
import type { ScatterDetectorSettings } from '../modules/scatter-detector';
import { startPie, resetPie, undoLastBoundary, commitPieSectors, computeSectors, getPieStep, getPieBoundaryCount, setPieTotalValue, getPieTotalValue } from '../modules/pie-detector';
import { startScaleBar, resetScaleBar, commitScaleBar, getScaleBarStep, isScaleBarSet, getScaleBarUnit, getPixelsPerUnit } from '../modules/scale-bar';
import { detectChartType, getChartTypeLabel } from '../modules/auto-detect';
import { getImageBitmap } from '../modules/canvas-engine';
import { startPerspective, resetPerspective, undoLastCorner, getPerspectiveStep, getPerspectiveCorners } from '../modules/perspective';
import { render as canvasRender } from '../modules/canvas-engine';
import { showToast } from '../utils/toast';
import type { ExtractionMode } from '../state/types';
import { updatePreview } from '../ui/preview-panel';
import { getMeasureMode, setMeasureMode, reset as resetMeasure, getMeasureResult, getMeasurePoints } from '../modules/measure';
import type { CalibPointRole } from '../state/types';

type Tab = 'calibrate' | 'data' | 'trace' | 'measure';
let activeTab: Tab = 'calibrate';

const TABS: { id: Tab; label: string }[] = [
  { id: 'calibrate', label: 'Calibrate' },
  { id: 'data',      label: 'Data' },
  { id: 'trace',     label: 'Trace' },
  { id: 'measure',   label: 'Measure' },
];

const STEP_TO_ROLE: Partial<Record<string, CalibPointRole>> = {
  'await-x1-value': 'x1', 'await-x2-value': 'x2',
  'await-y1-value': 'y1', 'await-y2-value': 'y2',
};

let sidebarDebounce: ReturnType<typeof setTimeout> | null = null;
let sidebarBodyEl: HTMLElement | null = null;

function initSidebarDebounced(): void {
  if (!sidebarBodyEl) return;
  if (sidebarDebounce) clearTimeout(sidebarDebounce);
  sidebarDebounce = setTimeout(() => renderBody(sidebarBodyEl!), 0);
}

export function initSidebar(_container: HTMLElement): void {
  const tabsEl = document.getElementById('panel-tabs');
  const bodyEl = document.getElementById('panel-body');
  if (!tabsEl || !bodyEl) return;
  sidebarBodyEl = bodyEl;

  tabsEl.innerHTML = '';
  TABS.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'panel-tab' + (t.id === activeTab ? ' active' : '');
    btn.textContent = t.label;
    btn.dataset.tab = t.id;
    btn.addEventListener('click', () => {
      // Clear auto-trace preview when leaving trace tab
      if (activeTab === 'trace' && t.id !== 'trace') {
        window.__autoTraceMod = null;
        clearPreview();
      }
      activeTab = t.id;
      tabsEl.querySelectorAll('.panel-tab').forEach(b =>
        b.classList.toggle('active', (b as HTMLElement).dataset.tab === t.id)
      );
      renderBody(bodyEl);
    });
    tabsEl.appendChild(btn);
  });

  renderBody(bodyEl);

  // Debounce re-renders — state can change on every wheel tick (zoom/pan)
  subscribe(() => {
    if (sidebarDebounce) clearTimeout(sidebarDebounce);
    sidebarDebounce = setTimeout(() => renderBody(bodyEl), 60);
  });
}

function renderBody(el: HTMLElement): void {
  el.innerHTML = '';
  if (activeTab === 'calibrate') renderCalibTab(el);
  else if (activeTab === 'data')    renderDataTab(el);
  else if (activeTab === 'trace')   renderTraceTab(el);
  else if (activeTab === 'measure') renderMeasureTab(el);
}

// ── Calibrate ─────────────────────────────────────────────────

function renderCalibTab(el: HTMLElement): void {
  const state = getState();
  const cal   = state.calibration;

  const statusSec = makeSec('Axis Calibration');
  const sb = makeSecBody(statusSec);

  const statusRow = makeRow('between');
  if (cal.isComplete) {
    statusRow.innerHTML = `<span class="status-dot ok">Calibrated</span>`;
    const resetBtn = makeBtn('Reset', 'btn btn-ghost btn-sm');
    resetBtn.addEventListener('click', resetCalibration);
    statusRow.appendChild(resetBtn);
  } else if (cal.step !== 'idle') {
    statusRow.innerHTML = `<span class="status-dot busy">Calibrating…</span>`;
  } else {
    statusRow.innerHTML = `<span class="status-dot err">Not calibrated</span>`;
  }
  sb.appendChild(statusRow);

  if (!cal.isComplete) {
    sb.appendChild(makeLbl('Axis type'));
    const axisSel = makeSelect([
      ['xy-linear','XY Linear'], ['xy-log-x','Semi-log (log X)'],
      ['xy-log-y','Semi-log (log Y)'], ['xy-log-xy','Log-log'],
      ['polar','Polar (R-θ)'], ['ternary','Ternary'],
      ['date-x','Date/Time X'], ['map','Map / Pixels only'],
    ], cal.axisType);
    axisSel.addEventListener('change', () => setState(d => { d.calibration.axisType = axisSel.value as any; }));
    sb.appendChild(axisSel);
  }

  if (cal.step === 'idle' && !cal.isComplete) {
    const startBtn = makeBtn('Start Calibration →', 'btn btn-primary');
    startBtn.addEventListener('click', startCalibration);
    sb.appendChild(startBtn);
  }
  el.appendChild(statusSec);

  // Wizard — branch on axis type for polar/ternary vs standard XY
  if (cal.step !== 'idle' && cal.step !== 'complete') {
    const wizEl = document.createElement('div');
    wizEl.className = 'ps';

    if (cal.axisType === 'polar') {
      // Polar 3-step wizard
      const steps = ['polar-place-center', 'polar-place-ref', 'polar-await-r'];
      const idx = steps.indexOf(cal.step);
      const pips = makeDiv('calib-progress');
      steps.forEach((_, i) => {
        const pip = makeDiv('calib-pip');
        if (i < idx) pip.classList.add('done');
        if (i === idx) pip.classList.add('active');
        pips.appendChild(pip);
      });
      wizEl.appendChild(pips);
      const lbl = makeDiv('calib-action-label');
      lbl.textContent = `Step ${idx + 1} of 3`;
      wizEl.appendChild(lbl);
      const hint = makeDiv('calib-hint');
      hint.textContent = getWizardPrompt();
      wizEl.appendChild(hint);

      if (cal.step === 'polar-await-r') {
        const inp = document.createElement('input');
        inp.className = 'pv-input';
        inp.type = 'number';
        inp.placeholder = 'Radius value at reference point';
        inp.style.cssText = 'margin:0 12px 6px;width:calc(100% - 24px);';
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') handlePolarRConfirm(parseFloat(inp.value)); });
        wizEl.appendChild(inp);
        const confirmBtn = makeBtn('Confirm →', 'btn btn-primary');
        confirmBtn.style.cssText = 'margin:0 12px 12px;width:calc(100% - 24px);';
        confirmBtn.addEventListener('click', () => handlePolarRConfirm(parseFloat(inp.value)));
        wizEl.appendChild(confirmBtn);
        setTimeout(() => inp.focus(), 50);
      }

    } else if (cal.axisType === 'ternary') {
      // Ternary 3-step wizard (no value inputs — just 3 vertex clicks)
      const steps = ['ternary-place-a', 'ternary-place-b', 'ternary-place-c'];
      const idx = steps.indexOf(cal.step);
      const pips = makeDiv('calib-progress');
      steps.forEach((_, i) => {
        const pip = makeDiv('calib-pip');
        if (i < idx) pip.classList.add('done');
        if (i === idx) pip.classList.add('active');
        pips.appendChild(pip);
      });
      wizEl.appendChild(pips);
      const lbl = makeDiv('calib-action-label');
      lbl.textContent = `Step ${idx + 1} of 3`;
      wizEl.appendChild(lbl);
      const hint = makeDiv('calib-hint');
      hint.textContent = getWizardPrompt();
      wizEl.appendChild(hint);

    } else {
      // Standard XY wizard (4 points)
      const stepOrder = [
        'place-x1','await-x1-value','place-x2','await-x2-value',
        'place-y1','await-y1-value','place-y2','await-y2-value',
      ];
      const idx = stepOrder.indexOf(cal.step);

      const pips = makeDiv('calib-progress');
      stepOrder.forEach((_, i) => {
        const pip = makeDiv('calib-pip');
        if (i < idx)  pip.classList.add('done');
        if (i === idx) pip.classList.add('active');
        pips.appendChild(pip);
      });
      wizEl.appendChild(pips);

      const actionLbl = makeDiv('calib-action-label');
      actionLbl.textContent = `Step ${Math.floor(idx / 2) + 1} of 4`;
      wizEl.appendChild(actionLbl);

      const hint = makeDiv('calib-hint');
      hint.textContent = getWizardPrompt();
      wizEl.appendChild(hint);

      const role = STEP_TO_ROLE[cal.step];
      if (role) {
        const inp = document.createElement('input');
        inp.className = 'pv-input';
        inp.type = 'number';
        inp.placeholder = (role === 'x1' || role === 'x2') ? 'Enter X value' : 'Enter Y value';
        inp.style.cssText = 'margin:0 12px 6px;width:calc(100% - 24px);';
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') handleCalibValueConfirm(role, inp.value); });
        wizEl.appendChild(inp);

        const confirmBtn = makeBtn('Confirm value →', 'btn btn-primary');
        confirmBtn.style.cssText = 'margin:0 12px 12px;width:calc(100% - 24px);';
        confirmBtn.addEventListener('click', () => handleCalibValueConfirm(role, inp.value));
        wizEl.appendChild(confirmBtn);
        setTimeout(() => inp.focus(), 50);
      }
    }
    el.appendChild(wizEl);
  }

  if (cal.isComplete) {
    const dispSec = makeSec('Display');
    const db = makeSecBody(dispSec);
    db.appendChild(makeCheckbox('Show calibration grid', cal.showGrid, e => {
      setState(d => { d.calibration.showGrid = (e.target as HTMLInputElement).checked; });
    }));
    el.appendChild(dispSec);
  }

  // Scale Bar Calibration
  renderScaleBarSection(el);

  // Perspective Correction
  renderPerspectiveSection(el);

  // PDF nav
  if (state.image.totalPages > 1) {
    const pdfSec = makeSec('PDF Pages');
    const pb = makeSecBody(pdfSec);
    const pr = makeRow('between');
    const prev = makeBtn('◀ Prev', 'btn btn-ghost btn-sm');
    prev.disabled = state.image.currentPage <= 1;
    prev.addEventListener('click', () => goToPage(state.image.currentPage - 1));
    const info = makeSpan(`${state.image.currentPage} / ${state.image.totalPages}`, 'font-family:var(--font-mono);font-size:12px;color:var(--color-text-2);');
    const next = makeBtn('Next ▶', 'btn btn-ghost btn-sm');
    next.disabled = state.image.currentPage >= state.image.totalPages;
    next.addEventListener('click', () => goToPage(state.image.currentPage + 1));
    pr.appendChild(prev); pr.appendChild(info); pr.appendChild(next);
    pb.appendChild(pr);
    el.appendChild(pdfSec);
  }
}

// ── Scale Bar ─────────────────────────────────────────────────

function renderScaleBarSection(el: HTMLElement): void {
  const step = getScaleBarStep();
  const isSet = isScaleBarSet();
  const sec = makeSec('Scale Bar');
  const body = makeSecBody(sec);

  if (isSet) {
    const unit = getScaleBarUnit();
    const ppu = getPixelsPerUnit();
    const info = makeDiv('');
    info.style.cssText = 'font-size:11px;color:var(--color-muted);padding:0 0 6px;font-family:var(--font-mono);';
    info.textContent = `1 ${unit} = ${ppu.toFixed(2)} px`;
    body.appendChild(info);

    const row = makeRow('start');
    row.style.gap = '6px';
    const resetBtn = makeBtn('Reset Scale', 'btn btn-ghost btn-sm');
    resetBtn.addEventListener('click', resetScaleBar);
    row.appendChild(resetBtn);
    body.appendChild(row);
  } else if (step === 'idle') {
    const hint = makeDiv('');
    hint.style.cssText = 'font-size:11px;color:var(--color-muted);padding:0 0 8px;';
    hint.textContent = 'Draw a line over a scale bar to calibrate physical distances.';
    body.appendChild(hint);
    const startBtn = makeBtn('Set Scale Bar →', 'btn btn-primary');
    startBtn.addEventListener('click', startScaleBar);
    body.appendChild(startBtn);
  } else if (step === 'place-p1') {
    const hint = makeDiv('calib-hint');
    hint.textContent = 'Click the left/start end of the scale bar';
    body.appendChild(hint);
    const cancelBtn = makeBtn('Cancel', 'btn btn-ghost btn-sm');
    cancelBtn.style.marginTop = '6px';
    cancelBtn.addEventListener('click', resetScaleBar);
    body.appendChild(cancelBtn);
  } else if (step === 'place-p2') {
    const hint = makeDiv('calib-hint');
    hint.textContent = 'Click the right/end of the scale bar';
    body.appendChild(hint);
    const cancelBtn = makeBtn('Cancel', 'btn btn-ghost btn-sm');
    cancelBtn.style.marginTop = '6px';
    cancelBtn.addEventListener('click', resetScaleBar);
    body.appendChild(cancelBtn);
  } else if (step === 'done') {
    const hint = makeDiv('calib-hint');
    hint.textContent = 'Enter the real-world length and unit:';
    body.appendChild(hint);

    const row = makeRow('start');
    row.style.cssText = 'gap:6px;padding:6px 0;';

    const valInp = document.createElement('input');
    valInp.className = 'pv-input';
    valInp.type = 'number';
    valInp.placeholder = 'e.g. 50';
    valInp.min = '0';
    valInp.style.cssText = 'flex:1;min-width:0;';

    const unitInp = document.createElement('input');
    unitInp.className = 'pv-input';
    unitInp.type = 'text';
    unitInp.placeholder = 'unit (µm, mm…)';
    unitInp.style.cssText = 'flex:1;min-width:0;';

    row.appendChild(valInp); row.appendChild(unitInp);
    body.appendChild(row);

    const commit = makeBtn('Confirm →', 'btn btn-primary');
    commit.addEventListener('click', () => {
      const v = parseFloat(valInp.value);
      const u = unitInp.value.trim();
      if (!v || v <= 0) { valInp.focus(); return; }
      if (!u) { unitInp.focus(); return; }
      commitScaleBar(v, u);
    });
    body.appendChild(commit);

    const cancelBtn = makeBtn('Cancel', 'btn btn-ghost btn-sm');
    cancelBtn.style.marginTop = '4px';
    cancelBtn.addEventListener('click', resetScaleBar);
    body.appendChild(cancelBtn);

    setTimeout(() => valInp.focus(), 50);
  }

  el.appendChild(sec);
}

// ── Perspective Correction ─────────────────────────────────────

function renderPerspectiveSection(el: HTMLElement): void {
  const step = getPerspectiveStep();
  const corners = getPerspectiveCorners();
  const sec = makeSec('Perspective Correction');
  const body = makeSecBody(sec);

  if (step === 'idle') {
    const hint = makeDiv('');
    hint.style.cssText = 'font-size:11px;color:var(--color-muted);padding:0 0 8px;';
    hint.textContent = 'Fix photos taken at an angle: click the 4 corners of the chart area clockwise from top-left.';
    body.appendChild(hint);
    const startBtn = makeBtn('Correct Perspective →', 'btn btn-primary');
    startBtn.addEventListener('click', startPerspective);
    body.appendChild(startBtn);
  } else {
    const hint = makeDiv('calib-hint');
    const remaining = 4 - corners.length;
    if (remaining > 0) {
      hint.textContent = `Click corner ${corners.length + 1} of 4 (${remaining} remaining) — clockwise from top-left`;
    } else {
      hint.textContent = 'Applying warp…';
    }
    body.appendChild(hint);

    const row = makeRow('start');
    row.style.cssText = 'gap:6px;margin-top:8px;';

    if (corners.length > 0) {
      const undoBtn = makeBtn('Undo', 'btn btn-ghost btn-sm');
      undoBtn.addEventListener('click', undoLastCorner);
      row.appendChild(undoBtn);
    }

    const cancelBtn = makeBtn('Cancel', 'btn btn-ghost btn-sm');
    cancelBtn.addEventListener('click', resetPerspective);
    row.appendChild(cancelBtn);
    body.appendChild(row);
  }

  el.appendChild(sec);
}

// ── Data ───────────────────────────────────────────────────────

function renderDataTab(el: HTMLElement): void {
  const state = getState();

  const dsSec = makeSec('Datasets');

  for (const ds of state.datasets) {
    const r = makeDiv('dataset-row' + (ds.id === state.activeDatasetId ? ' active' : ''));

    const swatch = document.createElement('input');
    swatch.type = 'color'; swatch.value = ds.color;
    swatch.style.cssText = 'width:16px;height:16px;padding:0;border:none;background:none;cursor:pointer;border-radius:3px;flex-shrink:0;';
    swatch.addEventListener('change', () => setDatasetColor(ds.id, swatch.value));
    swatch.addEventListener('click', e => e.stopPropagation());
    r.appendChild(swatch);

    const nameEl = document.createElement('span');
    nameEl.className = 'dataset-name';
    nameEl.contentEditable = 'true';
    nameEl.textContent = ds.name;
    nameEl.addEventListener('click', e => e.stopPropagation());
    nameEl.addEventListener('blur', () => renameDataset(ds.id, nameEl.textContent ?? ''));
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });
    r.appendChild(nameEl);

    const cnt = makeSpan(String(ds.points.length), '');
    cnt.className = 'dataset-count';
    r.appendChild(cnt);

    const eyeBtn = makeIconBtn(ds.visible ? '👁' : '○', ds.visible ? 'Hide' : 'Show');
    eyeBtn.addEventListener('click', e => { e.stopPropagation(); toggleDatasetVisibility(ds.id); });
    r.appendChild(eyeBtn);

    const dupBtn = makeIconBtn('⎘', 'Duplicate');
    dupBtn.addEventListener('click', e => { e.stopPropagation(); duplicateDataset(ds.id); });
    r.appendChild(dupBtn);

    const delBtn = makeIconBtn('×', 'Delete');
    delBtn.classList.add('danger');
    delBtn.addEventListener('click', e => { e.stopPropagation(); removeDataset(ds.id); });
    r.appendChild(delBtn);

    r.addEventListener('click', () => setActiveDataset(ds.id));
    dsSec.appendChild(r);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'add-ds-btn';
  addBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Dataset`;
  addBtn.addEventListener('click', () => addDataset());
  dsSec.appendChild(addBtn);
  el.appendChild(dsSec);

  // Point table
  const activeDs = state.datasets.find(d => d.id === state.activeDatasetId);
  if (activeDs) {
    const ptSec = makeSec(`Points — ${activeDs.name}`);

    const sortBar = makeDiv('');
    sortBar.style.cssText = 'display:flex;align-items:center;gap:5px;padding:6px 12px;border-bottom:1px solid var(--color-border);';
    const sortX = makeBtn('Sort X', 'btn btn-ghost btn-sm');
    sortX.addEventListener('click', () => sortDatasetPoints(activeDs.id, 'x'));
    const sortY = makeBtn('Sort Y', 'btn btn-ghost btn-sm');
    sortY.addEventListener('click', () => sortDatasetPoints(activeDs.id, 'y'));
    const spacer = makeDiv(''); spacer.style.flex = '1';
    const clearBtn = makeBtn('Clear', 'btn btn-danger btn-sm');
    clearBtn.addEventListener('click', () => clearDatasetPoints(activeDs.id));
    sortBar.appendChild(sortX); sortBar.appendChild(sortY); sortBar.appendChild(spacer); sortBar.appendChild(clearBtn);
    ptSec.appendChild(sortBar);

    const wrap = makeDiv('');
    wrap.style.cssText = 'overflow-y:auto;max-height:220px;';
    const table = document.createElement('table');
    table.className = 'point-table';
    table.innerHTML = `<thead><tr><th style="width:28px">#</th><th>X</th><th>Y</th><th style="width:24px"></th></tr></thead>`;
    const tbody = document.createElement('tbody');

    activeDs.points.slice(0, 500).forEach((pt, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="color:var(--color-muted)">${i + 1}</td>
        <td contenteditable="true" data-field="x" data-id="${pt.id}">${pt.dataX.toPrecision(6)}</td>
        <td contenteditable="true" data-field="y" data-id="${pt.id}">${pt.dataY.toPrecision(6)}</td>
        <td><button class="icon-btn danger" data-delete="${pt.id}" title="Delete">×</button></td>
      `;
      tbody.appendChild(tr);
    });

    if (activeDs.points.length > 500) {
      const info = document.createElement('tr');
      info.innerHTML = `<td colspan="4" style="text-align:center;color:var(--color-muted);padding:5px;font-size:10px;">Showing 500 of ${activeDs.points.length}</td>`;
      tbody.appendChild(info);
    }

    table.appendChild(tbody); wrap.appendChild(table); ptSec.appendChild(wrap);

    tbody.addEventListener('blur', (e: FocusEvent) => {
      const cell = e.target as HTMLElement;
      if (cell.contentEditable !== 'true') return;
      const { id, field } = cell.dataset;
      const val = parseFloat(cell.textContent ?? '');
      if (!id || !field || isNaN(val)) return;
      const pt = activeDs.points.find(p => p.id === id);
      if (!pt) return;
      updatePointData(activeDs.id, id, field === 'x' ? val : pt.dataX, field === 'y' ? val : pt.dataY);
    }, true);

    tbody.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('[data-delete]') as HTMLElement | null;
      if (btn?.dataset.delete) deleteDataPoint(activeDs.id, btn.dataset.delete);
    });

    el.appendChild(ptSec);
  }

  // Filters
  if (state.image.width > 0) {
    const filtSec = makeSec('Image Filters');
    const fb = makeSecBody(filtSec);
    const f = state.canvas.imageFilters;

    // CSS filters (display only)
    fb.appendChild(makeFilterSlider('Brightness', f.brightness, 0, 200,
      v => setState(d => { d.canvas.imageFilters.brightness = v; })));
    fb.appendChild(makeFilterSlider('Contrast', f.contrast, 0, 200,
      v => setState(d => { d.canvas.imageFilters.contrast = v; })));
    const cssRow = makeDiv(''); cssRow.style.cssText = 'display:flex;gap:12px;';
    cssRow.appendChild(makeCheckbox('Invert', f.invert,
      e => setState(d => { d.canvas.imageFilters.invert = (e.target as HTMLInputElement).checked; })));
    cssRow.appendChild(makeCheckbox('Grayscale', f.grayscale,
      e => setState(d => { d.canvas.imageFilters.grayscale = (e.target as HTMLInputElement).checked; })));
    fb.appendChild(cssRow);

    // Separator
    const sep = makeDiv(''); sep.style.cssText = 'height:1px;background:var(--color-border);margin:6px 0;';
    fb.appendChild(sep);

    // Pixel-level filters (affect auto-trace / detectors)
    const pixLabel = makeDiv('');
    pixLabel.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-muted);margin-bottom:4px;';
    pixLabel.textContent = 'Preprocessing (affects trace)';
    fb.appendChild(pixLabel);

    const pxRow1 = makeDiv(''); pxRow1.style.cssText = 'display:flex;gap:12px;';
    pxRow1.appendChild(makeCheckbox('Sharpen', f.sharpen,
      e => setState(d => { d.canvas.imageFilters.sharpen = (e.target as HTMLInputElement).checked; })));
    pxRow1.appendChild(makeCheckbox('Denoise', f.denoise,
      e => setState(d => { d.canvas.imageFilters.denoise = (e.target as HTMLInputElement).checked; })));
    fb.appendChild(pxRow1);

    const pxRow2 = makeDiv(''); pxRow2.style.cssText = 'display:flex;gap:12px;';
    pxRow2.appendChild(makeCheckbox('Auto-Contrast', f.autoContrast,
      e => setState(d => { d.canvas.imageFilters.autoContrast = (e.target as HTMLInputElement).checked; })));
    fb.appendChild(pxRow2);

    // Threshold slider (with on/off toggle)
    const threshRow = makeDiv(''); threshRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const threshCheck = document.createElement('input');
    threshCheck.type = 'checkbox'; threshCheck.checked = f.threshold !== null;
    threshCheck.style.cssText = 'accent-color:var(--color-accent);cursor:pointer;width:14px;height:14px;flex-shrink:0;';
    const threshLabel = makeDiv('');
    threshLabel.style.cssText = 'font-size:12px;color:var(--color-text-2);';
    threshLabel.textContent = 'Threshold';
    threshRow.appendChild(threshCheck);
    threshRow.appendChild(threshLabel);
    fb.appendChild(threshRow);

    const threshSliderWrap = makeDiv('');
    threshSliderWrap.style.display = f.threshold !== null ? 'block' : 'none';
    const threshVal = f.threshold ?? 128;
    threshSliderWrap.appendChild(makeFilterSlider(`Level: ${threshVal}`, threshVal, 0, 255,
      v => setState(d => { if (d.canvas.imageFilters.threshold !== null) d.canvas.imageFilters.threshold = v; })));
    fb.appendChild(threshSliderWrap);

    threshCheck.addEventListener('change', () => {
      const on = threshCheck.checked;
      setState(d => { d.canvas.imageFilters.threshold = on ? 128 : null; });
      threshSliderWrap.style.display = on ? 'block' : 'none';
    });

    // Reset button
    const resetBtn = makeBtn('Reset All Filters', 'btn btn-ghost btn-sm');
    resetBtn.style.marginTop = '6px';
    resetBtn.addEventListener('click', () => setState(d => {
      d.canvas.imageFilters = { brightness: 100, contrast: 100, grayscale: false, invert: false, sharpen: false, threshold: null, autoContrast: false, denoise: false };
    }));
    fb.appendChild(resetBtn);

    el.appendChild(filtSec);
  }

  // Inline preview chart at the bottom of Data tab
  const hasPoints = state.datasets.some(d => d.visible && d.points.length > 0);
  if (hasPoints) {
    const prevSec = makeSec('Preview');
    const pb = makeSecBody(prevSec);

    const modeRow = makeDiv('');
    modeRow.style.cssText = 'display:flex;gap:5px;margin-bottom:6px;';
    (['scatter','line'] as const).forEach(m => {
      const btn = makeBtn(m === 'scatter' ? 'Scatter' : 'Line', `btn btn-sm ${state.ui.previewMode === m ? 'btn-primary' : 'btn-ghost'}`);
      btn.style.flex = '1';
      btn.addEventListener('click', () => setState(d => { d.ui.previewMode = m; }));
      modeRow.appendChild(btn);
    });
    pb.appendChild(modeRow);

    const canvasWrap = makeDiv('');
    canvasWrap.style.cssText = 'position:relative;height:160px;';
    const previewCanvas = document.createElement('canvas');
    previewCanvas.id = 'preview-chart';
    previewCanvas.style.cssText = 'width:100%;height:100%;';
    canvasWrap.appendChild(previewCanvas);
    pb.appendChild(canvasWrap);

    el.appendChild(prevSec);

    // Render chart after DOM is attached
    requestAnimationFrame(() => updatePreview());
  }
}

// ── Trace ──────────────────────────────────────────────────────

let traceExtractionMode: ExtractionMode = 'curve';
let barSettings: BarDetectorSettings = { ...defaultBarSettings };
let scatterSettings: ScatterDetectorSettings = { ...defaultScatterSettings };

function renderTraceTab(el: HTMLElement): void {
  const ats = getAutoTraceSettings();
  let lastResult: { points: import('../state/types').DataPoint[]; previewData: Uint8ClampedArray; width: number; height: number } | null = null;

  // Auto-detect section
  const detectSec = makeSec('Auto-Detect Chart Type');
  const db = makeSecBody(detectSec);
  const detectBtn = makeBtn('Analyze image…', 'btn btn-ghost btn-sm');
  const detectResult = makeDiv('');
  detectResult.style.cssText = 'font-size:11px;color:var(--color-muted);margin-top:6px;font-family:var(--font-mono);';
  detectBtn.addEventListener('click', () => {
    const bmp = getImageBitmap();
    if (!bmp) { detectResult.textContent = 'Load an image first.'; return; }
    detectBtn.disabled = true;
    detectBtn.textContent = 'Analyzing…';
    try {
      const offscreen = document.createElement('canvas');
      const maxSide = 400;
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      offscreen.width = Math.round(bmp.width * scale);
      offscreen.height = Math.round(bmp.height * scale);
      offscreen.getContext('2d')!.drawImage(bmp, 0, 0, offscreen.width, offscreen.height);
      const imgData = offscreen.getContext('2d')!.getImageData(0, 0, offscreen.width, offscreen.height);
      const result = detectChartType(imgData);
      const label = getChartTypeLabel(result.type);
      detectResult.textContent = `${label} — ${(result.confidence * 100).toFixed(0)}% confidence\n${result.reason}`;
      detectResult.style.whiteSpace = 'pre-wrap';
    } catch (e) {
      detectResult.textContent = 'Detection failed.';
    }
    detectBtn.disabled = false;
    detectBtn.textContent = 'Analyze image…';
  });
  db.appendChild(detectBtn);
  db.appendChild(detectResult);
  el.appendChild(detectSec);

  // Extraction mode selector
  const modeSec = makeSec('Extraction Mode');
  const mb = makeSecBody(modeSec);
  const modes: { id: ExtractionMode; label: string; hint: string }[] = [
    { id: 'curve',   label: 'Line / Curve',   hint: 'Traces continuous curves and lines' },
    { id: 'bar',     label: 'Bar Chart',       hint: 'Detects vertical or horizontal bars' },
    { id: 'scatter', label: 'Scatter Points',  hint: 'Finds discrete point markers' },
    { id: 'pie',     label: 'Pie Chart',       hint: 'Click-based angle digitizer for pie/donut charts' },
  ];
  const modeRow = makeDiv(''); modeRow.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
  modes.forEach(m => {
    const btn = makeBtn(m.label, `btn btn-sm ${traceExtractionMode === m.id ? 'btn-primary' : 'btn-ghost'}`);
    btn.title = m.hint;
    btn.addEventListener('click', () => {
      if (traceExtractionMode === 'pie' && m.id !== 'pie') resetPie();
      traceExtractionMode = m.id;
      lastResult = null;
      window.__autoTraceMod = null;
      clearPreview();
      initSidebarDebounced();
    });
    modeRow.appendChild(btn);
  });
  mb.appendChild(modeRow);
  el.appendChild(modeSec);

  // Pie mode: show dedicated wizard UI, skip color/bg/settings/actions
  if (traceExtractionMode === 'pie') {
    renderPieWizard(el);
    return;
  }

  // Target color (shared across all modes)
  const curColor = traceExtractionMode === 'curve' ? ats.targetColor
    : traceExtractionMode === 'bar' ? barSettings.targetColor
    : scatterSettings.targetColor;

  const colorSec = makeSec('Target Color');
  const cb = makeSecBody(colorSec);
  const colorRow = makeRow('start'); colorRow.style.gap = '8px';
  const colorPicker = document.createElement('input');
  colorPicker.type = 'color'; colorPicker.value = curColor;
  colorPicker.style.cssText = 'width:34px;height:28px;border:1px solid var(--color-border-2);border-radius:5px;background:var(--color-bg);cursor:pointer;padding:2px;flex-shrink:0;';
  colorPicker.addEventListener('input', () => {
    if (traceExtractionMode === 'curve') setAutoTraceSettings({ targetColor: colorPicker.value });
    else if (traceExtractionMode === 'bar') barSettings.targetColor = colorPicker.value;
    else scatterSettings.targetColor = colorPicker.value;
  });
  colorRow.appendChild(colorPicker);
  colorRow.appendChild(makeSpan('or click canvas (T tool)', 'font-size:11px;color:var(--color-muted);'));
  cb.appendChild(colorRow);
  el.appendChild(colorSec);

  // Background exclusion (all modes)
  const bgSec = makeSec('Background Exclusion');
  const bgb = makeSecBody(bgSec);
  const bgRow = makeRow('start'); bgRow.style.cssText = 'gap:8px;margin-bottom:6px;';
  const bgCheck = document.createElement('input');
  bgCheck.type = 'checkbox';
  bgCheck.style.cssText = 'accent-color:var(--color-accent);cursor:pointer;width:14px;height:14px;flex-shrink:0;';
  const bgEnabled = traceExtractionMode === 'curve' ? ats.bgColor !== null
    : traceExtractionMode === 'bar' ? barSettings.bgColor !== null
    : scatterSettings.bgColor !== null;
  bgCheck.checked = bgEnabled;

  const bgPicker = document.createElement('input');
  bgPicker.type = 'color';
  const bgVal = (traceExtractionMode === 'curve' ? ats.bgColor : traceExtractionMode === 'bar' ? barSettings.bgColor : scatterSettings.bgColor) ?? '#ffffff';
  bgPicker.value = bgVal;
  bgPicker.disabled = !bgEnabled;
  bgPicker.style.cssText = `width:34px;height:28px;border:1px solid var(--color-border-2);border-radius:5px;background:var(--color-bg);cursor:pointer;padding:2px;flex-shrink:0;opacity:${bgEnabled ? '1' : '0.4'};`;
  bgPicker.addEventListener('input', () => {
    if (traceExtractionMode === 'curve') setAutoTraceSettings({ bgColor: bgPicker.value });
    else if (traceExtractionMode === 'bar') barSettings.bgColor = bgPicker.value;
    else scatterSettings.bgColor = bgPicker.value;
  });
  bgCheck.addEventListener('change', () => {
    const on = bgCheck.checked;
    bgPicker.disabled = !on; bgPicker.style.opacity = on ? '1' : '0.4';
    const col = on ? bgPicker.value : null;
    if (traceExtractionMode === 'curve') setAutoTraceSettings({ bgColor: col });
    else if (traceExtractionMode === 'bar') barSettings.bgColor = col;
    else scatterSettings.bgColor = col;
  });
  bgRow.appendChild(bgCheck);
  bgRow.appendChild(makeSpan('Exclude background color', 'font-size:11px;color:var(--color-text-2);'));
  bgRow.appendChild(bgPicker);
  bgb.appendChild(bgRow);
  el.appendChild(bgSec);

  // Mode-specific settings
  const settSec = makeSec('Settings');
  const sb = makeSecBody(settSec);

  if (traceExtractionMode === 'curve') {
    sb.appendChild(makeFilterSlider('Tolerance', ats.tolerance, 0, 100, v => setAutoTraceSettings({ tolerance: v })));
    sb.appendChild(makeLbl('Smoothing'));
    const smoothSel = makeSelect([['none','None'],['light','Light'],['heavy','Heavy']], ats.smoothing);
    smoothSel.addEventListener('change', () => setAutoTraceSettings({ smoothing: smoothSel.value as any }));
    sb.appendChild(smoothSel);
    sb.appendChild(makeFilterSlider(`Interval (${ats.samplingInterval}px)`, ats.samplingInterval, 1, 20,
      v => setAutoTraceSettings({ samplingInterval: v })));

  } else if (traceExtractionMode === 'bar') {
    sb.appendChild(makeFilterSlider('Tolerance', barSettings.tolerance, 0, 100,
      v => { barSettings.tolerance = v; }));
    sb.appendChild(makeLbl('Bar Direction'));
    const dirSel = makeSelect([['vertical','Vertical bars'],['horizontal','Horizontal bars']], barSettings.direction);
    dirSel.addEventListener('change', () => { barSettings.direction = dirSel.value as any; });
    sb.appendChild(dirSel);
    sb.appendChild(makeFilterSlider(`Min bar width (${barSettings.minBarWidth}px)`, barSettings.minBarWidth, 2, 40,
      v => { barSettings.minBarWidth = v; }));

  } else {
    sb.appendChild(makeFilterSlider('Tolerance', scatterSettings.tolerance, 0, 100,
      v => { scatterSettings.tolerance = v; }));
    sb.appendChild(makeFilterSlider(`Min marker size (${scatterSettings.minBlobArea}px²)`, scatterSettings.minBlobArea, 2, 100,
      v => { scatterSettings.minBlobArea = v; }));
    sb.appendChild(makeFilterSlider(`Max marker size (${scatterSettings.maxBlobArea}px²)`, scatterSettings.maxBlobArea, 50, 2000,
      v => { scatterSettings.maxBlobArea = v; }));
    sb.appendChild(makeFilterSlider(`Min spacing (${scatterSettings.minSpacing}px)`, scatterSettings.minSpacing, 2, 40,
      v => { scatterSettings.minSpacing = v; }));
  }
  el.appendChild(settSec);

  // Actions
  const actSec = makeSec('Actions');
  const ab = makeSecBody(actSec);

  const previewLabel = traceExtractionMode === 'curve' ? 'Preview Trace'
    : traceExtractionMode === 'bar' ? 'Detect Bars'
    : 'Detect Points';

  const previewBtn = makeBtn(previewLabel, 'btn btn-primary');
  previewBtn.addEventListener('click', () => {
    let result: typeof lastResult = null;
    if (traceExtractionMode === 'curve') {
      result = runAutoTrace(getAutoTraceSettings());
    } else if (traceExtractionMode === 'bar') {
      result = detectBars(barSettings);
    } else {
      result = detectScatterPoints(scatterSettings);
    }
    if (result) {
      lastResult = result;
      setPreviewData(result.previewData, result.width, result.height);
      window.__autoTraceMod = { getPreviewData: () => ({ data: result!.previewData, width: result!.width, height: result!.height }) };
      canvasRender();
      commitBtn.style.display = 'flex';
      commitBtn.textContent = `Commit ${result.points.length} pts →`;
    }
  });
  ab.appendChild(previewBtn);

  const commitBtn = makeBtn('Commit pts →', 'btn btn-success');
  commitBtn.style.display = 'none';
  commitBtn.addEventListener('click', () => {
    if (lastResult) {
      commitAutoTrace(lastResult.points);
      lastResult = null;
      window.__autoTraceMod = null;
      commitBtn.style.display = 'none';
    }
  });
  ab.appendChild(commitBtn);

  const clearBtn = makeBtn('Clear Preview', 'btn btn-ghost');
  clearBtn.addEventListener('click', () => {
    clearPreview();
    window.__autoTraceMod = null;
    lastResult = null;
    commitBtn.style.display = 'none';
  });
  ab.appendChild(clearBtn);

  // Stacked / grouped bar: auto-detect all color layers
  if (traceExtractionMode === 'bar') {
    const sep = makeDiv(''); sep.style.cssText = 'height:1px;background:var(--color-border);margin:8px 0;';
    ab.appendChild(sep);

    const stackedHint = makeDiv('');
    stackedHint.style.cssText = 'font-size:11px;color:var(--color-muted);margin-bottom:6px;';
    stackedHint.textContent = 'Stacked / grouped bars — detect each color layer automatically:';
    ab.appendChild(stackedHint);

    const stackedBtn = makeBtn('Detect All Layers', 'btn btn-ghost btn-sm');
    stackedBtn.addEventListener('click', () => {
      stackedBtn.disabled = true;
      stackedBtn.textContent = 'Detecting…';
      try {
        const layers = detectAllBarLayers(barSettings.direction, barSettings.tolerance);
        if (layers.length === 0) {
          showToast('No bar layers found — try adjusting tolerance or direction', 'warning');
        } else {
          // Each layer → new dataset
          layers.forEach((layer, i) => {
            const dsId = addDataset(`Layer ${i + 1}`, layer.color);
            commitAutoTrace(layer.result.points, dsId);
          });
          showToast(`Added ${layers.length} bar layer${layers.length > 1 ? 's' : ''} as datasets`, 'success');
        }
      } catch (err) {
        showToast('Stacked bar detection failed: ' + (err as Error).message, 'error');
      }
      stackedBtn.disabled = false;
      stackedBtn.textContent = 'Detect All Layers';
    });
    ab.appendChild(stackedBtn);
  }

  el.appendChild(actSec);
}

// ── Pie Wizard ─────────────────────────────────────────────────

function renderPieWizard(el: HTMLElement): void {
  const step = getPieStep();
  const boundaryCount = getPieBoundaryCount();

  // Total value input (always visible)
  const valSec = makeSec('Total Value');
  const vb = makeSecBody(valSec);
  const valRow = makeRow('start'); valRow.style.gap = '8px';
  const valInput = document.createElement('input');
  valInput.type = 'number'; valInput.className = 'pv-input';
  valInput.min = '0'; valInput.value = String(getPieTotalValue());
  valInput.placeholder = '100';
  valInput.style.cssText = 'width:80px;';
  const valLabel = makeSpan('(e.g. 100 for percentages)', 'font-size:11px;color:var(--color-muted);');
  valRow.appendChild(valInput); valRow.appendChild(valLabel);
  vb.appendChild(valRow);
  valInput.addEventListener('change', () => {
    const v = parseFloat(valInput.value);
    if (!isNaN(v) && v > 0) setPieTotalValue(v);
  });
  el.appendChild(valSec);

  // Steps
  const wizSec = makeSec('Wizard');
  const wb = makeSecBody(wizSec);

  if (step === 'idle') {
    const hint = makeDiv('');
    hint.style.cssText = 'font-size:12px;color:var(--color-text-2);margin-bottom:8px;line-height:1.5;';
    hint.textContent = 'Digitize pie/donut charts by clicking the center, a reference direction, then each sector boundary clockwise.';
    wb.appendChild(hint);

    const startBtn = makeBtn('Start Pie Extraction →', 'btn btn-primary');
    startBtn.addEventListener('click', () => {
      const v = parseFloat(valInput.value) || 100;
      setPieTotalValue(v);
      startPie(v);
      initSidebarDebounced();
    });
    wb.appendChild(startBtn);

  } else {
    // Progress pills
    const stepsInfo = [
      { label: 'Center',    done: step !== 'place-center' },
      { label: 'Reference', done: step === 'place-sectors' },
      { label: `${boundaryCount} sector${boundaryCount !== 1 ? 's' : ''}`, done: false },
    ];
    const pills = makeDiv('');
    pills.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;';
    stepsInfo.forEach(s => {
      const p = makeDiv('');
      p.style.cssText = `font-size:10px;padding:2px 8px;border-radius:99px;font-weight:600;
        background:${s.done ? 'var(--color-accent)' : 'var(--color-faint)'};
        color:${s.done ? '#fff' : 'var(--color-muted)'};`;
      p.textContent = s.label;
      pills.appendChild(p);
    });
    wb.appendChild(pills);

    // Current instruction
    const instrMap: Record<string, string> = {
      'place-center':    '① Click the center of the pie chart on the canvas',
      'place-reference': '② Click the reference direction (e.g. 12 o\'clock)',
      'place-sectors':   `③ Click sector boundaries clockwise (${boundaryCount} added) — then Finish`,
    };
    const instr = makeDiv('');
    instr.style.cssText = 'font-size:12px;color:var(--color-text-2);margin-bottom:8px;line-height:1.5;border-left:2px solid var(--color-accent);padding-left:8px;';
    instr.textContent = instrMap[step] ?? '';
    wb.appendChild(instr);

    // Computed sectors preview (when we have at least 1 boundary)
    if (step === 'place-sectors' && boundaryCount >= 1) {
      const sectors = computeSectors();
      const previewWrap = makeDiv('');
      previewWrap.style.cssText = 'margin-bottom:8px;';
      const totalVal = getPieTotalValue();
      sectors.forEach(s => {
        const row = makeDiv('');
        row.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;padding:2px 0;border-bottom:1px solid var(--color-faint);color:var(--color-text-2);';
        row.innerHTML = `<span>${s.label}</span><span style="font-family:var(--font-mono);">${s.angleDeg.toFixed(1)}° &nbsp; ${s.value.toFixed(totalVal === 100 ? 1 : 4)}</span>`;
        previewWrap.appendChild(row);
      });
      wb.appendChild(previewWrap);

      const btnRow = makeDiv(''); btnRow.style.cssText = 'display:flex;gap:6px;';
      const undoBtn = makeBtn('Undo last', 'btn btn-ghost btn-sm');
      undoBtn.addEventListener('click', () => { undoLastBoundary(); initSidebarDebounced(); });
      const finishBtn = makeBtn(`Commit ${sectors.length} sectors →`, 'btn btn-success');
      finishBtn.addEventListener('click', () => { commitPieSectors(); initSidebarDebounced(); });
      btnRow.appendChild(undoBtn); btnRow.appendChild(finishBtn);
      wb.appendChild(btnRow);
    }

    // Reset button
    const resetBtn = makeBtn('Reset', 'btn btn-ghost btn-sm');
    resetBtn.style.marginTop = '6px';
    resetBtn.addEventListener('click', () => { resetPie(); initSidebarDebounced(); });
    wb.appendChild(resetBtn);
  }

  el.appendChild(wizSec);
}

// ── Measure ────────────────────────────────────────────────────

function renderMeasureTab(el: HTMLElement): void {
  const modeSec = makeSec('Mode');
  const mb = makeSecBody(modeSec);
  const modeRow = makeDiv(''); modeRow.style.cssText = 'display:flex;gap:5px;';

  const modes: { id: 'distance'|'angle'|'area'; label: string }[] = [
    { id: 'distance', label: 'Distance' },
    { id: 'angle',    label: 'Angle' },
    { id: 'area',     label: 'Area' },
  ];
  const cur = getMeasureMode();
  modes.forEach(m => {
    const b = makeBtn(m.label, `btn btn-sm ${m.id === cur ? 'btn-primary' : 'btn-ghost'}`);
    b.style.flex = '1';
    b.addEventListener('click', () => setMeasureMode(m.id));
    modeRow.appendChild(b);
  });
  mb.appendChild(modeRow);

  const instrMap = { distance: 'Click 2 points', angle: 'Click 3 points (vertex second)', area: 'Click ≥3 points for polygon' };
  const instr = makeDiv('');
  instr.style.cssText = 'font-size:11px;color:var(--color-muted);margin-top:2px;';
  instr.textContent = instrMap[cur];
  mb.appendChild(instr);
  el.appendChild(modeSec);

  const result = getMeasureResult();
  const pts    = getMeasurePoints();

  if (pts.length > 0) {
    const resSec = makeSec('Result');
    const rb = makeSecBody(resSec);
    if (result) {
      const resEl = makeDiv('measure-result');
      resEl.textContent = result;
      rb.appendChild(resEl);
    } else {
      rb.appendChild(makeSpan(`${pts.length} pt${pts.length > 1 ? 's' : ''} — keep clicking`, 'font-size:11px;color:var(--color-muted);'));
    }
    const resetBtn = makeBtn('Reset', 'btn btn-ghost');
    resetBtn.addEventListener('click', resetMeasure);
    rb.appendChild(resetBtn);
    el.appendChild(resSec);
  } else {
    const hint = makeDiv('');
    hint.style.cssText = 'padding:16px 12px;font-size:11px;color:var(--color-muted);text-align:center;line-height:1.6;';
    hint.textContent = 'Press M to activate the Measure tool, then click points on the canvas';
    el.appendChild(hint);
  }
}

// ── DOM helpers ─────────────────────────────────────────────────

function makeSec(title: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ps';
  if (title) {
    const h = document.createElement('div');
    h.className = 'ps-head';
    h.textContent = title;
    el.appendChild(h);
  }
  return el;
}

function makeSecBody(sec: HTMLElement): HTMLElement {
  const b = document.createElement('div');
  b.className = 'ps-body';
  sec.appendChild(b);
  return b;
}

function makeDiv(cls: string): HTMLElement {
  const el = document.createElement('div');
  if (cls) el.className = cls;
  return el;
}

function makeSpan(text: string, style: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = text;
  if (style) el.style.cssText = style;
  return el;
}

function makeRow(justify: 'between'|'start'): HTMLElement {
  const el = makeDiv('');
  el.style.cssText = `display:flex;align-items:center;justify-content:${justify === 'between' ? 'space-between' : 'flex-start'};gap:6px;`;
  return el;
}

function makeLbl(text: string): HTMLElement {
  const el = document.createElement('label');
  el.className = 'pv-label';
  el.textContent = text;
  return el;
}

function makeBtn(text: string, cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  return b;
}

function makeSelect(options: [string, string][], cur: string): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'pv-select';
  options.forEach(([val, label]) => {
    const o = document.createElement('option');
    o.value = val; o.textContent = label;
    if (val === cur) o.selected = true;
    sel.appendChild(o);
  });
  return sel;
}

function makeIconBtn(char: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'icon-btn'; b.textContent = char; b.title = title;
  return b;
}

function makeCheckbox(label: string, checked: boolean, onChange?: (e: Event) => void): HTMLElement {
  const wrap = makeDiv('pv-check');
  const chk = document.createElement('input');
  chk.type = 'checkbox'; chk.checked = checked;
  if (onChange) chk.addEventListener('change', onChange);
  const lbl = makeSpan(label, '');
  lbl.addEventListener('click', () => { chk.checked = !chk.checked; chk.dispatchEvent(new Event('change')); });
  wrap.appendChild(chk); wrap.appendChild(lbl);
  return wrap;
}

function makeFilterSlider(label: string, value: number, min: number, max: number, onChange: (v: number) => void): HTMLElement {
  const wrap = makeDiv('filter-row');
  const labelRow = makeDiv('filter-label-row');
  const lbl = makeSpan(label, '');
  const valEl = makeSpan(String(value), '');
  valEl.className = 'filter-val';
  labelRow.appendChild(lbl); labelRow.appendChild(valEl);
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = String(min); slider.max = String(max); slider.value = String(value);
  slider.addEventListener('input', () => { valEl.textContent = slider.value; onChange(Number(slider.value)); });
  wrap.appendChild(labelRow); wrap.appendChild(slider);
  return wrap;
}
