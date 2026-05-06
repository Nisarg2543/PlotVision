import { getState } from '../state/store';
import { downloadText, downloadBlob } from '../utils/file';
import { showToast } from '../utils/toast';
import type { Dataset } from '../state/types';

function getDatasets(datasetId?: string): Dataset[] {
  const state = getState();
  return datasetId
    ? state.datasets.filter(d => d.id === datasetId)
    : state.datasets;
}

export function exportCSV(datasetId?: string): void {
  const datasets = getDatasets(datasetId);
  if (datasets.every(d => d.points.length === 0)) {
    showToast('No data to export', 'warning'); return;
  }

  const lines: string[] = ['Dataset,X,Y'];
  for (const ds of datasets) {
    for (const pt of ds.points) {
      const name = ds.name.replace(/"/g, '""');
      lines.push(`"${name}",${pt.dataX},${pt.dataY}`);
    }
  }

  const filename = getState().image.filename.replace(/\.[^.]+$/, '') || 'plotvision';
  downloadText(lines.join('\n'), `${filename}-export.csv`, 'text/csv');
  showToast('CSV exported', 'success');
}

export async function exportExcel(datasetId?: string): Promise<void> {
  const datasets = getDatasets(datasetId);
  if (datasets.every(d => d.points.length === 0)) {
    showToast('No data to export', 'warning'); return;
  }

  showToast('Preparing Excel file…', 'info', 1500);
  try {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    for (const ds of datasets) {
      const rows: (string | number)[][] = [['X', 'Y'], ...ds.points.map(p => [p.dataX, p.dataY])];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, ds.name.slice(0, 31));
    }
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const filename = getState().image.filename.replace(/\.[^.]+$/, '') || 'plotvision';
    downloadBlob(new Blob([buf], { type: 'application/octet-stream' }), `${filename}-export.xlsx`);
    showToast('Excel file exported', 'success');
  } catch (err) {
    showToast('Excel export failed: ' + (err as Error).message, 'error');
  }
}

export function exportJSON(datasetId?: string): void {
  const state = getState();
  const datasets = getDatasets(datasetId);
  const out = {
    metadata: {
      filename: state.image.filename,
      date: new Date().toISOString(),
      calibration: state.calibration.transform,
    },
    datasets: datasets.map(ds => ({
      name: ds.name,
      color: ds.color,
      points: ds.points.map(p => ({ x: p.dataX, y: p.dataY, label: p.label })),
    })),
  };
  const filename = state.image.filename.replace(/\.[^.]+$/, '') || 'plotvision';
  downloadText(JSON.stringify(out, null, 2), `${filename}-export.json`, 'application/json');
  showToast('JSON exported', 'success');
}

export async function exportClipboard(datasetId?: string): Promise<void> {
  const datasets = getDatasets(datasetId);
  const lines: string[] = [];
  for (const ds of datasets) {
    for (const pt of ds.points) {
      lines.push(`${pt.dataX}\t${pt.dataY}`);
    }
  }
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    showToast('Copied to clipboard — paste into Excel or Sheets', 'success');
  } catch {
    showToast('Clipboard access denied', 'error');
  }
}

export function exportLaTeX(datasetId?: string): void {
  const datasets = getDatasets(datasetId);
  const lines: string[] = [
    '\\begin{table}[h]',
    '\\centering',
    '\\begin{tabular}{cc}',
    '\\hline',
    'X & Y \\\\',
    '\\hline',
  ];
  for (const ds of datasets) {
    if (datasets.length > 1) lines.push(`\\multicolumn{2}{c}{${ds.name}} \\\\`);
    for (const pt of ds.points) {
      lines.push(`${pt.dataX} & ${pt.dataY} \\\\`);
    }
  }
  lines.push('\\hline', '\\end{tabular}', '\\end{table}');
  const filename = getState().image.filename.replace(/\.[^.]+$/, '') || 'plotvision';
  downloadText(lines.join('\n'), `${filename}-export.tex`, 'text/plain');
  showToast('LaTeX table exported', 'success');
}
