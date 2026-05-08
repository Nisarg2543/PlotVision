/**
 * Chart type auto-detection via image heuristics.
 * Downsamples to 80×80 for speed, analyzes foreground pixel distribution,
 * and scores each candidate chart type.
 */

export type DetectedChartType = 'bar' | 'pie' | 'scatter' | 'line' | 'unknown';

export interface DetectionResult {
  type: DetectedChartType;
  confidence: number;   // 0–1
  reason: string;
}

const SAMPLE_SIZE = 80;

/** Downsample imageData to SAMPLE_SIZE×SAMPLE_SIZE via nearest-neighbour */
function downsample(data: Uint8ClampedArray, srcW: number, srcH: number): Uint8Array {
  const out = new Uint8Array(SAMPLE_SIZE * SAMPLE_SIZE * 3); // RGB only
  const scaleX = srcW / SAMPLE_SIZE;
  const scaleY = srcH / SAMPLE_SIZE;
  for (let y = 0; y < SAMPLE_SIZE; y++) {
    for (let x = 0; x < SAMPLE_SIZE; x++) {
      const sx = Math.floor(x * scaleX);
      const sy = Math.floor(y * scaleY);
      const si = (sy * srcW + sx) * 4;
      const di = (y * SAMPLE_SIZE + x) * 3;
      out[di]   = data[si];
      out[di+1] = data[si+1];
      out[di+2] = data[si+2];
    }
  }
  return out;
}

/** Detect background color from corners (most common near-corner pixel) */
function getBackground(px: Uint8Array): [number, number, number] {
  // Average the four 5×5 corners
  const corners: number[][] = [];
  const S = 5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const positions = [
        [x, y], [SAMPLE_SIZE - 1 - x, y],
        [x, SAMPLE_SIZE - 1 - y], [SAMPLE_SIZE - 1 - x, SAMPLE_SIZE - 1 - y],
      ];
      for (const [px_, py_] of positions) {
        const i = (py_ * SAMPLE_SIZE + px_) * 3;
        corners.push([px[i], px[i+1], px[i+2]]);
      }
    }
  }
  const r = corners.reduce((s, c) => s + c[0], 0) / corners.length;
  const g = corners.reduce((s, c) => s + c[1], 0) / corners.length;
  const b = corners.reduce((s, c) => s + c[2], 0) / corners.length;
  return [r, g, b];
}

/** Euclidean RGB distance */
function colorDist(a: [number,number,number], b: [number,number,number]): number {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
}

/** Build foreground mask: pixels that differ from background by > threshold */
function buildFgMask(px: Uint8Array, bg: [number,number,number], thresh = 40): Uint8Array {
  const mask = new Uint8Array(SAMPLE_SIZE * SAMPLE_SIZE);
  for (let i = 0; i < SAMPLE_SIZE * SAMPLE_SIZE; i++) {
    const r = px[i*3], g = px[i*3+1], b = px[i*3+2];
    mask[i] = colorDist([r, g, b], bg) > thresh ? 1 : 0;
  }
  return mask;
}

/** Count foreground pixels per column; returns fraction [0,1] per column */
function columnFgFractions(mask: Uint8Array): Float32Array {
  const fracs = new Float32Array(SAMPLE_SIZE);
  for (let x = 0; x < SAMPLE_SIZE; x++) {
    let count = 0;
    for (let y = 0; y < SAMPLE_SIZE; y++) {
      if (mask[y * SAMPLE_SIZE + x]) count++;
    }
    fracs[x] = count / SAMPLE_SIZE;
  }
  return fracs;
}

/** Check vertical contiguity: for each column, what fraction of fg pixels are in one continuous run? */
function columnContiguity(mask: Uint8Array): Float32Array {
  const scores = new Float32Array(SAMPLE_SIZE);
  for (let x = 0; x < SAMPLE_SIZE; x++) {
    let total = 0, longestRun = 0, cur = 0;
    for (let y = 0; y < SAMPLE_SIZE; y++) {
      if (mask[y * SAMPLE_SIZE + x]) {
        total++; cur++;
        if (cur > longestRun) longestRun = cur;
      } else {
        cur = 0;
      }
    }
    scores[x] = total > 0 ? longestRun / total : 0;
  }
  return scores;
}

/** Simple blob count via flood-fill on downsampled mask */
function countBlobs(mask: Uint8Array): { count: number; avgSize: number; maxSize: number } {
  const visited = new Uint8Array(SAMPLE_SIZE * SAMPLE_SIZE);
  let count = 0, totalSize = 0, maxSize = 0;

  for (let i = 0; i < SAMPLE_SIZE * SAMPLE_SIZE; i++) {
    if (mask[i] && !visited[i]) {
      // BFS flood fill
      const queue = [i];
      visited[i] = 1;
      let size = 0;
      while (queue.length > 0) {
        const idx = queue.pop()!;
        size++;
        const x = idx % SAMPLE_SIZE, y = Math.floor(idx / SAMPLE_SIZE);
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < SAMPLE_SIZE && ny >= 0 && ny < SAMPLE_SIZE) {
            const ni = ny * SAMPLE_SIZE + nx;
            if (mask[ni] && !visited[ni]) { visited[ni] = 1; queue.push(ni); }
          }
        }
      }
      count++;
      totalSize += size;
      if (size > maxSize) maxSize = size;
    }
  }
  return { count, avgSize: count > 0 ? totalSize / count : 0, maxSize };
}

/** Measure circularity: area / (π * (boundingRadius)²) */
function computeCircularity(mask: Uint8Array): number {
  let sumX = 0, sumY = 0, fgCount = 0;
  for (let y = 0; y < SAMPLE_SIZE; y++) {
    for (let x = 0; x < SAMPLE_SIZE; x++) {
      if (mask[y * SAMPLE_SIZE + x]) { sumX += x; sumY += y; fgCount++; }
    }
  }
  if (fgCount === 0) return 0;
  const cx = sumX / fgCount, cy = sumY / fgCount;
  let maxR = 0;
  for (let y = 0; y < SAMPLE_SIZE; y++) {
    for (let x = 0; x < SAMPLE_SIZE; x++) {
      if (mask[y * SAMPLE_SIZE + x]) {
        const r = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (r > maxR) maxR = r;
      }
    }
  }
  const circleArea = Math.PI * maxR * maxR;
  return circleArea > 0 ? fgCount / circleArea : 0;
}

export function detectChartType(imageData: ImageData): DetectionResult {
  const { data, width, height } = imageData;
  const px = downsample(data, width, height);
  const bg = getBackground(px);
  const mask = buildFgMask(px, bg, 35);

  const totalFg = mask.reduce((s, v) => s + v, 0);
  if (totalFg < 30) {
    return { type: 'unknown', confidence: 0.5, reason: 'Not enough foreground pixels to analyze' };
  }

  const colFracs = columnFgFractions(mask);
  const colContig = columnContiguity(mask);
  const blobs = countBlobs(mask);
  const circularity = computeCircularity(mask);

  // ── Bar chart score ─────────────────────────────────────────
  // Characteristic: multiple columns with high density & high contiguity,
  // separated by near-zero columns (gaps between bars)
  const activeCols = Array.from(colFracs).filter(f => f > 0.05).length;
  const avgContigOnActive = activeCols > 0
    ? Array.from(colContig).filter((_, i) => colFracs[i] > 0.05).reduce((s, v) => s + v, 0) / activeCols
    : 0;
  const gapCount = Array.from(colFracs).filter((f, i) => f < 0.02 && i > 5 && i < SAMPLE_SIZE - 5).length;
  const barScore = avgContigOnActive * 0.6 + Math.min(1, gapCount / 10) * 0.4;

  // ── Pie chart score ─────────────────────────────────────────
  // Characteristic: large roughly-circular foreground region with multiple colors,
  // filling ~50-80% of the image
  const fgFraction = totalFg / (SAMPLE_SIZE * SAMPLE_SIZE);
  const pieScore = circularity > 0.55
    ? circularity * Math.min(1, fgFraction / 0.4) * 0.9
    : 0;

  // ── Scatter score ───────────────────────────────────────────
  // Characteristic: many small isolated blobs
  const scatterScore = blobs.count > 8 && blobs.avgSize < 15 && blobs.maxSize < 60
    ? Math.min(1, blobs.count / 30) * 0.8 + (blobs.count > 20 ? 0.2 : 0)
    : 0;

  // ── Line chart score ────────────────────────────────────────
  // Characteristic: few blobs, thin, spans the horizontal extent
  const spansFraction = activeCols / SAMPLE_SIZE;
  const lineScore = blobs.count <= 5 && blobs.avgSize > 20 && spansFraction > 0.5
    ? spansFraction * 0.7 + (blobs.count === 1 ? 0.3 : 0.1)
    : 0;

  const scores: [DetectedChartType, number, string][] = [
    ['bar',     barScore,     `${(activeCols)} active columns, contiguity ${avgContigOnActive.toFixed(2)}`],
    ['pie',     pieScore,     `circularity ${circularity.toFixed(2)}, fg fraction ${fgFraction.toFixed(2)}`],
    ['scatter', scatterScore, `${blobs.count} blobs, avg size ${blobs.avgSize.toFixed(1)} px`],
    ['line',    lineScore,    `${blobs.count} blob(s), spans ${(spansFraction*100).toFixed(0)}% width`],
  ];

  scores.sort((a, b) => b[1] - a[1]);
  const [best] = scores;

  if (best[1] < 0.25) {
    return { type: 'unknown', confidence: best[1], reason: 'No strong chart pattern detected' };
  }
  return { type: best[0], confidence: best[1], reason: best[2] };
}

const CHART_TYPE_LABELS: Record<DetectedChartType, string> = {
  bar: 'Bar Chart',
  pie: 'Pie Chart',
  scatter: 'Scatter Plot',
  line: 'Line / Curve Chart',
  unknown: 'Unknown',
};

export function getChartTypeLabel(t: DetectedChartType): string {
  return CHART_TYPE_LABELS[t];
}
