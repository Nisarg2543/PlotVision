import { getState, subscribe } from '../state/store';
import { setActiveTool } from '../modules/canvas-engine';
import { startCalibration } from '../modules/calibration';
import type { Tool } from '../state/types';

const TOOLS: { tool: Tool; emoji: string; tip: string }[] = [
  { tool: 'pointer',    emoji: '↖',  tip: 'Pointer  (V)' },
  { tool: 'calibrate',  emoji: '⊕',  tip: 'Calibrate  (C)' },
  { tool: 'add-point',  emoji: '✚',  tip: 'Add Point  (A)' },
  { tool: 'auto-trace', emoji: '✦',  tip: 'Auto-Trace  (T)' },
  { tool: 'measure',    emoji: '📐', tip: 'Measure  (M)' },
  { tool: 'eraser',     emoji: '⌫',  tip: 'Eraser  (E)' },
];

export function initLeftPanel(container: HTMLElement): void {
  function render() {
    const { activeTool } = getState();
    container.innerHTML = '';

    TOOLS.forEach(({ tool, emoji, tip }) => {
      const btn = document.createElement('button');
      btn.className = 'tool-btn' + (activeTool === tool ? ' active' : '');
      btn.textContent = emoji;
      btn.setAttribute('data-tip', tip);
      btn.title = tip;
      btn.addEventListener('click', () => {
        if (tool === 'calibrate') startCalibration();
        else setActiveTool(tool);
      });
      container.appendChild(btn);
    });

    const sep = document.createElement('div');
    sep.className = 'tool-sep';
    container.appendChild(sep);

    const panBtn = document.createElement('button');
    panBtn.className = 'tool-btn' + (activeTool === 'pan' ? ' active' : '');
    panBtn.textContent = '✋';
    panBtn.setAttribute('data-tip', 'Pan  (Space+drag)');
    panBtn.title = 'Pan (Space+drag)';
    panBtn.addEventListener('click', () => setActiveTool('pan'));
    container.appendChild(panBtn);
  }

  render();
  subscribe(render);
}
