/**
 * Pie chart extraction — click-based angle digitizer.
 * User places: center → reference direction → sector boundaries (clockwise).
 * Outputs one DataPoint per sector: dataX=angleDeg, dataY=computed value, label=sector name.
 */
import { getState, setState } from '../state/store';
import { uid } from '../utils/math';
import { pushHistory } from './history';
import { showToast } from '../utils/toast';
import { render } from './canvas-engine';

export type PieStep = 'idle' | 'place-center' | 'place-reference' | 'place-sectors';

interface PieInternalState {
  step: PieStep;
  centerX: number;
  centerY: number;
  refX: number;
  refY: number;
  boundaries: { x: number; y: number }[];
  totalValue: number;
}

const INITIAL: PieInternalState = {
  step: 'idle',
  centerX: 0, centerY: 0,
  refX: 0, refY: 0,
  boundaries: [],
  totalValue: 100,
};

let pieState: PieInternalState = { ...INITIAL, boundaries: [] };

export function getPieStep(): PieStep { return pieState.step; }
export function getPieBoundaryCount(): number { return pieState.boundaries.length; }
export function getPieTotalValue(): number { return pieState.totalValue; }

export function startPie(totalValue: number): void {
  pieState = { ...INITIAL, boundaries: [], totalValue, step: 'place-center' };
  setState(draft => { draft.activeTool = 'pie'; });
}

export function resetPie(): void {
  pieState = { ...INITIAL, boundaries: [] };
  setState(draft => { draft.activeTool = 'pointer'; });
}

export function setPieTotalValue(v: number): void {
  pieState.totalValue = v;
}

export function handlePieClick(imgX: number, imgY: number): void {
  switch (pieState.step) {
    case 'place-center':
      pieState.centerX = imgX;
      pieState.centerY = imgY;
      pieState.step = 'place-reference';
      break;
    case 'place-reference':
      pieState.refX = imgX;
      pieState.refY = imgY;
      pieState.step = 'place-sectors';
      break;
    case 'place-sectors':
      pieState.boundaries.push({ x: imgX, y: imgY });
      break;
  }
  render();
}

export function undoLastBoundary(): void {
  if (pieState.step === 'place-sectors' && pieState.boundaries.length > 0) {
    pieState.boundaries.pop();
    render();
  }
}

export interface PieSector {
  label: string;
  angleDeg: number;
  value: number;
  startAngleDeg: number; // clockwise from reference, for preview
}

export function computeSectors(): PieSector[] {
  const { centerX: cx, centerY: cy, refX: rx, refY: ry, boundaries, totalValue } = pieState;
  if (boundaries.length < 1) return [];

  const refRaw = Math.atan2(ry - cy, rx - cx);

  // All edge angles clockwise from reference: [0, cw(b0), cw(b1), ...]
  const edgeCW = boundaries.map(b => {
    const a = Math.atan2(b.y - cy, b.x - cx);
    return ((a - refRaw) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  });

  const sectors: PieSector[] = [];
  for (let i = 0; i < edgeCW.length; i++) {
    const startCW = i === 0 ? 0 : edgeCW[i - 1];
    const endCW   = edgeCW[i];
    const arc = ((endCW - startCW) + Math.PI * 2) % (Math.PI * 2);
    const angleDeg = arc * 180 / Math.PI;
    sectors.push({
      label: `Sector ${i + 1}`,
      angleDeg,
      value: (arc / (Math.PI * 2)) * totalValue,
      startAngleDeg: startCW * 180 / Math.PI,
    });
  }
  // Last sector: from final boundary back to reference (closing the circle)
  const lastStart = edgeCW[edgeCW.length - 1];
  const lastArc = ((Math.PI * 2) - lastStart + Math.PI * 2) % (Math.PI * 2) || Math.PI * 2;
  sectors.push({
    label: `Sector ${edgeCW.length + 1}`,
    angleDeg: lastArc * 180 / Math.PI,
    value: (lastArc / (Math.PI * 2)) * totalValue,
    startAngleDeg: lastStart * 180 / Math.PI,
  });
  return sectors;
}

export function commitPieSectors(): void {
  const sectors = computeSectors();
  if (sectors.length === 0) {
    showToast('Click at least one sector boundary first', 'warning');
    return;
  }

  const state = getState();
  if (!state.activeDatasetId) {
    showToast('No active dataset', 'warning');
    return;
  }

  const { centerX, centerY, boundaries } = pieState;

  pushHistory('Pie chart extraction');
  setState(draft => {
    const ds = draft.datasets.find(d => d.id === draft.activeDatasetId);
    if (!ds) return;
    sectors.forEach((s, i) => {
      // pixelX/Y stored at boundary point (or center for last sector)
      const px = i < boundaries.length ? boundaries[i].x : centerX;
      const py = i < boundaries.length ? boundaries[i].y : centerY;
      ds.points.push({
        id: uid(),
        pixelX: px, pixelY: py,
        dataX: parseFloat(s.angleDeg.toFixed(4)),
        dataY: parseFloat(s.value.toFixed(6)),
        label: s.label,
      });
    });
    draft.activeTool = 'pointer';
  });

  pieState = { ...INITIAL, boundaries: [] };
  showToast(`Added ${sectors.length} pie sectors`, 'success');
}

// ── Canvas overlay bridge ──────────────────────────────────────

export interface PieOverlay {
  step: PieStep;
  centerX: number; centerY: number;
  refX: number; refY: number;
  boundaries: { x: number; y: number }[];
}

export function getPieOverlay(): PieOverlay | null {
  if (pieState.step === 'idle') return null;
  return {
    step: pieState.step,
    centerX: pieState.centerX, centerY: pieState.centerY,
    refX: pieState.refX, refY: pieState.refY,
    boundaries: [...pieState.boundaries],
  };
}

// Register bridge so canvas-engine can read overlay without importing this module
(window as unknown as Record<string, unknown>).__pieMod = { getPieOverlay };
