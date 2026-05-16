/**
 * Step 2 — "Set the Scale"
 * Replaces the old Calibrate tab. Contains axis calibration wizard,
 * scale bar setup, and perspective correction.
 */

import { getState, setState } from '../state/store';
import {
  handleCalibValueConfirm, resetCalibration, getWizardPrompt, startCalibration,
  handlePolarRConfirm, handleBarChartValueConfirm,
  handleCircularR1Confirm, handleCircularR2Confirm,
  handleCircularT1Confirm, handleCircularT2Confirm,
  stepBackCalibration,
} from '../modules/calibration';
import {
  startScaleBar, resetScaleBar, commitScaleBar, getScaleBarStep,
  isScaleBarSet, getScaleBarUnit, getPixelsPerUnit,
} from '../modules/scale-bar';
import {
  startPerspective, resetPerspective, undoLastCorner,
  getPerspectiveStep, getPerspectiveCorners,
} from '../modules/perspective';
import { Icons } from './icons';
import {
  makeSec, makeDiv, makeRow, makeBtn,
  makeCheckbox, makeHint,
} from './ui-helpers';
import type { CalibPointRole } from '../state/types';

const STEP_TO_ROLE: Partial<Record<string, CalibPointRole>> = {
  'await-x1-value': 'x1', 'await-x2-value': 'x2',
  'await-y1-value': 'y1', 'await-y2-value': 'y2',
};

// Chart type cards definition
const CHART_TYPES: { value: string; icon: string; label: string }[] = [
  { value: 'xy-linear',  icon: Icons.xyAxis,    label: 'Regular XY' },
  { value: 'xy-log-x',   icon: Icons.logScale,  label: 'Log X axis' },
  { value: 'xy-log-y',   icon: Icons.logScale,  label: 'Log Y axis' },
  { value: 'xy-log-xy',  icon: Icons.logScale,  label: 'Log-log' },
  { value: 'polar',      icon: Icons.polar,     label: 'Polar' },
  { value: 'log-polar',  icon: Icons.polar,     label: 'Log-Polar' },
  { value: 'ternary',    icon: Icons.triangle,  label: 'Ternary △' },
  { value: 'bar-chart',  icon: Icons.chartBar,  label: 'Bar Chart' },
  { value: 'date-x',     icon: Icons.calendar,  label: 'Time axis' },
  { value: 'map',        icon: Icons.map,       label: 'Map / Pixels' },
  { value: 'circular',   icon: Icons.clock,     label: 'Circular' },
];

export function renderStepScale(container: HTMLElement): void {
  const state = getState();
  const cal = state.calibration;

  // Left column: chart type picker + calibration status
  const leftCol = makeDiv('dock-col dock-col-narrow dock-col-border');

  const statusSection = makeSec('Scale Setup');

  if (cal.isComplete) {
    const row = makeRow('between');
    const dot = makeDiv(''); dot.className = 'status-dot ok'; dot.textContent = 'Scale set';
    const resetBtn = makeBtn('Reset', 'btn btn-ghost btn-sm');
    resetBtn.addEventListener('click', resetCalibration);
    row.appendChild(dot); row.appendChild(resetBtn);
    statusSection.appendChild(row);
    leftCol.appendChild(statusSection);

    if (cal.showGrid !== undefined) {
      const displaySec = makeSec('Display');
      displaySec.appendChild(makeCheckbox('Show calibration grid', cal.showGrid, e => {
        setState(d => { d.calibration.showGrid = (e.target as HTMLInputElement).checked; });
      }));
      leftCol.appendChild(displaySec);
    }
  } else if (cal.step !== 'idle') {
    const dot = makeDiv(''); dot.className = 'status-dot busy'; dot.textContent = 'Calibrating…';
    statusSection.appendChild(dot);
    leftCol.appendChild(statusSection);
  } else {
    // Chart type picker
    const dot = makeDiv(''); dot.className = 'status-dot err'; dot.textContent = 'Not set yet';
    statusSection.appendChild(dot);
    leftCol.appendChild(statusSection);

    const typeSec = makeSec('What kind of chart is this?');
    const grid = makeDiv('card-grid');

    CHART_TYPES.forEach(({ value, icon, label }) => {
      const card = makeDiv('card-pick');
      if (cal.axisType === value) card.classList.add('active');
      card.innerHTML = `${icon}<span>${label}</span>`;
      card.addEventListener('click', () => {
        setState(d => { d.calibration.axisType = value as typeof d.calibration.axisType; });
      });
      grid.appendChild(card);
    });
    typeSec.appendChild(grid);
    leftCol.appendChild(typeSec);

    const startBtn = makeBtn('Start Setting Scale →', 'btn btn-primary');
    startBtn.addEventListener('click', startCalibration);
    leftCol.appendChild(startBtn);
  }

  container.appendChild(leftCol);

  // Center column: wizard steps
  const centerCol = makeDiv('dock-col dock-col-flex dock-col-border');

  if (cal.step !== 'idle' && cal.step !== 'complete') {
    renderCalibWizard(centerCol, cal);
  } else if (cal.isComplete) {
    const doneSec = makeSec('Scale set successfully');
    const msg = makeHint('Your axes are calibrated. You can now go to "Get Data" to start extracting values from the chart.');
    doneSec.appendChild(msg);
    centerCol.appendChild(doneSec);
  } else {
    const hintSec = makeSec('How it works');
    hintSec.appendChild(makeHint('Select the chart type on the left, then click "Start Setting Scale". You\'ll click 4 known points on the axes and enter their values — PlotVision uses those to convert pixel positions into real data coordinates.'));
    centerCol.appendChild(hintSec);
  }

  container.appendChild(centerCol);

  // Right column: scale bar + perspective
  const rightCol = makeDiv('dock-col dock-col-narrow');
  renderScaleBarSection(rightCol);
  renderPerspectiveSection(rightCol);
  container.appendChild(rightCol);
}

function renderCalibWizard(el: HTMLElement, cal: ReturnType<typeof getState>['calibration']): void {
  const wizSec = makeSec('Mark the axes');

  // Back button — always present in wizard
  const navRow = makeRow('start');
  navRow.style.cssText = 'gap:6px;margin-bottom:4px;';
  const backBtn = makeBtn('← Back', 'btn btn-ghost btn-sm');
  backBtn.style.width = 'auto';
  backBtn.title = 'Go back one step';
  backBtn.addEventListener('click', stepBackCalibration);
  const cancelBtn = makeBtn('Cancel', 'btn btn-ghost btn-sm');
  cancelBtn.style.width = 'auto';
  cancelBtn.addEventListener('click', resetCalibration);
  navRow.appendChild(backBtn); navRow.appendChild(cancelBtn);
  wizSec.appendChild(navRow);

  if (cal.axisType === 'polar' || cal.axisType === 'log-polar') {
    const steps = ['polar-place-center', 'polar-place-ref', 'polar-await-r'];
    const idx = steps.indexOf(cal.step);
    wizSec.appendChild(makePips(steps.length, idx));
    const lbl = makeDiv('calib-step-label'); lbl.textContent = `Step ${idx + 1} of 3`; wizSec.appendChild(lbl);
    const hint = makeDiv('calib-hint'); hint.textContent = getWizardPrompt(); wizSec.appendChild(hint);
    if (cal.step === 'polar-await-r') {
      const inp = mkNumInput('Radius value at reference point');
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') handlePolarRConfirm(parseFloat(inp.value)); });
      wizSec.appendChild(inp);
      const btn = makeBtn('Confirm →', 'btn btn-primary');
      btn.addEventListener('click', () => handlePolarRConfirm(parseFloat(inp.value)));
      wizSec.appendChild(btn);
      setTimeout(() => inp.focus(), 50);
    }

  } else if (cal.axisType === 'bar-chart') {
    const steps = ['bar-place-y1', 'bar-await-y1-value', 'bar-place-y2', 'bar-await-y2-value'];
    const idx = steps.indexOf(cal.step);
    wizSec.appendChild(makePips(steps.length, idx));
    const lbl = makeDiv('calib-step-label'); lbl.textContent = `Step ${idx + 1} of 4`; wizSec.appendChild(lbl);
    const hint = makeDiv('calib-hint'); hint.textContent = getWizardPrompt() || (idx < 2 ? 'Click a known Y value on the axis' : 'Click a second known Y value'); wizSec.appendChild(hint);
    const which = cal.step === 'bar-await-y1-value' ? 'y1' : cal.step === 'bar-await-y2-value' ? 'y2' : null;
    if (which) {
      const inp = mkNumInput('Enter Y value');
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') handleBarChartValueConfirm(which as 'y1'|'y2', inp.value); });
      wizSec.appendChild(inp);
      const btn = makeBtn('Confirm →', 'btn btn-primary');
      btn.addEventListener('click', () => handleBarChartValueConfirm(which as 'y1'|'y2', inp.value));
      wizSec.appendChild(btn);
      setTimeout(() => inp.focus(), 50);
    }

  } else if (cal.axisType === 'circular') {
    const circSteps = [
      'circ-place-center', 'circ-place-r1', 'circ-await-r1',
      'circ-place-r2', 'circ-await-r2',
      'circ-place-t1', 'circ-await-t1', 'circ-place-t2', 'circ-await-t2',
    ];
    const stepHints: Record<string, string> = {
      'circ-place-center': 'Click the center of the circular chart',
      'circ-place-r1':     'Click a point on the inner ring',
      'circ-await-r1':     'Enter the value at the inner ring',
      'circ-place-r2':     'Click a point on the outer ring',
      'circ-await-r2':     'Enter the value at the outer ring',
      'circ-place-t1':     'Click a time reference point (e.g. 12 o\'clock)',
      'circ-await-t1':     'Enter the time value at that point',
      'circ-place-t2':     'Click a second time reference point',
      'circ-await-t2':     'Enter the time value at the 2nd point',
    };
    const idx = circSteps.indexOf(cal.step);
    wizSec.appendChild(makePips(circSteps.length, idx));
    const lbl = makeDiv('calib-step-label'); lbl.textContent = `Step ${idx + 1} of 9`; wizSec.appendChild(lbl);
    const hint = makeDiv('calib-hint'); hint.textContent = stepHints[cal.step] ?? ''; wizSec.appendChild(hint);

    const mkNumInput2 = (ph: string) => { const i = mkNumInput(ph); return i; };
    const mkConfirm = (cb: () => void) => {
      const btn = makeBtn('Confirm →', 'btn btn-primary'); btn.addEventListener('click', cb); return btn;
    };

    if (cal.step === 'circ-await-r1') {
      const inp = mkNumInput2('Value at inner ring'); wizSec.appendChild(inp);
      wizSec.appendChild(mkConfirm(() => handleCircularR1Confirm(parseFloat(inp.value))));
      setTimeout(() => inp.focus(), 50);
    } else if (cal.step === 'circ-await-r2') {
      const inp = mkNumInput2('Value at outer ring'); wizSec.appendChild(inp);
      wizSec.appendChild(mkConfirm(() => handleCircularR2Confirm(parseFloat(inp.value))));
      setTimeout(() => inp.focus(), 50);
    } else if (cal.step === 'circ-await-t1') {
      const inp = mkNumInput2('Time value at this point'); wizSec.appendChild(inp);
      wizSec.appendChild(mkConfirm(() => handleCircularT1Confirm(parseFloat(inp.value))));
      setTimeout(() => inp.focus(), 50);
    } else if (cal.step === 'circ-await-t2') {
      const inp = mkNumInput2('Time value at 2nd point'); wizSec.appendChild(inp);
      const cwCheck = makeCheckbox('Clockwise rotation', false);
      wizSec.appendChild(cwCheck);
      const btn = mkConfirm(() => {
        const cw = (cwCheck.querySelector('input') as HTMLInputElement)?.checked ?? false;
        handleCircularT2Confirm(parseFloat(inp.value), cw);
      });
      wizSec.appendChild(btn);
      setTimeout(() => inp.focus(), 50);
    }

  } else if (cal.axisType === 'ternary') {
    const steps = ['ternary-place-a', 'ternary-place-b', 'ternary-place-c'];
    const idx = steps.indexOf(cal.step);
    wizSec.appendChild(makePips(steps.length, idx));
    const lbl = makeDiv('calib-step-label'); lbl.textContent = `Step ${idx + 1} of 3`; wizSec.appendChild(lbl);
    const hint = makeDiv('calib-hint'); hint.textContent = getWizardPrompt(); wizSec.appendChild(hint);

  } else {
    // Standard XY wizard
    const stepOrder = [
      'place-x1','await-x1-value','place-x2','await-x2-value',
      'place-y1','await-y1-value','place-y2','await-y2-value',
    ];
    const idx = stepOrder.indexOf(cal.step);
    wizSec.appendChild(makePips(stepOrder.length, idx));
    const lbl = makeDiv('calib-step-label'); lbl.textContent = `Step ${Math.floor(idx / 2) + 1} of 4`; wizSec.appendChild(lbl);
    const hint = makeDiv('calib-hint'); hint.textContent = getWizardPrompt(); wizSec.appendChild(hint);

    const role = STEP_TO_ROLE[cal.step];
    if (role) {
      const isXRole = role === 'x1' || role === 'x2';
      const isDateX = cal.axisType === 'date-x' && isXRole;
      const inp = document.createElement('input');
      inp.className = 'pv-input';
      if (isDateX) { inp.type = 'datetime-local'; inp.step = '1'; }
      else { inp.type = 'number'; inp.placeholder = isXRole ? 'Enter X value' : 'Enter Y value'; }
      const getVal = () => isDateX ? String(new Date(inp.value).getTime()) : inp.value;
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') handleCalibValueConfirm(role, getVal()); });
      wizSec.appendChild(inp);
      const btn = makeBtn('Confirm →', 'btn btn-primary');
      btn.addEventListener('click', () => handleCalibValueConfirm(role, getVal()));
      wizSec.appendChild(btn);
      setTimeout(() => inp.focus(), 50);
    }
  }

  el.appendChild(wizSec);
}

function makePips(total: number, current: number): HTMLElement {
  const row = makeDiv('calib-progress');
  for (let i = 0; i < total; i++) {
    const pip = makeDiv('calib-pip');
    if (i < current) pip.classList.add('done');
    if (i === current) pip.classList.add('active');
    row.appendChild(pip);
  }
  return row;
}

function mkNumInput(placeholder: string): HTMLInputElement {
  const inp = document.createElement('input');
  inp.className = 'pv-input'; inp.type = 'number'; inp.placeholder = placeholder;
  return inp;
}

function renderScaleBarSection(el: HTMLElement): void {
  const step = getScaleBarStep();
  const isSet = isScaleBarSet();
  const sec = makeSec('Ruler / Scale Bar');

  if (isSet) {
    const unit = getScaleBarUnit();
    const ppu = getPixelsPerUnit();
    const info = makeDiv('');
    info.style.cssText = 'font-size:11px;color:var(--color-muted);font-family:var(--font-mono);';
    info.textContent = `1 ${unit} = ${ppu.toFixed(2)} px`;
    sec.appendChild(info);
    const row = makeRow('start');
    const resetBtn = makeBtn('Remove Scale', 'btn btn-ghost btn-sm');
    resetBtn.addEventListener('click', resetScaleBar);
    row.appendChild(resetBtn);
    sec.appendChild(row);
  } else if (step === 'idle') {
    sec.appendChild(makeHint('Draw a line over a scale bar to calibrate physical distances.'));
    const startBtn = makeBtn('Add Scale Ruler →', 'btn btn-ghost btn-sm');
    startBtn.addEventListener('click', startScaleBar);
    sec.appendChild(startBtn);
  } else if (step === 'place-p1') {
    sec.appendChild(makeHint('Click the left/start end of the scale bar'));
    const cancelBtn = makeBtn('Cancel', 'btn btn-ghost btn-sm');
    cancelBtn.addEventListener('click', resetScaleBar);
    sec.appendChild(cancelBtn);
  } else if (step === 'place-p2') {
    sec.appendChild(makeHint('Click the right/end of the scale bar'));
    const cancelBtn = makeBtn('Cancel', 'btn btn-ghost btn-sm');
    cancelBtn.addEventListener('click', resetScaleBar);
    sec.appendChild(cancelBtn);
  } else if (step === 'done') {
    sec.appendChild(makeHint('Enter the real-world length and unit:'));
    const row = makeRow('start');
    row.style.gap = '6px';
    const valInp = document.createElement('input');
    valInp.className = 'pv-input'; valInp.type = 'number';
    valInp.placeholder = 'e.g. 50'; valInp.min = '0';
    valInp.style.cssText = 'flex:1;min-width:0;';
    const unitInp = document.createElement('input');
    unitInp.className = 'pv-input'; unitInp.type = 'text';
    unitInp.placeholder = 'unit (µm, mm…)';
    unitInp.style.cssText = 'flex:1;min-width:0;';
    row.appendChild(valInp); row.appendChild(unitInp);
    sec.appendChild(row);
    const commit = makeBtn('Confirm →', 'btn btn-primary');
    commit.addEventListener('click', () => {
      const v = parseFloat(valInp.value);
      const u = unitInp.value.trim();
      if (!v || v <= 0) { valInp.focus(); return; }
      if (!u) { unitInp.focus(); return; }
      commitScaleBar(v, u);
    });
    sec.appendChild(commit);
    const cancelBtn = makeBtn('Cancel', 'btn btn-ghost btn-sm');
    cancelBtn.addEventListener('click', resetScaleBar);
    sec.appendChild(cancelBtn);
    setTimeout(() => valInp.focus(), 50);
  }
  el.appendChild(sec);
}

function renderPerspectiveSection(el: HTMLElement): void {
  const step = getPerspectiveStep();
  const corners = getPerspectiveCorners();
  const sec = makeSec('Fix Camera Angle');

  if (step === 'idle') {
    sec.appendChild(makeHint('Correct photos taken at an angle: click the 4 corners of the chart area (clockwise from top-left).'));
    const startBtn = makeBtn('Fix Perspective →', 'btn btn-ghost btn-sm');
    startBtn.addEventListener('click', startPerspective);
    sec.appendChild(startBtn);
  } else {
    const remaining = 4 - corners.length;
    const hint = makeDiv('calib-hint');
    hint.textContent = remaining > 0
      ? `Click corner ${corners.length + 1} of 4 (${remaining} remaining) — clockwise from top-left`
      : 'Applying correction…';
    sec.appendChild(hint);
    const row = makeRow('start');
    if (corners.length > 0) {
      const undoBtn = makeBtn('← Undo', 'btn btn-ghost btn-sm');
      undoBtn.addEventListener('click', undoLastCorner);
      row.appendChild(undoBtn);
    }
    const cancelBtn = makeBtn('Cancel', 'btn btn-ghost btn-sm');
    cancelBtn.addEventListener('click', resetPerspective);
    row.appendChild(cancelBtn);
    sec.appendChild(row);
  }
  el.appendChild(sec);
}
