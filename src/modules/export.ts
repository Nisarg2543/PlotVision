import { getState } from '../state/store';
import { downloadText, downloadBlob } from '../utils/file';
import { showToast } from '../utils/toast';
import type { Dataset, DataPoint, ExportOptions } from '../state/types';

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatNum(v: number, opts: ExportOptions): string {
  if (opts.precision === 'fixed') return v.toFixed(opts.digits);
  if (opts.precision === 'sigfigs') return v.toPrecision(opts.digits);
  if (opts.precision === 'scientific') return v.toExponential(opts.digits);
  return String(v); // auto
}

function formatDate(ts: number, fmt: string): string {
  const d = new Date(ts);
  return fmt
    .replace('yyyy', String(d.getFullYear()).padStart(4,'0'))
    .replace('mm', String(d.getMonth()+1).padStart(2,'0'))
    .replace('dd', String(d.getDate()).padStart(2,'0'))
    .replace('HH', String(d.getHours()).padStart(2,'0'))
    .replace('ii', String(d.getMinutes()).padStart(2,'0'))
    .replace('ss', String(d.getSeconds()).padStart(2,'0'));
}

function sortPoints(points: DataPoint[], sort: ExportOptions['sort']): DataPoint[] {
  const pts = [...points];
  if (sort === 'x-asc')  return pts.sort((a, b) => a.dataX - b.dataX);
  if (sort === 'x-desc') return pts.sort((a, b) => b.dataX - a.dataX);
  if (sort === 'y-asc')  return pts.sort((a, b) => a.dataY - b.dataY);
  if (sort === 'y-desc') return pts.sort((a, b) => b.dataY - a.dataY);
  if (sort === 'nearest-neighbor' && pts.length > 1) {
    const result = [pts[0]];
    const remaining = new Set(pts.slice(1).map((_, i) => i + 1));
    while (remaining.size > 0) {
      const last = result[result.length - 1];
      let minDist = Infinity, minIdx = -1;
      for (const i of remaining) {
        const d = Math.hypot(pts[i].dataX - last.dataX, pts[i].dataY - last.dataY);
        if (d < minDist) { minDist = d; minIdx = i; }
      }
      result.push(pts[minIdx]);
      remaining.delete(minIdx);
    }
    return result;
  }
  return pts;
}

function getDatasets(datasetId?: string): Dataset[] {
  const state = getState();
  return datasetId
    ? state.datasets.filter(d => d.id === datasetId)
    : state.datasets;
}

export function exportCSV(datasetId?: string): void {
  const state = getState();
  const datasets = getDatasets(datasetId);
  if (datasets.every(d => d.points.length === 0)) {
    showToast('No data to export', 'warning'); return;
  }

  const opts = state.exportOptions;
  const axisType = state.calibration.axisType;

  // Build axis-specific header
  let header: string;
  if (axisType === 'polar' || axisType === 'log-polar') header = 'Dataset,r,theta_deg';
  else if (axisType === 'ternary')    header = 'Dataset,A_pct,B_pct,C_pct';
  else if (axisType === 'date-x')    header = 'Dataset,Date,Y';
  else if (axisType === 'bar-chart') header = 'Dataset,Category,Value';
  else if (axisType === 'circular')  header = 'Dataset,Time,Value';
  else {
    const hasLabels = datasets.some(d => d.points.some(p => p.label));
    const isPie = hasLabels && datasets.every(d => d.points.every(p => p.label));
    header = isPie ? 'Dataset,Sector,Angle(deg),Value' : hasLabels ? 'Dataset,Label,X,Y' : 'Dataset,X,Y';
  }

  const lines: string[] = [header];
  for (const ds of datasets) {
    const sorted = sortPoints(ds.points, opts.sort);
    for (const pt of sorted) {
      const name = `"${ds.name.replace(/"/g, '""')}"`;
      let row: string;
      if (axisType === 'ternary') {
        const c = parseFloat((100 - pt.dataX - pt.dataY).toFixed(4));
        row = `${name},${formatNum(pt.dataX, opts)},${formatNum(pt.dataY, opts)},${c}`;
      } else if (axisType === 'date-x') {
        row = `${name},${formatDate(pt.dataX, opts.dateFmt)},${formatNum(pt.dataY, opts)}`;
      } else if (axisType === 'bar-chart') {
        const cat = `"${(pt.label ?? String(pt.dataX)).replace(/"/g, '""')}"`;
        row = `${name},${cat},${formatNum(pt.dataY, opts)}`;
      } else if (axisType === 'polar' || axisType === 'log-polar') {
        row = `${name},${formatNum(pt.dataX, opts)},${pt.dataY.toFixed(4)}`;
      } else {
        // standard / pie / labeled
        const hasLabels = header.includes('Label') || header.includes('Sector');
        const label = `"${(pt.label ?? '').replace(/"/g, '""')}"`;
        row = hasLabels
          ? `${name},${label},${formatNum(pt.dataX, opts)},${formatNum(pt.dataY, opts)}`
          : `${name},${formatNum(pt.dataX, opts)},${formatNum(pt.dataY, opts)}`;
      }
      lines.push(row);
    }
  }

  const filename = state.image.filename.replace(/\.[^.]+$/, '') || 'plotvision';
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
    const hasLabels = datasets.some(d => d.points.some(p => p.label));
    for (const ds of datasets) {
      const rows: (string | number)[][] = hasLabels
        ? [['Label', 'X', 'Y'], ...ds.points.map(p => [p.label ?? '', p.dataX, p.dataY])]
        : [['X', 'Y'], ...ds.points.map(p => [p.dataX, p.dataY])];
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

  // Scale bar metadata if set
  type SBMod = { isScaleBarSet: () => boolean; getScaleBarUnit: () => string; getPixelsPerUnit: () => number } | null;
  const sbMod = (window as unknown as Record<string, SBMod>).__scaleBarMod;
  const scaleBar = sbMod?.isScaleBarSet?.()
    ? { unit: sbMod!.getScaleBarUnit!(), pixelsPerUnit: sbMod!.getPixelsPerUnit!() }
    : undefined;

  const out = {
    metadata: {
      filename: state.image.filename,
      date: new Date().toISOString(),
      calibration: state.calibration.transform,
      ...(scaleBar ? { scaleBar } : {}),
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

export function exportPlotly(datasetId?: string): void {
  const state = getState();
  const datasets = getDatasets(datasetId);
  const opts = state.exportOptions;
  const traces = datasets.map(ds => ({
    type: 'scatter', mode: 'markers+lines',
    name: ds.name, marker: { color: ds.color },
    x: sortPoints(ds.points, opts.sort).map(p => p.dataX),
    y: sortPoints(ds.points, opts.sort).map(p => p.dataY),
  }));
  const layout = {
    title: state.image.filename || 'PlotVision Export',
    xaxis: { title: 'X' }, yaxis: { title: 'Y' },
    paper_bgcolor: '#0d0d0d', plot_bgcolor: '#161616',
    font: { color: '#e5e5e5' },
  };
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="https://cdn.plot.ly/plotly-latest.min.js"><\/script>
<style>body{margin:0;background:#0d0d0d}</style>
</head><body>
<div id="plot" style="width:100%;height:100vh"></div>
<script>Plotly.newPlot('plot',${JSON.stringify(traces)},${JSON.stringify(layout)},{responsive:true})<\/script>
</body></html>`;
  const filename = state.image.filename.replace(/\.[^.]+$/, '') || 'plotvision';
  downloadText(html, `${filename}-plotly.html`, 'text/html');
  showToast('Plotly HTML exported', 'success');
}

export async function exportProjectTar(): Promise<void> {
  const state = getState();

  // Get current bitmap as PNG
  type BitmapMod = { getImageBitmap: () => ImageBitmap | null };
  const canvasEngine = await import('./canvas-engine') as BitmapMod;
  const bitmap = canvasEngine.getImageBitmap();
  let imageBytes: Uint8Array | null = null;
  if (bitmap) {
    const offscreen = document.createElement('canvas');
    offscreen.width = bitmap.width; offscreen.height = bitmap.height;
    offscreen.getContext('2d')!.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>(res => offscreen.toBlob(b => res(b!), 'image/png'));
    imageBytes = new Uint8Array(await blob.arrayBuffer());
  }

  const projectJson = JSON.stringify({
    version: 1,
    filename: state.image.filename,
    calibration: state.calibration,
    datasets: state.datasets,
    exportOptions: state.exportOptions,
  }, null, 2);

  // Build minimal tar archive (POSIX ustar format)
  const tarBlocks: Uint8Array[] = [];
  const addFile = (name: string, data: Uint8Array) => {
    const header = new Uint8Array(512);
    const enc = new TextEncoder();
    const writeFld = (offset: number, str: string) => enc.encode(str).forEach((b, i) => { if (offset + i < 512) header[offset + i] = b; });
    writeFld(0, name.slice(0, 99));
    writeFld(100, '0000644\0');     // mode
    writeFld(108, '0001750\0');     // uid
    writeFld(116, '0001750\0');     // gid
    const sizeOct = data.length.toString(8).padStart(11, '0') + '\0';
    writeFld(124, sizeOct);
    writeFld(136, Math.floor(Date.now()/1000).toString(8).padStart(11,'0') + '\0');
    header[156] = 48; // '0' = regular file
    writeFld(257, 'ustar\0');
    writeFld(265, '00');
    // Compute checksum
    header[148]=32;header[149]=32;header[150]=32;header[151]=32;header[152]=32;header[153]=32;header[154]=32;header[155]=32;
    const cksum = header.reduce((s, b) => s + b, 0);
    writeFld(148, cksum.toString(8).padStart(6,'0') + '\0 ');
    tarBlocks.push(header);
    // Data blocks (512-byte aligned)
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    tarBlocks.push(padded);
  };

  addFile('project.json', new TextEncoder().encode(projectJson));
  if (imageBytes) addFile('image.png', imageBytes);
  // EOF: 2 empty 512-byte blocks
  tarBlocks.push(new Uint8Array(1024));

  const total = tarBlocks.reduce((s, b) => s + b.length, 0);
  const tar = new Uint8Array(total);
  let offset = 0;
  for (const block of tarBlocks) { tar.set(block, offset); offset += block.length; }

  const filename = state.image.filename.replace(/\.[^.]+$/, '') || 'plotvision';
  downloadBlob(new Blob([tar], { type: 'application/x-tar' }), `${filename}-project.tar`);
  showToast('Project .tar exported', 'success');
}
