/**
 * Web Worker for heavy pixel-processing operations.
 * Receives pixel data + settings, returns traced points + preview overlay.
 * Runs off the main thread to keep the UI responsive.
 */

// ── Color utilities (duplicated from src/utils/color.ts — no imports in workers) ──

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let rn = r / 255, gn = g / 255, bn = b / 255;
  rn = rn > 0.04045 ? Math.pow((rn + 0.055) / 1.055, 2.4) : rn / 12.92;
  gn = gn > 0.04045 ? Math.pow((gn + 0.055) / 1.055, 2.4) : gn / 12.92;
  bn = bn > 0.04045 ? Math.pow((bn + 0.055) / 1.055, 2.4) : bn / 12.92;
  let x = (rn * 0.4124 + gn * 0.3576 + bn * 0.1805) / 0.95047;
  let y = (rn * 0.2126 + gn * 0.7152 + bn * 0.0722) / 1.00000;
  let z = (rn * 0.0193 + gn * 0.1192 + bn * 0.9505) / 1.08883;
  x = x > 0.008856 ? Math.pow(x, 1/3) : 7.787 * x + 16/116;
  y = y > 0.008856 ? Math.pow(y, 1/3) : 7.787 * y + 16/116;
  z = z > 0.008856 ? Math.pow(z, 1/3) : 7.787 * z + 16/116;
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE(a: [number,number,number], b: [number,number,number]): number {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
}

// ── Color mask builder ──

function buildColorMask(
  pixels: Uint8ClampedArray, W: number, H: number,
  targetHex: string, tolerance: number,
  bgHex: string | null, bgTolerance: number,
  roi?: { x1: number; y1: number; x2: number; y2: number } | null
): Uint8Array {
  const { r: tr, g: tg, b: tb } = hexToRgb(targetHex);
  const targetLab = rgbToLab(tr, tg, tb);
  const threshold = tolerance * 0.5;
  let bgLab: [number,number,number] | null = null;
  let bgThresh = 0;
  if (bgHex) {
    const { r: br, g: bg, b: bb } = hexToRgb(bgHex);
    bgLab = rgbToLab(br, bg, bb);
    bgThresh = bgTolerance * 0.5;
  }
  const rx1 = roi ? Math.round(Math.min(roi.x1, roi.x2)) : 0;
  const ry1 = roi ? Math.round(Math.min(roi.y1, roi.y2)) : 0;
  const rx2 = roi ? Math.round(Math.max(roi.x1, roi.x2)) : W - 1;
  const ry2 = roi ? Math.round(Math.max(roi.y1, roi.y2)) : H - 1;
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (roi && (x < rx1 || x > rx2 || y < ry1 || y > ry2)) continue;
      const i = y * W + x;
      const lab = rgbToLab(pixels[i*4], pixels[i*4+1], pixels[i*4+2]);
      if (bgLab && deltaE(bgLab, lab) < bgThresh) continue;
      if (deltaE(targetLab, lab) < threshold) mask[i] = 1;
    }
  }
  return mask;
}

// ── Column-median trace ──

function runColumnMedianTrace(
  pixels: Uint8ClampedArray, W: number, H: number,
  settings: {
    targetColor: string; tolerance: number; bgColor: string | null;
    bgTolerance: number; samplingInterval: number; smoothing: string;
    roi?: { x1: number; y1: number; x2: number; y2: number } | null;
  }
): { columnYs: (number | null)[]; preview: Uint8ClampedArray } {
  const mask = buildColorMask(pixels, W, H, settings.targetColor, settings.tolerance,
    settings.bgColor, settings.bgTolerance, settings.roi);

  const columnYs: (number | null)[] = new Array(W).fill(null);
  for (let x = 0; x < W; x++) {
    const fgYs: number[] = [];
    for (let y = 0; y < H; y++) {
      if (mask[y * W + x]) fgYs.push(y);
    }
    if (fgYs.length > 0) {
      fgYs.sort((a, b) => a - b);
      columnYs[x] = fgYs[Math.floor(fgYs.length / 2)];
    }
  }

  // Smooth
  const smoothed = smoothCurve(columnYs, settings.smoothing);

  const preview = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    if (mask[i]) { preview[i*4]=37; preview[i*4+1]=99; preview[i*4+2]=235; preview[i*4+3]=160; }
  }
  for (let x = 0; x < W; x++) {
    const y = smoothed[x];
    if (y !== null) {
      const yi = Math.round(y);
      for (let dy = -1; dy <= 1; dy++) {
        const py = yi + dy;
        if (py >= 0 && py < H) {
          const i = py * W + x;
          preview[i*4]=255; preview[i*4+1]=255; preview[i*4+2]=255; preview[i*4+3]=220;
        }
      }
    }
  }

  return { columnYs: smoothed, preview };
}

function smoothCurve(ys: (number | null)[], mode: string): (number | null)[] {
  if (mode === 'none') return ys;
  const win = mode === 'light' ? 5 : 15;
  const result: (number | null)[] = new Array(ys.length).fill(null);
  const half = Math.floor(win / 2);
  for (let x = 0; x < ys.length; x++) {
    const vals: number[] = [];
    for (let dx = -half; dx <= half; dx++) {
      const nx = x + dx;
      if (nx >= 0 && nx < ys.length && ys[nx] !== null) vals.push(ys[nx]!);
    }
    result[x] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return result;
}

// ── Message handler ──

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data as {
    type: 'trace';
    payload: {
      pixels: Uint8ClampedArray;
      W: number; H: number;
      settings: Parameters<typeof runColumnMedianTrace>[3];
    };
  };

  if (type === 'trace') {
    const { pixels, W, H, settings } = payload;
    const result = runColumnMedianTrace(pixels, W, H, settings);
    // Transfer the preview buffer back (zero-copy)
    self.postMessage({ type: 'trace-result', ...result }, { transfer: [result.preview.buffer] });
  }
};
