// Pure helpers for the overdue-by-client chart; kept apart so they need no recharts.

/** Compact axis tick: $2M, $850k, $999. */
export function compactMoney(v: number): string {
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${v}`;
}

/** Pixel height for a horizontal bar chart: 44px per bar plus padding, never below 160px. */
export function chartHeight(count: number): number {
  return Math.max(160, count * 44 + 40);
}
