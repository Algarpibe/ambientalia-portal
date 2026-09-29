import { describe, it, expect } from 'vitest';
import { mean, populationSd, cycleStats } from './statistics.js';
import { ruleV5, ruleV6 } from './rules.js';
import { DEFAULT_LIMITS } from './limits.js';

describe('Eq. 6-9 means and population SD', () => {
  it('T1: TAD App. A example', () => {
    const s = cycleStats([
      { slope: 1.0053, intercept: -0.1518 },
      { slope: 1.0091, intercept: -0.2136 },
      { slope: 1.0058, intercept: 0.0511 },
    ]);
    expect(s.meanSlope).toBeCloseTo(1.006733, 6);
    expect(s.meanIntercept).toBeCloseTo(-0.104767, 6);
    expect(s.sdSlope).toBeCloseTo(0.0016859, 7);
    expect(s.sdIntercept).toBeCloseTo(0.1130652, 7);
    expect(ruleV5(s.sdSlope, DEFAULT_LIMITS).pass).toBe(true);
    expect(ruleV6(s.sdIntercept, DEFAULT_LIMITS).pass).toBe(true);
  });

  it('SD divides by n, not n - 1', () => {
    // values 1, 3: population SD = 1, sample SD would be sqrt(2)
    expect(populationSd([1, 3])).toBeCloseTo(1, 12);
    expect(populationSd([5])).toBe(0);
    expect(mean([1, 2, 3, 4])).toBeCloseTo(2.5, 12);
  });

  it('empty input throws', () => {
    expect(() => mean([])).toThrow();
    expect(() => cycleStats([])).toThrow();
  });
});
