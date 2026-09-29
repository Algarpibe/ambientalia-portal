/** Ordinary least squares of y on x for one cycle (TAD 2023 App. A Eq. 3-5). */

export interface RegressionPoint {
  x: number;
  y: number;
  /** Marks a zero point; used when includeZero = false. Defaults to x === 0. */
  zero?: boolean;
}

export interface RegressionResult {
  slope: number;
  intercept: number;
  /** Coefficient of determination (informative). */
  r2: number;
  /** Number of points actually used in the fit. */
  n: number;
  /** Eq. 5 fitted values y-hat = b + m x, one per INPUT point (in input order). */
  fitted: number[];
  /** Residuals y - y-hat, one per INPUT point. */
  residuals: number[];
}

export class DegenerateRegressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DegenerateRegressionError';
  }
}

const isZero = (p: RegressionPoint) => (p.zero ?? p.x === 0);

/**
 * TAD 2023 App. A Eq. 3: m = Σ(x - x̄)(y - ȳ) / Σ(x - x̄)²
 * TAD 2023 App. A Eq. 4: b = ȳ - m x̄
 * TAD 2023 App. A Eq. 5: ŷ = b + m x
 * No intermediate rounding. Throws DegenerateRegressionError when fewer than
 * two points are used or all x are equal (Sxx = 0).
 */
export function leastSquares(
  points: readonly RegressionPoint[],
  options: { includeZero?: boolean } = {},
): RegressionResult {
  const includeZero = options.includeZero ?? true;
  const used = includeZero ? points : points.filter((p) => !isZero(p));
  const n = used.length;
  if (n < 2) throw new DegenerateRegressionError(`least squares needs at least 2 points (got ${n})`);

  let sx = 0;
  let sy = 0;
  for (const p of used) {
    sx += p.x;
    sy += p.y;
  }
  const xBar = sx / n;
  const yBar = sy / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of used) {
    const dx = p.x - xBar;
    const dy = p.y - yBar;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) throw new DegenerateRegressionError('all x values are equal (Sxx = 0)');

  const slope = sxy / sxx;
  const intercept = yBar - slope * xBar;

  let ssRes = 0;
  for (const p of used) {
    const r = p.y - (intercept + slope * p.x);
    ssRes += r * r;
  }
  const r2 = syy === 0 ? 1 : 1 - ssRes / syy;

  const fitted = points.map((p) => intercept + slope * p.x);
  const residuals = points.map((p, j) => p.y - fitted[j]);
  return { slope, intercept, r2, n, fitted, residuals };
}
