import { describe, expect, it } from 'vitest';
import { pdfSafe, pdfSafeDeep } from './pdfText';

describe('pdfSafe (built-in PDF fonts only encode WinAnsi)', () => {
  it('keeps Spanish accents, ñ, °, ±, ·, en dash and plain ASCII', () => {
    const s = 'Verificación ñ 22 °C ± 0,03 · IN.5.5.3 – borrador';
    expect(pdfSafe(s)).toBe(s);
  });
  it('replaces ≤ ≥ and the minus sign', () => {
    expect(pdfSafe('x ≤ 50 y ≥ 1 −3')).toBe('x <= 50 y >= 1 -3');
  });
  it('turns m̄ / b̄ (combining macron) into "m prom." / "b prom."', () => {
    expect(pdfSafe('|m − m̄| y b̄')).toBe('|m - m prom.| y b prom.');
  });
  it('replaces arrows, Δ, subscripts and any other unsupported character', () => {
    expect(pdfSafe('SRP → 6103 Δm O₃ r² ✓')).toBe('SRP -> 6103 Delta m O3 r2 ?');
  });
  it('keeps the WinAnsi extras (€, “ ”, •, —)', () => {
    expect(pdfSafe('“a” • — €')).toBe('“a” • — €');
  });
});

describe('pdfSafeDeep', () => {
  it('sanitises every string of a nested model and keeps numbers, booleans and null', () => {
    const out = pdfSafeDeep({ a: 'x ≤ 1', b: [{ c: 'm̄' }, 2], d: true, e: null });
    expect(out).toEqual({ a: 'x <= 1', b: [{ c: 'm prom.' }, 2], d: true, e: null });
  });
});
