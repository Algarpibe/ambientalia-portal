import { describe, it, expect } from 'vitest';
import { chartHeight, compactMoney } from './overdueByClientFormat';

describe('compactMoney', () => {
  it('abbreviates millions, thousands and small amounts', () => {
    expect(compactMoney(2_400_000)).toBe('$2M');
    expect(compactMoney(1_000_000)).toBe('$1M');
    expect(compactMoney(850_000)).toBe('$850k');
    expect(compactMoney(1_000)).toBe('$1k');
    expect(compactMoney(999)).toBe('$999');
    expect(compactMoney(0)).toBe('$0');
  });
});

describe('chartHeight', () => {
  it('grows 44px per bar with a 160px floor', () => {
    expect(chartHeight(0)).toBe(160);
    expect(chartHeight(1)).toBe(160);
    expect(chartHeight(10)).toBe(480);
  });
});
