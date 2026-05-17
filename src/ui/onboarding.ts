import { track } from '../utils/analytics';

const ONBOARDING_KEY = 'plotvision-onboarded-v1';

interface TourStep {
  targetId: string;
  title: string;
  body: string;
  position: 'right' | 'left' | 'bottom' | 'top' | 'above';
}

const STEPS: TourStep[] = [
  {
    targetId: 'canvas-container',
    title: 'Welcome to PlotVision',
    body: 'Extract numbers from any chart image — free, in your browser, no signup. Start by dropping a chart here, pasting with <strong>Ctrl+V</strong>, or clicking <strong>Open</strong> in the toolbar.',
    position: 'right',
  },
  {
    targetId: 'dock',
    title: 'Step 1 — Load your chart',
    body: 'The bottom panel guides you through 4 steps. <strong>Step 1</strong> is active now — open an image or try the demo chart to get started.',
    position: 'top',
  },
  {
    targetId: 'dock',
    title: 'Step 2 — Set the scale',
    body: 'Click <strong>Step 2</strong> in the panel below. Pick your chart type, then click <strong>Start Setting Scale</strong> and mark 4 known points on the axes. PlotVision learns the coordinate system from those points.',
    position: 'top',
  },
  {
    targetId: 'dock',
    title: 'Step 3 — Get your data',
    body: 'In <strong>Step 3</strong> you can add points manually (press <strong>A</strong> and click), auto-trace a curve (press <strong>T</strong>), or use detectors for bars, scatter plots, and pie charts.',
    position: 'top',
  },
  {
    targetId: 'dock',
    title: 'Auto-trace a curve',
    body: 'Select <strong>Trace a Line</strong> as the extraction method. Click the canvas with the T tool to sample the curve color, then press <strong>Preview Trace</strong>. PlotVision traces the entire curve automatically.',
    position: 'top',
  },
  {
    targetId: 'dock',
    title: 'Other extraction modes',
    body: 'Step 3 also supports <strong>Bar charts</strong> (detect bars by color), <strong>Find dots</strong> (scatter marker detection), <strong>Pie chart</strong> (click sector edges), and <strong>Find matching symbols</strong> (template matching).',
    position: 'top',
  },
  {
    targetId: 'dock',
    title: 'Scale bar & perspective fix',
    body: 'In <strong>Step 2</strong>, scroll the right column for two extra tools:<br>• <strong>Ruler in chart</strong> — draw over a printed scale bar and enter its real length.<br>• <strong>Fix camera angle</strong> — click 4 corners to correct a photo taken at an angle.',
    position: 'top',
  },
  {
    targetId: 'dock',
    title: 'Step 4 — Measure',
    body: 'Click <strong>Step 4</strong> to measure distances, angles, and areas directly on the chart — in real data units once the scale is set.',
    position: 'top',
  },
  {
    targetId: 'topbar',
    title: 'Save your work',
    body: 'Click <strong>Save</strong> (Ctrl+S) to download a <code>.pvz</code> project file. Load it back anytime to resume. Your session also autosaves to the browser every 30 seconds.',
    position: 'bottom',
  },
  {
    targetId: 'topbar',
    title: 'Export your data',
    body: 'Click <strong>Export</strong> to download as <strong>CSV</strong>, <strong>Excel</strong>, <strong>JSON</strong>, <strong>SVG</strong>, or an interactive <strong>Plotly HTML</strong> chart. Copy to clipboard for instant paste into Excel or Google Sheets.',
    position: 'bottom',
  },
];

let overlay: HTMLElement | null = null;

export function initOnboarding(): void {
  if (localStorage.getItem(ONBOARDING_KEY)) return;
  setTimeout(startTour, 700);
}

export function startTour(): void {
  track('tour-started');
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

  const wrap = document.createElement('div');
  wrap.id = 'onboarding-overlay';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:1000;pointer-events:none;';

  // Spotlight cutout via box-shadow
  const spotlight = document.createElement('div');
  spotlight.style.cssText = `
    position:fixed;
    left:${rect.left - 3}px; top:${rect.top - 3}px;
    width:${rect.width + 6}px; height:${rect.height + 6}px;
    border-radius:6px;
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.48);
    outline: 2.5px solid #6366f1;
    pointer-events:none;
    z-index:1001;
  `;

  const tooltip = document.createElement('div');
  const isDark = document.body.classList.contains('dark');
  tooltip.style.cssText = `
    position:fixed;
    z-index:1002;
    pointer-events:all;
    background:${isDark ? '#1c1c1e' : '#fff'};
    border:1px solid ${isDark ? '#3a3a3a' : '#e4e4e7'};
    border-radius:10px;
    padding:18px;
    width:288px;
    box-shadow:0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08);
    font-family:'Geist',system-ui,sans-serif;
    color:${isDark ? '#e5e5e5' : '#111'};
  `;

  if (step.position === 'right') {
    tooltip.style.left = `${Math.min(rect.right + gap, window.innerWidth - 310)}px`;
    tooltip.style.top  = `${Math.min(rect.top, window.innerHeight - 260)}px`;
  } else if (step.position === 'left') {
    tooltip.style.right = `${Math.max(window.innerWidth - rect.left + gap, 10)}px`;
    tooltip.style.top   = `${Math.min(rect.top, window.innerHeight - 260)}px`;
  } else if (step.position === 'bottom') {
    tooltip.style.left = `${Math.min(rect.left, window.innerWidth - 310)}px`;
    tooltip.style.top  = `${Math.min(rect.bottom + gap, window.innerHeight - 260)}px`;
  } else {
    // 'top' / 'above' — show tooltip above the target element, centered
    const left = Math.max(10, Math.min(rect.left + rect.width / 2 - 144, window.innerWidth - 310));
    tooltip.style.left   = `${left}px`;
    tooltip.style.bottom = `${window.innerHeight - rect.top + gap}px`;
  }

  const dots = STEPS.map((_, i) =>
    `<div style="width:5px;height:5px;border-radius:50%;background:${i === index ? '#6366f1' : (isDark ? '#3a3a3a' : '#d4d4d8')};flex-shrink:0;"></div>`
  ).join('');

  const muted = isDark ? '#a1a1aa' : '#666';
  const borderCol = isDark ? '#3a3a3a' : '#e4e4e7';

  tooltip.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <span style="font-size:13px;font-weight:600;">${step.title}</span>
      <span style="font-size:11px;color:${muted};">${index + 1} / ${STEPS.length}</span>
    </div>
    <p style="font-size:12px;color:${muted};line-height:1.65;margin:0 0 16px;">${step.body}</p>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;">
      <button id="tour-skip" style="padding:5px 10px;font-size:11px;background:none;color:${muted};border:1px solid ${borderCol};border-radius:5px;cursor:pointer;font-family:inherit;white-space:nowrap;">Skip</button>
      <div style="flex:1;display:flex;justify-content:center;gap:4px;flex-wrap:wrap;">${dots}</div>
      ${index > 0 ? `<button id="tour-prev" style="padding:5px 10px;font-size:11px;background:none;color:${muted};border:1px solid ${borderCol};border-radius:5px;cursor:pointer;font-family:inherit;">← Back</button>` : ''}
      <button id="tour-next" style="padding:5px 12px;font-size:11px;background:#6366f1;color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:600;font-family:inherit;white-space:nowrap;">
        ${index === STEPS.length - 1 ? '🎉 Get started' : 'Next →'}
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
  track('tour-completed');
}
