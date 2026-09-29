import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatIntercept,
  formatNumber,
  formatPercent,
  formatPpb,
  formatSlope,
  formatDiff,
  formatInputNumber,
} from './format';

describe('display rounding (§10) with es-CO comma decimal', () => {
  it('slope with 5 decimals', () => {
    expect(formatSlope(1.0070578)).toBe('1,00706');
  });
  it('intercept with 3 decimals', () => {
    expect(formatIntercept(0.22104)).toBe('0,221');
    expect(formatIntercept(-0.1045)).toBe('-0,105');
  });
  it('%Diff with 2 decimals', () => {
    expect(formatPercent(1.7307)).toBe('1,73');
  });
  it('ppb with 2 decimals and thousands grouping', () => {
    expect(formatPpb(15.2)).toBe('15,20');
    expect(formatPpb(1234.5)).toBe('1.234,50');
  });
  it('non-finite and null values render as a dash, never NaN', () => {
    expect(formatSlope(Number.NaN)).toBe('—');
    expect(formatPpb(null)).toBe('—');
    expect(formatNumber(undefined, 2)).toBe('—');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('—');
  });
  it('uses a real minus sign-free hyphen so values can be copied back', () => {
    expect(formatPpb(-0.1)).toBe('-0,10');
  });
});

describe('formatDiff', () => {
  it('PERCENT diff gets %, ABS diff gets ppb', () => {
    expect(formatDiff(0.456, 'PERCENT')).toBe('0,46 %');
    expect(formatDiff(-0.1, 'ABS_PPB')).toBe('-0,10 ppb');
  });
});

describe('formatDate', () => {
  it('ISO date to dd/mm/aaaa without timezone drift', () => {
    expect(formatDate('2026-01-05')).toBe('05/01/2026');
    expect(formatDate('2026-01-05T23:59:00.000Z')).toBe('05/01/2026');
  });
  it('null or garbage → dash', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('ayer')).toBe('—');
  });
});

describe('formatInputNumber', () => {
  it('writes a stored number back into an input with comma decimal and no rounding', () => {
    expect(formatInputNumber(15.25)).toBe('15,25');
    expect(formatInputNumber(0)).toBe('0');
    expect(formatInputNumber(null)).toBe('');
  });
});
