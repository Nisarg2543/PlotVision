import {
  Chart, ScatterController, LineController,
  LinearScale, PointElement, LineElement,
  Tooltip, Legend,
} from 'chart.js';
import { getState, subscribe } from '../state/store';

Chart.register(ScatterController, LineController, LinearScale, PointElement, LineElement, Tooltip, Legend);

let chart: Chart | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Render/update the preview chart. Call after #preview-chart is in the DOM. */
export function updatePreview(): void {
  const canvas = document.getElementById('preview-chart') as HTMLCanvasElement | null;
  if (!canvas) return;

  const state = getState();
  const datasets = state.datasets.filter(d => d.visible && d.points.length > 0);
  const mode = state.ui.previewMode;

  const chartData = {
    datasets: datasets.map(ds => ({
      label: ds.name,
      data: ds.points.map(p => ({ x: p.dataX, y: p.dataY })),
      borderColor: ds.color,
      backgroundColor: ds.color + '33',
      pointRadius: mode === 'scatter' ? 3 : 2,
      pointHoverRadius: 5,
      fill: false,
      tension: 0.2,
      showLine: mode === 'line',
    })),
  };

  // Destroy and recreate if canvas reference changed (sidebar re-render)
  if (chart && chart.canvas !== canvas) {
    chart.destroy();
    chart = null;
  }

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
            labels: { color: '#52525b', font: { size: 10, family: 'Geist, system-ui' }, boxWidth: 10 },
          },
          tooltip: {
            backgroundColor: '#ffffff',
            borderColor: '#e4e4e7',
            borderWidth: 1,
            titleColor: '#09090b',
            bodyColor: '#52525b',
            callbacks: {
              label: ctx => `(${(ctx.parsed.x as number).toPrecision(5)}, ${(ctx.parsed.y as number).toPrecision(5)})`,
            },
          },
        },
        scales: {
          x: { grid: { color: '#f0f0f0' }, ticks: { color: '#a1a1aa', font: { size: 10 } } },
          y: { grid: { color: '#f0f0f0' }, ticks: { color: '#a1a1aa', font: { size: 10 } } },
        },
      },
    });
  } else {
    chart.data = chartData;
    chart.update('none');
  }
}

export function destroyPreview(): void {
  chart?.destroy();
  chart = null;
}

/**
 * Subscribe to state changes so preview auto-updates when Data tab is open.
 * Call once from main.ts.
 */
export function initPreviewPanel(_container: HTMLElement): void {
  subscribe(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (document.getElementById('preview-chart')) updatePreview();
    }, 120);
  });
}
