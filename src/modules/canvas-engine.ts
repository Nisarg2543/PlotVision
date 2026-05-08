import { getState, setState, subscribe } from '../state/store';
import { canvasToImage, imageToCanvas, clamp, linearDataToPixel, linearPixelToData, niceGridInterval, distance } from '../utils/math';
import { isLogAxisType, getLogFlags, logPixelToData, logDataToPixel } from './axis-types';
import { applyThreshold, applySharpen, applyAutoContrast, applyDenoise } from './image-filters';
import { showToast } from '../utils/toast';
import { drawMeasureOverlay, handleMeasureClick, isMeasureActive } from './measure';
import { drawStripOverlays, getStrips } from './strip-chart';
import { pickColorAtPixel, setAutoTraceSettings } from './auto-trace';
import type { Dataset, DataPoint, CalibrationPoint } from '../state/types';

// ImageBitmap stored here — cannot be structuredCloned
let bitmap: ImageBitmap | null = null;

// Processed ImageData: CSS + pixel filters applied, used by detectors
// Rebuilt lazily on next getProcessedImageData() call after invalidation
let processedImageData: ImageData | null = null;

export function invalidateProcessedImage(): void {
  processedImageData = null;
}

export function getProcessedImageData(): ImageData | null {
  if (!bitmap) return null;
  if (!processedImageData) processedImageData = buildProcessedImageData();
  return processedImageData;
}

function buildProcessedImageData(): ImageData {
  const W = bitmap!.width, H = bitmap!.height;
  const offscreen = document.createElement('canvas');
  offscreen.width = W; offscreen.height = H;
  const offCtx = offscreen.getContext('2d')!;

  // Apply CSS filters first (matches visual display)
  const f = getState().canvas.imageFilters;
  let filterStr = `brightness(${f.brightness}%) contrast(${f.contrast}%)`;
  if (f.grayscale) filterStr += ' grayscale(1)';
  if (f.invert)    filterStr += ' invert(1)';
  offCtx.filter = filterStr;
  offCtx.drawImage(bitmap!, 0, 0);
  offCtx.filter = 'none';

  const imgData = offCtx.getImageData(0, 0, W, H);
  const d = imgData.data;

  // Apply pixel-level filters in order
  if (f.sharpen)      applySharpen(d, W, H);
  if (f.denoise)      applyDenoise(d, W, H);
  if (f.autoContrast) applyAutoContrast(d);
  if (f.threshold !== null) applyThreshold(d, f.threshold);

  return imgData;
}

// Typed interface for the auto-trace preview bridge
interface AutoTraceMod { getPreviewData: () => { data: Uint8ClampedArray; width: number; height: number } | null; }
// Typed interface for the pie-chart overlay bridge
interface PieOverlay { step: string; centerX: number; centerY: number; refX: number; refY: number; boundaries: { x: number; y: number }[]; }
interface PieMod { getPieOverlay: () => PieOverlay | null; }
// Typed interface for scale bar overlay bridge
interface ScaleBarOverlay { step: string; p1x: number; p1y: number; p2x: number; p2y: number; isSet: boolean; unit: string; pixelsPerUnit: number; }
interface ScaleBarMod { getScaleBarOverlay: () => ScaleBarOverlay | null; isScaleBarSet: () => boolean; convertPixelDistance: (px: number) => number; getScaleBarUnit: () => string; }
// Typed interface for perspective overlay bridge
interface PerspectiveOverlay { step: string; corners: { x: number; y: number }[]; }
interface PerspectiveMod { getPerspectiveOverlay: () => PerspectiveOverlay | null; }
declare global { interface Window { __autoTraceMod: AutoTraceMod | null; __pieMod: PieMod | null; __scaleBarMod: ScaleBarMod | null; __perspectiveMod: PerspectiveMod | null; } }

// Internal interaction state
let isPanning = false;
let panStartX = 0, panStartY = 0;
let panStartOffsetX = 0, panStartOffsetY = 0;
let isDraggingPoint: string | null = null;
let isDraggingCalibPoint: string | null = null;
let hoverPointId: string | null = null;
let mouseImgX = 0, mouseImgY = 0;
let mouseCanvasX = 0, mouseCanvasY = 0;
let rafPending = false;
let deletePopoverTarget: { datasetId: string; pointId: string } | null = null;

// Touch interaction state
let touchStartCanvasX = 0, touchStartCanvasY = 0;
let touchStartPanX = 0, touchStartPanY = 0;
let touchMoved = false;
let touchStartTime = 0;
let pinchStartDist = 0;
let pinchStartZoom = 0;
let pinchMidCanvasX = 0, pinchMidCanvasY = 0;
let pinchStartPanX = 0, pinchStartPanY = 0;

let mainCanvas: HTMLCanvasElement;
let overlayCanvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let overlayCtx: CanvasRenderingContext2D;
let container: HTMLElement;

// Callbacks set by other modules
let onCalibClick: ((imgX: number, imgY: number) => void) | null = null;
let onDigitizerClick: ((imgX: number, imgY: number) => void) | null = null;
let onCalibDrag: ((id: string, imgX: number, imgY: number) => void) | null = null;
let onPointDragEnd: ((datasetId: string, pointId: string, imgX: number, imgY: number) => void) | null = null;
let onDeletePoint: ((datasetId: string, pointId: string) => void) | null = null;
let onPieClick: ((imgX: number, imgY: number) => void) | null = null;
let onScaleBarClick: ((imgX: number, imgY: number) => void) | null = null;
let onPerspectiveClick: ((imgX: number, imgY: number) => void) | null = null;

export function setCanvasCallbacks(cbs: {
  onCalibClick?: (x: number, y: number) => void;
  onDigitizerClick?: (x: number, y: number) => void;
  onCalibDrag?: (id: string, x: number, y: number) => void;
  onPointDragEnd?: (datasetId: string, pointId: string, x: number, y: number) => void;
  onDeletePoint?: (datasetId: string, pointId: string) => void;
  onPieClick?: (x: number, y: number) => void;
  onScaleBarClick?: (x: number, y: number) => void;
  onPerspectiveClick?: (x: number, y: number) => void;
}): void {
  if (cbs.onCalibClick) onCalibClick = cbs.onCalibClick;
  if (cbs.onDigitizerClick) onDigitizerClick = cbs.onDigitizerClick;
  if (cbs.onCalibDrag) onCalibDrag = cbs.onCalibDrag;
  if (cbs.onPointDragEnd) onPointDragEnd = cbs.onPointDragEnd;
  if (cbs.onDeletePoint) onDeletePoint = cbs.onDeletePoint;
  if (cbs.onPieClick) onPieClick = cbs.onPieClick;
  if (cbs.onScaleBarClick) onScaleBarClick = cbs.onScaleBarClick;
  if (cbs.onPerspectiveClick) onPerspectiveClick = cbs.onPerspectiveClick;
}

export function setImageBitmap(bmp: ImageBitmap): void {
  bitmap = bmp;
  processedImageData = null;
}

export function getImageBitmap(): ImageBitmap | null {
  return bitmap;
}

export function initCanvas(cont: HTMLElement): void {
  container = cont;
  mainCanvas = document.getElementById('main-canvas') as HTMLCanvasElement;
  overlayCanvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;
  ctx = mainCanvas.getContext('2d')!;
  overlayCtx = overlayCanvas.getContext('2d')!;

  resizeCanvas();
  const ro = new ResizeObserver(() => { resizeCanvas(); render(); });
  ro.observe(container);

  mainCanvas.addEventListener('wheel', handleWheel, { passive: false });
  mainCanvas.addEventListener('mousedown', handleMouseDown);
  mainCanvas.addEventListener('mousemove', handleMouseMove);
  mainCanvas.addEventListener('mouseup', handleMouseUp);
  mainCanvas.addEventListener('mouseleave', handleMouseLeave);
  mainCanvas.addEventListener('contextmenu', handleContextMenu);
  mainCanvas.addEventListener('dblclick', handleDblClick);

  // Touch support
  mainCanvas.addEventListener('touchstart',  handleTouchStart,  { passive: false });
  mainCanvas.addEventListener('touchmove',   handleTouchMove,   { passive: false });
  mainCanvas.addEventListener('touchend',    handleTouchEnd,    { passive: false });
  mainCanvas.addEventListener('touchcancel', handleTouchCancel, { passive: false });

  // Delete popover buttons
  document.getElementById('delete-confirm')?.addEventListener('click', () => {
    if (deletePopoverTarget && onDeletePoint) {
      onDeletePoint(deletePopoverTarget.datasetId, deletePopoverTarget.pointId);
    }
    hideDeletePopover();
  });
  document.getElementById('delete-cancel')?.addEventListener('click', hideDeletePopover);

  subscribe(() => {
    processedImageData = null; // invalidate on any state change (filters may have changed)
    render();
  });
  render();
}

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();
  for (const c of [mainCanvas, overlayCanvas]) {
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    c.style.width = rect.width + 'px';
    c.style.height = rect.height + 'px';
  }
  ctx.scale(dpr, dpr);
  overlayCtx.scale(dpr, dpr);
}

export function render(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    renderFrame();
  });
}

function renderFrame(): void {
  const state = getState();
  const { zoom, panX, panY, imageFilters } = state.canvas;
  const w = mainCanvas.clientWidth;
  const h = mainCanvas.clientHeight;

  // Clear
  ctx.clearRect(0, 0, w, h);

  // Draw image
  if (bitmap) {
    let filterStr = `brightness(${imageFilters.brightness}%) contrast(${imageFilters.contrast}%)`;
    if (imageFilters.grayscale) filterStr += ' grayscale(1)';
    if (imageFilters.invert) filterStr += ' invert(1)';
    ctx.filter = filterStr;
    ctx.drawImage(bitmap, panX, panY, bitmap.width * zoom, bitmap.height * zoom);
    ctx.filter = 'none';
  }

  // Calibration grid overlay
  if (state.calibration.showGrid && state.calibration.isComplete && state.calibration.transform) {
    drawCalibGrid(state.calibration.transform, zoom, panX, panY, w, h, state.calibration.axisType);
  }

  // Calibration points
  drawCalibPoints(state.calibration.points, zoom, panX, panY);

  // Dataset points
  for (const ds of state.datasets) {
    if (!ds.visible) continue;
    drawDatasetPoints(ds, zoom, panX, panY, state.calibration.transform);
  }

  // Auto-trace preview overlay
  drawAutoTracePreview(zoom, panX, panY);

  // Pie chart extraction overlay
  drawPieOverlay(zoom, panX, panY);

  // Scale bar overlay
  drawScaleBarOverlay(zoom, panX, panY);

  // Perspective correction overlay
  drawPerspectiveOverlay(zoom, panX, panY);

  // Strip chart overlays
  if (getStrips().length > 0) {
    drawStripOverlays(ctx, zoom, panX, panY, mainCanvas.clientWidth, imageToCanvas);
  }

  // Measurement overlay — only draw when tool is active
  if (state.activeTool === 'measure' && isMeasureActive()) {
    drawMeasureOverlay(ctx, zoom, panX, panY, imageToCanvas);
  }

  // Overlay: crosshair
  overlayCtx.clearRect(0, 0, overlayCanvas.clientWidth, overlayCanvas.clientHeight);
  if (bitmap) {
    drawCrosshair(mouseCanvasX, mouseCanvasY, overlayCanvas.clientWidth, overlayCanvas.clientHeight);
  }

  // Update status bar
  updateStatusBar(state);
}

function drawAutoTracePreview(zoom: number, panX: number, panY: number): void {
  const mod = window.__autoTraceMod;
  if (!mod) return;
  const preview = mod.getPreviewData();
  if (!preview) return;
  const { data, width, height } = preview;
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = width; tmpCanvas.height = height;
  const tmpCtx = tmpCanvas.getContext('2d')!;
  const imgData = new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer), width, height);
  tmpCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(tmpCanvas, panX, panY, width * zoom, height * zoom);
}

function drawPieOverlay(zoom: number, panX: number, panY: number): void {
  const mod = window.__pieMod;
  if (!mod) return;
  const overlay = mod.getPieOverlay();
  if (!overlay) return;

  const { step, centerX, centerY, refX, refY, boundaries } = overlay;

  const toCanvas = (ix: number, iy: number) => imageToCanvas(ix, iy, zoom, panX, panY);

  // Center point
  if (step !== 'place-center') {
    const { canvasX: cx, canvasY: cy } = toCanvas(centerX, centerY);
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(37,99,235,0.85)';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Reference spoke
    if (step !== 'place-reference') {
      const { canvasX: rx, canvasY: ry } = toCanvas(refX, refY);
      ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(rx, ry);
      ctx.strokeStyle = 'rgba(37,99,235,0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(rx, ry, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(37,99,235,0.7)';
      ctx.fill();

      // Sector boundary spokes
      boundaries.forEach((b, i) => {
        const { canvasX: bx, canvasY: by } = toCanvas(b.x, b.y);
        ctx.beginPath();
        ctx.moveTo(cx, cy); ctx.lineTo(bx, by);
        ctx.strokeStyle = 'rgba(251,146,60,0.85)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251,146,60,0.85)';
        ctx.fill();

        ctx.font = 'bold 10px Geist Mono, monospace';
        ctx.fillStyle = '#fff';
        ctx.fillText(String(i + 1), bx + 7, by + 4);
      });
    }
  }
}

function drawScaleBarOverlay(zoom: number, panX: number, panY: number): void {
  const mod = window.__scaleBarMod;
  if (!mod) return;
  const overlay = mod.getScaleBarOverlay();
  if (!overlay) return;

  const { step, p1x, p1y, p2x, p2y, isSet, unit, pixelsPerUnit } = overlay;
  const toCanvas = (ix: number, iy: number) => imageToCanvas(ix, iy, zoom, panX, panY);

  const hasP1 = step !== 'idle' && (step === 'place-p2' || step === 'done' || isSet);
  const hasP2 = step === 'done' || isSet;

  if (hasP1) {
    const { canvasX: x1, canvasY: y1 } = toCanvas(p1x, p1y);
    ctx.beginPath();
    ctx.arc(x1, y1, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#10b981';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (hasP2) {
    const { canvasX: x1, canvasY: y1 } = toCanvas(p1x, p1y);
    const { canvasX: x2, canvasY: y2 } = toCanvas(p2x, p2y);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(x2, y2, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#10b981';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (isSet && unit && pixelsPerUnit > 0) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const label = `1 ${unit} = ${pixelsPerUnit.toFixed(1)} px`;
      ctx.font = '11px Geist Mono, monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = '#161616';
      ctx.fillRect(mx - tw / 2 - 4, my - 18, tw + 8, 18);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1;
      ctx.strokeRect(mx - tw / 2 - 4, my - 18, tw + 8, 18);
      ctx.fillStyle = '#10b981';
      ctx.fillText(label, mx - tw / 2, my - 4);
    }
  }
}

function drawPerspectiveOverlay(zoom: number, panX: number, panY: number): void {
  const mod = window.__perspectiveMod;
  if (!mod) return;
  const overlay = mod.getPerspectiveOverlay();
  if (!overlay || overlay.corners.length === 0) return;

  const { corners } = overlay;
  const toCanvas = (ix: number, iy: number) => imageToCanvas(ix, iy, zoom, panX, panY);
  const pts = corners.map(c => toCanvas(c.x, c.y));

  // Draw polygon lines between placed corners
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  pts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.canvasX, p.canvasY);
    else ctx.lineTo(p.canvasX, p.canvasY);
  });
  if (pts.length === 4) ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw corner dots with numbers
  pts.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.canvasX, p.canvasY, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#f59e0b';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = 'bold 10px Geist Mono, monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(String(i + 1), p.canvasX + 8, p.canvasY + 4);
  });
}

function drawCrosshair(x: number, y: number, w: number, h: number): void {
  overlayCtx.strokeStyle = 'rgba(37,99,235,0.35)';
  overlayCtx.lineWidth = 0.5;
  overlayCtx.setLineDash([4, 4]);
  overlayCtx.beginPath();
  overlayCtx.moveTo(0, y); overlayCtx.lineTo(w, y);
  overlayCtx.moveTo(x, 0); overlayCtx.lineTo(x, h);
  overlayCtx.stroke();
  overlayCtx.setLineDash([]);
}

function drawCalibGrid(
  t: ReturnType<typeof getState>['calibration']['transform'],
  zoom: number, panX: number, panY: number, w: number, h: number,
  axisType: string
): void {
  if (!t) return;
  ctx.strokeStyle = 'rgba(37,99,235,0.18)';
  ctx.lineWidth = 0.5;

  const { logX, logY } = isLogAxisType(axisType)
    ? getLogFlags(axisType)
    : { logX: false, logY: false };

  // Collect X grid values
  const xVals: number[] = [];
  if (logX && t.x1Data > 0 && t.x2Data > 0) {
    const logMin = Math.log10(Math.min(t.x1Data, t.x2Data));
    const logMax = Math.log10(Math.max(t.x1Data, t.x2Data));
    for (let e = Math.floor(logMin); e <= Math.ceil(logMax); e++) {
      for (const m of [1, 2, 5]) {
        const v = m * Math.pow(10, e);
        if (v >= Math.min(t.x1Data, t.x2Data) && v <= Math.max(t.x1Data, t.x2Data)) xVals.push(v);
      }
    }
  } else {
    const xInterval = niceGridInterval(Math.abs(t.x2Data - t.x1Data), 8);
    const xStart = Math.ceil(Math.min(t.x1Data, t.x2Data) / xInterval) * xInterval;
    const xEnd   = Math.floor(Math.max(t.x1Data, t.x2Data) / xInterval) * xInterval;
    for (let xv = xStart; xv <= xEnd + xInterval * 0.001; xv += xInterval) xVals.push(xv);
  }

  for (const xv of xVals) {
    const { pixelX } = logX
      ? logDataToPixel(xv, t.y1Data, t, true, false)
      : linearDataToPixel(xv, t.y1Data, t);
    const { canvasX } = imageToCanvas(pixelX, 0, zoom, panX, panY);
    if (canvasX < 0 || canvasX > w) continue;
    ctx.beginPath();
    ctx.moveTo(canvasX, 0); ctx.lineTo(canvasX, h);
    ctx.stroke();
  }

  // Collect Y grid values
  const yVals: number[] = [];
  if (logY && t.y1Data > 0 && t.y2Data > 0) {
    const logMin = Math.log10(Math.min(t.y1Data, t.y2Data));
    const logMax = Math.log10(Math.max(t.y1Data, t.y2Data));
    for (let e = Math.floor(logMin); e <= Math.ceil(logMax); e++) {
      for (const m of [1, 2, 5]) {
        const v = m * Math.pow(10, e);
        if (v >= Math.min(t.y1Data, t.y2Data) && v <= Math.max(t.y1Data, t.y2Data)) yVals.push(v);
      }
    }
  } else {
    const yInterval = niceGridInterval(Math.abs(t.y2Data - t.y1Data), 8);
    const yStart = Math.ceil(Math.min(t.y1Data, t.y2Data) / yInterval) * yInterval;
    const yEnd   = Math.floor(Math.max(t.y1Data, t.y2Data) / yInterval) * yInterval;
    for (let yv = yStart; yv <= yEnd + yInterval * 0.001; yv += yInterval) yVals.push(yv);
  }

  for (const yv of yVals) {
    const { pixelY } = logY
      ? logDataToPixel(t.x1Data, yv, t, false, true)
      : linearDataToPixel(t.x1Data, yv, t);
    const { canvasY } = imageToCanvas(0, pixelY, zoom, panX, panY);
    if (canvasY < 0 || canvasY > h) continue;
    ctx.beginPath();
    ctx.moveTo(0, canvasY); ctx.lineTo(w, canvasY);
    ctx.stroke();
  }
}

const CALIB_COLORS: Record<string, string> = {
  x1: '#2563eb', x2: '#2563eb', y1: '#d97706', y2: '#d97706',
};
const CALIB_LABELS: Record<string, string> = { x1: 'X1', x2: 'X2', y1: 'Y1', y2: 'Y2' };

function drawCalibPoints(points: CalibrationPoint[], zoom: number, panX: number, panY: number): void {
  for (const pt of points) {
    const { canvasX, canvasY } = imageToCanvas(pt.pixelX, pt.pixelY, zoom, panX, panY);
    const color = CALIB_COLORS[pt.role] ?? '#22d3ee';

    ctx.save();
    ctx.translate(canvasX, canvasY);
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = color;
    ctx.fillStyle = color + '33';
    ctx.lineWidth = 1.5;
    const s = 7;
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();

    // Label
    ctx.fillStyle = color;
    ctx.font = '11px Geist, system-ui';
    ctx.fillText(CALIB_LABELS[pt.role], canvasX + 8, canvasY - 6);

    // Value annotation if set
    if (pt.dataX !== null || pt.dataY !== null) {
      const val = pt.role === 'x1' || pt.role === 'x2'
        ? `=${pt.dataX}`
        : `=${pt.dataY}`;
      ctx.fillStyle = '#52525b';
      ctx.font = '10px Geist Mono, monospace';
      ctx.fillText(val, canvasX + 8, canvasY + 6);
    }
  }
}

function drawDatasetPoints(
  ds: Dataset, zoom: number, panX: number, panY: number,
  transform: ReturnType<typeof getState>['calibration']['transform']
): void {
  for (const pt of ds.points) {
    const { canvasX, canvasY } = imageToCanvas(pt.pixelX, pt.pixelY, zoom, panX, panY);
    const isHover = hoverPointId === pt.id;
    const r = isHover ? 7 : 5;

    ctx.beginPath();
    ctx.arc(canvasX, canvasY, r, 0, Math.PI * 2);
    ctx.fillStyle = ds.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (isHover && transform) {
      const text = `(${pt.dataX.toPrecision(5)}, ${pt.dataY.toPrecision(5)})`;
      ctx.font = '11px Geist Mono, monospace';
      const tw = ctx.measureText(text).width;
      const tx = canvasX + 10;
      const ty = canvasY - 12;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.12)';
      ctx.shadowBlur = 8;
      ctx.fillRect(tx - 4, ty - 13, tw + 8, 20);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#e4e4e7';
      ctx.lineWidth = 1;
      ctx.strokeRect(tx - 4, ty - 13, tw + 8, 20);
      ctx.fillStyle = '#09090b';
      ctx.fillText(text, tx, ty);
    }
  }
}

function updateStatusBar(state: ReturnType<typeof getState>): void {
  const xEl   = document.getElementById('st-x');
  const yEl   = document.getElementById('st-y');
  const ptsEl = document.getElementById('st-pts');
  const toolEl= document.getElementById('st-tool');
  const zoomEl= document.getElementById('st-zoom');
  const fileEl= document.getElementById('st-file');

  if (state.calibration.isComplete && state.calibration.transform) {
    let dataX: number, dataY: number;
    if (isLogAxisType(state.calibration.axisType)) {
      const { logX, logY } = getLogFlags(state.calibration.axisType);
      ({ dataX, dataY } = logPixelToData(mouseImgX, mouseImgY, state.calibration.transform, logX, logY));
    } else {
      ({ dataX, dataY } = linearPixelToData(mouseImgX, mouseImgY, state.calibration.transform));
    }
    if (xEl) xEl.textContent = dataX.toPrecision(5);
    if (yEl) yEl.textContent = dataY.toPrecision(5);
  } else {
    if (xEl) xEl.textContent = mouseImgX.toFixed(1) + 'px';
    if (yEl) yEl.textContent = mouseImgY.toFixed(1) + 'px';
  }

  if (ptsEl) {
    const active = state.datasets.find(d => d.id === state.activeDatasetId);
    ptsEl.textContent = active ? `${active.points.length} pts` : '0 pts';
  }
  if (toolEl) toolEl.textContent = state.activeTool;
  if (zoomEl) zoomEl.textContent = `${Math.round(state.canvas.zoom * 100)}%`;
  if (fileEl) fileEl.textContent = state.image.filename || '';
}

// Hit testing
function hitTestCalibPoint(canvasX: number, canvasY: number): CalibrationPoint | null {
  const { calibration, canvas } = getState();
  for (const pt of calibration.points) {
    const { canvasX: cx, canvasY: cy } = imageToCanvas(pt.pixelX, pt.pixelY, canvas.zoom, canvas.panX, canvas.panY);
    if (distance(canvasX, canvasY, cx, cy) < 10) return pt;
  }
  return null;
}

function hitTestDataPoint(canvasX: number, canvasY: number): { dataset: Dataset; point: DataPoint } | null {
  const { datasets, canvas } = getState();
  for (const ds of datasets) {
    if (!ds.visible) continue;
    for (const pt of ds.points) {
      const { canvasX: cx, canvasY: cy } = imageToCanvas(pt.pixelX, pt.pixelY, canvas.zoom, canvas.panX, canvas.panY);
      if (distance(canvasX, canvasY, cx, cy) < 8) return { dataset: ds, point: pt };
    }
  }
  return null;
}

function handleWheel(e: WheelEvent): void {
  e.preventDefault();
  const state = getState();
  const { zoom, panX, panY } = state.canvas;
  const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const newZoom = clamp(zoom * delta, 0.02, 80);

  const rect = mainCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const imgX = (mouseX - panX) / zoom;
  const imgY = (mouseY - panY) / zoom;

  setState(draft => {
    draft.canvas.zoom = newZoom;
    draft.canvas.panX = mouseX - imgX * newZoom;
    draft.canvas.panY = mouseY - imgY * newZoom;
  });
}

function getMousePos(e: MouseEvent): { x: number; y: number } {
  const rect = mainCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function handleMouseDown(e: MouseEvent): void {
  if (e.button === 1) { e.preventDefault(); return; } // Middle mouse — let move handle pan
  const { x, y } = getMousePos(e);
  const state = getState();
  const { zoom, panX, panY } = state.canvas;
  const { imgX, imgY } = canvasToImage(x, y, zoom, panX, panY);

  if (state.activeTool === 'pan' || e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true;
    panStartX = x; panStartY = y;
    panStartOffsetX = panX; panStartOffsetY = panY;
    mainCanvas.style.cursor = 'grabbing';
    return;
  }

  if (e.button === 0) {
    // Try calibration point drag first
    const calibHit = hitTestCalibPoint(x, y);
    if (calibHit && state.activeTool === 'calibrate') {
      isDraggingCalibPoint = calibHit.id;
      return;
    }

    // Try data point drag (pointer tool)
    const dataHit = hitTestDataPoint(x, y);
    if (dataHit && state.activeTool === 'pointer') {
      isDraggingPoint = dataHit.point.id;
      return;
    }

    // Tool actions
    if (state.activeTool === 'calibrate' && onCalibClick) {
      onCalibClick(imgX, imgY);
    } else if (state.activeTool === 'add-point' && onDigitizerClick) {
      onDigitizerClick(imgX, imgY);
    } else if (state.activeTool === 'measure') {
      handleMeasureClick(imgX, imgY);
    } else if (state.activeTool === 'auto-trace') {
      const hex = pickColorAtPixel(imgX, imgY);
      setAutoTraceSettings({ targetColor: hex });
      const picker = document.querySelector('input[type="color"]') as HTMLInputElement | null;
      if (picker) picker.value = hex;
      showToast(`Color picked: ${hex}`, 'info', 1500);
    } else if (state.activeTool === 'pie' && onPieClick) {
      onPieClick(imgX, imgY);
    } else if (state.activeTool === 'scale-bar' && onScaleBarClick) {
      onScaleBarClick(imgX, imgY);
    } else if (state.activeTool === 'perspective' && onPerspectiveClick) {
      onPerspectiveClick(imgX, imgY);
    }
  }
}

function handleMouseMove(e: MouseEvent): void {
  const { x, y } = getMousePos(e);
  const state = getState();
  const { zoom, panX, panY } = state.canvas;
  const { imgX, imgY } = canvasToImage(x, y, zoom, panX, panY);

  mouseCanvasX = x;
  mouseCanvasY = y;
  mouseImgX = imgX;
  mouseImgY = imgY;

  if (isPanning) {
    setState(draft => {
      draft.canvas.panX = panStartOffsetX + (x - panStartX);
      draft.canvas.panY = panStartOffsetY + (y - panStartY);
    });
    return;
  }

  if (isDraggingCalibPoint && onCalibDrag) {
    onCalibDrag(isDraggingCalibPoint, imgX, imgY);
    return;
  }

  if (isDraggingPoint) {
    setState(draft => {
      for (const ds of draft.datasets) {
        const pt = ds.points.find(p => p.id === isDraggingPoint);
        if (pt) {
          pt.pixelX = imgX; pt.pixelY = imgY;
          if (draft.calibration.transform) {
            let dataX: number, dataY: number;
            if (isLogAxisType(draft.calibration.axisType)) {
              const { logX, logY } = getLogFlags(draft.calibration.axisType);
              ({ dataX, dataY } = logPixelToData(imgX, imgY, draft.calibration.transform, logX, logY));
            } else {
              ({ dataX, dataY } = linearPixelToData(imgX, imgY, draft.calibration.transform));
            }
            pt.dataX = dataX; pt.dataY = dataY;
          }
          break;
        }
      }
    });
    return;
  }

  // Hover detection
  const hit = hitTestDataPoint(x, y);
  const newHoverId = hit?.point.id ?? null;
  if (newHoverId !== hoverPointId) {
    hoverPointId = newHoverId;
    mainCanvas.style.cursor = hoverPointId ? 'pointer' : getCursorForTool(state.activeTool);
    render();
  } else {
    render(); // crosshair update
  }
}

function handleMouseUp(_e: MouseEvent): void {
  if (isDraggingPoint && onPointDragEnd) {
    const state = getState();
    for (const ds of state.datasets) {
      const pt = ds.points.find(p => p.id === isDraggingPoint);
      if (pt) { onPointDragEnd(ds.id, pt.id, pt.pixelX, pt.pixelY); break; }
    }
  }
  isPanning = false;
  isDraggingPoint = null;
  isDraggingCalibPoint = null;
  mainCanvas.style.cursor = getCursorForTool(getState().activeTool);
}

// ── Touch handlers ────────────────────────────────────────────────────────────

function getTouchCanvasPos(touch: Touch): { x: number; y: number } {
  const rect = mainCanvas.getBoundingClientRect();
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

function handleTouchStart(e: TouchEvent): void {
  e.preventDefault();
  const state = getState();

  if (e.touches.length === 1) {
    const pos = getTouchCanvasPos(e.touches[0]);
    touchStartCanvasX = pos.x;
    touchStartCanvasY = pos.y;
    touchStartPanX = state.canvas.panX;
    touchStartPanY = state.canvas.panY;
    touchMoved = false;
    touchStartTime = Date.now();

    // Update crosshair position
    mouseCanvasX = pos.x; mouseCanvasY = pos.y;
    const { imgX, imgY } = canvasToImage(pos.x, pos.y, state.canvas.zoom, state.canvas.panX, state.canvas.panY);
    mouseImgX = imgX; mouseImgY = imgY;
    render();

  } else if (e.touches.length === 2) {
    touchMoved = true;
    const rect = mainCanvas.getBoundingClientRect();
    const t0 = e.touches[0], t1 = e.touches[1];
    const dx = t0.clientX - t1.clientX;
    const dy = t0.clientY - t1.clientY;
    pinchStartDist = Math.sqrt(dx * dx + dy * dy);
    pinchStartZoom = state.canvas.zoom;
    pinchMidCanvasX = ((t0.clientX + t1.clientX) / 2) - rect.left;
    pinchMidCanvasY = ((t0.clientY + t1.clientY) / 2) - rect.top;
    pinchStartPanX = state.canvas.panX;
    pinchStartPanY = state.canvas.panY;
    // Compute image point under pinch center — stays fixed during pinch
    const { imgX, imgY } = canvasToImage(pinchMidCanvasX, pinchMidCanvasY, state.canvas.zoom, state.canvas.panX, state.canvas.panY);
    mouseImgX = imgX; mouseImgY = imgY;
  }
}

function handleTouchMove(e: TouchEvent): void {
  e.preventDefault();

  if (e.touches.length === 1) {
    const pos = getTouchCanvasPos(e.touches[0]);
    const dx = pos.x - touchStartCanvasX;
    const dy = pos.y - touchStartCanvasY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) touchMoved = true;

    setState(draft => {
      draft.canvas.panX = touchStartPanX + dx;
      draft.canvas.panY = touchStartPanY + dy;
    });

    mouseCanvasX = pos.x; mouseCanvasY = pos.y;
    const state = getState();
    const { imgX, imgY } = canvasToImage(pos.x, pos.y, state.canvas.zoom, state.canvas.panX, state.canvas.panY);
    mouseImgX = imgX; mouseImgY = imgY;

  } else if (e.touches.length === 2) {
    const t0 = e.touches[0], t1 = e.touches[1];
    const dx = t0.clientX - t1.clientX;
    const dy = t0.clientY - t1.clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (pinchStartDist === 0) return;

    const scale = dist / pinchStartDist;
    const newZoom = clamp(pinchStartZoom * scale, 0.02, 80);
    // Keep the image point under the pinch center fixed
    const imgX = (pinchMidCanvasX - pinchStartPanX) / pinchStartZoom;
    const imgY = (pinchMidCanvasY - pinchStartPanY) / pinchStartZoom;
    setState(draft => {
      draft.canvas.zoom = newZoom;
      draft.canvas.panX = pinchMidCanvasX - imgX * newZoom;
      draft.canvas.panY = pinchMidCanvasY - imgY * newZoom;
    });
  }
}

function handleTouchEnd(e: TouchEvent): void {
  e.preventDefault();

  // All fingers lifted — check for tap
  if (e.touches.length === 0 && !touchMoved) {
    const elapsed = Date.now() - touchStartTime;
    if (elapsed < 400) {
      // Tap: fire tool action at touch start position
      const state = getState();
      const { zoom, panX, panY } = state.canvas;
      const { imgX, imgY } = canvasToImage(touchStartCanvasX, touchStartCanvasY, zoom, panX, panY);

      switch (state.activeTool) {
        case 'calibrate':
          if (onCalibClick) onCalibClick(imgX, imgY);
          break;
        case 'add-point':
          if (onDigitizerClick) onDigitizerClick(imgX, imgY);
          break;
        case 'measure':
          handleMeasureClick(imgX, imgY);
          break;
        case 'auto-trace': {
          const hex = pickColorAtPixel(imgX, imgY);
          setAutoTraceSettings({ targetColor: hex });
          const picker = document.querySelector('input[type="color"]') as HTMLInputElement | null;
          if (picker) picker.value = hex;
          showToast(`Color picked: ${hex}`, 'info', 1500);
          break;
        }
        case 'eraser': {
          const hit = hitTestDataPoint(touchStartCanvasX, touchStartCanvasY);
          if (hit && onDeletePoint) onDeletePoint(hit.dataset.id, hit.point.id);
          break;
        }
      }
    }
  }

  // Clean up drag state when last finger lifts
  if (e.touches.length === 0) {
    if (isDraggingPoint && onPointDragEnd) {
      const state = getState();
      for (const ds of state.datasets) {
        const pt = ds.points.find(p => p.id === isDraggingPoint);
        if (pt) { onPointDragEnd(ds.id, pt.id, pt.pixelX, pt.pixelY); break; }
      }
    }
    isDraggingPoint = null;
    isDraggingCalibPoint = null;
    pinchStartDist = 0;
    mouseCanvasX = -999; mouseCanvasY = -999;
    render();
  }
}

function handleTouchCancel(e: TouchEvent): void {
  e.preventDefault();
  isPanning = false;
  isDraggingPoint = null;
  isDraggingCalibPoint = null;
  pinchStartDist = 0;
  mouseCanvasX = -999; mouseCanvasY = -999;
  render();
}

function handleMouseLeave(): void {
  isPanning = false;
  mouseCanvasX = -999; mouseCanvasY = -999;
  hoverPointId = null;
  render();
}

function handleContextMenu(e: MouseEvent): void {
  e.preventDefault();
  const { x, y } = getMousePos(e);
  const hit = hitTestDataPoint(x, y);
  if (hit) {
    deletePopoverTarget = { datasetId: hit.dataset.id, pointId: hit.point.id };
    showDeletePopover(e.clientX, e.clientY);
  }
}

function handleDblClick(e: MouseEvent): void {
  // Double-click to zoom in
  const { x, y } = getMousePos(e);
  const state = getState();
  const { zoom, panX, panY } = state.canvas;
  const newZoom = clamp(zoom * 2, 0.02, 80);
  const imgX = (x - panX) / zoom;
  const imgY = (y - panY) / zoom;
  setState(draft => {
    draft.canvas.zoom = newZoom;
    draft.canvas.panX = x - imgX * newZoom;
    draft.canvas.panY = y - imgY * newZoom;
  });
}

// Single tracked outside-click handler to prevent listener accumulation
let popoverOutsideHandler: ((e: MouseEvent) => void) | null = null;

function showDeletePopover(clientX: number, clientY: number): void {
  const popover = document.getElementById('delete-popover');
  if (!popover) return;

  // Remove any previous outside-click listener
  if (popoverOutsideHandler) {
    document.removeEventListener('mousedown', popoverOutsideHandler);
    popoverOutsideHandler = null;
  }

  // Clamp position so popover stays within viewport
  const pw = 180, ph = 80;
  popover.style.left = Math.min(clientX, window.innerWidth - pw - 8) + 'px';
  popover.style.top  = Math.min(clientY, window.innerHeight - ph - 8) + 'px';
  popover.style.display = 'block';

  popoverOutsideHandler = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node)) {
      hideDeletePopover();
    }
  };
  setTimeout(() => document.addEventListener('mousedown', popoverOutsideHandler!), 0);
}

function hideDeletePopover(): void {
  const popover = document.getElementById('delete-popover');
  if (popover) popover.style.display = 'none';
  deletePopoverTarget = null;
  if (popoverOutsideHandler) {
    document.removeEventListener('mousedown', popoverOutsideHandler);
    popoverOutsideHandler = null;
  }
}

function getCursorForTool(tool: string): string {
  switch (tool) {
    case 'pan': return 'grab';
    case 'add-point': return 'crosshair';
    case 'calibrate': return 'crosshair';
    case 'eraser': return 'cell';
    default: return 'default';
  }
}

export function fitToWindow(): void {
  if (!bitmap) return;
  const rect = container.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const zoom = clamp(
    Math.min(rect.width / bitmap.width, rect.height / bitmap.height) * 0.92,
    0.02, 80
  );
  const panX = (rect.width - bitmap.width * zoom) / 2;
  const panY = (rect.height - bitmap.height * zoom) / 2;
  setState(draft => { draft.canvas.zoom = zoom; draft.canvas.panX = panX; draft.canvas.panY = panY; });
}

export function zoomBy(factor: number): void {
  const state = getState();
  const rect = container.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  const { zoom, panX, panY } = state.canvas;
  const newZoom = clamp(zoom * factor, 0.02, 80);
  const imgX = (cx - panX) / zoom;
  const imgY = (cy - panY) / zoom;
  setState(draft => {
    draft.canvas.zoom = newZoom;
    draft.canvas.panX = cx - imgX * newZoom;
    draft.canvas.panY = cy - imgY * newZoom;
  });
}

export function setActiveTool(tool: ReturnType<typeof getState>['activeTool']): void {
  setState(draft => { draft.activeTool = tool; });
  mainCanvas.style.cursor = getCursorForTool(tool);
}

export function enableSpacePan(enabled: boolean): void {
  if (enabled) {
    mainCanvas.style.cursor = 'grab';
  } else {
    mainCanvas.style.cursor = getCursorForTool(getState().activeTool);
  }
}
