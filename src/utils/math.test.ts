import { describe, it, expect } from 'vitest';
import {
  clamp, distance, canvasToImage, imageToCanvas,
  linearPixelToData, linearDataToPixel, isTransformValid, niceGridInterval,
} from './math';
import { linearTransform } from '../test-fixtures/transform';

describe('clamp', () => {
  it('returns value when within range', () => expect(clamp(5, 0, 10)).toBe(5));
  it('clamps to min', () => expect(clamp(-3, 0, 10)).toBe(0));
  it('clamps to max', () => expect(clamp(15, 0, 10)).toBe(10));
  it('accepts value equal to min', () => expect(clamp(0, 0, 10)).toBe(0));
  it('accepts value equal to max', () => expect(clamp(10, 0, 10)).toBe(10));
});

describe('distance', () => {
  it('returns 0 for same point', () => expect(distance(3, 4, 3, 4)).toBe(0));
  it('returns horizontal distance', () => expect(distance(0, 0, 5, 0)).toBe(5));
  it('returns vertical distance', () => expect(distance(0, 0, 0, 7)).toBe(7));
  it('3-4-5 right triangle', () => expect(distance(0, 0, 3, 4)).toBe(5));
  it('is symmetric', () => expect(distance(1, 2, 4, 6)).toBeCloseTo(distance(4, 6, 1, 2)));
});

describe('canvasToImage / imageToCanvas', () => {
  it('identity at zoom=1, pan=0', () => {
    const result = canvasToImage(100, 200, 1, 0, 0);
    expect(result.imgX).toBe(100);
    expect(result.imgY).toBe(200);
  });

  it('2× zoom maps canvas center to image half', () => {
    const result = canvasToImage(200, 400, 2, 0, 0);
    expect(result.imgX).toBe(100);
    expect(result.imgY).toBe(200);
  });

  it('pan offset shifts result', () => {
    const result = canvasToImage(150, 130, 1, 50, 30);
    expect(result.imgX).toBe(100);
    expect(result.imgY).toBe(100);
  });

  it('imageToCanvas is inverse of canvasToImage', () => {
    const zoom = 1.5, panX = 30, panY = -10;
    const { imgX, imgY } = canvasToImage(120, 80, zoom, panX, panY);
    const { canvasX, canvasY } = imageToCanvas(imgX, imgY, zoom, panX, panY);
    expect(canvasX).toBeCloseTo(120);
    expect(canvasY).toBeCloseTo(80);
  });

  it('imageToCanvas 2× zoom', () => {
    const result = imageToCanvas(100, 200, 2, 0, 0);
    expect(result.canvasX).toBe(200);
    expect(result.canvasY).toBe(400);
  });
});

describe('linearPixelToData', () => {
  it('maps x1px to x1Data', () => {
    const { dataX } = linearPixelToData(100, 400, linearTransform);
    expect(dataX).toBeCloseTo(0);
  });

  it('maps x2px to x2Data', () => {
    const { dataX } = linearPixelToData(600, 400, linearTransform);
    expect(dataX).toBeCloseTo(10);
  });

  it('maps midpoint pixel X to midpoint data X', () => {
    const { dataX } = linearPixelToData(350, 400, linearTransform);
    expect(dataX).toBeCloseTo(5);
  });

  it('maps y1py to y1Data', () => {
    const { dataY } = linearPixelToData(100, 400, linearTransform);
    expect(dataY).toBeCloseTo(0);
  });

  it('maps y2py to y2Data', () => {
    const { dataY } = linearPixelToData(100, 100, linearTransform);
    expect(dataY).toBeCloseTo(10);
  });

  it('maps midpoint pixel Y to midpoint data Y', () => {
    const { dataY } = linearPixelToData(100, 250, linearTransform);
    expect(dataY).toBeCloseTo(5);
  });
});

describe('linearDataToPixel', () => {
  it('maps x1Data to x1px', () => {
    const { pixelX } = linearDataToPixel(0, 0, linearTransform);
    expect(pixelX).toBeCloseTo(100);
  });

  it('maps x2Data to x2px', () => {
    const { pixelX } = linearDataToPixel(10, 0, linearTransform);
    expect(pixelX).toBeCloseTo(600);
  });

  it('is inverse of linearPixelToData', () => {
    const px = 275, py = 180;
    const { dataX, dataY } = linearPixelToData(px, py, linearTransform);
    const { pixelX, pixelY } = linearDataToPixel(dataX, dataY, linearTransform);
    expect(pixelX).toBeCloseTo(px);
    expect(pixelY).toBeCloseTo(py);
  });
});

describe('isTransformValid', () => {
  it('returns true for a valid transform', () => {
    expect(isTransformValid(linearTransform)).toBe(true);
  });

  it('returns false when x1px === x2px', () => {
    const t = { ...linearTransform, x2px: 100 };
    expect(isTransformValid(t)).toBe(false);
  });

  it('returns false when y1py === y2py', () => {
    const t = { ...linearTransform, y2py: 400 };
    expect(isTransformValid(t)).toBe(false);
  });

  it('returns false when x1Data === x2Data', () => {
    const t = { ...linearTransform, x2Data: 0 };
    expect(isTransformValid(t)).toBe(false);
  });

  it('returns false when y1Data === y2Data', () => {
    const t = { ...linearTransform, y2Data: 0 };
    expect(isTransformValid(t)).toBe(false);
  });
});

describe('niceGridInterval', () => {
  it('range=100, 10 lines → 10', () => expect(niceGridInterval(100, 10)).toBe(10));
  it('range=100, 5 lines → 20', () => expect(niceGridInterval(100, 5)).toBe(20));
  it('range=1000, 10 lines → 100', () => expect(niceGridInterval(1000, 10)).toBe(100));
  it('range=50, 5 lines → 10', () => expect(niceGridInterval(50, 5)).toBe(10));
  it('range=1, 10 lines → 0.1', () => expect(niceGridInterval(1, 10)).toBeCloseTo(0.1));
  it('always returns a positive number', () => expect(niceGridInterval(7, 5)).toBeGreaterThan(0));
});
