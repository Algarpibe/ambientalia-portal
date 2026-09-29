import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { DEFAULT_LIMITS, type Limits, type RuleResult } from '../engine';
import {
  calcAnalyzerCheck,
  calcDilution,
  calcEq10,
  calcEq4,
  calcLinearity,
  calcOzoneLoss,
  calcTpCorrection,
  type CalcResult,
} from '../lib/calculators';
import { formatNumber, formatPercent, formatPpb } from '../lib/format';
import { formatRuleValue } from '../lib/results';
import { parseDecimal } from '../lib/parse';
import { Alert, Card, DecimalInput, Field, PassMark } from '../ui';

type Values<K extends string> = Record<K, string>;

function useFields<K extends string>(initial: Values<K>) {
  const [v, setV] = useState(initial);
  const input = (k: K, label: string, hint?: string) => {
    const n = parseDecimal(v[k]);
    return (
      <Field label={label} hint={hint}>
        <DecimalInput value={v[k]} invalid={n !== null && Number.isNaN(n)} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))} />
      </Field>
    );
  };
  return { v, input };
}

function Output<T>({ r, children }: { r: CalcResult<T>; children: (v: T) => ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm" aria-live="polite">
      {r.ok ? children(r.value) : <span className="text-gray-600">{r.error}</span>}
    </div>
  );
}

function RuleLine({ rule }: { rule: RuleResult }) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-2">
      <b>{rule.id}</b> {formatRuleValue(rule)} (límite {rule.limitText}) <PassMark pass={rule.pass} />
      <span className="text-xs text-gray-500">{rule.reference}</span>
    </p>
  );
}

const Big = ({ children }: { children: ReactNode }) => <span className="text-xl font-semibold tabular-nums text-gray-900">{children}</span>;

function Eq4() {
  const { v, input } = useFields({ alpha: '308', pathLengthCm: '', transmittance: '', tempK: '', pressTorr: '', lossPercent: '' });
  return (
    <Card title="Concentración fotométrica (App. D, Ec. 4)">
      <p className="mb-3 text-xs text-gray-500">[O₃] = (−1/(α·l))·ln(I/I0)·(T/273)·(760/P)·(10⁶/L), con L = 1 − pérdida.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {input('alpha', 'α (atm⁻¹·cm⁻¹)', 'Por defecto 308')}
        {input('pathLengthCm', 'Longitud de la celda l (cm)')}
        {input('transmittance', 'Transmitancia I/I0')}
        {input('tempK', 'Temperatura de celda (K)', '°C + 273,15')}
        {input('pressTorr', 'Presión de celda (torr)', 'Medellín ≈ 640 torr')}
        {input('lossPercent', 'Pérdida de O₃ (%)', 'Opcional')}
      </div>
      <Output r={calcEq4(v)}>
        {(o) => (
          <>
            <Big>{formatNumber(o.ppm, 5)} ppm</Big> <span className="text-gray-600">= {formatPpb(o.ppb)} ppb</span>
            <RuleLine rule={o.lossRule} />
          </>
        )}
      </Output>
    </Card>
  );
}

function Dilution() {
  const { v, input } = useFields({ concentration: '', f0: '', fd: '' });
  return (
    <Card title="Dilución (App. D, Ec. 6)">
      <p className="mb-3 text-xs text-gray-500">[O₃]′ = [O₃]·F0/(F0 + FD).</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {input('concentration', 'Concentración original')}
        {input('f0', 'Flujo de O₃ F0')}
        {input('fd', 'Flujo de dilución FD')}
      </div>
      <Output r={calcDilution(v)}>
        {(o) => (
          <>
            <Big>{formatNumber(o.diluted, 3)}</Big> <span className="text-gray-600">(misma unidad; R = {formatNumber(o.ratio, 5)})</span>
          </>
        )}
      </Output>
    </Card>
  );
}

function Linearity({ limits }: { limits: Limits }) {
  const { v, input } = useFields({ a1: '', a2: '', f0: '', fd: '' });
  return (
    <Card title="Linealidad (App. D §5.2.3)">
      <p className="mb-3 text-xs text-gray-500">E(%) = (A1 − A2/R)/A1 × 100, R = F0/(F0 + FD). Criterio D2.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {input('a1', 'A1: concentración original')}
        {input('a2', 'A2: concentración diluida')}
        {input('f0', 'Flujo F0')}
        {input('fd', 'Flujo FD')}
      </div>
      <Output r={calcLinearity(v, limits)}>
        {(o) => (
          <>
            <Big>E = {formatPercent(o.errorPercent)} %</Big> <span className="text-gray-600">(R = {formatNumber(o.ratio, 5)})</span>
            <RuleLine rule={o.rule} />
          </>
        )}
      </Output>
    </Card>
  );
}

function OzoneLoss({ limits }: { limits: Limits }) {
  const { v, input } = useFields({ lossPercent: '' });
  return (
    <Card title="Pérdida de O₃ (D1)">
      <div className="grid gap-3 sm:grid-cols-2">{input('lossPercent', 'Fracción de O₃ perdida (%)')}</div>
      <Output r={calcOzoneLoss(v, limits)}>
        {(o) => (
          <>
            <Big>L = {formatNumber(o.lossFactor, 4)}</Big>
            <RuleLine rule={o.rule} />
          </>
        )}
      </Output>
    </Card>
  );
}

function Eq10() {
  const { v, input } = useFields({ indicated: '', meanSlope: '', meanIntercept: '' });
  return (
    <Card title="Concentración patrón (TAD App. A, Ec. 10)">
      <p className="mb-3 text-xs text-gray-500">Std = (1/m̄)·(Indicado − b̄), con la m̄ y la b̄ vigentes del patrón.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {input('indicated', 'Valor indicado (ppb)')}
        {input('meanSlope', 'm̄')}
        {input('meanIntercept', 'b̄ (ppb)')}
      </div>
      <Output r={calcEq10(v)}>{(o) => <Big>{formatPpb(o.standardPpb)} ppb</Big>}</Output>
    </Card>
  );
}

function Analyzer({ limits }: { limits: Limits }) {
  const { v, input } = useFields({ referencePpb: '', analyzerPpb: '' });
  return (
    <Card title="Verificación de un punto de analizadores (C1)">
      <p className="mb-3 text-xs text-gray-500">
        Entre {formatNumber(limits.C1.minPpb, 0)} y {formatNumber(limits.C1.maxPpb, 0)} ppb: ±{formatNumber(limits.C1.percent, 1)} % o ±
        {formatNumber(limits.C1.ppb, 1)} ppb.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {input('referencePpb', 'Concentración del patrón (ppb)')}
        {input('analyzerPpb', 'Lectura del analizador (ppb)')}
      </div>
      <Output r={calcAnalyzerCheck(v, limits)}>
        {(o) => (
          <>
            <Big>Δ = {formatPpb(o.diffPpb)} ppb</Big>
            <RuleLine rule={o.rule} />
          </>
        )}
      </Output>
    </Card>
  );
}

function TpCorrection() {
  const { v, input } = useFields({ concentration: '', tempCAssumed: '25', tempCActual: '', pressTorrAssumed: '760', pressTorrActual: '640' });
  return (
    <Card title="Corrección y sensibilidad a T/P">
      <p className="mb-3 text-xs text-gray-500">
        [O₃] ∝ T/P (App. D Ec. 4). Un error de 3 °C o de 7,5 torr equivale a ≈ 1 % de O₃. En Medellín (≈ 1.500 m s. n. m.) P ≈ 640 torr.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {input('concentration', 'Concentración calculada')}
        {input('tempCAssumed', 'Temperatura supuesta (°C)')}
        {input('tempCActual', 'Temperatura real (°C)')}
        {input('pressTorrAssumed', 'Presión supuesta (torr)')}
        {input('pressTorrActual', 'Presión real (torr)')}
      </div>
      <Output r={calcTpCorrection(v)}>
        {(o) => (
          <>
            <Big>{formatNumber(o.corrected, 3)}</Big> <span className="text-gray-600">corregida (misma unidad)</span>
            <p className="mt-1 text-gray-700">
              Efecto de la temperatura: {formatPercent(o.tempErrorPercent)} % · efecto de la presión: {formatPercent(o.pressErrorPercent)} %
            </p>
          </>
        )}
      </Output>
    </Card>
  );
}

/** Standalone engine-backed calculators (§8.3). Limits come from the active set when readable. */
export default function CalculatorsSection() {
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    api
      .getLimits()
      .then((l) => setLimits(l.active.limits))
      .catch(() => setFallback(true));
  }, []);
  return (
    <div className="space-y-4">
      {fallback && <Alert tone="amber">No se pudo leer la tabla de límites activa: se usan los límites por defecto del motor.</Alert>}
      <div className="grid gap-4 xl:grid-cols-2">
        <Eq4 />
        <Eq10 />
        <Dilution />
        <Linearity limits={limits} />
        <OzoneLoss limits={limits} />
        <Analyzer limits={limits} />
        <TpCorrection />
      </div>
    </div>
  );
}
