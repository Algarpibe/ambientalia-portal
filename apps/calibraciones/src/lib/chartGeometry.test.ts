import { describe, expect, it } from 'vitest';
import { chartGeometry, niceScale } from './chartGeometry';

describe('niceScale', () => {
  it('rounds the maximum up to a 1/2/5 × 10ⁿ step', () => {
    expect(niceScale(201.9)).toEqual({ max: 250, step: 50 });
    expect(niceScale(200)).toEqual({ max: 200, step: 50 });
    expect(niceScale(0.8)).toEqual({ max: 0.8, step: 0.2 });
    expect(niceScale(0.81)).toEqual({ max: 1, step: 0.2 });
    expect(niceScale(0)).toEqual({ max: 1, step: 0.2 });
  });
});

describe('chartGeometry (y vs x for the PDF, SVG coordinates)', () => {
  const series = {
    cycles: [{ index: 1, points: [{ x: 0, y: 0, residual: 0 }, { x: 100, y: 100, residual: 0 }], line: [{ x: 0, y: 0 }, { x: 100, y: 100 }] }],
    identity: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
  };
  const box = { width: 300, height: 200, padLeft: 40, padRight: 10, padTop: 10, padBottom: 30 };

  it('maps data to the plot area with y growing upwards', () => {
    const g = chartGeometry(series, box);
    expect(g.plot).toEqual({ x: 40, y: 10, width: 250, height: 160 });
    expect(g.points[0]).toMatchObject({ cycle: 1, cx: 40, cy: 170 });
    expect(g.points[1]).toMatchObject({ cx: 290, cy: 10 });
    expect(g.lines[0]).toEqual({ cycle: 1, x1: 40, y1: 170, x2: 290, y2: 10 });
    expect(g.identity).toEqual({ x1: 40, y1: 170, x2: 290, y2: 10 });
  });

  it('ticks with es-CO labels on both axes', () => {
    const g = chartGeometry(series, box);
    expect(g.xTicks.map((t) => t.label)).toEqual(['0', '20', '40', '60', '80', '100']);
    expect(g.yTicks[0]).toEqual({ pos: 170, label: '0' });
    const small = chartGeometry({ ...series, identity: [{ x: 0, y: 0 }, { x: 0.8, y: 0.8 }], cycles: [] }, box);
    expect(small.xTicks[1].label).toBe('0,2');
  });

  it('a degenerate cycle (no line) still plots its points', () => {
    const g = chartGeometry({ ...series, cycles: [{ ...series.cycles[0], line: null }] }, box);
    expect(g.lines).toEqual([]);
    expect(g.points).toHaveLength(2);
  });
});
