/**
 * Standalone calculators (master prompt §8.3). Thin wrappers over the engine:
 * they parse the text fields (comma decimals), call the engine function and
 * turn its RangeErrors into a Spanish message. No formula lives here.
 */
import {
  DEFAULT_LIMITS,
  correctForTemperaturePressure,
  dilute,
  dilutionRatio,
  linearityErrorPercent,
  ozoneConcentrationPpm,
  ppmToPpb,
  ruleC1,
  ruleD1,
  ruleD2,
  toStandardConcentration,
  tpSensitivity,
  type Limits,
  type RuleResult,
} from '../engine';
import { parseDecimal } from './parse';

export type CalcResult<T> = { ok: true; value: T } | { ok: false; error: string };

type Fields<K extends string> = Record<K, string>;

/** Parses the fields; `required` maps each required key to its es-CO label. */
function read<K extends string>(
  f: Fields<K>,
  required: Partial<Record<K, string>>,
  optional: Partial<Record<K, string>> = {},
): { values: Record<K, number | undefined> } | { error: string } {
  const values = {} as Record<K, number | undefined>;
  const empty: string[] = [];
  for (const [k, label] of Object.entries({ ...required, ...optional }) as [K, string][]) {
    const n = parseDecimal(f[k] ?? '');
    if (n === null) {
      if (k in required) empty.push(label);
      values[k] = undefined;
      continue;
    }
    if (Number.isNaN(n)) return { error: `${label}: «${f[k]}» no es un número.` };
    values[k] = n;
  }
  if (empty.length) return { error: `Complete: ${empty.join(', ')}.` };
  return { values };
}

const ENGINE_MESSAGES: [RegExp, string][] = [
  [/transmittance/, 'La transmitancia I/I0 debe estar entre 0 y 1.'],
  [/lossFactor/, 'La pérdida de O₃ debe estar entre 0 % y 100 %.'],
  [/pathLength/, 'La longitud de la celda debe ser positiva.'],
  [/tempK|Temp/, 'La temperatura debe ser positiva (en kelvin).'],
  [/press|Press/, 'La presión debe ser positiva.'],
  [/F0/, 'El flujo F0 debe ser positivo.'],
  [/FD/, 'El flujo de dilución FD no puede ser negativo.'],
  [/A1/, 'A1 debe ser distinta de cero.'],
  [/slope/, 'La pendiente m̄ debe ser distinta de cero.'],
  [/intercept/, 'El intercepto b̄ debe ser un número.'],
];

function run<T>(fn: () => T): CalcResult<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const es = ENGINE_MESSAGES.find(([re]) => re.test(msg))?.[1];
    return { ok: false, error: es ?? 'No se pudo calcular con esos datos.' };
  }
}

/** 40 CFR 50 App. D Eq. 4 (+ D1 on the loss). */
export function calcEq4(
  f: Fields<'alpha' | 'pathLengthCm' | 'transmittance' | 'tempK' | 'pressTorr' | 'lossPercent'>,
  limits: Pick<Limits, 'D1'> = DEFAULT_LIMITS,
): CalcResult<{ ppm: number; ppb: number; lossRule: RuleResult }> {
  const r = read(
    f,
    { pathLengthCm: 'Longitud de la celda', transmittance: 'Transmitancia I/I0', tempK: 'Temperatura', pressTorr: 'Presión' },
    { alpha: 'α', lossPercent: 'Pérdida de O₃' },
  );
  if ('error' in r) return { ok: false, error: r.error };
  const v = r.values;
  const loss = (v.lossPercent ?? 0) / 100;
  return run(() => {
    const ppm = ozoneConcentrationPpm({
      ...(v.alpha !== undefined ? { alpha: v.alpha } : {}),
      pathLengthCm: v.pathLengthCm!,
      transmittance: v.transmittance!,
      tempK: v.tempK!,
      pressTorr: v.pressTorr!,
      lossFactor: 1 - loss,
    });
    return { ppm, ppb: ppmToPpb(ppm), lossRule: ruleD1(loss, limits) };
  });
}

/** 40 CFR 50 App. D Eq. 6. */
export function calcDilution(f: Fields<'concentration' | 'f0' | 'fd'>): CalcResult<{ diluted: number; ratio: number }> {
  const r = read(f, { concentration: 'Concentración', f0: 'Flujo F0', fd: 'Flujo FD' });
  if ('error' in r) return { ok: false, error: r.error };
  const { concentration, f0, fd } = r.values;
  return run(() => ({ diluted: dilute(concentration!, f0!, fd!), ratio: dilutionRatio(f0!, fd!) }));
}

/** 40 CFR 50 App. D §5.2.3 linearity + D2. */
export function calcLinearity(
  f: Fields<'a1' | 'a2' | 'f0' | 'fd'>,
  limits: Pick<Limits, 'D2'> = DEFAULT_LIMITS,
): CalcResult<{ errorPercent: number; ratio: number; rule: RuleResult }> {
  const r = read(f, { a1: 'A1', a2: 'A2', f0: 'Flujo F0', fd: 'Flujo FD' });
  if ('error' in r) return { ok: false, error: r.error };
  const { a1, a2, f0, fd } = r.values;
  return run(() => {
    const errorPercent = linearityErrorPercent(a1!, a2!, f0!, fd!);
    return { errorPercent, ratio: dilutionRatio(f0!, fd!), rule: ruleD2(errorPercent, limits) };
  });
}

/** D1: O3 loss ≤ 5 %. */
export function calcOzoneLoss(
  f: Fields<'lossPercent'>,
  limits: Pick<Limits, 'D1'> = DEFAULT_LIMITS,
): CalcResult<{ lossFactor: number; rule: RuleResult }> {
  const r = read(f, { lossPercent: 'Pérdida de O₃' });
  if ('error' in r) return { ok: false, error: r.error };
  const loss = r.values.lossPercent! / 100;
  if (loss < 0 || loss > 1) return { ok: false, error: 'La pérdida de O₃ debe estar entre 0 % y 100 %.' };
  return { ok: true, value: { lossFactor: 1 - loss, rule: ruleD1(loss, limits) } };
}

/** TAD 2023 App. A Eq. 10. */
export function calcEq10(f: Fields<'indicated' | 'meanSlope' | 'meanIntercept'>): CalcResult<{ standardPpb: number }> {
  const r = read(f, { indicated: 'Valor indicado', meanSlope: 'm̄', meanIntercept: 'b̄' });
  if ('error' in r) return { ok: false, error: r.error };
  const { indicated, meanSlope, meanIntercept } = r.values;
  return run(() => ({ standardPpb: toStandardConcentration(indicated!, meanSlope!, meanIntercept!) }));
}

/** C1: analyzer one-point check (5–80 ppb, ±7,1 % or ±1,5 ppb). */
export function calcAnalyzerCheck(
  f: Fields<'referencePpb' | 'analyzerPpb'>,
  limits: Pick<Limits, 'C1'> = DEFAULT_LIMITS,
): CalcResult<{ diffPpb: number; rule: RuleResult }> {
  const r = read(f, { referencePpb: 'Concentración del patrón', analyzerPpb: 'Lectura del analizador' });
  if ('error' in r) return { ok: false, error: r.error };
  const { referencePpb, analyzerPpb } = r.values;
  return { ok: true, value: { diffPpb: analyzerPpb! - referencePpb!, rule: ruleC1(referencePpb!, analyzerPpb!, limits) } };
}

const C_TO_K = 273.15;

/** App. D Eq. 4 ([O3] ∝ T/P): T/P correction and informative sensitivity. Temperatures in °C. */
export function calcTpCorrection(
  f: Fields<'concentration' | 'tempCAssumed' | 'tempCActual' | 'pressTorrAssumed' | 'pressTorrActual'>,
): CalcResult<{ corrected: number; tempErrorPercent: number; pressErrorPercent: number }> {
  const r = read(f, {
    concentration: 'Concentración',
    tempCAssumed: 'Temperatura supuesta',
    tempCActual: 'Temperatura real',
    pressTorrAssumed: 'Presión supuesta',
    pressTorrActual: 'Presión real',
  });
  if ('error' in r) return { ok: false, error: r.error };
  const v = r.values;
  const tA = v.tempCAssumed! + C_TO_K;
  const tR = v.tempCActual! + C_TO_K;
  return run(() => {
    const corrected = correctForTemperaturePressure(v.concentration!, {
      tempKAssumed: tA,
      tempKActual: tR,
      pressTorrAssumed: v.pressTorrAssumed!,
      pressTorrActual: v.pressTorrActual!,
    });
    const s = tpSensitivity({
      tempK: tA,
      pressTorr: v.pressTorrAssumed!,
      deltaTempK: tR - tA,
      deltaPressTorr: v.pressTorrActual! - v.pressTorrAssumed!,
    });
    return { corrected, ...s };
  });
}
