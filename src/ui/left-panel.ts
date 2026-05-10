import { getState, setState, subscribe } from '../state/store';
import { setActiveTool } from '../modules/canvas-engine';
import { startCalibration } from '../modules/calibration';
import { startScaleBar } from '../modules/scale-bar';
import type { Tool } from '../state/types';

const TOOLS: { tool: Tool; label: string; tip: string }[] = [
  { tool: 'pointer',    label: '↖',  tip: 'Pointer  (V)' },
  { tool: 'calibrate',  label: '⊕',  tip: 'Calibrate  (C)' },
  { tool: 'add-point',  label: '✚',  tip: 'Add Point  (A)' },
  { tool: 'auto-trace', label: '✦',  tip: 'Auto-Trace  (T)' },
  { tool: 'measure',    label: '📐', tip: 'Measure  (M)' },
  { tool: 'eraser',     label: '⌫',  tip: 'Eraser  (E)' },
];

export function initLeftPanel(container: HTMLElement): void {
  function render() {
    const { activeTool } = getState();
    container.innerHTML = '';

    TOOLS.forEach(({ tool, label, tip }) => {
      const btn = document.createElement('button');
      btn.className = 'tool-btn' + (activeTool === tool ? ' active' : '');
      btn.textContent = label;
      btn.setAttribute('data-tip', tip);
      btn.title = tip;
      btn.setAttribute('aria-label', tip);
      btn.addEventListener('click', () => {
        if (tool === 'calibrate') startCalibration();
        else setActiveTool(tool);
      });
      container.appendChild(btn);
    });

    const sep = document.createElement('div');
    sep.className = 'tool-sep';
    container.appendChild(sep);

    // Scale bar tool
    const sbBtn = document.createElement('button');
    sbBtn.className = 'tool-btn' + (activeTool === 'scale-bar' ? ' active' : '');
    sbBtn.textContent = '⟷';
    sbBtn.setAttribute('data-tip', 'Scale Bar  (B)');
    sbBtn.title = 'Scale Bar (B)';
    sbBtn.setAttribute('aria-label', 'Scale Bar');
    sbBtn.addEventListener('click', startScaleBar);
    container.appendChild(sbBtn);

    // RoI tool
    const roiBtn = document.createElement('button');
    roiBtn.className = 'tool-btn' + (activeTool === 'roi' ? ' active' : '');
    roiBtn.textContent = '⬚';
    roiBtn.setAttribute('data-tip', 'Region of Interest  (R)');
    roiBtn.title = 'Region of Interest (R)';
    roiBtn.setAttribute('aria-label', 'Region of Interest');
    roiBtn.addEventListener('click', () => setState(d => { d.activeTool = 'roi'; }));
    container.appendChild(roiBtn);

    const sep2 = document.createElement('div');
    sep2.className = 'tool-sep';
    container.appendChild(sep2);

    const panBtn = document.createElement('button');
    panBtn.className = 'tool-btn' + (activeTool === 'pan' ? ' active' : '');
    panBtn.textContent = '✋';
    panBtn.setAttribute('data-tip', 'Pan  (Space+drag)');
    panBtn.title = 'Pan (Space+drag)';
    panBtn.setAttribute('aria-label', 'Pan');
    panBtn.addEventListener('click', () => setActiveTool('pan'));
    container.appendChild(panBtn);
  }

  render();
  subscribe(render);
}
