import type { CurveFit, FitType } from '../state/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function computeR2(ys: number[], predicted: number[]): number {
  const yBar = mean(ys);
  const SStot = ys.reduce((s, y) => s + (y - yBar) ** 2, 0);
  if (SStot === 0) return 1;
  const SSres = ys.reduce((s, y, i) => s + (y - predicted[i]) ** 2, 0);
  return Math.max(0, 1 - SSres / SStot);
}

// Gaussian elimination for square system Ax = b (in-place)
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Augmented matrix
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return null;
    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
    }
  }
  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

// Simple linear regression — returns {a (slope), b (intercept)}
function linearRegression(xs: number[], ys: number[]): { a: number; b: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const sx = xs.reduce((s, v) => s + v, 0);
  const sy = ys.reduce((s, v) => s + v, 0);
  const sxy = xs.reduce((s, v, i) => s + v * ys[i], 0);
  const sxx = xs.reduce((s, v) => s + v * v, 0);
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const a = (n * sxy - sx * sy) / denom;
  const b = (sy - a * sx) / n;
  return { a, b };
}

// ── Fit functions ─────────────────────────────────────────────────────────────

export function fitLinear(xs: number[], ys: number[]): CurveFit | null {
  const reg = linearRegression(xs, ys);
  if (!reg) return null;
  const predicted = xs.map(x => reg.a * x + reg.b);
  return { type: 'linear', params: [reg.a, reg.b], r2: computeR2(ys, predicted), visible: true };
}

export function fitExponential(xs: number[], ys: number[]): CurveFit | null {
  if (ys.some(y => y <= 0)) return null;
  const lnYs = ys.map(y => Math.log(y));
  const reg = linearRegression(xs, lnYs);
  if (!reg) return null;
  const a = Math.exp(reg.b);
  const b = reg.a;
  const predicted = xs.map(x => a * Math.exp(b * x));
  return { type: 'exponential', params: [a, b], r2: computeR2(ys, predicted), visible: true };
}

export function fitPower(xs: number[], ys: number[]): CurveFit | null {
  if (xs.some(x => x <= 0) || ys.some(y => y <= 0)) return null;
  const lnXs = xs.map(x => Math.log(x));
  const lnYs = ys.map(y => Math.log(y));
  const reg = linearRegression(lnXs, lnYs);
  if (!reg) return null;
  const a = Math.exp(reg.b);
  const b = reg.a;
  const predicted = xs.map(x => a * Math.pow(x, b));
  return { type: 'power', params: [a, b], r2: computeR2(ys, predicted), visible: true };
}

export function fitPolynomial(xs: number[], ys: number[], degree: number): CurveFit | null {
  const n = xs.length;
  const d = Math.min(degree, n - 1);
  if (d < 1 || n < 2) return null;

  // Normal equations: A^T A c = A^T y, where A[i][j] = xs[i]^j
  const size = d + 1;
  const ATA = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const ATy = new Array<number>(size).fill(0);

  for (let i = 0; i < n; i++) {
    const xpow = new Array<number>(size);
    xpow[0] = 1;
    for (let j = 1; j < size; j++) xpow[j] = xpow[j - 1] * xs[i];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) ATA[r][c] += xpow[r] * xpow[c];
      ATy[r] += xpow[r] * ys[i];
    }
  }

  const coeffs = solveLinearSystem(ATA, ATy);
  if (!coeffs) return null;

  const predicted = xs.map(x => {
    let y = 0, xp = 1;
    for (const c of coeffs) { y += c * xp; xp *= x; }
    return y;
  });

  return { type: 'polynomial', degree: d, params: coeffs, r2: computeR2(ys, predicted), visible: true };
}

export function evaluateFit(fit: CurveFit, x: number): number {
  const [a, b] = fit.params;
  switch (fit.type) {
    case 'linear':      return a * x + b;
    case 'exponential': return a * Math.exp(b * x);
    case 'power':       return a * Math.pow(Math.max(x, 1e-300), b);
    case 'polynomial': {
      let y = 0, xp = 1;
      for (const c of fit.params) { y += c * xp; xp *= x; }
      return y;
    }
  }
}

export function fitEquationString(fit: CurveFit, precision = 4): string {
  const fmt = (v: number) => v.toPrecision(precision);
  const [a, b] = fit.params;
  switch (fit.type) {
    case 'linear':      return `y = ${fmt(a)}x + ${fmt(b)}`;
    case 'exponential': return `y = ${fmt(a)} · e^(${fmt(b)}x)`;
    case 'power':       return `y = ${fmt(a)} · x^${fmt(b)}`;
    case 'polynomial': {
      return 'y = ' + fit.params
        .map((c, i) => i === 0 ? fmt(c) : `${fmt(c)}x${i > 1 ? '^' + i : ''}`)
        .reverse().join(' + ');
    }
  }
}

export function fitPoints(fit: CurveFit, xMin: number, xMax: number, n = 200): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const x = xMin + (i / (n - 1)) * (xMax - xMin);
    const y = evaluateFit(fit, x);
    if (isFinite(y)) pts.push({ x, y });
  }
  return pts;
}

export function runFit(xs: number[], ys: number[], type: FitType, degree?: number): CurveFit | null {
  switch (type) {
    case 'linear':      return fitLinear(xs, ys);
    case 'exponential': return fitExponential(xs, ys);
    case 'power':       return fitPower(xs, ys);
    case 'polynomial':  return fitPolynomial(xs, ys, degree ?? 2);
  }
}
