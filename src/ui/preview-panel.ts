import {
  Chart, ScatterController, LineController,
  LinearScale, PointElement, LineElement,
  Tooltip, Legend,
} from 'chart.js';
import { getState, setState, subscribe } from '../state/store';

Chart.register(ScatterController, LineController, LinearScale, PointElement, LineElement, Tooltip, Legend);

let chart: Chart | null = null;
let previewTimer: ReturnType<typeof setTimeout>;

export function initPreviewPanel(container: HTMLElement): void {
  // Add preview section below existing sidebar content
  const section = document.createElement('div');
  section.className = 'sidebar-section';
  section.style.cssText = 'flex-shrink:0';

  const header = document.createElement('div');
  header.className = 'sidebar-section-header';
  header.innerHTML = `
    <span>PREVIEW</span>
    <div style="display:flex;gap:6px">
      <button class="preview-mode-btn" data-mode="scatter" style="font-size:10px;padding:1px 5px;border-radius:3px;border:1px solid #2a2a2a;background:#0d0d0d;color:#71717a;cursor:pointer">Scatter</button>
      <button class="preview-mode-btn" data-mode="line" style="font-size:10px;padding:1px 5px;border-radius:3px;border:1px solid #2a2a2a;background:#0d0d0d;color:#71717a;cursor:pointer">Line</button>
    </div>
  `;
  section.appendChild(header);

  const body = document.createElement('div');
  body.style.cssText = 'padding:8px;';

  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = 'position:relative;height:180px;';
  const canvas = document.createElement('canvas');
  canvas.id = 'preview-chart';
  canvasWrap.appendChild(canvas);
  body.appendChild(canvasWrap);

  // Stats
  const stats = document.createElement('div');
  stats.id = 'preview-stats';
  stats.style.cssText = 'font-size:11px;color:#71717a;font-family:Geist Mono,monospace;margin-top:6px;line-height:1.5';
  body.appendChild(stats);

  section.appendChild(body);
  container.appendChild(section);

  // Mode buttons
  section.querySelectorAll('.preview-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as 'scatter' | 'line';
      setState(draft => { draft.ui.previewMode = mode; });
    });
  });

  // Subscribe with debounce
  subscribe(() => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 120);
  });
}

function updatePreview(): void {
  const state = getState();
  const canvas = document.getElementById('preview-chart') as HTMLCanvasElement | null;
  if (!canvas) return;

  const datasets = state.datasets.filter(d => d.visible && d.points.length > 0);
  const mode = state.ui.previewMode;

  const chartData = {
    datasets: datasets.map(ds => ({
      label: ds.name,
      data: ds.points.map(p => ({ x: p.dataX, y: p.dataY })),
      borderColor: ds.color,
      backgroundColor: ds.color + '44',
      pointRadius: mode === 'scatter' ? 3 : 2,
      pointHoverRadius: 5,
      fill: false,
      tension: 0.2,
      showLine: mode === 'line',
    })),
  };

  if (!chart) {
    chart = new Chart(canvas, {
      type: 'scatter',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            display: datasets.length > 1,
            labels: { color: '#71717a', font: { size: 10 }, boxWidth: 10 },
          },
          tooltip: {
            backgroundColor: '#161616',
            borderColor: '#2a2a2a',
            borderWidth: 1,
            titleColor: '#e5e5e5',
            bodyColor: '#71717a',
            callbacks: {
              label: ctx => `(${(ctx.parsed.x as number).toPrecision(4)}, ${(ctx.parsed.y as number).toPrecision(4)})`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: '#2a2a2a' },
            ticks: { color: '#71717a', font: { size: 10 } },
          },
          y: {
            grid: { color: '#2a2a2a' },
            ticks: { color: '#71717a', font: { size: 10 } },
          },
        },
      },
    });
  } else {
    chart.data = chartData;
    chart.update('none');
  }

  // Update stats
  const statsEl = document.getElementById('preview-stats');
  if (statsEl && datasets.length > 0) {
    const allPoints = datasets.flatMap(d => d.points);
    const xs = allPoints.map(p => p.dataX);
    const ys = allPoints.map(p => p.dataY);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    statsEl.innerHTML = `
      N: ${allPoints.length} &nbsp;
      X: [${xMin.toPrecision(4)}, ${xMax.toPrecision(4)}]<br>
      Y: [${yMin.toPrecision(4)}, ${yMax.toPrecision(4)}] &nbsp;
      μX: ${mean(xs).toPrecision(4)}
    `;
  } else if (statsEl) {
    statsEl.textContent = '';
  }
}
