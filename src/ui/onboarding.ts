const ONBOARDING_KEY = 'plotvision-onboarded-v1';

interface TourStep {
  targetId: string;
  title: string;
  body: string;
  position: 'right' | 'left' | 'bottom' | 'top';
}

const STEPS: TourStep[] = [
  {
    targetId: 'canvas-container',
    title: 'Welcome to PlotVision',
    body: 'Extract numerical data from any chart image. Start by loading an image — drag & drop, paste (Ctrl+V), or click Open in the toolbar.',
    position: 'right',
  },
  {
    targetId: 'left-panel',
    title: 'Tool Rail',
    body: 'Switch between tools here. V = Pointer, C = Calibrate, A = Add Point, T = Auto-Trace, M = Measure.',
    position: 'right',
  },
  {
    targetId: 'right-panel',
    title: 'Calibration & Data',
    body: 'Calibrate the axes first, then switch to the Data tab to manage datasets and view extracted points.',
    position: 'left',
  },
  {
    targetId: 'topbar',
    title: 'Save & Export',
    body: 'Save your project (Ctrl+S) and export data as CSV, Excel, JSON, or copy to clipboard.',
    position: 'bottom',
  },
];

let overlay: HTMLElement | null = null;

export function initOnboarding(): void {
  if (localStorage.getItem(ONBOARDING_KEY)) return;
  setTimeout(startTour, 600);
}

export function startTour(): void {
  showStep(0);
}

function showStep(index: number): void {
  removeOverlay();
  if (index >= STEPS.length) { finishTour(); return; }

  const step   = STEPS[index];
  const target = document.getElementById(step.targetId);
  if (!target) { showStep(index + 1); return; }

  const rect = target.getBoundingClientRect();
  const gap  = 14;

  // Full-screen container — pointer-events: none so clicks pass through to spotlight/tooltip
  const wrap = document.createElement('div');
  wrap.id = 'onboarding-overlay';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:1000;pointer-events:none;';

  // Dark backdrop (box-shadow trick — no separate div needed)
  const spotlight = document.createElement('div');
  spotlight.style.cssText = `
    position:fixed;
    left:${rect.left - 3}px; top:${rect.top - 3}px;
    width:${rect.width + 6}px; height:${rect.height + 6}px;
    border-radius:6px;
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.45);
    outline: 2px solid #2563eb;
    pointer-events:none;
    z-index:1001;
  `;

  // Tooltip — pointer-events:all overrides parent's none
  const tooltip = document.createElement('div');
  tooltip.style.cssText = `
    position:fixed;
    z-index:1002;
    pointer-events:all;
    background:#fff;
    border:1px solid #e4e4e7;
    border-radius:10px;
    padding:18px;
    width:272px;
    box-shadow:0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
    font-family:'Geist',system-ui,sans-serif;
  `;

  // Position
  if (step.position === 'right') {
    tooltip.style.left = `${rect.right + gap}px`;
    tooltip.style.top  = `${Math.min(rect.top, window.innerHeight - 220)}px`;
  } else if (step.position === 'left') {
    tooltip.style.right = `${window.innerWidth - rect.left + gap}px`;
    tooltip.style.top   = `${Math.min(rect.top, window.innerHeight - 220)}px`;
  } else if (step.position === 'bottom') {
    tooltip.style.left = `${Math.min(rect.left, window.innerWidth - 290)}px`;
    tooltip.style.top  = `${rect.bottom + gap}px`;
  } else {
    tooltip.style.left   = `${rect.left}px`;
    tooltip.style.bottom = `${window.innerHeight - rect.top + gap}px`;
  }

  // Progress dots
  const dots = STEPS.map((_, i) =>
    `<div style="width:5px;height:5px;border-radius:50%;background:${i === index ? '#2563eb' : '#d4d4d8'};"></div>`
  ).join('');

  tooltip.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <span style="font-size:13px;font-weight:600;color:#111;">${step.title}</span>
      <span style="font-size:11px;color:#999;">${index + 1} / ${STEPS.length}</span>
    </div>
    <p style="font-size:12px;color:#555;line-height:1.6;margin:0 0 16px;">${step.body}</p>
    <div style="display:flex;align-items:center;gap:8px;">
      <button id="tour-skip"  style="padding:5px 10px;font-size:11px;background:none;color:#999;border:1px solid #e4e4e7;border-radius:5px;cursor:pointer;font-family:inherit;">Skip</button>
      <div style="flex:1;display:flex;justify-content:center;gap:5px;">${dots}</div>
      ${index > 0 ? `<button id="tour-prev" style="padding:5px 10px;font-size:11px;background:none;color:#555;border:1px solid #e4e4e7;border-radius:5px;cursor:pointer;font-family:inherit;">← Back</button>` : ''}
      <button id="tour-next" style="padding:5px 12px;font-size:11px;background:#2563eb;color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:600;font-family:inherit;">
        ${index === STEPS.length - 1 ? 'Get started' : 'Next →'}
      </button>
    </div>
  `;

  wrap.appendChild(spotlight);
  wrap.appendChild(tooltip);
  document.body.appendChild(wrap);
  overlay = wrap;

  tooltip.querySelector('#tour-next')!.addEventListener('click', () => showStep(index + 1));
  tooltip.querySelector('#tour-prev')?.addEventListener('click', () => showStep(index - 1));
  tooltip.querySelector('#tour-skip')!.addEventListener('click', finishTour);
}

function removeOverlay(): void {
  overlay?.remove();
  overlay = null;
}

function finishTour(): void {
  removeOverlay();
  localStorage.setItem(ONBOARDING_KEY, '1');
}
