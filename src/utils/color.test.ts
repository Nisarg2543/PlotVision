import { describe, it, expect } from 'vitest';
import { hexToRgb, rgbToHex, rgbToLab, deltaE } from './color';

describe('hexToRgb', () => {
  it('converts red', () => expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 }));
  it('converts green', () => expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 255, b: 0 }));
  it('converts blue', () => expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 }));
  it('converts white', () => expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 }));
  it('converts black', () => expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 }));
  it('converts mixed color', () => expect(hexToRgb('#0080ff')).toEqual({ r: 0, g: 128, b: 255 }));
  it('works without # prefix', () => expect(hexToRgb('ff0000')).toEqual({ r: 255, g: 0, b: 0 }));
});

describe('rgbToHex', () => {
  it('converts red', () => expect(rgbToHex(255, 0, 0)).toBe('#ff0000'));
  it('converts blue', () => expect(rgbToHex(0, 0, 255)).toBe('#0000ff'));
  it('converts white', () => expect(rgbToHex(255, 255, 255)).toBe('#ffffff'));
  it('converts black', () => expect(rgbToHex(0, 0, 0)).toBe('#000000'));
  it('pads single hex digits', () => expect(rgbToHex(0, 128, 255)).toBe('#0080ff'));
});

describe('rgbToLab', () => {
  it('white has L ≈ 100', () => {
    const [L] = rgbToLab(255, 255, 255);
    expect(L).toBeCloseTo(100, 0);
  });

  it('black has L ≈ 0', () => {
    const [L] = rgbToLab(0, 0, 0);
    expect(L).toBeCloseTo(0, 0);
  });

  it('returns a 3-element tuple', () => {
    expect(rgbToLab(128, 128, 128)).toHaveLength(3);
  });

  it('gray is approximately neutral (a≈0, b≈0)', () => {
    const [, a, b] = rgbToLab(128, 128, 128);
    expect(Math.abs(a)).toBeLessThan(5);
    expect(Math.abs(b)).toBeLessThan(5);
  });
});

describe('deltaE', () => {
  it('identical colors → 0', () => {
    const lab = rgbToLab(100, 150, 200);
    expect(deltaE(lab, lab)).toBe(0);
  });

  it('black vs white → large distance', () => {
    const black = rgbToLab(0, 0, 0);
    const white = rgbToLab(255, 255, 255);
    expect(deltaE(black, white)).toBeGreaterThan(50);
  });

  it('is symmetric', () => {
    const a = rgbToLab(255, 0, 0);
    const b = rgbToLab(0, 0, 255);
    expect(deltaE(a, b)).toBeCloseTo(deltaE(b, a));
  });

  it('similar colors → small distance', () => {
    const c1 = rgbToLab(100, 100, 100);
    const c2 = rgbToLab(105, 105, 105);
    expect(deltaE(c1, c2)).toBeLessThan(5);
  });
});
