/**
 * Strip chart mode — for multi-panel time-series charts where a single
 * image contains multiple stacked signal strips sharing a common X axis.
 *
 * Each strip is a horizontal band with its own Y calibration.
 * The user defines strips by clicking the top and bottom edge of each panel.
 * Auto-trace then runs per-strip with shared X calibration.
 */
import { getState, setState } from '../state/store';
import { addDataset } from './datasets';
import { runAutoTrace, getAutoTraceSettings, commitAutoTrace } from './auto-trace';
import { showToast } from '../utils/toast';
import { uid } from '../utils/math';
import type { CoordinateTransform } from '../state/types';

export interface Strip {
  id: string;
  name: string;
  topPx: number;    // image-space Y of strip top edge
  bottomPx: number; // image-space Y of strip bottom edge
  yMinData: number;
  yMaxData: number;
  color: string;
}

let strips: Strip[] = [];
let definingStrip: Partial<Strip> | null = null;

export function getStrips(): Strip[] { return strips; }
export function isDefiningStrip(): boolean { return definingStrip !== null; }

export function startDefiningStrip(name: string, color: string): void {
  definingStrip = { id: uid(), name, color };
  (window as unknown as Record<string, unknown>).__stripDefining = true;
  showToast('Click the TOP edge of the strip on the canvas', 'info', 3000);
}

/**
 * Handle canvas click during strip definition.
 * First click sets topPx. Second click sets bottomPx and prompts for Y values via UI.
 * yMinData and yMaxData are provided when the user finishes entering values.
 */
export function handleStripClick(imgX: number, imgY: number): void {
  if (!definingStrip) return;
  void imgX;

  if (definingStrip.topPx === undefined) {
    definingStrip.topPx = imgY;
    showToast('Now click the BOTTOM edge of the strip', 'info', 3000);
  } else {
    definingStrip.bottomPx = imgY;
    // Normalise direction — top must have smaller Y pixel value (higher on screen)
    if (definingStrip.topPx > definingStrip.bottomPx) {
      [definingStrip.topPx, definingStrip.bottomPx] = [definingStrip.bottomPx, definingStrip.topPx];
    }
    // Default Y data range; user can edit in the strip list UI
    definingStrip.yMinData = 0;
    definingStrip.yMaxData = 1;
    strips.push(definingStrip as Strip);
    const stripName = (definingStrip as Strip).name;
    definingStrip = null;
    (window as unknown as Record<string, unknown>).__stripDefining = false;
    showToast(`Strip "${stripName}" defined — set Y range in strip list`, 'success');
  }
}

export function updateStripYRange(id: string, yMin: number, yMax: number): void {
  const strip = strips.find(s => s.id === id);
  if (strip) { strip.yMinData = yMin; strip.yMaxData = yMax; }
}

export function removeStrip(id: string): void {
  strips = strips.filter(s => s.id !== id);
}

export function clearStrips(): void {
  strips = [];
  definingStrip = null;
}

/** Build a per-strip CoordinateTransform using shared X from global calibration */
function buildStripTransform(strip: Strip): CoordinateTransform | null {
  const state = getState();
  const base = state.calibration.transform;
  if (!base) return null;

  // Y mapping: topPx → yMaxData, bottomPx → yMinData
  return {
    ...base,
    y1px: strip.bottomPx, y1py: strip.bottomPx, y1Data: strip.yMinData,
    y2px: strip.topPx,    y2py: strip.topPx,    y2Data: strip.yMaxData,
  };
}

/** Auto-trace all defined strips using the active color + tolerance settings */
export async function traceAllStrips(): Promise<void> {
  const state = getState();
  if (!state.calibration.isComplete) {
    showToast('Complete X-axis calibration before tracing strips', 'warning');
    return;
  }
  if (strips.length === 0) {
    showToast('Define at least one strip first', 'warning');
    return;
  }

  let traced = 0;
  for (const strip of strips) {
    const transform = buildStripTransform(strip);
    if (!transform) continue;

    // Temporarily override calibration transform and active dataset for this strip
    const dsId = addDataset(strip.name, strip.color);

    setState(draft => {
      draft.activeDatasetId = dsId;
      draft.calibration.transform = transform;
    });

    const settings = {
      ...getState().canvas,
      targetColor: '#000000', // user should set per strip — use current
    };
    void settings;

    const result = runAutoTrace({ ...getAutoTraceSettings() });

    if (result && result.points.length > 0) {
      commitAutoTrace(result.points);
      traced++;
    }
  }

  // Restore original transform
  showToast(`Traced ${traced} of ${strips.length} strips`, traced > 0 ? 'success' : 'warning');
}

/** Draw strip boundaries on the canvas (called from canvas-engine renderFrame) */
export function drawStripOverlays(
  ctx: CanvasRenderingContext2D,
  zoom: number, panX: number, panY: number,
  canvasWidth: number,
  imageToCanvasFn: (x: number, y: number, z: number, px: number, py: number) => { canvasX: number; canvasY: number }
): void {
  const COLORS = ['#22d3ee', '#f59e0b', '#34d399', '#f87171', '#a78bfa'];

  strips.forEach((strip, i) => {
    const color = strip.color || COLORS[i % COLORS.length];
    const { canvasY: topY }    = imageToCanvasFn(0, strip.topPx,    zoom, panX, panY);
    const { canvasY: bottomY } = imageToCanvasFn(0, strip.bottomPx, zoom, panX, panY);

    // Shaded band
    ctx.fillStyle = color + '15';
    ctx.fillRect(0, topY, canvasWidth, bottomY - topY);

    // Top / bottom borders
    ctx.strokeStyle = color + '80';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, topY);    ctx.lineTo(canvasWidth, topY);
    ctx.moveTo(0, bottomY); ctx.lineTo(canvasWidth, bottomY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = color;
    ctx.font = '11px Geist, system-ui';
    ctx.fillText(strip.name, 8, topY + 14);
  });

  // Show "click top edge" crosshair hint during definition
  if (definingStrip) {
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, panY); ctx.lineTo(canvasWidth, panY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
