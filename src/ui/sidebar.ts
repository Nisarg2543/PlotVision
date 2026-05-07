import { getState, setState, subscribe } from '../state/store';
import {
  addDataset, removeDataset, setActiveDataset, toggleDatasetVisibility,
  renameDataset, setDatasetColor, duplicateDataset, sortDatasetPoints, clearDatasetPoints,
} from '../modules/datasets';
import { handleCalibValueConfirm, resetCalibration, getWizardPrompt, startCalibration } from '../modules/calibration';
import { updatePointData, deletePoint as deleteDataPoint } from '../modules/digitizer';
import { goToPage } from '../modules/image-loader';
import { getAutoTraceSettings, setAutoTraceSettings, runAutoTrace, commitAutoTrace, clearPreview, setPreviewData } from '../modules/auto-trace';
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

export function initSidebar(_container: HTMLElement): void {
  const tabsEl = document.getElementById('panel-tabs')!;
  const bodyEl = document.getElementById('panel-body')!;

  tabsEl.innerHTML = '';
  TABS.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'panel-tab' + (t.id === activeTab ? ' active' : '');
    btn.textContent = t.label;
    btn.dataset.tab = t.id;
    btn.addEventListener('click', () => {
      activeTab = t.id;
      tabsEl.querySelectorAll('.panel-tab').forEach(b =>
        b.classList.toggle('active', (b as HTMLElement).dataset.tab === t.id)
      );
      renderBody(bodyEl);
    });
    tabsEl.appendChild(btn);
  });

  renderBody(bodyEl);
  subscribe(() => renderBody(bodyEl));
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

  // Wizard
  if (cal.step !== 'idle' && cal.step !== 'complete') {
    const wizEl = document.createElement('div');
    wizEl.className = 'ps';

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
    fb.appendChild(makeFilterSlider('Brightness', state.canvas.imageFilters.brightness, 0, 200,
      v => setState(d => { d.canvas.imageFilters.brightness = v; })));
    fb.appendChild(makeFilterSlider('Contrast', state.canvas.imageFilters.contrast, 0, 200,
      v => setState(d => { d.canvas.imageFilters.contrast = v; })));
    fb.appendChild(makeCheckbox('Invert', state.canvas.imageFilters.invert,
      e => setState(d => { d.canvas.imageFilters.invert = (e.target as HTMLInputElement).checked; })));
    fb.appendChild(makeCheckbox('Grayscale', state.canvas.imageFilters.grayscale,
      e => setState(d => { d.canvas.imageFilters.grayscale = (e.target as HTMLInputElement).checked; })));
    el.appendChild(filtSec);
  }
}

// ── Trace ──────────────────────────────────────────────────────

function renderTraceTab(el: HTMLElement): void {
  const ats = getAutoTraceSettings();
  let lastResult: ReturnType<typeof runAutoTrace> = null;

  const infoSec = makeSec('Auto-Trace');
  const ib = makeSecBody(infoSec);
  const infoTxt = makeDiv('');
  infoTxt.style.cssText = 'font-size:11px;color:var(--color-text-2);line-height:1.55;';
  infoTxt.textContent = 'Switch to Auto-Trace tool (T), click a line to pick its color, then preview and commit.';
  ib.appendChild(infoTxt);
  el.appendChild(infoSec);

  const colorSec = makeSec('Target Color');
  const cb = makeSecBody(colorSec);
  const colorRow = makeRow('start');
  colorRow.style.gap = '8px';
  const colorPicker = document.createElement('input');
  colorPicker.type = 'color'; colorPicker.value = ats.targetColor;
  colorPicker.style.cssText = 'width:34px;height:28px;border:1px solid var(--color-border-2);border-radius:5px;background:var(--color-bg);cursor:pointer;padding:2px;flex-shrink:0;';
  colorPicker.addEventListener('input', () => setAutoTraceSettings({ targetColor: colorPicker.value }));
  cb.appendChild(colorRow);
  colorRow.appendChild(colorPicker);
  colorRow.appendChild(makeSpan('or click canvas (T tool)', 'font-size:11px;color:var(--color-muted);'));
  el.appendChild(colorSec);

  const settSec = makeSec('Settings');
  const sb = makeSecBody(settSec);
  sb.appendChild(makeFilterSlider('Tolerance', ats.tolerance, 0, 100, v => setAutoTraceSettings({ tolerance: v })));
  sb.appendChild(makeLbl('Smoothing'));
  const smoothSel = makeSelect([['none','None'],['light','Light'],['heavy','Heavy']], ats.smoothing);
  smoothSel.addEventListener('change', () => setAutoTraceSettings({ smoothing: smoothSel.value as any }));
  sb.appendChild(smoothSel);
  sb.appendChild(makeFilterSlider(`Interval (${ats.samplingInterval}px)`, ats.samplingInterval, 1, 20,
    v => setAutoTraceSettings({ samplingInterval: v })));
  el.appendChild(settSec);

  const actSec = makeSec('Actions');
  const ab = makeSecBody(actSec);

  const previewBtn = makeBtn('Preview Trace', 'btn btn-primary');
  previewBtn.addEventListener('click', () => {
    const result = runAutoTrace(getAutoTraceSettings());
    if (result) {
      lastResult = result;
      setPreviewData(result.previewData, result.width, result.height);
      (window as any).__autoTraceMod = { getPreviewData: () => ({ data: result.previewData, width: result.width, height: result.height }) };
      import('../modules/canvas-engine').then(m => m.render());
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
      (window as any).__autoTraceMod = null;
      commitBtn.style.display = 'none';
    }
  });
  ab.appendChild(commitBtn);

  const clearBtn = makeBtn('Clear Preview', 'btn btn-ghost');
  clearBtn.addEventListener('click', () => {
    clearPreview();
    (window as any).__autoTraceMod = null;
    lastResult = null;
    commitBtn.style.display = 'none';
  });
  ab.appendChild(clearBtn);

  el.appendChild(actSec);
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
