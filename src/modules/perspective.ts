/**
 * Perspective Correction — click 4 corners of a chart in a photograph.
 * Computes a homography (projective transform) via DLT and warps the image
 * to a corrected flat rectangle. Replaces the current ImageBitmap.
 */
import { setState } from '../state/store';
import { render, getImageBitmap, setImageBitmap } from './canvas-engine';
import { showToast } from '../utils/toast';
import { showLoading, hideLoading } from '../ui/loading-overlay';

export type PerspectiveStep = 'idle' | 'placing';

interface PerspectiveState {
  step: PerspectiveStep;
  corners: { x: number; y: number }[];
}

const INITIAL: PerspectiveState = { step: 'idle', corners: [] };
let persState: PerspectiveState = { ...INITIAL };

export function getPerspectiveStep(): PerspectiveStep { return persState.step; }
export function getPerspectiveCorners(): { x: number; y: number }[] { return [...persState.corners]; }

export function startPerspective(): void {
  persState = { step: 'placing', corners: [] };
  setState(d => { d.activeTool = 'perspective'; });
}

export function resetPerspective(): void {
  persState = { ...INITIAL };
  setState(d => { d.activeTool = 'pointer'; });
}

export function undoLastCorner(): void {
  if (persState.step === 'placing' && persState.corners.length > 0) {
    persState.corners.pop();
    render();
  }
}

export function handlePerspectiveClick(imgX: number, imgY: number): void {
  if (persState.step !== 'placing') return;
  persState.corners.push({ x: imgX, y: imgY });
  if (persState.corners.length === 4) {
    applyPerspectiveWarp();
  } else {
    render();
  }
}

function applyPerspectiveWarp(): void {
  const bitmap = getImageBitmap();
  if (!bitmap) return;

  const corners = persState.corners;
  if (corners.length !== 4) return;

  showLoading('Applying perspective correction…');
  showToast('Applying perspective correction…', 'info', 2500);

  const src: [number, number][] = corners.map(c => [c.x, c.y]);

  // Destination: axis-aligned bounding box of the 4 corners
  const xs = src.map(p => p[0]);
  const ys = src.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const dstW = Math.round(maxX - minX);
  const dstH = Math.round(maxY - minY);

  if (dstW < 10 || dstH < 10) {
    showToast('Corners too close — try again', 'warning');
    persState = { ...INITIAL };
    render();
    return;
  }

  const dst: [number, number][] = [
    [0, 0], [dstW, 0], [dstW, dstH], [0, dstH],
  ];

  const H = computeHomography(src, dst);
  if (!H) {
    showToast('Perspective correction failed — degenerate corners', 'error');
    persState = { ...INITIAL };
    render();
    return;
  }

  const Hinv = invertMatrix3(H);
  if (!Hinv) {
    showToast('Perspective correction failed', 'error');
    persState = { ...INITIAL };
    render();
    return;
  }

  // Render source image to get pixel data
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = bitmap.width; srcCanvas.height = bitmap.height;
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.drawImage(bitmap, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, bitmap.width, bitmap.height).data;

  // Build corrected image via inverse warp
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = dstW; dstCanvas.height = dstH;
  const dstCtx = dstCanvas.getContext('2d')!;
  const dstImg = dstCtx.createImageData(dstW, dstH);
  const dstData = dstImg.data;

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const [sx, sy] = applyH(Hinv, x, y);
      const si = Math.round(sx);
      const sj = Math.round(sy);
      if (si >= 0 && si < bitmap.width && sj >= 0 && sj < bitmap.height) {
        const srcOff = (sj * bitmap.width + si) * 4;
        const dstOff = (y * dstW + x) * 4;
        dstData[dstOff]     = srcData[srcOff];
        dstData[dstOff + 1] = srcData[srcOff + 1];
        dstData[dstOff + 2] = srcData[srcOff + 2];
        dstData[dstOff + 3] = srcData[srcOff + 3];
      }
    }
  }

  dstCtx.putImageData(dstImg, 0, 0);

  createImageBitmap(dstCanvas).then(newBitmap => {
    hideLoading();
    setImageBitmap(newBitmap);
    setState(d => {
      d.image.width = dstW;
      d.image.height = dstH;
      d.activeTool = 'pointer';
      d.canvas.zoom = 1;
      d.canvas.panX = 0;
      d.canvas.panY = 0;
    });
    persState = { ...INITIAL };
    showToast('Perspective correction applied — recalibrate axes', 'success');
    render();
  });
}

// Compute homography H that maps src[i] → dst[i] using DLT (8-equation linear system)
function computeHomography(src: [number, number][], dst: [number, number][]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const [dx, dy] = dst[i];
    A.push([sx, sy, 1,  0,  0, 0, -dx * sx, -dx * sy]);
    A.push([ 0,  0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dx);
    b.push(dy);
  }
  const x = gaussianElimination(A, b);
  if (!x) return null;
  return [...x, 1]; // h0..h7, h8=1
}

function applyH(H: number[], x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

function gaussianElimination(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-10) return null;
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    x[row] = M[row][n];
    for (let col = row + 1; col < n; col++) x[row] -= M[row][col] * x[col];
    x[row] /= M[row][row];
  }
  return x;
}

function invertMatrix3(H: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = H;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) return null;
  return [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
}

export interface PerspectiveOverlay {
  step: PerspectiveStep;
  corners: { x: number; y: number }[];
}

export function getPerspectiveOverlay(): PerspectiveOverlay | null {
  if (persState.step === 'idle') return null;
  return { step: persState.step, corners: [...persState.corners] };
}

(window as unknown as Record<string, unknown>).__perspectiveMod = { getPerspectiveOverlay };
