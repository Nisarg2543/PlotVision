/**
 * Step 4 — Measure
 * Distance, angle, and area measurements with history log.
 */

import {
  getMeasureMode, setMeasureMode, reset as resetMeasure,
  getMeasureResult, getMeasurePoints, getMeasurementLog, clearMeasurementLog,
} from '../modules/measure';
import { exportMeasurements } from '../modules/export';
import { makeSec, makeDiv, makeRow, makeBtn, makeHint } from './ui-helpers';

export function renderStepMeasure(container: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'flex:1;display:flex;gap:0;overflow:hidden;';

  // Left: mode + result
  const leftCol = makeDiv('dock-col dock-col-medium dock-col-border');
  renderModeSection(leftCol);
  wrap.appendChild(leftCol);

  // Right: history log
  const rightCol = makeDiv('dock-col dock-col-flex');
  renderHistorySection(rightCol);
  wrap.appendChild(rightCol);

  container.appendChild(wrap);
}

function renderModeSection(el: HTMLElement): void {
  const modeSec = makeSec('Measurement mode');
  const modeRow = makeDiv('flex-row'); modeRow.style.gap = '5px;';

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
  modeSec.appendChild(modeRow);

  const instrMap = {
    distance: 'Press M, then click 2 points on the chart',
    angle:    'Press M, then click 3 points — vertex second',
    area:     'Press M, then click 3 or more points to form a polygon',
  };
  modeSec.appendChild(makeHint(instrMap[cur]));
  el.appendChild(modeSec);

  const result = getMeasureResult();
  const pts = getMeasurePoints();

  if (pts.length > 0) {
    const resSec = makeSec('Result');
    if (result) {
      const resEl = makeDiv('measure-result');
      resEl.textContent = result;
      resSec.appendChild(resEl);
    } else {
      resSec.appendChild(makeHint(`${pts.length} point${pts.length > 1 ? 's' : ''} — keep clicking`));
    }
    const resetBtn = makeBtn('Reset', 'btn btn-ghost');
    resetBtn.addEventListener('click', resetMeasure);
    resSec.appendChild(resetBtn);
    el.appendChild(resSec);
  }
}

function renderHistorySection(el: HTMLElement): void {
  const log = getMeasurementLog();

  if (log.length === 0) {
    el.appendChild(makeHint('Measurements will appear here as you use the Measure tool (M).'));
    return;
  }

  const logSec = makeSec(`History (${log.length})`);

  const logWrap = makeDiv('');
  logWrap.style.cssText = 'max-height:160px;overflow-y:auto;';
  [...log].reverse().slice(0, 20).forEach(m => {
    const row = makeDiv('flex-between');
    row.style.cssText = 'font-size:11px;padding:3px 0;border-bottom:1px solid var(--color-faint);';
    const modeSpan = document.createElement('span');
    modeSpan.style.cssText = 'color:var(--color-muted);flex-shrink:0;text-transform:capitalize;';
    modeSpan.textContent = m.mode;
    const resSpan = document.createElement('span');
    resSpan.style.cssText = 'font-family:var(--font-mono);font-size:10px;color:var(--color-text-2);';
    resSpan.textContent = m.result;
    row.appendChild(modeSpan); row.appendChild(resSpan);
    logWrap.appendChild(row);
  });
  logSec.appendChild(logWrap);

  const actRow = makeRow('start'); actRow.style.gap = '6px';
  const exportBtn = makeBtn('Export CSV', 'btn btn-ghost btn-sm');
  exportBtn.style.width = 'auto';
  exportBtn.addEventListener('click', () => { exportMeasurements(); });
  const clearBtn = makeBtn('Clear', 'btn btn-danger btn-sm');
  clearBtn.style.width = 'auto';
  clearBtn.addEventListener('click', () => { clearMeasurementLog(); });
  actRow.appendChild(exportBtn); actRow.appendChild(clearBtn);
  logSec.appendChild(actRow);

  el.appendChild(logSec);
}
