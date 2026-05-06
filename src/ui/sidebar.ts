import { getState, setState, subscribe } from '../state/store';
import {
  addDataset, removeDataset, setActiveDataset, toggleDatasetVisibility,
  renameDataset, setDatasetColor, duplicateDataset, sortDatasetPoints, clearDatasetPoints,
} from '../modules/datasets';
import { handleCalibValueConfirm, resetCalibration, getWizardPrompt, startCalibration } from '../modules/calibration';
import { updatePointData, deletePoint as deleteDataPoint } from '../modules/digitizer';
import { exportCSV, exportExcel, exportClipboard } from '../modules/export';
import { goToPage } from '../modules/image-loader';
import {
  getAutoTraceSettings, setAutoTraceSettings, runAutoTrace,
  commitAutoTrace, clearPreview, setPreviewData,
} from '../modules/auto-trace';
import { getMeasureMode, setMeasureMode, reset as resetMeasure, getMeasureResult, getMeasurePoints } from '../modules/measure';
import type { CalibPointRole } from '../state/types';

const STEP_TO_ROLE: Partial<Record<string, CalibPointRole>> = {
  'await-x1-value': 'x1', 'await-x2-value': 'x2',
  'await-y1-value': 'y1', 'await-y2-value': 'y2',
};

export function initSidebar(container: HTMLElement): void {
  function render() {
    const state = getState();
    container.innerHTML = '';

    // === Calibration Section ===
    const calibSection = section('CALIBRATION');
    const calibBody = div('p-3 flex flex-col gap-2');

    // Status badge
    const badge = document.createElement('div');
    badge.className = 'flex items-center justify-between';
    if (state.calibration.isComplete) {
      badge.innerHTML = `<span class="badge badge-success">● Calibrated</span>`;
    } else if (state.calibration.step !== 'idle') {
      badge.innerHTML = `<span class="badge badge-warning">● Calibrating…</span>`;
    } else {
      badge.innerHTML = `<span class="badge badge-error">● Not calibrated</span>`;
    }

    if (state.calibration.isComplete) {
      const resetBtn = smallBtn('Reset');
      resetBtn.addEventListener('click', resetCalibration);
      badge.appendChild(resetBtn);
    }
    calibBody.appendChild(badge);

    // Axis type selector (shown when idle or not complete)
    if (!state.calibration.isComplete) {
      const axisRow = div('flex flex-col gap-1');
      const axisLbl = document.createElement('label');
      axisLbl.style.cssText = 'font-size:11px;color:#71717a';
      axisLbl.textContent = 'Axis type:';
      const axisSel = document.createElement('select');
      axisSel.className = 'pv-input';
      const axisOptions: { value: string; label: string }[] = [
        { value: 'xy-linear', label: 'XY Linear' },
        { value: 'xy-log-x', label: 'Semi-log (log X)' },
        { value: 'xy-log-y', label: 'Semi-log (log Y)' },
        { value: 'xy-log-xy', label: 'Log-log (both)' },
        { value: 'polar', label: 'Polar (R-θ)' },
        { value: 'ternary', label: 'Ternary' },
        { value: 'date-x', label: 'Date/Time X' },
        { value: 'map', label: 'Map / Image (px only)' },
      ];
      axisOptions.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value; o.textContent = opt.label;
        if (state.calibration.axisType === opt.value) o.selected = true;
        axisSel.appendChild(o);
      });
      axisSel.addEventListener('change', () => {
        setState(draft => { draft.calibration.axisType = axisSel.value as any; });
      });
      axisRow.appendChild(axisLbl);
      axisRow.appendChild(axisSel);
      calibBody.appendChild(axisRow);
    }

    if (state.calibration.step === 'idle' && !state.calibration.isComplete) {
      const startBtn = primaryBtn('Calibrate Axis');
      startBtn.addEventListener('click', startCalibration);
      calibBody.appendChild(startBtn);
    }

    // Wizard UI
    if (state.calibration.step !== 'idle' && state.calibration.step !== 'complete') {
      const prompt = document.createElement('p');
      prompt.style.cssText = 'font-size:12px;color:#e5e5e5;line-height:1.4;margin:0';
      prompt.textContent = getWizardPrompt();
      calibBody.appendChild(prompt);

      const role = STEP_TO_ROLE[state.calibration.step];
      if (role) {
        const isX = role === 'x1' || role === 'x2';
        const labelEl = document.createElement('label');
        labelEl.style.cssText = 'font-size:11px;color:#71717a';
        labelEl.textContent = `${role.toUpperCase()} value (${isX ? 'X' : 'Y'} axis):`;
        const inp = document.createElement('input');
        inp.className = 'pv-input';
        inp.type = 'number';
        inp.placeholder = 'e.g. 0';
        inp.autofocus = true;
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            handleCalibValueConfirm(role, inp.value);
          }
        });
        const confirmBtn = primaryBtn('Confirm →');
        confirmBtn.addEventListener('click', () => handleCalibValueConfirm(role, inp.value));
        calibBody.appendChild(labelEl);
        calibBody.appendChild(inp);
        calibBody.appendChild(confirmBtn);
        setTimeout(() => inp.focus(), 50);
      }
    }

    // Grid overlay toggle
    if (state.calibration.isComplete) {
      const gridRow = div('flex items-center gap-2 mt-1');
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = state.calibration.showGrid;
      chk.style.accentColor = '#22d3ee';
      chk.addEventListener('change', () => {
        setState(draft => { draft.calibration.showGrid = chk.checked; });
      });
      const lbl = document.createElement('label');
      lbl.style.cssText = 'font-size:12px;color:#71717a;cursor:pointer';
      lbl.textContent = 'Show grid overlay';
      lbl.addEventListener('click', () => { chk.checked = !chk.checked; chk.dispatchEvent(new Event('change')); });
      gridRow.appendChild(chk);
      gridRow.appendChild(lbl);
      calibBody.appendChild(gridRow);
    }

    calibSection.appendChild(calibBody);
    container.appendChild(calibSection);

    // === PDF page navigation ===
    if (state.image.totalPages > 1) {
      const pdfSection = section('PDF PAGES');
      const pdfBody = div('p-3 flex items-center gap-2');
      const prevBtn = smallBtn('◀');
      prevBtn.disabled = state.image.currentPage <= 1;
      prevBtn.addEventListener('click', () => goToPage(state.image.currentPage - 1));
      const pageInfo = document.createElement('span');
      pageInfo.style.cssText = 'font-size:12px;color:#71717a;flex:1;text-align:center';
      pageInfo.textContent = `Page ${state.image.currentPage} / ${state.image.totalPages}`;
      const nextBtn = smallBtn('▶');
      nextBtn.disabled = state.image.currentPage >= state.image.totalPages;
      nextBtn.addEventListener('click', () => goToPage(state.image.currentPage + 1));
      pdfBody.appendChild(prevBtn);
      pdfBody.appendChild(pageInfo);
      pdfBody.appendChild(nextBtn);
      pdfSection.appendChild(pdfBody);
      container.appendChild(pdfSection);
    }

    // === Datasets Section ===
    const dsSection = section('DATASETS');
    const dsBody = div('flex flex-col');

    for (const ds of state.datasets) {
      const row = document.createElement('div');
      row.className = 'dataset-row' + (ds.id === state.activeDatasetId ? ' active' : '');

      // Color swatch (also color picker)
      const swatch = document.createElement('input');
      swatch.type = 'color';
      swatch.value = ds.color;
      swatch.style.cssText = `width:16px;height:16px;border:none;background:none;cursor:pointer;padding:0;border-radius:3px;flex-shrink:0`;
      swatch.addEventListener('change', () => setDatasetColor(ds.id, swatch.value));
      swatch.addEventListener('click', e => e.stopPropagation());
      row.appendChild(swatch);

      // Name
      const nameEl = document.createElement('span');
      nameEl.style.cssText = 'flex:1;font-size:13px;color:#e5e5e5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      nameEl.textContent = ds.name;
      nameEl.contentEditable = 'true';
      nameEl.addEventListener('click', e => e.stopPropagation());
      nameEl.addEventListener('blur', () => renameDataset(ds.id, nameEl.textContent ?? ''));
      nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });
      row.appendChild(nameEl);

      // Point count badge
      const cnt = document.createElement('span');
      cnt.style.cssText = 'font-size:10px;color:#71717a;flex-shrink:0';
      cnt.textContent = `${ds.points.length}`;
      row.appendChild(cnt);

      // Eye toggle
      const eyeBtn = document.createElement('button');
      eyeBtn.className = 'icon-btn';
      eyeBtn.textContent = ds.visible ? '👁' : '🚫';
      eyeBtn.title = ds.visible ? 'Hide' : 'Show';
      eyeBtn.addEventListener('click', e => { e.stopPropagation(); toggleDatasetVisibility(ds.id); });
      row.appendChild(eyeBtn);

      // Duplicate
      const dupBtn = document.createElement('button');
      dupBtn.className = 'icon-btn';
      dupBtn.textContent = '⎘';
      dupBtn.title = 'Duplicate';
      dupBtn.addEventListener('click', e => { e.stopPropagation(); duplicateDataset(ds.id); });
      row.appendChild(dupBtn);

      // Delete
      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.style.color = '#f87171';
      delBtn.textContent = '×';
      delBtn.title = 'Delete dataset';
      delBtn.addEventListener('click', e => { e.stopPropagation(); removeDataset(ds.id); });
      row.appendChild(delBtn);

      row.addEventListener('click', () => setActiveDataset(ds.id));
      dsBody.appendChild(row);
    }

    // Add dataset button
    const addBtn = document.createElement('button');
    addBtn.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 12px;font-size:12px;color:#22d3ee;background:none;border:none;cursor:pointer;width:100%;text-align:left';
    addBtn.textContent = '+ New Dataset';
    addBtn.addEventListener('click', () => addDataset());
    dsBody.appendChild(addBtn);

    dsSection.appendChild(dsBody);
    container.appendChild(dsSection);

    // === Point Table Section ===
    const activeDs = state.datasets.find(d => d.id === state.activeDatasetId);
    if (activeDs) {
      const ptSection = section(`POINTS (${activeDs.name})`);
      const ptBody = div('flex flex-col');

      // Sort controls
      const sortRow = div('flex items-center gap-2 px-3 py-2 border-b border-border');
      const sortXBtn = smallBtn('Sort X');
      sortXBtn.addEventListener('click', () => sortDatasetPoints(activeDs.id, 'x'));
      const sortYBtn = smallBtn('Sort Y');
      sortYBtn.addEventListener('click', () => sortDatasetPoints(activeDs.id, 'y'));
      const clearBtn = smallBtn('Clear all');
      clearBtn.style.color = '#f87171';
      clearBtn.addEventListener('click', () => clearDatasetPoints(activeDs.id));
      sortRow.appendChild(sortXBtn);
      sortRow.appendChild(sortYBtn);
      const spacer = document.createElement('div');
      spacer.className = 'flex-1';
      sortRow.appendChild(spacer);
      sortRow.appendChild(clearBtn);
      ptBody.appendChild(sortRow);

      // Table
      const tableWrap = div('overflow-y-auto');
      tableWrap.style.maxHeight = '200px';
      const table = document.createElement('table');
      table.className = 'point-table';
      table.innerHTML = `<thead><tr><th style="width:28px">#</th><th>X</th><th>Y</th><th style="width:24px"></th></tr></thead>`;
      const tbody = document.createElement('tbody');

      const displayPoints = activeDs.points.slice(0, 500);
      displayPoints.forEach((pt, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="color:#71717a">${i + 1}</td>
          <td contenteditable="true" data-field="x" data-id="${pt.id}">${pt.dataX.toPrecision(6)}</td>
          <td contenteditable="true" data-field="y" data-id="${pt.id}">${pt.dataY.toPrecision(6)}</td>
          <td>
            <button class="icon-btn" style="color:#f87171;width:20px;height:20px" data-delete="${pt.id}">×</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      if (activeDs.points.length > 500) {
        const info = document.createElement('tr');
        info.innerHTML = `<td colspan="4" style="text-align:center;color:#71717a;padding:4px;font-size:11px">Showing 500 of ${activeDs.points.length} points</td>`;
        tbody.appendChild(info);
      }

      table.appendChild(tbody);
      tableWrap.appendChild(table);
      ptBody.appendChild(tableWrap);

      // Table event delegation
      tbody.addEventListener('blur', async (e) => {
        const el = e.target as HTMLElement;
        if (el.contentEditable !== 'true') return;
        const id = el.dataset.id;
        const field = el.dataset.field;
        const val = parseFloat(el.textContent ?? '');
        if (!id || !field || isNaN(val)) return;
        const pt = activeDs.points.find(p => p.id === id);
        if (!pt) return;
        const dataX = field === 'x' ? val : pt.dataX;
        const dataY = field === 'y' ? val : pt.dataY;
        updatePointData(activeDs.id, id, dataX, dataY);
      }, true);

      tbody.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('[data-delete]') as HTMLElement | null;
        if (btn?.dataset.delete) {
          deleteDataPoint(activeDs.id, btn.dataset.delete);
        }
      });

      ptSection.appendChild(ptBody);
      container.appendChild(ptSection);
    }

    // === Measure Section ===
    if (state.activeTool === 'measure') {
      const mSection = section('MEASURE');
      const mBody = div('p-3 flex flex-col gap-3');

      // Mode selector
      const modeRow = div('flex gap-2');
      for (const mode of ['distance', 'angle', 'area'] as const) {
        const btn = document.createElement('button');
        const isActive = getMeasureMode() === mode;
        btn.style.cssText = `flex:1;padding:4px;font-size:11px;border-radius:4px;border:1px solid ${isActive ? '#22d3ee' : '#2a2a2a'};background:${isActive ? 'color-mix(in srgb,#22d3ee 12%,transparent)' : '#0d0d0d'};color:${isActive ? '#22d3ee' : '#71717a'};cursor:pointer;`;
        btn.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
        btn.addEventListener('click', () => setMeasureMode(mode));
        modeRow.appendChild(btn);
      }
      mBody.appendChild(modeRow);

      // Instructions
      const instrMap = { distance: 'Click 2 points', angle: 'Click 3 points (vertex in middle)', area: 'Click N points to define polygon' };
      const instr = document.createElement('p');
      instr.style.cssText = 'font-size:11px;color:#71717a;margin:0';
      instr.textContent = instrMap[getMeasureMode()];
      mBody.appendChild(instr);

      // Result
      const result = getMeasureResult();
      if (result) {
        const resultEl = document.createElement('div');
        resultEl.style.cssText = 'font-family:Geist Mono,monospace;font-size:13px;color:#f59e0b;padding:8px;background:#0d0d0d;border:1px solid #2a2a2a;border-radius:4px';
        resultEl.textContent = result;
        mBody.appendChild(resultEl);
      }

      // Point count
      const ptCount = getMeasurePoints().length;
      if (ptCount > 0) {
        const cntEl = document.createElement('p');
        cntEl.style.cssText = 'font-size:11px;color:#71717a;margin:0';
        cntEl.textContent = `${ptCount} point${ptCount !== 1 ? 's' : ''} placed — click to add more`;
        mBody.appendChild(cntEl);
      }

      const resetBtn = smallBtn('Reset Measurement');
      resetBtn.addEventListener('click', resetMeasure);
      mBody.appendChild(resetBtn);

      mSection.appendChild(mBody);
      container.appendChild(mSection);
    }

    // === Auto-Trace Section ===
    if (state.activeTool === 'auto-trace' && state.image.width > 0) {
      const atSection = section('AUTO-TRACE');
      const atBody = div('p-3 flex flex-col gap-3');
      const ats = getAutoTraceSettings();

      // Color picker row
      const colorRow = div('flex flex-col gap-1');
      const colorLbl = document.createElement('label');
      colorLbl.style.cssText = 'font-size:11px;color:#71717a';
      colorLbl.textContent = 'Target color (click on chart line):';
      const colorInner = div('flex items-center gap-2');
      const colorPicker = document.createElement('input');
      colorPicker.type = 'color';
      colorPicker.value = ats.targetColor;
      colorPicker.style.cssText = 'width:32px;height:28px;border:1px solid #2a2a2a;border-radius:4px;background:#0d0d0d;cursor:pointer;padding:2px';
      colorPicker.addEventListener('input', () => setAutoTraceSettings({ targetColor: colorPicker.value }));
      const pickHint = document.createElement('span');
      pickHint.style.cssText = 'font-size:11px;color:#71717a;font-style:italic';
      pickHint.textContent = 'or click canvas while in trace mode';
      colorInner.appendChild(colorPicker);
      colorInner.appendChild(pickHint);
      colorRow.appendChild(colorLbl);
      colorRow.appendChild(colorInner);
      atBody.appendChild(colorRow);

      // Tolerance slider
      atBody.appendChild(filterSlider('Tolerance', null, ats.tolerance, 0, 100, (v) => setAutoTraceSettings({ tolerance: v })));

      // Smoothing select
      const smoothRow = div('flex flex-col gap-1');
      const smoothLbl = document.createElement('label');
      smoothLbl.style.cssText = 'font-size:11px;color:#71717a';
      smoothLbl.textContent = 'Smoothing:';
      const smoothSel = document.createElement('select');
      smoothSel.className = 'pv-input';
      smoothSel.style.cssText += 'cursor:pointer';
      ['none', 'light', 'heavy'].forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
        if (ats.smoothing === opt) o.selected = true;
        smoothSel.appendChild(o);
      });
      smoothSel.addEventListener('change', () => setAutoTraceSettings({ smoothing: smoothSel.value as any }));
      smoothRow.appendChild(smoothLbl);
      smoothRow.appendChild(smoothSel);
      atBody.appendChild(smoothRow);

      // Sampling interval
      const intervalRow = div('flex flex-col gap-1');
      const intervalLbl = document.createElement('label');
      intervalLbl.style.cssText = 'font-size:11px;color:#71717a';
      intervalLbl.textContent = `Sample every ${ats.samplingInterval}px:`;
      const intervalSlider = document.createElement('input');
      intervalSlider.type = 'range';
      intervalSlider.min = '1'; intervalSlider.max = '20'; intervalSlider.value = String(ats.samplingInterval);
      intervalSlider.style.cssText = 'width:100%;accent-color:#22d3ee;cursor:pointer';
      intervalSlider.addEventListener('input', () => {
        intervalLbl.textContent = `Sample every ${intervalSlider.value}px:`;
        setAutoTraceSettings({ samplingInterval: Number(intervalSlider.value) });
      });
      intervalRow.appendChild(intervalLbl);
      intervalRow.appendChild(intervalSlider);
      atBody.appendChild(intervalRow);

      // Action buttons
      let lastTraceResult: ReturnType<typeof runAutoTrace> = null;

      const previewBtn = primaryBtn('Preview Trace');
      previewBtn.addEventListener('click', () => {
        const settings = getAutoTraceSettings();
        const result = runAutoTrace(settings);
        if (result) {
          lastTraceResult = result;
          setPreviewData(result.previewData, result.width, result.height);
          // Register with canvas engine via global (avoid circular)
          (window as any).__autoTraceMod = { getPreviewData: () => ({ data: result.previewData, width: result.width, height: result.height }) };
          import('../modules/canvas-engine').then(m => m.render());
          const commitBtn = document.getElementById('at-commit-btn') as HTMLButtonElement | null;
          if (commitBtn) {
            commitBtn.style.display = 'flex';
            commitBtn.textContent = `Commit ${result.points.length} Points →`;
          }
        }
      });
      atBody.appendChild(previewBtn);

      const commitBtn = primaryBtn('Commit Points →');
      commitBtn.id = 'at-commit-btn';
      commitBtn.style.display = 'none';
      commitBtn.style.background = 'color-mix(in srgb,#34d399 15%,transparent)';
      commitBtn.style.color = '#34d399';
      commitBtn.style.borderColor = '#34d39933';
      commitBtn.addEventListener('click', () => {
        if (lastTraceResult) {
          commitAutoTrace(lastTraceResult.points);
          lastTraceResult = null;
          (window as any).__autoTraceMod = null;
          commitBtn.style.display = 'none';
        }
      });
      atBody.appendChild(commitBtn);

      const clearBtn = smallBtn('Clear Preview');
      clearBtn.addEventListener('click', () => {
        clearPreview();
        (window as any).__autoTraceMod = null;
        lastTraceResult = null;
        const cb = document.getElementById('at-commit-btn') as HTMLButtonElement | null;
        if (cb) cb.style.display = 'none';
      });
      atBody.appendChild(clearBtn);

      atSection.appendChild(atBody);
      container.appendChild(atSection);
    }

    // === Image Filters ===
    if (state.image.width > 0) {
      const filterSection = section('IMAGE FILTERS');
      const filterBody = div('p-3 flex flex-col gap-2');
      filterBody.appendChild(filterSlider('Brightness', 'brightness', state.canvas.imageFilters.brightness, 0, 200, null!));
      filterBody.appendChild(filterSlider('Contrast', 'contrast', state.canvas.imageFilters.contrast, 0, 200, null!));
      filterBody.appendChild(filterCheck('Invert', 'invert', state.canvas.imageFilters.invert));
      filterBody.appendChild(filterCheck('Grayscale', 'grayscale', state.canvas.imageFilters.grayscale));
      filterSection.appendChild(filterBody);
      container.appendChild(filterSection);
    }

    // === Export Section ===
    const exportSection = section('EXPORT');
    const exportBody = div('p-3 flex flex-col gap-2');
    const csvBtn = primaryBtn('Export CSV (all)');
    csvBtn.addEventListener('click', () => exportCSV());
    exportBody.appendChild(csvBtn);
    if (activeDs) {
      const csvActiveBtn = smallBtn(`Export "${activeDs.name}" CSV`);
      csvActiveBtn.style.cssText += 'width:100%;justify-content:center';
      csvActiveBtn.addEventListener('click', () => exportCSV(activeDs.id));
      exportBody.appendChild(csvActiveBtn);
    }
    const xlsxBtn = primaryBtn('Export Excel (.xlsx)');
    xlsxBtn.addEventListener('click', () => exportExcel());
    exportBody.appendChild(xlsxBtn);
    const clipBtn = primaryBtn('Copy to Clipboard');
    clipBtn.addEventListener('click', () => exportClipboard());
    exportBody.appendChild(clipBtn);
    exportSection.appendChild(exportBody);
    container.appendChild(exportSection);
  }

  render();
  subscribe(render);
}

// === Helpers ===

function section(title: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'sidebar-section';
  const header = document.createElement('div');
  header.className = 'sidebar-section-header';
  header.textContent = title;
  el.appendChild(header);
  return el;
}

function div(classes: string): HTMLElement {
  const el = document.createElement('div');
  el.className = classes;
  return el;
}

function primaryBtn(text: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.style.cssText = `
    display:flex;align-items:center;justify-content:center;
    padding:6px 12px;font-size:12px;font-family:Geist,system-ui;
    background:color-mix(in srgb,#22d3ee 12%,transparent);
    color:#22d3ee;border:1px solid #22d3ee33;border-radius:4px;
    cursor:pointer;width:100%;transition:background 0.15s;
  `;
  btn.textContent = text;
  btn.addEventListener('mouseenter', () => btn.style.background = 'color-mix(in srgb,#22d3ee 20%,transparent)');
  btn.addEventListener('mouseleave', () => btn.style.background = 'color-mix(in srgb,#22d3ee 12%,transparent)');
  return btn;
}

function smallBtn(text: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.style.cssText = `
    display:flex;align-items:center;justify-content:center;
    padding:3px 8px;font-size:11px;font-family:Geist,system-ui;
    background:#0d0d0d;color:#71717a;border:1px solid #2a2a2a;
    border-radius:4px;cursor:pointer;transition:color 0.15s;
  `;
  btn.textContent = text;
  btn.addEventListener('mouseenter', () => btn.style.color = '#e5e5e5');
  btn.addEventListener('mouseleave', () => btn.style.color = '#71717a');
  return btn;
}

function filterSlider(
  label: string,
  field: 'brightness' | 'contrast' | null,
  value: number, min: number, max: number,
  onChangeCb?: (v: number) => void
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px';
  const labelRow = document.createElement('div');
  labelRow.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:#71717a';
  const lbl = document.createElement('span');
  lbl.textContent = label;
  const valEl = document.createElement('span');
  valEl.textContent = `${value}`;
  labelRow.appendChild(lbl);
  labelRow.appendChild(valEl);
  wrap.appendChild(labelRow);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min); slider.max = String(max); slider.value = String(value);
  slider.style.cssText = 'width:100%;accent-color:#22d3ee;cursor:pointer';
  slider.addEventListener('input', () => {
    valEl.textContent = `${slider.value}`;
    if (onChangeCb) {
      onChangeCb(Number(slider.value));
    } else if (field) {
      setState(draft => { (draft.canvas.imageFilters as any)[field] = Number(slider.value); });
    }
  });
  wrap.appendChild(slider);
  return wrap;
}

function filterCheck(label: string, field: 'invert' | 'grayscale', value: boolean): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer';
  const chk = document.createElement('input');
  chk.type = 'checkbox'; chk.checked = value;
  chk.style.accentColor = '#22d3ee';
  chk.addEventListener('change', () => {
    setState(draft => { (draft.canvas.imageFilters as any)[field] = chk.checked; });
  });
  const lbl = document.createElement('span');
  lbl.style.cssText = 'font-size:12px;color:#71717a';
  lbl.textContent = label;
  lbl.addEventListener('click', () => { chk.checked = !chk.checked; chk.dispatchEvent(new Event('change')); });
  wrap.appendChild(chk);
  wrap.appendChild(lbl);
  return wrap;
}
