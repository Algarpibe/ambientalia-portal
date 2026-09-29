import { CHECKLIST_ITEMS, checklistComplete, labTemperatureWarning, type DraftState } from '../../lib/draft';
import { parseDecimal } from '../../lib/parse';
import { Alert, Card, Checkbox, DecimalInput, Field } from '../../ui';
import type { Updater } from './VerificationWizard';

type NumKey =
  | 'labTempStartC'
  | 'labTempEndC'
  | 'labRhPct'
  | 'baroPressureTorr'
  | 'totalFlowSlpm'
  | 'warmupMinutes'
  | 'lossPercent'
  | 'linearityErrorPercent';

/** Step 2: acceptance checklist + lab conditions (§7.7) + optional App. D data. */
export default function StepChecklist({ draft, update, readOnly }: { draft: DraftState; update: Updater; readOnly: boolean }) {
  const set = <K extends keyof DraftState>(k: K, v: DraftState[K]) => update((d) => ({ ...d, [k]: v }));
  const num = (k: NumKey, label: string, hint?: string) => {
    const n = parseDecimal(draft[k]);
    return (
      <Field label={label} hint={hint} error={n !== null && Number.isNaN(n) ? 'No es un número.' : null}>
        <DecimalInput value={draft[k]} disabled={readOnly} invalid={n !== null && Number.isNaN(n)} onChange={(e) => set(k, e.target.value)} />
      </Field>
    );
  };
  const tempWarning = labTemperatureWarning(draft);
  const warmup = parseDecimal(draft.warmupMinutes);

  return (
    <div className="space-y-4">
      <Card title="Pruebas de aceptación">
        <div className="grid gap-2 sm:grid-cols-2">
          {CHECKLIST_ITEMS.map((i) => (
            <Checkbox
              key={i.id}
              label={i.label}
              checked={draft.checklist[i.id]}
              disabled={readOnly}
              onChange={(v) => update((d) => ({ ...d, checklist: { ...d.checklist, [i.id]: v } }))}
            />
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {num('warmupMinutes', 'Minutos de calentamiento')}
          <Field label="Observaciones" className="sm:col-span-2">
            <textarea
              value={draft.checklistNotes}
              disabled={readOnly}
              rows={2}
              onChange={(e) => set('checklistNotes', e.target.value)}
              className="block w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none disabled:bg-gray-50"
            />
          </Field>
        </div>
        <div className="mt-3 space-y-2">
          {!checklistComplete(draft) && <Alert tone="amber">Faltan pruebas de aceptación por confirmar.</Alert>}
          {warmup !== null && !Number.isNaN(warmup) && warmup < 30 && (
            <Alert tone="amber">El calentamiento debe ser de al menos 30 minutos.</Alert>
          )}
        </div>
      </Card>

      <Card title="Condiciones ambientales">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {num('labTempStartC', 'Temperatura inicial (°C)')}
          {num('labTempEndC', 'Temperatura final (°C)')}
          {num('labRhPct', 'Humedad relativa (%)')}
          {num('baroPressureTorr', 'Presión barométrica (torr)', 'Medellín ≈ 640 torr')}
          {num('totalFlowSlpm', 'Flujo total (SLPM)')}
        </div>
        {tempWarning && (
          <div className="mt-3">
            <Alert tone="amber">{tempWarning}</Alert>
          </div>
        )}
      </Card>

      <Card title="Fotometría (40 CFR 50 App. D, opcional)">
        <div className="grid gap-4 sm:grid-cols-2">
          {num('lossPercent', 'Pérdida de O₃ (%)', 'D1: ≤ 5 %')}
          {num('linearityErrorPercent', 'Error de linealidad (%)', 'D2: |E| < 3 %. Use la calculadora de linealidad si hace falta.')}
        </div>
      </Card>
    </div>
  );
}
