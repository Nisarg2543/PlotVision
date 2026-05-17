import { describe, it, expect } from 'vitest';
import {
  logPixelToData, logDataToPixel,
  isLogAxisType, getLogFlags,
} from './axis-types';
import { linearTransform, logTransform } from '../test-fixtures/transform';

// logTransform: pixel X [100..600] → data X [1..100] (2 log decades)
//               pixel Y [400..100] → data Y [0.1..1000] (4 log decades)

describe('logPixelToData — log X', () => {
  it('maps x1px to x1Data', () => {
    const { dataX } = logPixelToData(100, 400, logTransform, true, false);
    expect(dataX).toBeCloseTo(1, 5);
  });

  it('maps x2px to x2Data', () => {
    const { dataX } = logPixelToData(600, 400, logTransform, true, false);
    expect(dataX).toBeCloseTo(100, 3);
  });

  it('maps mid-pixel to geometric mean (10)', () => {
    // mid of 1-decade log scale (1→100): log midpoint = 1, so dataX = 10
    const { dataX } = logPixelToData(350, 400, logTransform, true, false);
    expect(dataX).toBeCloseTo(10, 3);
  });
});

describe('logPixelToData — log Y', () => {
  it('maps y1py to y1Data', () => {
    const { dataY } = logPixelToData(100, 400, logTransform, false, true);
    expect(dataY).toBeCloseTo(0.1, 5);
  });

  it('maps y2py to y2Data', () => {
    const { dataY } = logPixelToData(100, 100, logTransform, false, true);
    expect(dataY).toBeCloseTo(1000, 3);
  });

  it('maps mid-pixel Y to geometric mean on 4 decades (10)', () => {
    // Y: pixel 400→0.1, pixel 100→1000 (log range -1 to 3, 4 decades)
    // mid pixel = 250 → logVal = -1 + (250-400)*4/(100-400) = -1 + (-150*4/-300) = -1+2 = 1 → 10
    const { dataY } = logPixelToData(100, 250, logTransform, false, true);
    expect(dataY).toBeCloseTo(10, 3);
  });
});

describe('logPixelToData — log XY', () => {
  it('maps corner pixel to corner data values', () => {
    const tl = logPixelToData(100, 400, logTransform, true, true);
    expect(tl.dataX).toBeCloseTo(1);
    expect(tl.dataY).toBeCloseTo(0.1);
  });

  it('falls back to linear when logX=false', () => {
    // Uses linearTransform (data X: 0..10) with logX=false
    const { dataX } = logPixelToData(350, 400, linearTransform, false, false);
    expect(dataX).toBeCloseTo(5, 4);
  });
});

describe('logDataToPixel — inverse of logPixelToData', () => {
  it('maps x1Data back to x1px', () => {
    const { pixelX } = logDataToPixel(1, 0.1, logTransform, true, true);
    expect(pixelX).toBeCloseTo(100);
  });

  it('maps x2Data back to x2px', () => {
    const { pixelX } = logDataToPixel(100, 0.1, logTransform, true, true);
    expect(pixelX).toBeCloseTo(600);
  });

  it('roundtrip: pixel → data → pixel', () => {
    const px = 320, py = 210;
    const { dataX, dataY } = logPixelToData(px, py, logTransform, true, true);
    const { pixelX, pixelY } = logDataToPixel(dataX, dataY, logTransform, true, true);
    expect(pixelX).toBeCloseTo(px, 3);
    expect(pixelY).toBeCloseTo(py, 3);
  });

  it('falls back to linear when dataX ≤ 0 on log axis', () => {
    // Should not throw; falls back to linear interpolation
    expect(() => logDataToPixel(0, 1, logTransform, true, false)).not.toThrow();
  });
});

describe('isLogAxisType', () => {
  it('returns true for xy-log-x', () => expect(isLogAxisType('xy-log-x')).toBe(true));
  it('returns true for xy-log-y', () => expect(isLogAxisType('xy-log-y')).toBe(true));
  it('returns true for xy-log-xy', () => expect(isLogAxisType('xy-log-xy')).toBe(true));
  it('returns false for xy-linear', () => expect(isLogAxisType('xy-linear')).toBe(false));
  it('returns false for polar', () => expect(isLogAxisType('polar')).toBe(false));
});

describe('getLogFlags', () => {
  it('xy-log-x: logX=true, logY=false', () => {
    expect(getLogFlags('xy-log-x')).toEqual({ logX: true, logY: false });
  });

  it('xy-log-y: logX=false, logY=true', () => {
    expect(getLogFlags('xy-log-y')).toEqual({ logX: false, logY: true });
  });

  it('xy-log-xy: both true', () => {
    expect(getLogFlags('xy-log-xy')).toEqual({ logX: true, logY: true });
  });

  it('xy-linear: both false', () => {
    expect(getLogFlags('xy-linear')).toEqual({ logX: false, logY: false });
  });
});
