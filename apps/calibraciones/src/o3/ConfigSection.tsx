import { useEffect, useState } from 'react';
import { api } from '../api';
import type { EngineConfig, Limits } from '../engine';
import { can } from '../lib/domain';
import { formatDate, formatInputNumber } from '../lib/format';
import { parseDecimal } from '../lib/parse';
import type { LimitsResponse, Me } from '../types';
import { Alert, Button, Card, Checkbox, DecimalInput, Field, Loading, TableWrap, TD, TextInput, TH } from '../ui';

const RULE_LABEL: Record<string, string> = {
  V1: 'V1 · %Diff por punto',
  V2: 'V2 · |AbsDiff| por punto',
  V3: 'V3 · Pendiente por ciclo',
  V4: 'V4 · Intercepto por ciclo',
  V5: 'V5 · SD de pendientes',
  V6: 'V6 · SD de interceptos',
  V7: 'V7 · Número de ciclos',
  V8: 'V8 · Puntos por ciclo',
  R1: 'R1 · |m − m̄| reverificación',
  R2: 'R2 · |b − b̄| reverificación',
  R3: 'R3 · Pendiente reverificación',
  R4: 'R4 · Intercepto reverificación',
  Q1: 'Q1 · Repetibilidad (informativo)',
  D1: 'D1 · Pérdida de O₃',
  D2: 'D2 · Error de linealidad',
  C1: 'C1 · Un punto de analizadores',
  photometerPrecision: 'Precisión del fotómetro (App. D §3.1)',
};

const FIELD_LABEL: Record<string, string> = {
  maxPercent: 'Máximo (%)',
  maxAbsPpb: 'Máximo (ppb)',
  inclusive: 'Límite inclusivo (≤)',
  nominal: 'Nominal',
  tolerance: 'Tolerancia',
  tolerancePpb: 'Tolerancia (ppb)',
  max: 'Máximo',
  maxPpb: 'Máximo (ppb)',
  requiredCycles: 'Ciclos requeridos',
  minZeroPoints: 'Mínimo de ceros',
  minNonZeroPoints: 'Mínimo de puntos no cero',
  percent: 'Porcentaje (%)',
  ppb: 'ppb',
  maxLossFraction: 'Pérdida máxima (fracción 0–1)',
  minPpb: 'Mínimo (ppb)',
};

type RuleKey = Exclude<keyof Limits, 'version'>;

function LimitsEditor({ data, canWrite, onSaved }: { data: LimitsResponse; canWrite: boolean; onSaved: () => void }) {
  const active = data.active.limits;
  const keys = Object.keys(active).filter((k) => k !== 'version') as RuleKey[];
  const initialText = () =>
    Object.fromEntries(
      keys.flatMap((k) =>
        Object.entries(active[k] as Record<string, number | boolean>).map(([f, v]) => [`${k}.${f}`, typeof v === 'boolean' ? String(v) : formatInputNumber(v)]),
      ),
    ) as Record<string, string>;
  const [text, setText] = useState(initialText);
  const [version, setVersion] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function save() {
    setError(null);
    setOk(null);
    const next: Record<string, unknown> = { version: version.trim() };
    for (const k of keys) {
      const rule: Record<string, number | boolean> = {};
      for (const [f, v] of Object.entries(active[k] as Record<string, number | boolean>)) {
        const t = text[`${k}.${f}`];
        if (typeof v === 'boolean') rule[f] = t === 'true';
        else {
          const n = parseDecimal(t);
          if (n === null || Number.isNaN(n)) {
            setError(`${RULE_LABEL[k] ?? k}, ${FIELD_LABEL[f] ?? f}: debe ser un número.`);
            return;
          }
          rule[f] = n;
        }
      }
      next[k] = rule;
    }
    setBusy(true);
    try {
      await api.putLimits(version.trim(), next as unknown as Limits, reason.trim());
      setOk(`Tabla de límites ${version.trim()} activada.`);
      setVersion('');
      setReason('');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`Límites de aceptación (versión activa ${data.active.version})`}>
      <p className="mb-4 text-sm text-gray-600">
        Editar crea una versión nueva con su motivo; las verificaciones ya calculadas conservan la versión con la que se evaluaron.
      </p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {keys.map((k) => (
          <fieldset key={k} className="rounded-xl border border-gray-200 p-3">
            <legend className="px-1 text-sm font-semibold text-gray-800">{RULE_LABEL[k] ?? k}</legend>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(active[k] as Record<string, number | boolean>).map(([f, v]) => {
                const id = `${k}.${f}`;
                if (typeof v === 'boolean') {
                  return (
                    <div key={id} className="col-span-2">
                      <Checkbox
                        label={FIELD_LABEL[f] ?? f}
                        checked={text[id] === 'true'}
                        disabled={!canWrite}
                        onChange={(c) => setText((s) => ({ ...s, [id]: String(c) }))}
                      />
                    </div>
                  );
                }
                const n = parseDecimal(text[id]);
                return (
                  <Field key={id} label={FIELD_LABEL[f] ?? f}>
                    <DecimalInput
                      value={text[id]}
                      disabled={!canWrite}
                      invalid={n === null || Number.isNaN(n)}
                      onChange={(e) => setText((s) => ({ ...s, [id]: e.target.value }))}
                    />
                  </Field>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      {canWrite && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Nueva versión" hint={`Actual: ${data.active.version}`}>
            <TextInput value={version} onChange={(e) => setVersion(e.target.value)} placeholder="p. ej. 1.1.0" />
          </Field>
          <Field label="Motivo del cambio" className="sm:col-span-2">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="sm:col-span-3 flex flex-wrap gap-2">
            <Button variant="primary" busy={busy} disabled={!version.trim() || !reason.trim()} onClick={() => void save()}>
              Guardar como nueva versión
            </Button>
            <Button onClick={() => setText(initialText())}>Descartar cambios</Button>
          </div>
        </div>
      )}
      <div className="mt-3 space-y-2">
        {error && <Alert tone="red">{error}</Alert>}
        {ok && <Alert tone="green">{ok}</Alert>}
      </div>

      <h3 className="mb-2 mt-6 text-sm font-semibold text-gray-800">Historial de versiones</h3>
      <TableWrap>
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr>
              <th className={TH}>Versión</th>
              <th className={TH}>Fecha</th>
              <th className={TH}>Autor</th>
              <th className={TH}>Motivo</th>
              <th className={TH}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {data.history.map((h) => (
              <tr key={h.id}>
                <td className={`${TD} font-semibold`}>{h.version}</td>
                <td className={TD}>{formatDate(h.createdAt)}</td>
                <td className={TD}>{h.createdByEmail}</td>
                <td className={TD}>{h.reason}</td>
                <td className={TD}>{h.active ? 'Activa' : 'Histórica'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

const VALIDITY_LABEL: Record<keyof EngineConfig['validityDays'], string> = {
  level2Annual: 'Nivel 2: verificación anual (días)',
  level2FieldReverification: 'Nivel 2 de campo: reverificación (días)',
  level3Bench: 'Nivel 3 de banco (días)',
  level3Field: 'Nivel 3 de campo (días)',
  level4Quarterly: 'Nivel 4: reverificación trimestral (días)',
};

function ConfigEditor({ config, canWrite, onSaved }: { config: EngineConfig; canWrite: boolean; onSaved: (c: EngineConfig) => void }) {
  const [threshold, setThreshold] = useState(formatInputNumber(config.absDiffThresholdPpb));
  const [includeZero, setIncludeZero] = useState(config.includeZeroInRegression);
  const [days, setDays] = useState(() =>
    Object.fromEntries(Object.entries(config.validityDays).map(([k, v]) => [k, String(v)])) as Record<keyof EngineConfig['validityDays'], string>,
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function save() {
    setError(null);
    setOk(false);
    const t = parseDecimal(threshold);
    if (t === null || Number.isNaN(t) || t < 0) return setError('El umbral debe ser un número mayor o igual que cero.');
    const validityDays = {} as EngineConfig['validityDays'];
    for (const [k, v] of Object.entries(days) as [keyof EngineConfig['validityDays'], string][]) {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) return setError(`${VALIDITY_LABEL[k]}: debe ser un entero positivo.`);
      validityDays[k] = n;
    }
    setBusy(true);
    try {
      const saved = await api.putConfig({ absDiffThresholdPpb: t, includeZeroInRegression: includeZero, validityDays }, reason.trim());
      setOk(true);
      setReason('');
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Configuración del cálculo">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Umbral %Diff / AbsDiff (ppb)" hint="x ≤ umbral usa la diferencia absoluta (Ec. 2). Por defecto 50 (D-001).">
          <DecimalInput value={threshold} disabled={!canWrite} onChange={(e) => setThreshold(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Checkbox label="El cero entra en la regresión (D-003)" checked={includeZero} disabled={!canWrite} onChange={setIncludeZero} />
        </div>
        {(Object.keys(VALIDITY_LABEL) as (keyof EngineConfig['validityDays'])[]).map((k) => (
          <Field key={k} label={VALIDITY_LABEL[k]}>
            <DecimalInput inputMode="numeric" value={days[k]} disabled={!canWrite} onChange={(e) => setDays((s) => ({ ...s, [k]: e.target.value }))} />
          </Field>
        ))}
      </div>
      {canWrite && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="Motivo del cambio" className="min-w-[16rem] flex-1">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button variant="primary" busy={busy} disabled={!reason.trim()} onClick={() => void save()}>
            Guardar configuración
          </Button>
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">La configuración no se versiona, pero cada cálculo guarda una copia de la que usó.</p>
      <div className="mt-3 space-y-2">
        {error && <Alert tone="red">{error}</Alert>}
        {ok && <Alert tone="green">Configuración guardada.</Alert>}
      </div>
    </Card>
  );
}

/** Configuración (Technical Director): versioned limits + engine config. */
export default function ConfigSection({ me }: { me: Me }) {
  const [limits, setLimits] = useState<LimitsResponse | null>(null);
  const [config, setConfig] = useState<EngineConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    Promise.all([api.getLimits(), api.getConfig()])
      .then(([l, c]) => {
        setLimits(l);
        setConfig(c);
      })
      .catch((e: Error) => setError(e.message));
  }, [reload]);

  if (error) return <Alert tone="red">{error}</Alert>;
  if (!limits || !config) return <Loading />;
  return (
    <div className="space-y-4">
      <ConfigEditor key={`c${reload}`} config={config} canWrite={can(me, 'config.write')} onSaved={setConfig} />
      <LimitsEditor key={`l${limits.active.version}`} data={limits} canWrite={can(me, 'limits.write')} onSaved={() => setReload((n) => n + 1)} />
    </div>
  );
}
