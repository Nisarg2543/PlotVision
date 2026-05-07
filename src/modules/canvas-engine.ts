import { getState, setState, subscribe } from '../state/store';
import { canvasToImage, imageToCanvas, clamp, linearDataToPixel, linearPixelToData, niceGridInterval, distance } from '../utils/math';
import { showToast } from '../utils/toast';
import { drawMeasureOverlay, handleMeasureClick, isMeasureActive } from './measure';
import { drawStripOverlays, getStrips } from './strip-chart';
import { pickColorAtPixel, setAutoTraceSettings } from './auto-trace';
import type { Dataset, DataPoint, CalibrationPoint } from '../state/types';

// ImageBitmap stored here — cannot be structuredCloned
let bitmap: ImageBitmap | null = null;

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

export function setCanvasCallbacks(cbs: {
  onCalibClick?: (x: number, y: number) => void;
  onDigitizerClick?: (x: number, y: number) => void;
  onCalibDrag?: (id: string, x: number, y: number) => void;
  onPointDragEnd?: (datasetId: string, pointId: string, x: number, y: number) => void;
  onDeletePoint?: (datasetId: string, pointId: string) => void;
}): void {
  if (cbs.onCalibClick) onCalibClick = cbs.onCalibClick;
  if (cbs.onDigitizerClick) onDigitizerClick = cbs.onDigitizerClick;
  if (cbs.onCalibDrag) onCalibDrag = cbs.onCalibDrag;
  if (cbs.onPointDragEnd) onPointDragEnd = cbs.onPointDragEnd;
  if (cbs.onDeletePoint) onDeletePoint = cbs.onDeletePoint;
}

export function setImageBitmap(bmp: ImageBitmap): void {
  bitmap = bmp;
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

  // Delete popover buttons
  document.getElementById('delete-confirm')?.addEventListener('click', () => {
    if (deletePopoverTarget && onDeletePoint) {
      onDeletePoint(deletePopoverTarget.datasetId, deletePopoverTarget.pointId);
    }
    hideDeletePopover();
  });
  document.getElementById('delete-cancel')?.addEventListener('click', hideDeletePopover);

  subscribe(() => render());
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
    drawCalibGrid(state.calibration.transform, zoom, panX, panY, w, h);
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
  // Lazy import to avoid circular dependency at module load time
  // getPreviewData is only defined after auto-trace module loads
  const mod = (window as any).__autoTraceMod;
  if (!mod) return;
  const preview = mod.getPreviewData();
  if (!preview) return;
  const { data, width, height } = preview;
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = width; tmpCanvas.height = height;
  const tmpCtx = tmpCanvas.getContext('2d')!;
  const imgData = new ImageData(data, width, height);
  tmpCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(tmpCanvas, panX, panY, width * zoom, height * zoom);
}

function drawCrosshair(x: number, y: number, w: number, h: number): void {
  overlayCtx.strokeStyle = 'rgba(34,211,238,0.4)';
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
  zoom: number, panX: number, panY: number, w: number, h: number
): void {
  if (!t) return;
  ctx.strokeStyle = 'rgba(34,211,238,0.15)';
  ctx.lineWidth = 0.5;

  const xRange = Math.abs(t.x2Data - t.x1Data);
  const yRange = Math.abs(t.y2Data - t.y1Data);
  const xInterval = niceGridInterval(xRange, 8);
  const yInterval = niceGridInterval(yRange, 8);

  const xStart = Math.ceil(Math.min(t.x1Data, t.x2Data) / xInterval) * xInterval;
  const xEnd = Math.floor(Math.max(t.x1Data, t.x2Data) / xInterval) * xInterval;
  for (let xv = xStart; xv <= xEnd + xInterval * 0.001; xv += xInterval) {
    const { pixelX } = linearDataToPixel(xv, t.y1Data, t);
    const { canvasX } = imageToCanvas(pixelX, 0, zoom, panX, panY);
    if (canvasX < 0 || canvasX > w) continue;
    ctx.beginPath();
    ctx.moveTo(canvasX, 0); ctx.lineTo(canvasX, h);
    ctx.stroke();
  }

  const yStart = Math.ceil(Math.min(t.y1Data, t.y2Data) / yInterval) * yInterval;
  const yEnd = Math.floor(Math.max(t.y1Data, t.y2Data) / yInterval) * yInterval;
  for (let yv = yStart; yv <= yEnd + yInterval * 0.001; yv += yInterval) {
    const { pixelY } = linearDataToPixel(t.x1Data, yv, t);
    const { canvasY } = imageToCanvas(0, pixelY, zoom, panX, panY);
    if (canvasY < 0 || canvasY > h) continue;
    ctx.beginPath();
    ctx.moveTo(0, canvasY); ctx.lineTo(w, canvasY);
    ctx.stroke();
  }
}

const CALIB_COLORS: Record<string, string> = {
  x1: '#22d3ee', x2: '#22d3ee', y1: '#f59e0b', y2: '#f59e0b',
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
      ctx.fillStyle = '#71717a';
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
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (isHover && transform) {
      // Tooltip
      const text = `(${pt.dataX.toPrecision(5)}, ${pt.dataY.toPrecision(5)})`;
      const tw = ctx.measureText(text).width;
      const tx = canvasX + 10;
      const ty = canvasY - 12;
      ctx.fillStyle = '#161616';
      ctx.fillRect(tx - 3, ty - 12, tw + 6, 18);
      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 1;
      ctx.strokeRect(tx - 3, ty - 12, tw + 6, 18);
      ctx.fillStyle = '#e5e5e5';
      ctx.font = '11px Geist Mono, monospace';
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
    const { dataX, dataY } = linearPixelToData(mouseImgX, mouseImgY, state.calibration.transform);
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
            const { dataX, dataY } = linearPixelToData(imgX, imgY, draft.calibration.transform);
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

function showDeletePopover(clientX: number, clientY: number): void {
  const popover = document.getElementById('delete-popover')!;
  popover.style.left = clientX + 'px';
  popover.style.top = clientY + 'px';
  popover.classList.remove('hidden');

  // Auto-hide on outside click
  const handler = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node)) {
      hideDeletePopover();
      document.removeEventListener('mousedown', handler);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', handler), 0);
}

function hideDeletePopover(): void {
  document.getElementById('delete-popover')?.classList.add('hidden');
  deletePopoverTarget = null;
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
  const zoom = Math.min(rect.width / bitmap.width, rect.height / bitmap.height) * 0.92;
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
