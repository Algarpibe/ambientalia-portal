import { describe, it, expect } from 'vitest';
import { percentDiff, absDiff, pointDifference } from './differences.js';
import { DEFAULT_CONFIG } from './limits.js';

describe('Eq. 1 / Eq. 2 point differences', () => {
  it('T2: x = 14.9, y = 14.8 -> AbsDiff = -0.1 ppb (signed y - x)', () => {
    const d = pointDifference(14.9, 14.8, DEFAULT_CONFIG);
    expect(d.type).toBe('ABS_PPB');
    expect(d.value).toBeCloseTo(-0.1, 10);
  });

  it('T2: x > 50 uses %Diff = |y - x| / x * 100', () => {
    // 0.45 % of 200 = 0.9 ppb
    const d = pointDifference(200, 200.9, DEFAULT_CONFIG);
    expect(d.type).toBe('PERCENT');
    expect(d.value).toBeCloseTo(0.45, 10);
    expect(percentDiff(200, 199.1)).toBeCloseTo(0.45, 10);
  });

  it('x exactly at the threshold (50) uses AbsDiff by default', () => {
    expect(pointDifference(50, 51, DEFAULT_CONFIG).type).toBe('ABS_PPB');
    expect(pointDifference(50.0001, 51, DEFAULT_CONFIG).type).toBe('PERCENT');
  });

  it('threshold is configurable', () => {
    const d = pointDifference(40, 41, { ...DEFAULT_CONFIG, absDiffThresholdPpb: 30 });
    expect(d.type).toBe('PERCENT');
    expect(d.value).toBeCloseTo(2.5, 10);
  });

  it('T7: x = 0 never divides by zero', () => {
    const d = pointDifference(0, 0.3, DEFAULT_CONFIG);
    expect(d.type).toBe('ABS_PPB');
    expect(d.value).toBeCloseTo(0.3, 12);
    expect(Number.isFinite(d.value)).toBe(true);
    // Even with a threshold below zero the engine must fall back to AbsDiff.
    const e = pointDifference(0, 0.3, { ...DEFAULT_CONFIG, absDiffThresholdPpb: -1 });
    expect(e.type).toBe('ABS_PPB');
    expect(() => percentDiff(0, 1)).toThrow();
  });

  it('absDiff is signed y - x', () => {
    expect(absDiff(10, 11.5)).toBeCloseTo(1.5, 12);
    expect(absDiff(10, 8.5)).toBeCloseTo(-1.5, 12);
  });
});
