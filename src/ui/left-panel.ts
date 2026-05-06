import { getState, subscribe } from '../state/store';
import { setActiveTool } from '../modules/canvas-engine';
import { startCalibration } from '../modules/calibration';
import type { Tool } from '../state/types';

const TOOLS: { tool: Tool; label: string; emoji: string; key: string }[] = [
  { tool: 'pointer',    label: 'Pointer (V)',     emoji: '↖', key: 'V' },
  { tool: 'calibrate',  label: 'Calibrate (C)',   emoji: '⊕', key: 'C' },
  { tool: 'add-point',  label: 'Add Point (A)',   emoji: '✚', key: 'A' },
  { tool: 'auto-trace', label: 'Auto-Trace (T)',  emoji: '✦', key: 'T' },
  { tool: 'measure',    label: 'Measure (M)',     emoji: '📏', key: 'M' },
  { tool: 'eraser',     label: 'Eraser (E)',      emoji: '⌫', key: 'E' },
];

export function initLeftPanel(container: HTMLElement): void {
  function render() {
    const { activeTool } = getState();
    container.innerHTML = '';

    for (const { tool, label, emoji } of TOOLS) {
      const btn = document.createElement('button');
      btn.className = 'tool-btn' + (activeTool === tool ? ' active' : '');
      btn.title = label;
      btn.setAttribute('data-tooltip', label);
      btn.style.cssText = 'font-size:16px;border:none;background:none;cursor:pointer;';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        if (tool === 'calibrate') {
          startCalibration();
        } else {
          setActiveTool(tool);
        }
      });
      container.appendChild(btn);
    }

    // Separator
    const sep = document.createElement('div');
    sep.style.cssText = 'width:28px;height:1px;background:#2a2a2a;margin:4px auto;';
    container.appendChild(sep);

    // Pan tool
    const panBtn = document.createElement('button');
    panBtn.className = 'tool-btn' + (activeTool === 'pan' ? ' active' : '');
    panBtn.title = 'Pan (Space+drag)';
    panBtn.style.cssText = 'font-size:16px;border:none;background:none;cursor:pointer;';
    panBtn.textContent = '✋';
    panBtn.addEventListener('click', () => setActiveTool('pan'));
    container.appendChild(panBtn);
  }

  render();
  subscribe(render);
}
