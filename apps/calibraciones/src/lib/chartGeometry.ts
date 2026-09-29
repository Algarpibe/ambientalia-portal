/**
 * Geometry of the y-vs-x chart drawn as SVG in the PDF report (react-pdf has
 * no chart library): points, regression lines (Eq. 5), the 1:1 line and axis
 * ticks, already in SVG coordinates. Both axes share one scale from 0.
 */
import type { CycleSeries } from './results';
import { formatNumber } from './format';

export function niceScale(max: number, ticks = 5): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 0.2 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = Number((nice * mag).toPrecision(12));
  return { max: Number((Math.ceil(max / step - 1e-9) * step).toPrecision(12)), step };
}

export interface ChartBox {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ChartGeometry {
  plot: { x: number; y: number; width: number; height: number };
  points: { cycle: number; cx: number; cy: number }[];
  lines: (Segment & { cycle: number })[];
  identity: Segment;
  xTicks: { pos: number; label: string }[];
  yTicks: { pos: number; label: string }[];
}

const tickLabel = (v: number, step: number) => formatNumber(v, step < 1 ? Math.min(3, Math.ceil(-Math.log10(step))) : 0).replace(/\./g, '');

export function chartGeometry(series: { cycles: CycleSeries[]; identity: { x: number; y: number }[] }, box: ChartBox): ChartGeometry {
  let max = 0;
  for (const p of series.identity) max = Math.max(max, p.x, p.y);
  for (const c of series.cycles) for (const p of c.points) max = Math.max(max, p.x, p.y);
  const scale = niceScale(max);
  const plot = { x: box.padLeft, y: box.padTop, width: box.width - box.padLeft - box.padRight, height: box.height - box.padTop - box.padBottom };
  const sx = (x: number) => plot.x + (x / scale.max) * plot.width;
  const sy = (y: number) => plot.y + plot.height - (y / scale.max) * plot.height;

  const ticks: number[] = [];
  for (let i = 0; i * scale.step <= scale.max + 1e-9; i++) ticks.push(Number((i * scale.step).toPrecision(12)));

  return {
    plot,
    points: series.cycles.flatMap((c) => c.points.map((p) => ({ cycle: c.index, cx: sx(p.x), cy: sy(p.y) }))),
    lines: series.cycles.flatMap((c) =>
      c.line ? [{ cycle: c.index, x1: sx(c.line[0].x), y1: sy(c.line[0].y), x2: sx(c.line[1].x), y2: sy(c.line[1].y) }] : [],
    ),
    identity: { x1: sx(0), y1: sy(0), x2: sx(max), y2: sy(max) },
    xTicks: ticks.map((t) => ({ pos: sx(t), label: tickLabel(t, scale.step) })),
    yTicks: ticks.map((t) => ({ pos: sy(t), label: tickLabel(t, scale.step) })),
  };
}
