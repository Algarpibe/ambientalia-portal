/** UV photometry of ozone (40 CFR Part 50 Appendix D). */

import type { Limits } from './limits.js';
import { mean } from './statistics.js';

/** O3 absorption coefficient at 254 nm, 0 °C, 760 torr (atm⁻¹ cm⁻¹). 40 CFR 50 App. D. */
export const OZONE_ALPHA = 308;
/** Reference temperature exactly as written in App. D Eq. 4 (273, not 273.15). */
const T_REF_K = 273;
const P_REF_TORR = 760;

export interface PhotometerInput {
  /** Absorption coefficient; defaults to 308 atm⁻¹ cm⁻¹. */
  alpha?: number;
  /** Optical path length l (cm). */
  pathLengthCm: number;
  /** Transmittance I/I0, in (0, 1]. */
  transmittance: number;
  /** Cell temperature (K). */
  tempK: number;
  /** Cell pressure (torr). */
  pressTorr: number;
  /** L = 1 - fraction of O3 lost; in (0, 1]. Defaults to 1. */
  lossFactor?: number;
}

const positive = (name: string, v: number) => {
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${name} must be a positive number (got ${v})`);
};

/**
 * 40 CFR 50 App. D Eq. 4:
 * [O3] (ppm) = (-1/(α·l))·ln(I/I0)·(T/273)·(760/P)·(10⁶/L)
 */
export function ozoneConcentrationPpm(input: PhotometerInput): number {
  const alpha = input.alpha ?? OZONE_ALPHA;
  const lossFactor = input.lossFactor ?? 1;
  positive('alpha', alpha);
  positive('pathLengthCm', input.pathLengthCm);
  positive('tempK', input.tempK);
  positive('pressTorr', input.pressTorr);
  positive('lossFactor', lossFactor);
  if (lossFactor > 1) throw new RangeError(`lossFactor must be <= 1 (got ${lossFactor})`);
  positive('transmittance', input.transmittance);
  if (input.transmittance > 1) throw new RangeError(`transmittance I/I0 must be <= 1 (got ${input.transmittance})`);

  return (
    (-1 / (alpha * input.pathLengthCm)) *
    Math.log(input.transmittance) *
    (input.tempK / T_REF_K) *
    (P_REF_TORR / input.pressTorr) *
    (1e6 / lossFactor)
  );
}

/** 40 CFR 50 App. D §5.2.5 (D1): O3 loss <= 5 %, i.e. L >= 0.95. */
export function isOzoneLossAcceptable(lossFactor: number, limits: Pick<Limits, 'D1'>): boolean {
  return 1 - lossFactor <= limits.D1.maxLossFraction + 1e-12;
}

/** 40 CFR 50 App. D Eq. 6 dilution ratio R = F0 / (F0 + FD). */
export function dilutionRatio(f0: number, fd: number): number {
  positive('F0', f0);
  if (!Number.isFinite(fd) || fd < 0) throw new RangeError(`FD must be >= 0 (got ${fd})`);
  return f0 / (f0 + fd);
}

/** 40 CFR 50 App. D Eq. 6: [O3]' = [O3]·F0/(F0 + FD). */
export function dilute(concentration: number, f0: number, fd: number): number {
  return concentration * dilutionRatio(f0, fd);
}

/**
 * 40 CFR 50 App. D §5.2.3 linearity error: E(%) = (A1 - A2/R)/A1 × 100, with
 * R = F0/(F0 + FD). Criterion (D2): |E| < 3 %.
 */
export function linearityErrorPercent(a1: number, a2: number, f0: number, fd: number): number {
  if (!Number.isFinite(a1) || a1 === 0) throw new RangeError('A1 must be finite and non-zero');
  return ((a1 - a2 / dilutionRatio(f0, fd)) / a1) * 100;
}

export interface PrecisionResult {
  /** Sample standard deviation (n - 1) of the repeated readings, ppb. */
  sdPpb: number;
  /** max(5 ppb, 3 % of concentration). */
  limitPpb: number;
  pass: boolean;
}

/**
 * 40 CFR 50 App. D §3.1 photometer precision: SD of repeated readings
 * <= max(5 ppb, 3 % of the concentration). Uses the sample SD (n - 1), the
 * conventional repeatability estimator (see DECISIONS.md).
 */
export function photometerPrecision(
  readingsPpb: readonly number[],
  concentrationPpb: number,
  limits: Pick<Limits, 'photometerPrecision'>,
): PrecisionResult {
  if (readingsPpb.length < 2) throw new RangeError('precision needs at least 2 readings');
  const m = mean(readingsPpb);
  let s = 0;
  for (const r of readingsPpb) s += (r - m) * (r - m);
  const sdPpb = Math.sqrt(s / (readingsPpb.length - 1));
  const limitPpb = Math.max(
    limits.photometerPrecision.ppb,
    (limits.photometerPrecision.percent / 100) * Math.abs(concentrationPpb),
  );
  return { sdPpb, limitPpb, pass: sdPpb <= limitPpb };
}

export interface SensitivityResult {
  /** Relative O3 error caused by a temperature error, %. */
  tempErrorPercent: number;
  /** Relative O3 error caused by a pressure error, %. */
  pressErrorPercent: number;
}

/**
 * Informative T/P sensitivity derived from App. D Eq. 4 ([O3] ∝ T/P):
 * ΔT/T and ΔP/P. At ~298 K a 3 °C error and at 760 torr a 7.5 torr error are
 * each ≈ 1 %.
 */
export function tpSensitivity(input: {
  tempK: number;
  pressTorr: number;
  deltaTempK: number;
  deltaPressTorr: number;
}): SensitivityResult {
  positive('tempK', input.tempK);
  positive('pressTorr', input.pressTorr);
  return {
    tempErrorPercent: (Math.abs(input.deltaTempK) / input.tempK) * 100,
    pressErrorPercent: (Math.abs(input.deltaPressTorr) / input.pressTorr) * 100,
  };
}

/**
 * T/P correction calculator from App. D Eq. 4 ([O3] ∝ T/P): re-expresses a
 * concentration computed with assumed T/P at the actual T/P.
 */
export function correctForTemperaturePressure(
  concentration: number,
  tp: { tempKAssumed: number; tempKActual: number; pressTorrAssumed: number; pressTorrActual: number },
): number {
  positive('tempKAssumed', tp.tempKAssumed);
  positive('tempKActual', tp.tempKActual);
  positive('pressTorrAssumed', tp.pressTorrAssumed);
  positive('pressTorrActual', tp.pressTorrActual);
  return concentration * (tp.tempKActual / tp.tempKAssumed) * (tp.pressTorrAssumed / tp.pressTorrActual);
}
