import { describe, it, expect } from 'vitest';
import {
  ruleV1,
  ruleV2,
  ruleV3,
  ruleV4,
  ruleV5,
  ruleV6,
  ruleV7,
  ruleV8,
  ruleR1,
  ruleR2,
  ruleR3,
  ruleR4,
  ruleR5,
  ruleQ1,
  ruleD1,
  ruleD2,
  ruleC1,
} from './rules.js';
import { DEFAULT_LIMITS, LIMITS_VERSION } from './limits.js';

const L = DEFAULT_LIMITS;

describe('limits table', () => {
  it('is versioned', () => {
    expect(LIMITS_VERSION).toBe('1.0.0');
    expect(L.version).toBe(LIMITS_VERSION);
  });
});

describe('TAD 2023 Table 4-1 rules', () => {
  it('every rule carries id, Spanish text and a normative reference', () => {
    const r = ruleV1(1, L);
    expect(r.id).toBe('V1');
    expect(r.textEs.length).toBeGreaterThan(5);
    expect(r.reference).toMatch(/TAD 2023/);
    expect(r.appliesTo).toBe('POINT');
    expect(r.informative).toBe(false);
  });

  it('V1: %Diff < 3.1 (strict)', () => {
    expect(ruleV1(3.09, L).pass).toBe(true);
    expect(ruleV1(3.1, L).pass).toBe(false);
  });

  it('V2: |AbsDiff| <= 1.5 by default, strict when configured', () => {
    expect(ruleV2(-1.5, L).pass).toBe(true);
    expect(ruleV2(1.51, L).pass).toBe(false);
    expect(ruleV2(1.5, { ...L, V2: { ...L.V2, inclusive: false } }).pass).toBe(false);
  });

  it('V3 / V4: slope 1 +/- 0.03 and intercept 0 +/- 3 (inclusive)', () => {
    expect(ruleV3(1.03, L).pass).toBe(true);
    expect(ruleV3(0.97, L).pass).toBe(true);
    expect(ruleV3(1.0301, L).pass).toBe(false);
    expect(ruleV4(-3, L).pass).toBe(true);
    expect(ruleV4(3.01, L).pass).toBe(false);
    expect(ruleV3(1.02, L).appliesTo).toBe('CYCLE');
  });

  it('V5 / V6: SDm < 0.0075, SDb < 1.00 (strict)', () => {
    expect(ruleV5(0.0074, L).pass).toBe(true);
    expect(ruleV5(0.0075, L).pass).toBe(false);
    expect(ruleV6(0.99, L).pass).toBe(true);
    expect(ruleV6(1.0, L).pass).toBe(false);
  });

  it('V7: exactly 3 cycles', () => {
    expect(ruleV7(3, L).pass).toBe(true);
    expect(ruleV7(2, L).pass).toBe(false);
  });

  it('V8: zero + at least 6 points', () => {
    expect(ruleV8(1, 6, L).pass).toBe(true);
    expect(ruleV8(1, 5, L).pass).toBe(false);
    expect(ruleV8(0, 7, L).pass).toBe(false);
  });

  it('R1 / R2: deviation from last verification means', () => {
    expect(ruleR1(1.024, 1.0073827, L).pass).toBe(false);
    expect(ruleR1(1.024, 1.0073827, L).value).toBeCloseTo(0.0166173, 7);
    expect(ruleR1(1.015, 1.0, L).pass).toBe(true);
    expect(ruleR2(1.7, 0.2, L).pass).toBe(true);
    expect(ruleR2(1.8, 0.2, L).pass).toBe(false);
    expect(ruleR1(1, 1, L).appliesTo).toBe('REVERIFICATION');
  });

  it('R3 / R4 slope and intercept ranges', () => {
    expect(ruleR3(1.024, L).pass).toBe(true);
    expect(ruleR3(1.04, L).pass).toBe(false);
    expect(ruleR4(0.2, L).pass).toBe(true);
    expect(ruleR4(-3.5, L).pass).toBe(false);
  });

  it('R5: internal factors identical to last verification', () => {
    expect(ruleR5({ span: 1.002, zero: 0.1 }, { zero: 0.1, span: 1.002 }).pass).toBe(true);
    expect(ruleR5({ span: 1.003, zero: 0.1 }, { span: 1.002, zero: 0.1 }).pass).toBe(false);
    expect(ruleR5({ span: 1.002 }, { span: 1.002, zero: 0.1 }).pass).toBe(false);
    expect(ruleR5(undefined, { span: 1 }).pass).toBe(false);
  });

  it('Q1 is informative: +/-4 % or +/-4 ppb, whichever is greater', () => {
    const ok = ruleQ1(200, 207.9, L); // 7.9 <= max(8, 4)
    expect(ok.pass).toBe(true);
    expect(ok.informative).toBe(true);
    expect(ruleQ1(50, 53.9, L).pass).toBe(true); // 3.9 <= max(2, 4)
    expect(ruleQ1(50, 54.5, L).pass).toBe(false);
  });

  it('D1: O3 loss <= 5 %; T7: 6 % loss fails', () => {
    expect(ruleD1(0.05, L).pass).toBe(true);
    expect(ruleD1(0.06, L).pass).toBe(false);
    expect(ruleD1(0.06, L).reference).toMatch(/40 CFR 50 App\. D/);
  });

  it('D2: |E| < 3 %', () => {
    expect(ruleD2(-2.99, L).pass).toBe(true);
    expect(ruleD2(3, L).pass).toBe(false);
  });

  it('C1: analyzer one-point check (5-80 ppb): +/-7.1 % or +/-1.5 ppb', () => {
    expect(ruleC1(60, 64, L).pass).toBe(true); // 6.67 %
    expect(ruleC1(10, 11.4, L).pass).toBe(true); // 14 % but 1.4 ppb
    expect(ruleC1(60, 65, L).pass).toBe(false); // 8.3 % and 5 ppb
    expect(ruleC1(100, 101, L).pass).toBe(false); // outside 5-80 ppb
  });
});
