export interface Delta {
  delta: number;
  deltaPct: number | null;
}

export function computeDelta(a: number, b: number): Delta {
  return { delta: a - b, deltaPct: b !== 0 ? (a - b) / b : null };
}

export function formatDeltaPct(pct: number | null): string {
  if (pct === null) return "—";
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct * 100).toFixed(1)}%`;
}
