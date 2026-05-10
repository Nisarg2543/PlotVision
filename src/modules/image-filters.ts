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

/**
 * Grid removal — detects near-horizontal and near-vertical lines (grid lines)
 * by checking if >85% of a row/column pixels share the same brightness,
 * then replaces them with local neighbour averages.
 */
export function applyGridRemoval(data: Uint8ClampedArray, width: number, height: number, uniformThresh = 18): void {
  const orig = new Uint8ClampedArray(data);

  const isHGrid = new Uint8Array(height);
  for (let y = 0; y < height; y++) {
    let baseR = orig[y * width * 4], baseG = orig[y * width * 4 + 1], baseB = orig[y * width * 4 + 2];
    let same = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.abs(orig[i]-baseR) <= uniformThresh && Math.abs(orig[i+1]-baseG) <= uniformThresh && Math.abs(orig[i+2]-baseB) <= uniformThresh) {
        same++;
      } else { baseR = orig[i]; baseG = orig[i+1]; baseB = orig[i+2]; }
    }
    if (same / width > 0.85) isHGrid[y] = 1;
  }

  const isVGrid = new Uint8Array(width);
  for (let x = 0; x < width; x++) {
    let baseR = orig[x * 4], baseG = orig[x * 4 + 1], baseB = orig[x * 4 + 2];
    let same = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      if (Math.abs(orig[i]-baseR) <= uniformThresh && Math.abs(orig[i+1]-baseG) <= uniformThresh && Math.abs(orig[i+2]-baseB) <= uniformThresh) {
        same++;
      } else { baseR = orig[i]; baseG = orig[i+1]; baseB = orig[i+2]; }
    }
    if (same / height > 0.85) isVGrid[x] = 1;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isHGrid[y] && !isVGrid[x]) continue;
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let ny = y - 1; ny >= Math.max(0, y - 5); ny--) {
        if (!isHGrid[ny]) { const ni=(ny*width+x)*4; r+=orig[ni]; g+=orig[ni+1]; b+=orig[ni+2]; cnt++; break; }
      }
      for (let ny = y + 1; ny <= Math.min(height-1, y+5); ny++) {
        if (!isHGrid[ny]) { const ni=(ny*width+x)*4; r+=orig[ni]; g+=orig[ni+1]; b+=orig[ni+2]; cnt++; break; }
      }
      if (cnt > 0) { const i=(y*width+x)*4; data[i]=r/cnt; data[i+1]=g/cnt; data[i+2]=b/cnt; }
    }
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
