import { describe, it, expect } from 'vitest';
import {
  fitLinear, fitExponential, fitPower, fitPolynomial,
  evaluateFit, fitEquationString, fitPoints, runFit,
} from './curve-fitting';

// y = 2x + 1 at x = 0..4
const linXs = [0, 1, 2, 3, 4];
const linYs = [1, 3, 5, 7, 9];

// y = 3·e^(0.5x) at x = 0..4
const expXs = [0, 1, 2, 3, 4];
const expYs = expXs.map(x => 3 * Math.exp(0.5 * x));

// y = 2·x^3 at x = 1..5
const powXs = [1, 2, 3, 4, 5];
const powYs = powXs.map(x => 2 * Math.pow(x, 3));

// y = x² + 2x + 1 at x = 0..4
const polyXs = [0, 1, 2, 3, 4];
const polyYs = polyXs.map(x => x * x + 2 * x + 1);

describe('fitLinear', () => {
  it('returns a fit for well-formed data', () => expect(fitLinear(linXs, linYs)).not.toBeNull());

  it('recovers slope and intercept', () => {
    const fit = fitLinear(linXs, linYs)!;
    expect(fit.params[0]).toBeCloseTo(2, 5);   // slope
    expect(fit.params[1]).toBeCloseTo(1, 5);   // intercept
  });

  it('achieves r²=1 for perfect linear data', () => {
    expect(fitLinear(linXs, linYs)!.r2).toBeCloseTo(1, 5);
  });

  it('type is linear', () => expect(fitLinear(linXs, linYs)!.type).toBe('linear'));
  it('visible defaults to true', () => expect(fitLinear(linXs, linYs)!.visible).toBe(true));
  it('returns null for fewer than 2 points', () => expect(fitLinear([1], [1])).toBeNull());
});

describe('fitExponential', () => {
  it('recovers amplitude and rate', () => {
    const fit = fitExponential(expXs, expYs)!;
    expect(fit.params[0]).toBeCloseTo(3, 3);   // a
    expect(fit.params[1]).toBeCloseTo(0.5, 3); // b
  });

  it('achieves r²≈1 for perfect exponential data', () => {
    expect(fitExponential(expXs, expYs)!.r2).toBeCloseTo(1, 4);
  });

  it('returns null when any y ≤ 0', () => {
    expect(fitExponential([0, 1, 2], [1, -1, 1])).toBeNull();
  });
});

describe('fitPower', () => {
  it('recovers coefficient and exponent', () => {
    const fit = fitPower(powXs, powYs)!;
    expect(fit.params[0]).toBeCloseTo(2, 3);   // a
    expect(fit.params[1]).toBeCloseTo(3, 3);   // b
  });

  it('achieves r²≈1 for perfect power data', () => {
    expect(fitPower(powXs, powYs)!.r2).toBeCloseTo(1, 4);
  });

  it('returns null when any x ≤ 0', () => {
    expect(fitPower([0, 1, 2], [1, 2, 4])).toBeNull();
  });

  it('returns null when any y ≤ 0', () => {
    expect(fitPower([1, 2, 3], [1, -1, 3])).toBeNull();
  });
});

describe('fitPolynomial', () => {
  it('recovers degree-2 coefficients [const, linear, quadratic]', () => {
    const fit = fitPolynomial(polyXs, polyYs, 2)!;
    expect(fit.params[0]).toBeCloseTo(1, 4); // constant
    expect(fit.params[1]).toBeCloseTo(2, 4); // linear
    expect(fit.params[2]).toBeCloseTo(1, 4); // quadratic
  });

  it('achieves r²=1 for perfect quadratic data', () => {
    expect(fitPolynomial(polyXs, polyYs, 2)!.r2).toBeCloseTo(1, 5);
  });

  it('degree stored on result', () => {
    expect(fitPolynomial(polyXs, polyYs, 2)!.degree).toBe(2);
  });

  it('recovers degree-3 polynomial', () => {
    // y = x³ - x + 1  at x=0..4 → [1, 1, 7, 25, 61]
    const xs = [0, 1, 2, 3, 4];
    const ys = xs.map(x => x ** 3 - x + 1);
    const fit = fitPolynomial(xs, ys, 3)!;
    expect(fit.params[0]).toBeCloseTo(1, 3);  // constant
    expect(fit.params[1]).toBeCloseTo(-1, 3); // linear
    expect(fit.params[2]).toBeCloseTo(0, 3);  // quadratic
    expect(fit.params[3]).toBeCloseTo(1, 3);  // cubic
  });

  it('returns null for fewer than 2 points', () => {
    expect(fitPolynomial([1], [1], 2)).toBeNull();
  });
});

describe('evaluateFit', () => {
  it('evaluates linear fit', () => {
    const fit = fitLinear(linXs, linYs)!;
    expect(evaluateFit(fit, 3)).toBeCloseTo(7, 5);
  });

  it('evaluates exponential fit', () => {
    const fit = fitExponential(expXs, expYs)!;
    expect(evaluateFit(fit, 0)).toBeCloseTo(3, 4);
  });

  it('evaluates power fit', () => {
    const fit = fitPower(powXs, powYs)!;
    expect(evaluateFit(fit, 2)).toBeCloseTo(16, 3);
  });

  it('evaluates polynomial fit', () => {
    const fit = fitPolynomial(polyXs, polyYs, 2)!;
    expect(evaluateFit(fit, 3)).toBeCloseTo(16, 4); // 1+2*3+3²=16
  });
});

describe('fitEquationString', () => {
  it('returns a non-empty string for linear', () => {
    const s = fitEquationString(fitLinear(linXs, linYs)!);
    expect(s.length).toBeGreaterThan(0);
    expect(s).toContain('y =');
  });

  it('returns a non-empty string for exponential', () => {
    expect(fitEquationString(fitExponential(expXs, expYs)!)).toContain('e^');
  });

  it('returns a non-empty string for power', () => {
    expect(fitEquationString(fitPower(powXs, powYs)!)).toContain('x^');
  });

  it('returns a non-empty string for polynomial', () => {
    expect(fitEquationString(fitPolynomial(polyXs, polyYs, 2)!)).toContain('y =');
  });
});

describe('fitPoints', () => {
  it('returns n points by default 200', () => {
    const fit = fitLinear(linXs, linYs)!;
    const pts = fitPoints(fit, 0, 4);
    expect(pts.length).toBe(200);
  });

  it('respects custom n', () => {
    const fit = fitLinear(linXs, linYs)!;
    expect(fitPoints(fit, 0, 4, 50).length).toBe(50);
  });

  it('first point is at xMin, last at xMax', () => {
    const fit = fitLinear(linXs, linYs)!;
    const pts = fitPoints(fit, 1, 3, 10);
    expect(pts[0].x).toBeCloseTo(1);
    expect(pts[pts.length - 1].x).toBeCloseTo(3);
  });
});

describe('runFit', () => {
  it('dispatches to fitLinear', () => {
    const fit = runFit(linXs, linYs, 'linear');
    expect(fit?.type).toBe('linear');
  });

  it('dispatches to fitExponential', () => {
    const fit = runFit(expXs, expYs, 'exponential');
    expect(fit?.type).toBe('exponential');
  });

  it('dispatches to fitPower', () => {
    const fit = runFit(powXs, powYs, 'power');
    expect(fit?.type).toBe('power');
  });

  it('dispatches to fitPolynomial with degree', () => {
    const fit = runFit(polyXs, polyYs, 'polynomial', 2);
    expect(fit?.type).toBe('polynomial');
    expect(fit?.degree).toBe(2);
  });
});
