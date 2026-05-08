/**
 * Pixel-level image filters applied to a raw ImageData buffer.
 * All operations mutate the data in-place.
 * These are applied on top of CSS filters (brightness/contrast/grayscale/invert)
 * which are handled separately in canvas-engine.
 */

/** Convert to binary black/white — pixels brighter than `level` become white, rest black. */
export function applyThreshold(data: Uint8ClampedArray, level: number): void {
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const v = gray >= level ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

/** Sharpen using a 3×3 unsharp convolution kernel [[0,-1,0],[-1,5,-1],[0,-1,0]]. */
export function applySharpen(data: Uint8ClampedArray, width: number, height: number): void {
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  const orig = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const nx = Math.min(Math.max(x + kx, 0), width - 1);
          const ny = Math.min(Math.max(y + ky, 0), height - 1);
          const ki = (ky + 1) * 3 + (kx + 1);
          const pi = (ny * width + nx) * 4;
          r += orig[pi]     * kernel[ki];
          g += orig[pi + 1] * kernel[ki];
          b += orig[pi + 2] * kernel[ki];
        }
      }
      const oi = (y * width + x) * 4;
      data[oi]     = Math.min(255, Math.max(0, r));
      data[oi + 1] = Math.min(255, Math.max(0, g));
      data[oi + 2] = Math.min(255, Math.max(0, b));
    }
  }
}

/** Stretch histogram so the darkest pixel becomes 0 and brightest becomes 255 per channel. */
export function applyAutoContrast(data: Uint8ClampedArray): void {
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]     < minR) minR = data[i];
    if (data[i]     > maxR) maxR = data[i];
    if (data[i + 1] < minG) minG = data[i + 1];
    if (data[i + 1] > maxG) maxG = data[i + 1];
    if (data[i + 2] < minB) minB = data[i + 2];
    if (data[i + 2] > maxB) maxB = data[i + 2];
  }
  const scaleR = maxR > minR ? 255 / (maxR - minR) : 1;
  const scaleG = maxG > minG ? 255 / (maxG - minG) : 1;
  const scaleB = maxB > minB ? 255 / (maxB - minB) : 1;
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = Math.round((data[i]     - minR) * scaleR);
    data[i + 1] = Math.round((data[i + 1] - minG) * scaleG);
    data[i + 2] = Math.round((data[i + 2] - minB) * scaleB);
  }
}

/** 3×3 median filter — replaces each pixel with the median of its 3×3 neighbourhood. */
export function applyDenoise(data: Uint8ClampedArray, width: number, height: number): void {
  const orig = new Uint8ClampedArray(data);
  const rs = new Array<number>(9);
  const gs = new Array<number>(9);
  const bs = new Array<number>(9);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let k = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const nx = Math.min(Math.max(x + kx, 0), width - 1);
          const ny = Math.min(Math.max(y + ky, 0), height - 1);
          const pi = (ny * width + nx) * 4;
          rs[k] = orig[pi]; gs[k] = orig[pi + 1]; bs[k] = orig[pi + 2];
          k++;
        }
      }
      rs.sort((a, b) => a - b);
      gs.sort((a, b) => a - b);
      bs.sort((a, b) => a - b);
      const oi = (y * width + x) * 4;
      data[oi]     = rs[4];
      data[oi + 1] = gs[4];
      data[oi + 2] = bs[4];
    }
  }
}
