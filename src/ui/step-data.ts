/**
 * Step 3 — "Get Your Data"
 * Replaces the old Data + Trace tabs.
 * Left column: datasets list + method picker
 * Center: method-specific settings + actions
 * Right: points table + stats + export options
 */

import { getState, setState } from '../state/store';
import {
  addDataset, removeDataset, setActiveDataset, toggleDatasetVisibility,
  renameDataset, setDatasetColor, duplicateDataset, sortDatasetPoints,
  clearDatasetPoints, importPointsFromCSV, flagOutliers, clearOutliers, removeOutliers,
  setDatasetFit, toggleFitVisibility, normalizeDataset,
} from '../modules/datasets';
import { runFit, fitEquationString } from '../modules/curve-fitting';
import { uid } from '../utils/math';
import type { FitType, CurveFit } from '../state/types';
import { updatePointData, deletePoint as deleteDataPoint, getPendingBarLabel, confirmBarLabel } from '../modules/digitizer';
import {
  getAutoTraceSettings, setAutoTraceSettings, runAutoTraceAsync, runXStepTrace,
  runCustomIndependents, commitAutoTrace, clearPreview, setPreviewData,
} from '../modules/auto-trace';
import { defaultBarSettings, detectBars, detectAllBarLayers } from '../modules/bar-detector';
import { defaultScatterSettings, detectScatterPoints } from '../modules/scatter-detector';
import type { BarDetectorSettings } from '../modules/bar-detector';
import type { ScatterDetectorSettings } from '../modules/scatter-detector';
import {
  startPie, resetPie, undoLastBoundary, commitPieSectors, computeSectors,
  getPieStep, getPieBoundaryCount, setPieTotalValue, getPieTotalValue,
} from '../modules/pie-detector';
import {
  startTemplateSelect, resetTemplate, runTemplateMatch, hasTemplate, getTemplateStep,
} from '../modules/template-match';
import {
  getStrips, startDefiningStrip, updateStripYRange, removeStrip, clearStrips,
  traceAllStrips, isDefiningStrip,
} from '../modules/strip-chart';
import { clearRoi } from '../modules/roi';
import { showToast } from '../utils/toast';
import { esc } from '../utils/sanitize';
import { Icons } from './icons';
import {
  makeSec, makeDiv, makeSpan, makeRow, makeLbl, makeBtn,
  makeSelect, makeIconBtn, makeCheckbox, makeFilterSlider, makeHint, makeLabelWithTip,
} from './ui-helpers';
import { trapFocus } from '../utils/modal';
import { pushHistory } from '../modules/history';
import type { ExtractionMode } from '../state/types';
// FitType and CurveFit imported above with datasets
const triggerPreview = () => import('./preview-panel').then(m => m.updatePreview());

// Module-level state preserved across renders
let traceExtractionMode: ExtractionMode = 'curve';
let barSettings: BarDetectorSettings = { ...defaultBarSettings };
let scatterSettings: ScatterDetectorSettings = { ...defaultScatterSettings };
type CurveAlgorithm = 'column-median' | 'x-step' | 'custom-x';
let curveAlgorithm: CurveAlgorithm = 'column-median';
let xStepPx = 5;
let customXStr = '';
let lastTraceResult: {
  points: import('../state/types').DataPoint[];
  previewData: Uint8ClampedArray;
  width: number;
  height: number;
} | null = null;

// Invalidate cached trace result when mode changes
function setMode(m: ExtractionMode): void {
  if (traceExtractionMode === 'pie' && m !== 'pie') resetPie();
  if (traceExtractionMode === 'template' && m !== 'template') resetTemplate();
  traceExtractionMode = m;
  lastTraceResult = null;
  window.__autoTraceMod = null;
  clearPreview();
}

export function renderStepData(container: HTMLElement): void {
  const state = getState();

  if (!state.calibration.isComplete) {
    const hint = makeDiv('');
    hint.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;';
    const icon = makeDiv('');
    icon.style.cssText = 'width:48px;height:48px;border-radius:14px;background:var(--color-accent-dim);display:flex;align-items:center;justify-content:center;';
    icon.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
    const title = makeDiv('');
    title.style.cssText = 'font-size:14px;font-weight:700;color:var(--color-text);text-align:center;';
    title.textContent = 'Set the scale first';
    const sub = makeDiv('');
    sub.style.cssText = 'font-size:12px;color:var(--color-muted);text-align:center;max-width:240px;line-height:1.6;';
    sub.textContent = 'Go to Step 2 and calibrate the axes before extracting data.';
    hint.appendChild(icon);
    hint.appendChild(title);
    hint.appendChild(sub);
    container.appendChild(hint);
    return;
  }

  // Left column: datasets + extraction method picker
  const leftCol = makeDiv('dock-col dock-col-narrow dock-col-border');
  renderDatasetsList(leftCol, state);
  renderMethodPicker(leftCol);
  container.appendChild(leftCol);

  // Center column: method-specific settings
  const centerCol = makeDiv('dock-col dock-col-medium dock-col-border');
  renderMethodSettings(centerCol, state);
  container.appendChild(centerCol);

  // Right column: points table + stats + export options
  const rightCol = makeDiv('dock-col dock-col-flex');
  renderPointsPanel(rightCol, state);
  container.appendChild(rightCol);
}

// ── Datasets list ──────────────────────────────────────────────

function renderDatasetsList(el: HTMLElement, state: ReturnType<typeof getState>): void {
  const sec = makeSec('Data Series');

  // Bar label prompt (appears when digitizing bar chart)
  const pending = getPendingBarLabel();
  if (pending) {
    const promptSec = makeSec('Category Label');
    const inp = document.createElement('input');
    inp.className = 'pv-input'; inp.type = 'text'; inp.placeholder = 'e.g. Q1 2024, Group A…';
    const confirmBtn = makeBtn('Confirm →', 'btn btn-primary btn-sm');
    confirmBtn.style.width = 'auto';
    const doConfirm = () => confirmBarLabel(inp.value);
    confirmBtn.addEventListener('click', doConfirm);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') doConfirm(); });
    const row = makeRow('start');
    row.style.gap = '6px';
    row.appendChild(inp); row.appendChild(confirmBtn);
    promptSec.appendChild(row);
    el.appendChild(promptSec);
    setTimeout(() => inp.focus(), 50);
  }

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

    const cnt = makeSpan(String(ds.points.length));
    cnt.className = 'dataset-count';
    r.appendChild(cnt);

    const eyeBtn = makeIconBtn(ds.visible ? Icons.eye : Icons.eyeOff, ds.visible ? 'Hide' : 'Show');
    eyeBtn.addEventListener('click', e => { e.stopPropagation(); toggleDatasetVisibility(ds.id); });
    r.appendChild(eyeBtn);

    const dupBtn = makeIconBtn(Icons.copy, 'Duplicate');
    dupBtn.addEventListener('click', e => { e.stopPropagation(); duplicateDataset(ds.id); });
    r.appendChild(dupBtn);

    const delBtn = makeIconBtn(Icons.x, 'Delete');
    delBtn.classList.add('danger');
    delBtn.addEventListener('click', e => { e.stopPropagation(); removeDataset(ds.id); });
    r.appendChild(delBtn);

    r.addEventListener('click', () => setActiveDataset(ds.id));
    sec.appendChild(r);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'add-ds-btn';
  addBtn.innerHTML = `${Icons.plus} New series`;
  addBtn.addEventListener('click', () => addDataset());
  sec.appendChild(addBtn);

  el.appendChild(sec);
}

// ── Method picker ──────────────────────────────────────────────

const METHODS: { id: ExtractionMode; icon: string; label: string; sub: string }[] = [
  { id: 'curve',      icon: Icons.chartLine, label: 'Trace a Line',     sub: 'Trace curves automatically' },
  { id: 'bar',        icon: Icons.chartBar,  label: 'Detect Bars',      sub: 'Read bar chart heights' },
  { id: 'scatter',    icon: Icons.scatter,   label: 'Find Dots',         sub: 'Locate scatter markers' },
  { id: 'pie',        icon: Icons.pieChart,  label: 'Pie Chart',         sub: 'Click sector boundaries' },
  { id: 'template',   icon: Icons.stamp,     label: 'Find Symbols',      sub: 'Copy a marker, find all' },
  { id: 'strip-chart',icon: Icons.strips,    label: 'Multi-Panel',       sub: 'Strip/ECG charts' },
  { id: 'ai',         icon: '✨',             label: 'AI Extract',        sub: 'Extract all data automatically' },
];

function renderMethodPicker(el: HTMLElement): void {
  const sec = makeSec('How do you want to get the data?');
  const list = makeDiv('method-list');

  METHODS.forEach(m => {
    const card = makeDiv('method-card' + (traceExtractionMode === m.id ? ' active' : ''));
    card.innerHTML = `
      ${m.icon}
      <div class="method-card-text">
        <span class="method-card-label">${m.label}</span>
        <span class="method-card-sub">${m.sub}</span>
      </div>
    `;
    card.addEventListener('click', () => { setMode(m.id); });
    list.appendChild(card);
  });

  sec.appendChild(list);
  el.appendChild(sec);
}

// ── Method-specific settings + actions ────────────────────────

function renderMethodSettings(el: HTMLElement, state: ReturnType<typeof getState>): void {
  const ats = getAutoTraceSettings();
  const roiState = state.canvas.roi;

  // Focus area (RoI)
  const roiSec = makeSec('Focus Area');
  if (roiState) {
    const info = makeDiv('text-muted');
    info.textContent = `Active: (${Math.round(Math.min(roiState.x1,roiState.x2))},${Math.round(Math.min(roiState.y1,roiState.y2))}) → (${Math.round(Math.max(roiState.x1,roiState.x2))},${Math.round(Math.max(roiState.y1,roiState.y2))})`;
    roiSec.appendChild(info);
    const row = makeRow('start');
    const redraw = makeBtn('Redraw', 'btn btn-ghost btn-sm');
    redraw.addEventListener('click', () => setState(d => { d.activeTool = 'roi'; }));
    const clrBtn = makeBtn('Clear', 'btn btn-danger btn-sm');
    clrBtn.addEventListener('click', clearRoi);
    row.appendChild(redraw); row.appendChild(clrBtn);
    roiSec.appendChild(row);
  } else {
    roiSec.appendChild(makeHint('Optionally draw a box to focus all detectors on a sub-region of the image.'));
    const drawBtn = makeBtn('Draw Focus Area', 'btn btn-ghost btn-sm');
    drawBtn.addEventListener('click', () => setState(d => { d.activeTool = 'roi'; }));
    roiSec.appendChild(drawBtn);
  }
  el.appendChild(roiSec);

  if (traceExtractionMode === 'pie') {
    renderPieWizard(el);
    return;
  }
  if (traceExtractionMode === 'template') {
    renderTemplateWizard(el);
    return;
  }
  if (traceExtractionMode === 'strip-chart') {
    renderStripWizard(el);
    return;
  }
  if (traceExtractionMode === 'ai') {
    renderAIExtractWizard(el);
    return;
  }

  // Target color picker (curve, bar, scatter)
  const curColor = traceExtractionMode === 'curve' ? ats.targetColor
    : traceExtractionMode === 'bar' ? barSettings.targetColor
    : scatterSettings.targetColor;

  const colorSec = makeSec('Line / marker color');
  const colorRow = makeRow('start');
  colorRow.style.gap = '8px';
  const colorPicker = document.createElement('input');
  colorPicker.type = 'color'; colorPicker.value = curColor;
  colorPicker.style.cssText = 'width:34px;height:30px;border:1.5px solid var(--color-border);border-radius:7px;background:var(--color-bg);cursor:pointer;padding:2px;flex-shrink:0;';
  colorPicker.addEventListener('input', () => {
    if (traceExtractionMode === 'curve') setAutoTraceSettings({ targetColor: colorPicker.value });
    else if (traceExtractionMode === 'bar') barSettings.targetColor = colorPicker.value;
    else scatterSettings.targetColor = colorPicker.value;
  });
  colorRow.appendChild(colorPicker);
  colorRow.appendChild(makeSpan('or click the canvas with Trace tool (T)', 'font-size:11px;color:var(--color-muted);'));
  colorSec.appendChild(colorRow);
  el.appendChild(colorSec);

  // Background exclusion
  const bgSec = makeSec('Background exclusion');
  const bgEnabled = traceExtractionMode === 'curve' ? ats.bgColor !== null
    : traceExtractionMode === 'bar' ? barSettings.bgColor !== null
    : scatterSettings.bgColor !== null;
  const bgRow = makeRow('start'); bgRow.style.gap = '8px';
  const bgCheck = document.createElement('input');
  bgCheck.type = 'checkbox'; bgCheck.checked = bgEnabled;
  bgCheck.style.cssText = 'accent-color:var(--color-accent);cursor:pointer;width:14px;height:14px;flex-shrink:0;';
  const bgPicker = document.createElement('input'); bgPicker.type = 'color';
  const bgVal = (traceExtractionMode === 'curve' ? ats.bgColor : traceExtractionMode === 'bar' ? barSettings.bgColor : scatterSettings.bgColor) ?? '#ffffff';
  bgPicker.value = bgVal; bgPicker.disabled = !bgEnabled;
  bgPicker.style.cssText = `width:34px;height:30px;border:1.5px solid var(--color-border);border-radius:7px;background:var(--color-bg);cursor:pointer;padding:2px;flex-shrink:0;opacity:${bgEnabled ? '1' : '0.4'};`;
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
  bgRow.appendChild(bgCheck); bgRow.appendChild(makeSpan('Skip background color', 'font-size:11px;color:var(--color-text-2);')); bgRow.appendChild(bgPicker);
  bgSec.appendChild(bgRow);
  el.appendChild(bgSec);

  // Mode-specific settings
  const settSec = makeSec('Settings');

  if (traceExtractionMode === 'curve') {
    settSec.appendChild(makeLbl('Algorithm'));
    const algSel = makeSelect([
      ['column-median','Auto trace (default)'],
      ['x-step','Fixed-spacing trace'],
      ['custom-x','My own X values'],
    ], curveAlgorithm);
    algSel.addEventListener('change', () => { curveAlgorithm = algSel.value as CurveAlgorithm; });
    settSec.appendChild(algSel);

    settSec.appendChild(makeLabelWithTip('Sensitivity', 'Higher = picks up more pixels but may include noise. Lower = stricter color match, fewer false positives.'));
    settSec.appendChild(makeFilterSlider('', ats.tolerance, 0, 100, v => setAutoTraceSettings({ tolerance: v })));

    if (curveAlgorithm === 'column-median') {
      settSec.appendChild(makeLabelWithTip('Curve smoothness', 'Smooths the traced line. Use "Smooth" for noisy or aliased images. Use "Rough" to preserve sharp features.'));
      const smoothSel = makeSelect([['none','Rough (none)'],['light','Medium'],['heavy','Smooth']], ats.smoothing);
      smoothSel.addEventListener('change', () => setAutoTraceSettings({ smoothing: smoothSel.value as any }));
      settSec.appendChild(smoothSel);
      settSec.appendChild(makeFilterSlider(`Sampling every ${ats.samplingInterval}px`, ats.samplingInterval, 1, 20,
        v => setAutoTraceSettings({ samplingInterval: v })));
    } else if (curveAlgorithm === 'x-step') {
      settSec.appendChild(makeFilterSlider(`Step size: ${xStepPx}px`, xStepPx, 1, 50, v => { xStepPx = v; }));
    } else {
      settSec.appendChild(makeLbl('X values (comma-separated)'));
      const xInp = document.createElement('input');
      xInp.className = 'pv-input'; xInp.type = 'text'; xInp.placeholder = '1,2,3,4,5 …';
      xInp.value = customXStr;
      xInp.addEventListener('input', () => { customXStr = xInp.value; });
      settSec.appendChild(xInp);
    }

  } else if (traceExtractionMode === 'bar') {
    settSec.appendChild(makeFilterSlider('Sensitivity', barSettings.tolerance, 0, 100, v => { barSettings.tolerance = v; }));
    settSec.appendChild(makeLbl('Bar orientation'));
    const dirSel = makeSelect([['vertical','Vertical bars'],['horizontal','Horizontal bars']], barSettings.direction);
    dirSel.addEventListener('change', () => { barSettings.direction = dirSel.value as any; });
    settSec.appendChild(dirSel);
    settSec.appendChild(makeFilterSlider(`Min bar width: ${barSettings.minBarWidth}px`, barSettings.minBarWidth, 2, 40, v => { barSettings.minBarWidth = v; }));

  } else {
    settSec.appendChild(makeLabelWithTip('Sensitivity', 'How closely the marker color must match. Higher = picks up more pixels. Lower = stricter.'));
    settSec.appendChild(makeFilterSlider('', scatterSettings.tolerance, 0, 100, v => { scatterSettings.tolerance = v; }));
    settSec.appendChild(makeLabelWithTip('Min marker size (px²)', 'Ignore color blobs smaller than this area. Increase to filter out tiny noise specks.'));
    settSec.appendChild(makeFilterSlider(`${scatterSettings.minBlobArea}px²`, scatterSettings.minBlobArea, 2, 100, v => { scatterSettings.minBlobArea = v; }));
    settSec.appendChild(makeFilterSlider(`Max marker size: ${scatterSettings.maxBlobArea}px²`, scatterSettings.maxBlobArea, 50, 2000, v => { scatterSettings.maxBlobArea = v; }));
    settSec.appendChild(makeFilterSlider(`Min spacing: ${scatterSettings.minSpacing}px`, scatterSettings.minSpacing, 2, 40, v => { scatterSettings.minSpacing = v; }));
  }

  el.appendChild(settSec);

  // Actions
  const actSec = makeSec('Actions');
  const previewLabel = traceExtractionMode === 'curve' ? 'Preview Trace'
    : traceExtractionMode === 'bar' ? 'Detect Bars' : 'Detect Dots';

  const previewBtn = makeBtn(previewLabel, 'btn btn-primary');
  previewBtn.addEventListener('click', () => { runDetect(previewBtn, ats); });
  actSec.appendChild(previewBtn);

  if (lastTraceResult) {
    const commitBtn = makeBtn(`Add ${lastTraceResult.points.length} pts to dataset →`, 'btn btn-success');
    commitBtn.addEventListener('click', () => {
      if (lastTraceResult) {
        commitAutoTrace(lastTraceResult.points);
        lastTraceResult = null;
        window.__autoTraceMod = null;
        clearPreview();
      }
    });
    actSec.appendChild(commitBtn);
    const clearBtn = makeBtn('Clear preview', 'btn btn-ghost btn-sm');
    clearBtn.style.width = 'auto';
    clearBtn.addEventListener('click', () => { lastTraceResult = null; window.__autoTraceMod = null; clearPreview(); });
    actSec.appendChild(clearBtn);
  }

  // Stacked bars
  if (traceExtractionMode === 'bar') {
    const stackSec = makeSec('Stacked / Grouped Bars');
    stackSec.appendChild(makeHint('Detect each color layer automatically:'));
    const stackBtn = makeBtn('Detect All Layers', 'btn btn-ghost btn-sm');
    stackBtn.style.width = 'auto';
    stackBtn.addEventListener('click', () => { void detectAllBarLayers(); });
    stackSec.appendChild(stackBtn);
    el.appendChild(stackSec);
  }

  el.appendChild(actSec);
}

function runDetect(btn: HTMLButtonElement, ats: ReturnType<typeof getAutoTraceSettings>): void {
  if (traceExtractionMode === 'curve') {
    if (curveAlgorithm === 'x-step') {
      const r = runXStepTrace(ats, xStepPx);
      if (r && r.points.length > 0) {
        lastTraceResult = r; setPreviewData(r.previewData, r.width, r.height);
      } else { showToast('No points traced — try adjusting sensitivity', 'warning'); }
    } else if (curveAlgorithm === 'custom-x') {
      const vals = customXStr.split(',').map(s => parseFloat(s.trim())).filter(v => !isNaN(v));
      if (vals.length === 0) { showToast('Enter at least one X value', 'warning'); return; }
      const r = runCustomIndependents(ats, vals);
      if (r && r.points.length > 0) {
        lastTraceResult = r; setPreviewData(r.previewData, r.width, r.height);
      } else { showToast('No points found at those X values', 'warning'); }
    } else {
      // Column median — async worker
      btn.disabled = true; btn.textContent = 'Tracing…';
      runAutoTraceAsync(ats, (r) => {
        btn.disabled = false; btn.textContent = 'Preview Trace';
        if (r && r.points.length > 0) {
          lastTraceResult = r; setPreviewData(r.previewData, r.width, r.height);
        } else { showToast('No points traced — try adjusting sensitivity', 'warning'); }
      });
      return;
    }
  } else if (traceExtractionMode === 'bar') {
    const r = detectBars(barSettings);
    if (r && r.points.length > 0) {
      lastTraceResult = r; setPreviewData(r.previewData, r.width, r.height);
    } else { showToast('No bars detected — try adjusting sensitivity', 'warning'); }
  } else {
    const r = detectScatterPoints(scatterSettings);
    if (r && r.points.length > 0) {
      lastTraceResult = r; setPreviewData(r.previewData, r.width, r.height);
    } else { showToast('No markers detected — try adjusting sensitivity', 'warning'); }
  }
}

// ── Pie wizard ──────────────────────────────────────────────────

function renderPieWizard(el: HTMLElement): void {
  const step = getPieStep();
  const boundaryCount = getPieBoundaryCount();
  const totalValue = getPieTotalValue();

  const valueSec = makeSec('Total value');
  const valInp = document.createElement('input');
  valInp.className = 'pv-input'; valInp.type = 'number';
  valInp.value = String(totalValue); valInp.placeholder = '100';
  valInp.style.width = '120px';
  valInp.addEventListener('change', () => { setPieTotalValue(parseFloat(valInp.value) || 100); });
  const valRow = makeRow('start'); valRow.style.gap = '8px';
  valRow.appendChild(valInp);
  valRow.appendChild(makeSpan('(e.g. 100 for percentages)', 'font-size:11px;color:var(--color-muted);'));
  valueSec.appendChild(valRow);
  el.appendChild(valueSec);

  const wizSec = makeSec('Pie digitizer');
  if (step === 'idle') {
    wizSec.appendChild(makeHint('Click the center, a reference direction, then each sector boundary clockwise.'));
    const startBtn = makeBtn('Start Pie Digitizer →', 'btn btn-primary');
    startBtn.addEventListener('click', () => startPie(getPieTotalValue()));
    wizSec.appendChild(startBtn);
  } else {
    const pills = makeDiv('pill-tabs');
    [
      { label: 'Center', idx: 0 }, { label: 'Reference', idx: 1 },
      { label: `${boundaryCount} sectors`, idx: 2 },
    ].forEach(({ label, idx }) => {
      const pill = makeDiv('pill-tab');
      pill.textContent = label;
      const currentIdx = step === 'place-center' ? 0 : step === 'place-reference' ? 1 : 2;
      if (idx < currentIdx) pill.classList.add('done');
      if (idx === currentIdx) pill.classList.add('active');
      pills.appendChild(pill);
    });
    wizSec.appendChild(pills);

    const instructions: Record<string, string> = {
      'place-center':    '① Click the center of the pie chart',
      'place-reference': '② Click the reference direction (e.g. 12 o\'clock)',
      'place-sectors':   `③ Click sector boundaries clockwise (${boundaryCount} added) — then Finish`,
    };
    wizSec.appendChild(makeHint(instructions[step] ?? ''));

    if (step === 'place-sectors' && boundaryCount > 0) {
      const sectors = computeSectors();
      const tableWrap = makeDiv('');
      tableWrap.style.cssText = 'max-height:100px;overflow-y:auto;';
      const table = document.createElement('table');
      table.style.cssText = 'width:100%;font-family:var(--font-mono);font-size:10px;border-collapse:collapse;';
      table.innerHTML = `<thead><tr><th style="text-align:left;color:var(--color-muted);padding:2px 4px;">Angle</th><th style="text-align:left;color:var(--color-muted);padding:2px 4px;">Value</th></tr></thead>`;
      const tbody = document.createElement('tbody');
      sectors.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="padding:2px 4px;">${s.angleDeg.toFixed(1)}°</td><td style="padding:2px 4px;">${s.value.toFixed(2)}</td>`;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody); tableWrap.appendChild(table);
      wizSec.appendChild(tableWrap);
    }

    const actionRow = makeRow('start'); actionRow.style.gap = '6px;margin-top:8px;';
    if (boundaryCount > 0) {
      const undoBtn = makeBtn('← Undo last', 'btn btn-ghost btn-sm');
      undoBtn.addEventListener('click', undoLastBoundary);
      actionRow.appendChild(undoBtn);
    }
    if (step === 'place-sectors' && boundaryCount > 0) {
      const commitBtn = makeBtn(`Add ${boundaryCount} sectors →`, 'btn btn-success btn-sm');
      commitBtn.addEventListener('click', () => commitPieSectors());
      actionRow.appendChild(commitBtn);
    }
    const resetBtn = makeBtn('Reset', 'btn btn-ghost btn-sm');
    resetBtn.addEventListener('click', resetPie);
    actionRow.appendChild(resetBtn);
    wizSec.appendChild(actionRow);
  }

  el.appendChild(wizSec);
}

// ── Template wizard ─────────────────────────────────────────────

function renderTemplateWizard(el: HTMLElement): void {
  const templateStep = getTemplateStep();
  const captured = hasTemplate();

  const sec = makeSec('Find matching symbols');
  sec.appendChild(makeHint('Drag over one marker on the chart to capture a template. PlotVision will find all similar markers.'));

  if (templateStep === 'idle' || templateStep === 'selecting') {
    const msg = makeDiv('text-muted');
    msg.style.marginTop = '4px';
    msg.textContent = templateStep === 'selecting' ? 'Drag over a marker on the canvas…' : 'Not capturing yet.';
    sec.appendChild(msg);
    const captureBtn = makeBtn(captured ? 'Recapture Template' : 'Capture Template', 'btn btn-primary');
    captureBtn.addEventListener('click', startTemplateSelect);
    sec.appendChild(captureBtn);
  }

  if (captured) {
    const msg = makeDiv('text-muted');
    msg.textContent = 'Template captured. Adjust threshold and click Find Matches.';
    sec.appendChild(msg);

    const clrBtn = makeBtn('Clear template', 'btn btn-ghost btn-sm');
    clrBtn.style.width = 'auto';
    clrBtn.addEventListener('click', resetTemplate);
    sec.appendChild(clrBtn);

    sec.appendChild(makeFilterSlider('Match sensitivity', 70, 10, 100, () => {}));
    sec.appendChild(makeFilterSlider('Min spacing between matches', 10, 4, 80, () => {}));

    const findBtn = makeBtn('Find Matches', 'btn btn-primary');
    findBtn.addEventListener('click', () => {
      const r = runTemplateMatch();
      if (r && r.points.length > 0) {
        lastTraceResult = r as typeof lastTraceResult;
        setPreviewData(r.previewData, r.width, r.height);
      } else { showToast('No matches found — try adjusting sensitivity', 'warning'); }
    });
    sec.appendChild(findBtn);

    if (lastTraceResult) {
      const commitBtn = makeBtn(`Add ${lastTraceResult.points.length} matches →`, 'btn btn-success');
      commitBtn.addEventListener('click', () => {
        if (lastTraceResult) { commitAutoTrace(lastTraceResult.points); lastTraceResult = null; clearPreview(); }
      });
      sec.appendChild(commitBtn);
    }
  }
  el.appendChild(sec);
}

// ── Strip chart wizard ──────────────────────────────────────────

function renderStripWizard(el: HTMLElement): void {
  const strips = getStrips();
  const defining = isDefiningStrip();

  const defSec = makeSec('Multi-panel chart strips');
  const nameInp = document.createElement('input');
  nameInp.className = 'pv-input'; nameInp.type = 'text'; nameInp.placeholder = 'Strip name (e.g. Channel 1)';

  if (defining) {
    defSec.appendChild(makeHint('Click the top edge, then bottom edge of the strip on the canvas…'));
    const cancelBtn = makeBtn('Cancel', 'btn btn-ghost btn-sm');
    cancelBtn.style.width = 'auto';
    cancelBtn.addEventListener('click', () => {
      (window as any).__stripDefining = false;
    });
    defSec.appendChild(cancelBtn);
  } else {
    defSec.appendChild(makeHint('Enter a name and click "Define Strip", then click the top and bottom edges of each panel.'));
    defSec.appendChild(nameInp);
    const defineBtn = makeBtn('+ Define Strip', 'btn btn-primary');
    defineBtn.addEventListener('click', () => { startDefiningStrip(nameInp.value || 'Strip', '#6366f1'); });
    defSec.appendChild(defineBtn);
  }
  el.appendChild(defSec);

  if (strips.length > 0) {
    const listSec = makeSec(`Strips (${strips.length})`);
    strips.forEach(strip => {
      const row = makeRow('between');
      row.style.padding = '4px 0';
      const label = makeDiv('');
      label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;color:var(--color-text);';
      const dot = makeDiv('');
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${strip.color ?? 'var(--color-accent)'};flex-shrink:0;`;
      label.appendChild(dot); label.appendChild(document.createTextNode(strip.name));
      row.appendChild(label);
      const yRow = makeDiv('flex-row');
      const yMinInp = document.createElement('input');
      yMinInp.className = 'pv-input'; yMinInp.type = 'number';
      yMinInp.value = String(strip.yMinData ?? 0); yMinInp.style.cssText = 'width:60px;';
      yMinInp.placeholder = 'Y min';
      const yMaxInp = document.createElement('input');
      yMaxInp.className = 'pv-input'; yMaxInp.type = 'number';
      yMaxInp.value = String(strip.yMaxData ?? 1); yMaxInp.style.cssText = 'width:60px;';
      yMaxInp.placeholder = 'Y max';
      const setYBtn = makeBtn('Set Y', 'btn btn-ghost btn-sm');
      setYBtn.style.width = 'auto';
      setYBtn.addEventListener('click', () => {
        updateStripYRange(strip.id, parseFloat(yMinInp.value), parseFloat(yMaxInp.value));
      });
      const removeBtn = makeIconBtn(Icons.x, 'Remove strip');
      removeBtn.classList.add('danger');
      removeBtn.addEventListener('click', () => removeStrip(strip.id));
      yRow.appendChild(yMinInp); yRow.appendChild(yMaxInp); yRow.appendChild(setYBtn); yRow.appendChild(removeBtn);
      row.appendChild(yRow);
      listSec.appendChild(row);
    });

    const actRow = makeRow('start'); actRow.style.gap = '6px;margin-top:8px;';
    const traceAllBtn = makeBtn('Trace All Strips', 'btn btn-primary btn-sm');
    traceAllBtn.style.width = 'auto';
    traceAllBtn.addEventListener('click', () => void traceAllStrips());
    const clearBtn = makeBtn('Clear All', 'btn btn-danger btn-sm');
    clearBtn.style.width = 'auto';
    clearBtn.addEventListener('click', clearStrips);
    actRow.appendChild(traceAllBtn); actRow.appendChild(clearBtn);
      listSec.appendChild(actRow);
    el.appendChild(listSec);
  }
}

// ── AI Extract wizard ──────────────────────────────────────────

function renderAIExtractWizard(el: HTMLElement): void {
  const sec = makeSec('✨ AI Assist');
  sec.appendChild(makeHint('Automatically extract all visible data series using AI.'));
  
  const extractBtn = makeBtn('Extract All Data', 'btn btn-primary');
  extractBtn.addEventListener('click', async () => {
    if (!getState().ai.apiKey) {
      import('../utils/toast').then(m => m.showToast('Please configure AI API Key in Settings first', 'warning'));
      return;
    }
    import('./loading-overlay').then(m => m.showLoading('Extracting data with AI...'));
    try {
      const { aiExtractAllData } = await import('../modules/ai-assist');
      const res = await aiExtractAllData();
      
      setState(d => {
        res.series.forEach(s => {
          const dsId = uid();
          d.datasets.push({
            id: dsId,
            name: s.name || 'AI Series',
            color: s.color || '#6366f1',
            visible: true,
            points: s.points.map(p => ({
              id: uid(),
              pixelX: 0,
              pixelY: 0,
              dataX: p.dataX,
              dataY: p.dataY
            }))
          });
          d.activeDatasetId = dsId;
        });
      });
      import('../utils/toast').then(m => m.showToast(`Extracted ${res.series.length} series`, 'success'));
    } catch (e: any) {
      import('../utils/toast').then(m => m.showToast(e.message, 'error'));
    } finally {
      import('./loading-overlay').then(m => m.hideLoading());
    }
  });
  
  sec.appendChild(extractBtn);
  el.appendChild(sec);
}

// ── Points panel (right column) ────────────────────────────────

function renderPointsPanel(el: HTMLElement, state: ReturnType<typeof getState>): void {
  const activeDs = state.datasets.find(d => d.id === state.activeDatasetId);

  if (!activeDs) {
    el.appendChild(makeHint('Select a data series on the left to see its points.'));
    return;
  }

  // Sort + import + clear bar
  const sortSec = makeSec(`Points — ${activeDs.name}`);
  const sortBar = makeRow('start');
  sortBar.style.cssText = 'gap:5px;margin-bottom:4px;flex-wrap:wrap;';
  const sortX = makeBtn('Sort X', 'btn btn-ghost btn-sm');
  sortX.addEventListener('click', () => sortDatasetPoints(activeDs.id, 'x'));
  const sortY = makeBtn('Sort Y', 'btn btn-ghost btn-sm');
  sortY.addEventListener('click', () => sortDatasetPoints(activeDs.id, 'y'));
  const importBtn = makeBtn('Import CSV', 'btn btn-ghost btn-sm');
  importBtn.title = 'Import X,Y rows from clipboard or file';
  importBtn.addEventListener('click', () => openImportModal(activeDs.id));
  const spacer = makeDiv(''); spacer.style.flex = '1';
  const clearBtn = makeBtn('Clear', 'btn btn-danger btn-sm');
  clearBtn.addEventListener('click', () => clearDatasetPoints(activeDs.id));
  sortBar.appendChild(sortX); sortBar.appendChild(sortY); sortBar.appendChild(importBtn);
  sortBar.appendChild(spacer); sortBar.appendChild(clearBtn);
  sortSec.appendChild(sortBar);

  // Points table
  const wrap = makeDiv('');
  wrap.style.cssText = 'overflow-y:auto;max-height:160px;';
  const table = document.createElement('table');
  table.className = 'point-table';
  const [colX, colY] = getAxisColumnLabels(state.calibration.axisType);
  const isTernary = state.calibration.axisType === 'ternary';
  table.innerHTML = `<thead><tr><th style="width:28px">#</th><th>${colX}</th><th>${colY}</th>${isTernary ? '<th>C%</th>' : ''}<th style="width:24px"></th></tr></thead>`;
  const tbody = document.createElement('tbody');

  activeDs.points.slice(0, 500).forEach((pt, i) => {
    const tr = document.createElement('tr');
    tr.dataset.pointId = pt.id;
    tr.style.cursor = 'pointer';
    const xDisplay = formatCellX(pt, state.calibration.axisType);
    const yDisplay = (state.calibration.axisType === 'polar' || state.calibration.axisType === 'log-polar')
      ? pt.dataY.toFixed(2) + '°' : pt.dataY.toPrecision(6);
    const xEditable = state.calibration.axisType !== 'bar-chart' && state.calibration.axisType !== 'date-x';
    const cPct = isTernary ? `<td style="color:var(--color-muted);font-size:10px;">${(100 - pt.dataX - pt.dataY).toFixed(2)}%</td>` : '';
    tr.innerHTML = `
      <td style="color:var(--color-muted)">${i + 1}</td>
      <td ${xEditable ? 'contenteditable="true"' : ''} data-field="x" data-id="${esc(pt.id)}">${esc(xDisplay)}</td>
      <td contenteditable="true" data-field="y" data-id="${esc(pt.id)}">${esc(yDisplay)}</td>
      ${cPct}
      <td><button class="icon-btn danger" data-delete="${esc(pt.id)}" title="Delete">${Icons.x}</button></td>
    `;
    tbody.appendChild(tr);
  });

  if (activeDs.points.length > 500) {
    const info = document.createElement('tr');
    info.innerHTML = `<td colspan="4" style="text-align:center;color:var(--color-muted);padding:5px;font-size:10px;">Showing 500 of ${activeDs.points.length}</td>`;
    tbody.appendChild(info);
  }

  table.appendChild(tbody); wrap.appendChild(table); sortSec.appendChild(wrap);

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
    // Delete button
    const btn = (e.target as HTMLElement).closest('[data-delete]') as HTMLElement | null;
    if (btn?.dataset.delete) { deleteDataPoint(activeDs.id, btn.dataset.delete); return; }
    // Row click → open point editor
    const row = (e.target as HTMLElement).closest('tr[data-point-id]') as HTMLElement | null;
    if (row?.dataset.pointId) openPointEditor(activeDs.id, row.dataset.pointId, state.calibration.axisType);
  });

  el.appendChild(sortSec);

  // Statistics (F6 — expanded)
  if (activeDs.points.length >= 2) {
    const xs = activeDs.points.map(p => p.dataX);
    const ys = activeDs.points.map(p => p.dataY);
    const n = xs.length;
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    const stdX = Math.sqrt(xs.reduce((s, v) => s + (v - meanX) ** 2, 0) / n);
    const stdY = Math.sqrt(ys.reduce((s, v) => s + (v - meanY) ** 2, 0) / n);
    const cov  = xs.reduce((s, v, i) => s + (v - meanX) * (ys[i] - meanY), 0) / n;
    const pearsonR = stdX > 0 && stdY > 0 ? cov / (stdX * stdY) : 0;
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    const statSec = makeSec('Statistics');
    const grid = makeDiv('stat-grid');
    const mkStat = (label: string, value: string) => {
      const c = makeDiv('stat-card');
      c.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value">${value}</div>`;
      return c;
    };
    grid.appendChild(mkStat('N', String(n)));
    grid.appendChild(mkStat('Mean X', meanX.toPrecision(4)));
    grid.appendChild(mkStat('Mean Y', meanY.toPrecision(4)));
    grid.appendChild(mkStat('Std X', stdX.toPrecision(3)));
    grid.appendChild(mkStat('Std Y', stdY.toPrecision(3)));
    grid.appendChild(mkStat('Pearson r', pearsonR.toFixed(3)));
    statSec.appendChild(grid);

    // Copy stats button
    const copyBtn = makeBtn('Copy stats', 'btn btn-ghost btn-sm');
    copyBtn.style.cssText = 'width:auto;margin-top:6px;';
    copyBtn.addEventListener('click', () => {
      const text = `N\t${n}\nMean X\t${meanX.toPrecision(6)}\nMean Y\t${meanY.toPrecision(6)}\nStd X\t${stdX.toPrecision(6)}\nStd Y\t${stdY.toPrecision(6)}\nPearson r\t${pearsonR.toFixed(6)}\nX range\t${minX.toPrecision(6)} – ${maxX.toPrecision(6)}\nY range\t${minY.toPrecision(6)} – ${maxY.toPrecision(6)}`;
      navigator.clipboard.writeText(text).then(() => showToast('Stats copied', 'success'));
    });
    statSec.appendChild(copyBtn);

    // Outlier detection UI (F7)
    const outlierCount = activeDs.points.filter(p => p.outlier).length;
    const outlierRow = makeRow('start');
    outlierRow.style.cssText = 'gap:6px;margin-top:8px;flex-wrap:wrap;';
    const detectBtn = makeBtn('Detect outliers (2.5σ)', 'btn btn-ghost btn-sm');
    detectBtn.style.width = 'auto';
    detectBtn.addEventListener('click', () => {
      const found = flagOutliers(activeDs.id, 2.5);
      showToast(found > 0 ? `${found} outlier${found !== 1 ? 's' : ''} flagged` : 'No outliers found', found > 0 ? 'warning' : 'info');
    });
    outlierRow.appendChild(detectBtn);
    if (outlierCount > 0) {
      const removeBtn = makeBtn(`Remove ${outlierCount} outlier${outlierCount !== 1 ? 's' : ''}`, 'btn btn-danger btn-sm');
      removeBtn.style.width = 'auto';
      removeBtn.addEventListener('click', () => { removeOutliers(activeDs.id); showToast('Outliers removed', 'info'); });
      const clearBtn = makeBtn('Clear flags', 'btn btn-ghost btn-sm');
      clearBtn.style.width = 'auto';
      clearBtn.addEventListener('click', () => clearOutliers(activeDs.id));
      outlierRow.appendChild(removeBtn); outlierRow.appendChild(clearBtn);
    }
    statSec.appendChild(outlierRow);
    el.appendChild(statSec);

    // A2: Curve fitting
    const fitSec = makeSec('Curve Fitting');
    const existingFit = (activeDs as any).curveFit as CurveFit | undefined;

    const fitTypes: { value: FitType; label: string }[] = [
      { value: 'linear',      label: 'Linear' },
      { value: 'exponential', label: 'Exponential' },
      { value: 'power',       label: 'Power law' },
      { value: 'polynomial',  label: 'Polynomial' },
    ];
    const fitTypeRow = makeRow('start'); fitTypeRow.style.gap = '4px';
    const fitTypeSel = makeSelect(fitTypes.map(t => [t.value, t.label] as [string, string]),
      existingFit?.type ?? 'linear');
    fitTypeSel.style.flex = '1';
    fitTypeRow.appendChild(fitTypeSel);
    fitSec.appendChild(fitTypeRow);

    const degRow = makeRow('start'); degRow.style.gap = '6px';
    const degLbl = makeDiv(''); degLbl.style.cssText = 'font-size:11px;color:var(--color-text-2);white-space:nowrap;';
    degLbl.textContent = 'Degree:';
    const degSel = makeSelect(
      [2,3,4,5].map(n => [String(n), String(n)] as [string, string]),
      String(existingFit?.degree ?? 2)
    );
    degSel.style.width = '64px';
    degRow.appendChild(degLbl); degRow.appendChild(degSel);
    fitSec.appendChild(degRow);

    const showDegRow = () => { degRow.style.display = fitTypeSel.value === 'polynomial' ? 'flex' : 'none'; };
    showDegRow();
    fitTypeSel.addEventListener('change', showDegRow);

    const fitBtnRow = makeRow('start'); fitBtnRow.style.gap = '6px';
    const fitBtn = makeBtn('Fit', 'btn btn-primary btn-sm'); fitBtn.style.width = 'auto';
    const clearFitBtn = makeBtn('Clear', 'btn btn-ghost btn-sm'); clearFitBtn.style.width = 'auto';
    fitBtnRow.appendChild(fitBtn); fitBtnRow.appendChild(clearFitBtn);
    fitSec.appendChild(fitBtnRow);

    const fitResultEl = makeDiv('');
    fitResultEl.style.cssText = 'font-size:11px;font-family:var(--font-mono);color:var(--color-text-2);background:var(--color-surface-3);border:1px solid var(--color-border);border-radius:7px;padding:7px 10px;line-height:1.7;';
    if (existingFit) {
      fitResultEl.innerHTML = `<strong>${fitEquationString(existingFit)}</strong><br>R² = ${existingFit.r2.toFixed(4)}`;
    } else {
      fitResultEl.style.display = 'none';
    }
    fitSec.appendChild(fitResultEl);

    if (existingFit) {
      const visRow = makeRow('start'); visRow.style.gap = '6px';
      const visBtn = makeBtn(existingFit.visible ? 'Hide fit curve' : 'Show fit curve', 'btn btn-ghost btn-sm');
      visBtn.style.width = 'auto';
      visBtn.addEventListener('click', () => toggleFitVisibility(activeDs.id));
      visRow.appendChild(visBtn);
      fitSec.appendChild(visRow);
    }

    fitBtn.addEventListener('click', () => {
      const xs = activeDs.points.map(p => p.dataX);
      const ys = activeDs.points.map(p => p.dataY);
      const type = fitTypeSel.value as FitType;
      const degree = parseInt(degSel.value, 10);
      const result = runFit(xs, ys, type, degree);
      if (!result) {
        showToast('Fit failed — check data requirements (e.g. all Y > 0 for exponential)', 'warning');
        return;
      }
      setDatasetFit(activeDs.id, result);
      fitResultEl.style.display = '';
      fitResultEl.innerHTML = `<strong>${fitEquationString(result)}</strong><br>R² = ${result.r2.toFixed(4)}`;
    });
    clearFitBtn.addEventListener('click', () => { setDatasetFit(activeDs.id, null); fitResultEl.style.display = 'none'; });

    el.appendChild(fitSec);

    // A3: Normalization
    const normSec = makeSec('Normalize');
    const normRow = makeRow('start'); normRow.style.gap = '6px';
    const normSel = makeSelect(
      [['minmax', 'Min-Max (0–1)'], ['zscore', 'Z-score']] as [string, string][],
      'minmax'
    );
    normSel.style.flex = '1';
    const normBtn = makeBtn('Create normalized copy', 'btn btn-ghost btn-sm'); normBtn.style.width = 'auto';
    normBtn.addEventListener('click', () => normalizeDataset(activeDs.id, normSel.value as 'minmax' | 'zscore'));
    normRow.appendChild(normSel); normRow.appendChild(normBtn);
    normSec.appendChild(normRow);
    normSec.appendChild(makeHint('Creates a new series with scaled values. Original data is preserved.'));
    el.appendChild(normSec);
  }

  // Image filters (collapsed/compact in right panel)
  if (state.image.width > 0) {
    renderImageFilters(el, state);
  }

  // Export options
  renderExportOptions(el, state);

  // Preview chart
  const hasPoints = state.datasets.some(d => d.visible && d.points.length > 0);
  if (hasPoints) {
    const prevSec = makeSec('Preview');
    const modeRow = makeRow('start'); modeRow.style.cssText = 'gap:5px;margin-bottom:6px;';
    (['scatter','line'] as const).forEach(m => {
      const btn = makeBtn(m === 'scatter' ? 'Scatter' : 'Line',
        `btn btn-sm ${state.ui.previewMode === m ? 'btn-primary' : 'btn-ghost'}`);
      btn.style.cssText = 'flex:1;';
      btn.addEventListener('click', () => setState(d => { d.ui.previewMode = m; }));
      modeRow.appendChild(btn);
    });
    prevSec.appendChild(modeRow);
    const canvasWrap = makeDiv('');
    canvasWrap.style.cssText = 'position:relative;height:140px;';
    const previewCanvas = document.createElement('canvas');
    previewCanvas.id = 'preview-chart';
    previewCanvas.style.cssText = 'width:100%;height:100%;';
    canvasWrap.appendChild(previewCanvas);
    prevSec.appendChild(canvasWrap);
    el.appendChild(prevSec);
    requestAnimationFrame(() => { void triggerPreview(); });
  }
}

function renderImageFilters(el: HTMLElement, state: ReturnType<typeof getState>): void {
  const filtSec = makeSec('Image Adjustments');
  const f = state.canvas.imageFilters;

  filtSec.appendChild(makeFilterSlider('Brightness', f.brightness, 0, 200,
    v => setState(d => { d.canvas.imageFilters.brightness = v; })));
  filtSec.appendChild(makeFilterSlider('Contrast', f.contrast, 0, 200,
    v => setState(d => { d.canvas.imageFilters.contrast = v; })));

  const cssRow = makeDiv('flex-row'); cssRow.style.gap = '12px;flex-wrap:wrap;';
  cssRow.appendChild(makeCheckbox('Invert', f.invert,
    e => setState(d => { d.canvas.imageFilters.invert = (e.target as HTMLInputElement).checked; })));
  cssRow.appendChild(makeCheckbox('Grayscale', f.grayscale,
    e => setState(d => { d.canvas.imageFilters.grayscale = (e.target as HTMLInputElement).checked; })));
  filtSec.appendChild(cssRow);

  const pxRow = makeDiv('flex-row'); pxRow.style.gap = '12px;flex-wrap:wrap;';
  pxRow.appendChild(makeCheckbox('Sharpen', f.sharpen,
    e => setState(d => { d.canvas.imageFilters.sharpen = (e.target as HTMLInputElement).checked; })));
  pxRow.appendChild(makeCheckbox('Denoise', f.denoise,
    e => setState(d => { d.canvas.imageFilters.denoise = (e.target as HTMLInputElement).checked; })));
  pxRow.appendChild(makeCheckbox('Remove grid', f.gridRemoval,
    e => setState(d => { d.canvas.imageFilters.gridRemoval = (e.target as HTMLInputElement).checked; })));
  pxRow.appendChild(makeCheckbox('Auto-contrast', f.autoContrast,
    e => setState(d => { d.canvas.imageFilters.autoContrast = (e.target as HTMLInputElement).checked; })));
  filtSec.appendChild(pxRow);

  const resetBtn = makeBtn('Reset filters', 'btn btn-ghost btn-sm');
  resetBtn.style.width = 'auto';
  resetBtn.addEventListener('click', () => setState(d => {
    d.canvas.imageFilters = { brightness: 100, contrast: 100, grayscale: false, invert: false, sharpen: false, threshold: null, autoContrast: false, denoise: false, gridRemoval: false };
  }));
  filtSec.appendChild(resetBtn);
  el.appendChild(filtSec);
}

function renderExportOptions(el: HTMLElement, state: ReturnType<typeof getState>): void {
  const expOptSec = makeSec('Export Format');
  const expOpts = state.exportOptions;

  expOptSec.appendChild(makeLbl('Number format'));
  const precSel = makeSelect([
    ['auto','Auto'], ['fixed','Fixed decimals'], ['sigfigs','Significant figures'], ['scientific','Scientific'],
  ], expOpts.precision);
  precSel.addEventListener('change', () => setState(d => { d.exportOptions.precision = precSel.value as any; }));
  expOptSec.appendChild(precSel);

  expOptSec.appendChild(makeLbl('Sort order'));
  const sortSel = makeSelect([
    ['none','None'], ['x-asc','X ascending'], ['x-desc','X descending'],
    ['y-asc','Y ascending'], ['y-desc','Y descending'], ['nearest-neighbor','Nearest-Neighbor'],
  ], expOpts.sort);
  sortSel.addEventListener('change', () => setState(d => { d.exportOptions.sort = sortSel.value as any; }));
  expOptSec.appendChild(sortSel);

  el.appendChild(expOptSec);
}

function openImportModal(datasetId: string): void {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--color-surface);border:1.5px solid var(--color-border);border-radius:14px;padding:20px;width:360px;font-family:var(--font-sans);';
  box.innerHTML = `
    <div style="font-size:14px;font-weight:700;margin-bottom:6px;color:var(--color-text);">Import X,Y Points</div>
    <div style="font-size:11px;color:var(--color-muted);margin-bottom:12px;line-height:1.6;">Paste CSV or TSV rows — one point per line. First two columns are X and Y. Optional third column as label.</div>
  `;
  const ta = document.createElement('textarea');
  ta.style.cssText = 'width:100%;height:120px;resize:vertical;font-family:var(--font-mono);font-size:11px;padding:8px;border:1.5px solid var(--color-border);border-radius:8px;background:var(--color-bg);color:var(--color-text);';
  ta.placeholder = '1.2, 3.4\n2.5, 6.1\n…';
  box.appendChild(ta);
  const btnRow = makeRow('start'); btnRow.style.cssText = 'gap:8px;margin-top:12px;justify-content:flex-end;';
  const cancelB = makeBtn('Cancel', 'btn btn-ghost btn-sm');
  cancelB.style.width = 'auto';
  cancelB.addEventListener('click', () => modal.remove());
  const confirmB = makeBtn('Import', 'btn btn-primary btn-sm');
  confirmB.style.width = 'auto';
  confirmB.addEventListener('click', () => {
    const count = importPointsFromCSV(datasetId, ta.value);
    modal.remove();
    if (count > 0) showToast(`Imported ${count} points`, 'success');
    else showToast('No valid X,Y rows found', 'warning');
  });
  btnRow.appendChild(cancelB); btnRow.appendChild(confirmB);
  box.appendChild(btnRow);
  modal.appendChild(box);
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  setTimeout(() => ta.focus(), 50);
}

// ── F4: Point Editor Dialog ───────────────────────────────────────────────────

function openPointEditor(datasetId: string, pointId: string, axisType: string): void {
  const state = getState();
  const ds = state.datasets.find(d => d.id === datasetId);
  const pt = ds?.points.find(p => p.id === pointId);
  if (!pt) return;

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:300;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;';

  const box = document.createElement('div');
  box.style.cssText = 'background:var(--color-surface);border:1.5px solid var(--color-border);border-radius:14px;padding:20px;width:320px;font-family:var(--font-sans);box-shadow:0 24px 64px rgba(0,0,0,0.2);';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:14px;font-weight:700;color:var(--color-text);margin-bottom:14px;';
  title.textContent = 'Edit Point';
  box.appendChild(title);

  const [colX, colY] = getAxisColumnLabels(axisType);
  const xEditable = axisType !== 'bar-chart' && axisType !== 'date-x';

  const fields: { label: string; value: string; key: string; editable: boolean; type: string }[] = [
    { label: colX, value: String(pt.dataX), key: 'x', editable: xEditable, type: 'number' },
    { label: colY, value: String(pt.dataY), key: 'y', editable: true, type: 'number' },
    { label: `± ${colX} error`, value: String(pt.xError ?? ''), key: 'xError', editable: true, type: 'number' },
    { label: `± ${colY} error`, value: String(pt.yError ?? ''), key: 'yError', editable: true, type: 'number' },
    { label: 'Label', value: pt.label ?? '', key: 'label', editable: true, type: 'text' },
  ];

  const inputs: Record<string, HTMLInputElement> = {};
  for (const f of fields) {
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--color-text-2);margin-bottom:3px;margin-top:10px;';
    lbl.textContent = f.label;
    const inp = document.createElement('input');
    inp.className = 'pv-input';
    inp.type = f.type;
    inp.value = f.value;
    inp.disabled = !f.editable;
    if (f.type === 'number' && f.key.includes('error')) inp.min = '0';
    if (!f.editable) inp.style.opacity = '0.5';
    inp.addEventListener('keydown', e => { if (e.key === 'Escape') modal.remove(); if (e.key === 'Enter') doSave(); });
    box.appendChild(lbl);
    box.appendChild(inp);
    inputs[f.key] = inp;
  }

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-ghost btn-sm';
  cancelBtn.style.width = 'auto';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => modal.remove());
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary btn-sm';
  saveBtn.style.flex = '1';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', doSave);
  btnRow.appendChild(cancelBtn); btnRow.appendChild(saveBtn);
  box.appendChild(btnRow);

  modal.appendChild(box);
  document.body.appendChild(modal);
  const closeEditor = () => { modal.remove(); releaseEditor(); };
  modal.addEventListener('click', e => { if (e.target === modal) closeEditor(); });
  const releaseEditor = trapFocus(box, closeEditor);

  function doSave(): void {
    const newX = xEditable ? parseFloat(inputs.x.value) : pt!.dataX;
    const newY = parseFloat(inputs.y.value);
    const newLabel = inputs.label.value.trim() || undefined;
    const rawXErr = parseFloat(inputs.xError.value);
    const rawYErr = parseFloat(inputs.yError.value);
    const newXError = isNaN(rawXErr) || rawXErr <= 0 ? undefined : rawXErr;
    const newYError = isNaN(rawYErr) || rawYErr <= 0 ? undefined : rawYErr;
    if (isNaN(newX) || isNaN(newY)) { showToast('X and Y must be valid numbers', 'warning'); return; }
    pushHistory('Edit point');
    setState(d => {
      const dsDraft = d.datasets.find(ds => ds.id === datasetId);
      const ptDraft = dsDraft?.points.find(p => p.id === pointId);
      if (ptDraft) {
        ptDraft.dataX = newX; ptDraft.dataY = newY; ptDraft.label = newLabel;
        ptDraft.xError = newXError; ptDraft.yError = newYError;
      }
    });
    modal.remove();
    showToast('Point updated', 'success');
  }
}

function getAxisColumnLabels(axisType: string): [string, string] {
  if (axisType === 'polar' || axisType === 'log-polar') return ['r', 'θ°'];
  if (axisType === 'ternary')    return ['A%', 'B%'];
  if (axisType === 'date-x')    return ['Date', 'Y'];
  if (axisType === 'bar-chart') return ['Category', 'Value'];
  if (axisType === 'circular')  return ['Time', 'Value'];
  return ['X', 'Y'];
}

function formatCellX(pt: import('../state/types').DataPoint, axisType: string): string {
  if (axisType === 'bar-chart') return pt.label ?? '—';
  if (axisType === 'date-x') {
    const d = new Date(pt.dataX);
    return isNaN(d.getTime()) ? String(pt.dataX) : d.toLocaleString();
  }
  return pt.dataX.toPrecision(6);
}
