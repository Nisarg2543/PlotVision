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
    title: 'Welcome to PlotVision 👋',
    body: 'Extract numerical data from any chart image. Start by loading an image — drag & drop, paste (Ctrl+V), or click Open.',
    position: 'right',
  },
  {
    targetId: 'left-panel',
    title: 'Tool Rail',
    body: 'Switch between tools here. Use keyboard shortcuts: V = Pointer, C = Calibrate, A = Add Point, T = Auto-Trace, M = Measure.',
    position: 'right',
  },
  {
    targetId: 'right-panel',
    title: 'Calibration & Datasets',
    body: 'First, calibrate the axis by clicking "Calibrate Axis" and placing 4 reference points on your chart axes. Then add datasets and digitize points.',
    position: 'left',
  },
  {
    targetId: 'topbar',
    title: 'Save & Export',
    body: 'Save your project as a .pvz file (Ctrl+S) to resume later. Export data as CSV, Excel, JSON, or copy to clipboard (Ctrl+E).',
    position: 'bottom',
  },
];

let overlay: HTMLElement | null = null;

export function initOnboarding(): void {
  if (localStorage.getItem(ONBOARDING_KEY)) return;
  // Delay start so app is fully rendered
  setTimeout(startTour, 800);
}

export function startTour(): void {
  showStep(0);
}

function showStep(index: number): void {
  removeOverlay();
  if (index >= STEPS.length) {
    finishTour();
    return;
  }

  const step = STEPS[index];
  const target = document.getElementById(step.targetId);
  if (!target) { showStep(index + 1); return; }

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;pointer-events:none';

  // Spotlight: cut out target area
  const rect = target.getBoundingClientRect();
  const spotlight = document.createElement('div');
  spotlight.style.cssText = `
    position:fixed;
    left:${rect.left - 4}px;top:${rect.top - 4}px;
    width:${rect.width + 8}px;height:${rect.height + 8}px;
    border:2px solid #22d3ee;border-radius:6px;
    box-shadow:0 0 0 9999px rgba(0,0,0,0.6);
    z-index:1001;pointer-events:none;
  `;

  // Tooltip
  const tooltip = document.createElement('div');
  tooltip.style.cssText = `
    position:fixed;z-index:1002;
    background:#161616;border:1px solid #2a2a2a;border-radius:6px;
    padding:16px;width:280px;
    box-shadow:0 8px 32px rgba(0,0,0,0.5);
    font-family:Geist,system-ui;
  `;

  // Position tooltip relative to target
  const gap = 16;
  if (step.position === 'right') {
    tooltip.style.left = `${rect.right + gap}px`;
    tooltip.style.top = `${rect.top}px`;
  } else if (step.position === 'left') {
    tooltip.style.right = `${window.innerWidth - rect.left + gap}px`;
    tooltip.style.top = `${rect.top}px`;
  } else if (step.position === 'bottom') {
    tooltip.style.left = `${rect.left}px`;
    tooltip.style.top = `${rect.bottom + gap}px`;
  } else {
    tooltip.style.left = `${rect.left}px`;
    tooltip.style.bottom = `${window.innerHeight - rect.top + gap}px`;
  }

  tooltip.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:13px;font-weight:600;color:#e5e5e5">${step.title}</span>
      <span style="font-size:11px;color:#71717a">${index + 1} / ${STEPS.length}</span>
    </div>
    <p style="font-size:12px;color:#71717a;line-height:1.5;margin:0 0 14px">${step.body}</p>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="tour-skip" style="padding:4px 10px;font-size:11px;background:#0d0d0d;color:#71717a;border:1px solid #2a2a2a;border-radius:4px;cursor:pointer">Skip tour</button>
      ${index > 0 ? `<button id="tour-prev" style="padding:4px 10px;font-size:11px;background:#0d0d0d;color:#71717a;border:1px solid #2a2a2a;border-radius:4px;cursor:pointer">← Back</button>` : ''}
      <button id="tour-next" style="padding:4px 10px;font-size:11px;background:#22d3ee;color:#0d0d0d;border:none;border-radius:4px;cursor:pointer;font-weight:600">
        ${index === STEPS.length - 1 ? 'Get started →' : 'Next →'}
      </button>
    </div>
    <!-- Progress dots -->
    <div style="display:flex;gap:4px;justify-content:center;margin-top:10px">
      ${STEPS.map((_, i) => `<div style="width:6px;height:6px;border-radius:50%;background:${i === index ? '#22d3ee' : '#3f3f46'}"></div>`).join('')}
    </div>
  `;

  const wrap = document.createElement('div');
  wrap.id = 'onboarding-overlay';
  wrap.appendChild(backdrop);
  wrap.appendChild(spotlight);
  wrap.appendChild(tooltip);
  document.body.appendChild(wrap);
  overlay = wrap;

  tooltip.querySelector('#tour-next')?.addEventListener('click', () => showStep(index + 1));
  tooltip.querySelector('#tour-prev')?.addEventListener('click', () => showStep(index - 1));
  tooltip.querySelector('#tour-skip')?.addEventListener('click', finishTour);
}

function removeOverlay(): void {
  overlay?.remove();
  overlay = null;
}

function finishTour(): void {
  removeOverlay();
  localStorage.setItem(ONBOARDING_KEY, '1');
}
