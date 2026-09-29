/**
 * Helpers for step 4 (results): rule grouping, chart series and the
 * comparison between the live browser preview and the server's
 * authoritative result.
 */
import type { EvaluationResult, RuleResult } from '../engine';
import { DASH, formatIntercept, formatNumber, formatSlope } from './format';

const RULE_FORMAT: Record<string, [decimals: number, unit: string]> = {
  V1: [2, ' %'],
  V2: [2, ' ppb'],
  V3: [5, ''],
  R3: [5, ''],
  R1: [5, ''],
  V5: [5, ''],
  V4: [3, ' ppb'],
  R4: [3, ' ppb'],
  R2: [3, ' ppb'],
  V6: [3, ' ppb'],
  V7: [0, ''],
  V8: [0, ''],
  D1: [2, ' %'],
  D2: [2, ' %'],
  Q1: [2, ' ppb'],
  C1: [2, ' %'],
};

/** A rule's computed value with the §10 decimals of its quantity (slope 5, intercept 3, % and ppb 2). */
export function formatRuleValue(r: Pick<RuleResult, 'id' | 'value'>): string {
  const [decimals, unit] = RULE_FORMAT[r.id] ?? [2, ''];
  const text = formatNumber(r.value, decimals);
  return text === DASH ? text : `${text}${unit}`;
}

/** The V1/V2 rule of one point. */
export function pointRules(rules: readonly RuleResult[], cycleIndex: number, pointOrder: number): RuleResult | undefined {
  return rules.find((r) => r.cycleIndex === cycleIndex && r.pointOrder === pointOrder);
}

/** Every rule that is not a per-point rule (cycle, verification, App. D, Q1). */
export function summaryRules(rules: readonly RuleResult[]): RuleResult[] {
  return rules.filter((r) => r.pointOrder === undefined);
}

export interface ChartPoint {
  x: number;
  y: number;
  residual: number | null;
}

export interface CycleSeries {
  index: number;
  points: ChartPoint[];
  /** Regression line (Eq. 5) from min x to max x, or null for a degenerate cycle. */
  line: { x: number; y: number }[] | null;
}

export function chartSeries(e: EvaluationResult): { cycles: CycleSeries[]; identity: { x: number; y: number }[] } {
  let max = 0;
  const cycles = e.cycles.map((c) => {
    const points = c.points.map((p) => ({ x: p.xPpb, y: p.yPpb, residual: p.residual }));
    for (const p of points) max = Math.max(max, p.x, p.y);
    let line: CycleSeries['line'] = null;
    if (c.regression && points.length) {
      const xs = points.map((p) => p.x);
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      const { slope, intercept } = c.regression;
      line = [
        { x: lo, y: intercept + slope * lo },
        { x: hi, y: intercept + slope * hi },
      ];
    }
    return { index: c.index, points, line };
  });
  return {
    cycles,
    identity: [
      { x: 0, y: 0 },
      { x: max, y: max },
    ],
  };
}

const REL_TOL = 1e-9;
const close = (a: number, b: number) => Math.abs(a - b) <= REL_TOL * Math.max(1, Math.abs(a), Math.abs(b));

const ruleKey = (r: RuleResult) => `${r.id}|${r.cycleIndex ?? ''}|${r.pointOrder ?? ''}`;

function ruleLabel(r: RuleResult): string {
  if (r.pointOrder !== undefined) return `${r.id} (ciclo ${r.cycleIndex}, punto ${r.pointOrder})`;
  if (r.cycleIndex !== undefined) return `${r.id} (ciclo ${r.cycleIndex})`;
  return r.id;
}

/**
 * Differences (es-CO) between the live preview and the server result. Float
 * noise (relative 1e-9) is ignored. Empty list → they agree.
 */
export function compareEvaluations(live: EvaluationResult, server: EvaluationResult): string[] {
  const out: string[] = [];
  if (live.limitsVersion !== server.limitsVersion) {
    out.push(`Tabla de límites: vista previa ${live.limitsVersion}, servidor ${server.limitsVersion}.`);
  }
  if (live.overallResult !== server.overallResult) {
    out.push(`Resultado global: vista previa ${live.overallResult}, servidor ${server.overallResult}.`);
  }
  const a = live.aggregates;
  const b = server.aggregates;
  if (a && b) {
    const fields = [
      ['meanSlope', 'm̄', formatSlope],
      ['meanIntercept', 'b̄', formatIntercept],
      ['sdSlope', 'SDm', formatSlope],
      ['sdIntercept', 'SDb', formatIntercept],
    ] as const;
    for (const [k, label, fmt] of fields) {
      if (!close(a[k], b[k])) out.push(`${label}: vista previa ${fmt(a[k])}, servidor ${fmt(b[k])}.`);
    }
  } else if (!!a !== !!b) {
    out.push('Promedios: solo uno de los dos cálculos los tiene.');
  }
  const serverRules = new Map(server.rules.map((r) => [ruleKey(r), r]));
  for (const r of live.rules) {
    const s = serverRules.get(ruleKey(r));
    if (s && s.pass !== r.pass) {
      out.push(`${ruleLabel(r)}: vista previa ${r.pass ? 'cumple' : 'no cumple'}, servidor ${s.pass ? 'cumple' : 'no cumple'}.`);
    }
  }
  return out;
}
