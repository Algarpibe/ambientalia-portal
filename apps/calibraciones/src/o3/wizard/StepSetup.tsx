import type { Route, TraceabilityResult } from '../../engine';
import { BUCKET, can, EQUIPMENT_TYPE_LABEL, ROUTE_LABEL } from '../../lib/domain';
import { withKind, type DraftState } from '../../lib/draft';
import { formatDate, formatIntercept, formatPpb, formatSlope } from '../../lib/format';
import type { EquipmentWithValidity, Me, TraceabilityBlockedDetail, Verification } from '../../types';
import { Alert, Badge, Card, Checkbox, Field, Loading, Segmented, Select, TextInput } from '../../ui';
import type { Updater } from './VerificationWizard';
import { FactorEditor, IssueLists } from './parts';

function EquipmentSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  exclude,
}: {
  label: string;
  value: string;
  options: EquipmentWithValidity[];
  onChange: (id: string) => void;
  disabled: boolean;
  exclude: string;
}) {
  const selected = options.find((e) => e.id === value);
  return (
    <Field
      label={label}
      hint={
        selected && (
          <span className="flex flex-wrap items-center gap-2">
            {EQUIPMENT_TYPE_LABEL[selected.type]}, nivel {selected.currentLevel ?? '—'}
            <Badge tone={BUCKET[selected.validity.bucket].tone}>{BUCKET[selected.validity.bucket].label}</Badge>
          </span>
        )
      }
    >
      <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Elija un equipo…</option>
        {options
          .filter((e) => (e.active || e.id === value) && e.id !== exclude)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.internalCode} — {e.brand} {e.model}
              {e.currentLevel ? ` (N${e.currentLevel})` : ''}
              {!e.hasPhotometer || e.type === 'GENERATOR_ONLY' ? ' · sin fotómetro' : ''}
            </option>
          ))}
      </Select>
    </Field>
  );
}

function RouteSelect({ label, value, onChange, disabled }: { label: string; value: Route | ''; onChange: (r: Route | '') => void; disabled: boolean }) {
  return (
    <Field label={label}>
      <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Route | '')}>
        <option value="">Sin indicar</option>
        {Object.entries(ROUTE_LABEL).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Step 1: kind, reference + candidate, routes, traceability option, factors; live §7 validation. */
export default function StepSetup({
  me,
  draft,
  update,
  readOnly,
  equipment,
  reference,
  referenceVerification,
  referenceLoaded,
  lastFull,
  trace,
  serverIssues,
}: {
  me: Me;
  draft: DraftState;
  update: Updater;
  readOnly: boolean;
  equipment: EquipmentWithValidity[];
  reference: EquipmentWithValidity | null;
  referenceVerification: Verification | null;
  referenceLoaded: boolean;
  lastFull: Verification | null;
  trace: TraceabilityResult | null;
  serverIssues: TraceabilityBlockedDetail | null;
}) {
  const set = <K extends keyof DraftState>(k: K, v: DraftState[K]) => update((d) => ({ ...d, [k]: v }));
  const isRev = draft.kind === 'REVERIFICATION_1_CYCLE';

  return (
    <div className="space-y-4">
      <Card title="Tipo y equipos">
        <div className="space-y-4">
          {draft.kind === 'CROSS_CHECK' ? (
            <Alert tone="amber">Verificación cruzada: se puede guardar, pero el motor todavía no la evalúa.</Alert>
          ) : (
            <Segmented
              label="Tipo de verificación"
              value={draft.kind}
              onChange={(k) => !readOnly && update((d) => withKind(d, k))}
              options={[
                ['VERIFICATION_3_CYCLES', 'Verificación (3 ciclos)'],
                ['REVERIFICATION_1_CYCLE', 'Reverificación (1 ciclo)'],
              ]}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Fecha de la prueba">
              <TextInput type="date" value={draft.verificationDate} disabled={readOnly} onChange={(e) => set('verificationDate', e.target.value)} />
            </Field>
            <Field label="Lugar" className="lg:col-span-3">
              <TextInput value={draft.location} disabled={readOnly} onChange={(e) => set('location', e.target.value)} placeholder="Laboratorio Medellín" />
            </Field>
            <div className="sm:col-span-2">
              <EquipmentSelect
                label="Patrón (x, mayor autoridad)"
                value={draft.referenceEquipmentId}
                options={equipment}
                exclude={draft.candidateEquipmentId}
                disabled={readOnly}
                onChange={(id) => update((d) => ({ ...d, referenceEquipmentId: id, referenceVerificationId: null }))}
              />
            </div>
            <div className="sm:col-span-2">
              <EquipmentSelect
                label="Candidato (y)"
                value={draft.candidateEquipmentId}
                options={equipment}
                exclude={draft.referenceEquipmentId}
                disabled={readOnly}
                onChange={(id) => set('candidateEquipmentId', id)}
              />
            </div>
            <RouteSelect label="Ruta del patrón" value={draft.referenceRoute} disabled={readOnly} onChange={(r) => set('referenceRoute', r)} />
            <RouteSelect label="Ruta del candidato" value={draft.candidateRoute} disabled={readOnly} onChange={(r) => set('candidateRoute', r)} />
          </div>
        </div>
      </Card>

      {reference && (
        <Card title="Verificación vigente del patrón">
          {reference.type === 'SRP' ? (
            <p className="text-sm text-gray-700">
              SRP certificado externamente: certificado <b>{reference.certificateNumber ?? 'sin número'}</b>, vigente hasta{' '}
              <b>{formatDate(reference.certificateValidUntil)}</b>, rango{' '}
              <b>{reference.certificateMaxPpb !== null ? `${formatPpb(reference.certificateMaxPpb)} ppb` : 'sin indicar'}</b>.
            </p>
          ) : !referenceLoaded ? (
            <Loading />
          ) : referenceVerification ? (
            <div className="space-y-2 text-sm text-gray-700">
              <p>
                Verificación del {formatDate(referenceVerification.verificationDate)} (versión {referenceVerification.version}), vigente hasta{' '}
                <b>{formatDate(referenceVerification.validUntil)}</b>. m̄ = <b className="tabular-nums">{formatSlope(referenceVerification.meanSlope)}</b>, b̄ ={' '}
                <b className="tabular-nums">{formatIntercept(referenceVerification.meanIntercept)} ppb</b>, rango verificado{' '}
                {formatPpb(referenceVerification.maxVerifiedPointPpb)} ppb.
              </p>
              {referenceVerification.traceabilityOption === 2 && (
                <Alert tone="blue">
                  El patrón usa la Opción 2: cada lectura x se convertirá con la Ec. 10 (Std = (1/m̄)·(Indicado − b̄)) antes de calcular.
                </Alert>
              )}
            </div>
          ) : (
            <Alert tone="amber">El patrón no tiene una verificación aprobada y conforme a la fecha de la prueba.</Alert>
          )}
          {isRev && (
            <p className="mt-3 text-sm text-gray-600">
              Última verificación completa del candidato:{' '}
              {lastFull
                ? `${formatDate(lastFull.verificationDate)}, m̄ ${formatSlope(lastFull.meanSlope)}, b̄ ${formatIntercept(lastFull.meanIntercept)} ppb (R1, R2, R5).`
                : 'ninguna. R1, R2 y R5 no podrán cumplirse.'}
            </p>
          )}
        </Card>
      )}

      <Card title="Opción de trazabilidad y factores internos">
        <div className="space-y-4">
          <Segmented
            label="Opción de trazabilidad"
            value={String(draft.traceabilityOption) as '1' | '2'}
            onChange={(v) => !readOnly && set('traceabilityOption', Number(v) as 1 | 2)}
            options={[
              ['1', 'Opción 1: ajuste de factores'],
              ['2', 'Opción 2: Ecuación 10'],
            ]}
          />
          <p className="text-xs text-gray-500">
            Es la opción con la que el candidato transferirá su trazabilidad: con la Opción 2, quien lo use como patrón convertirá sus lecturas con la Ec. 10.
          </p>
          <div className="grid gap-3 lg:grid-cols-3">
            <FactorEditor
              label="Factores del candidato antes (encontrados)"
              rows={draft.factorsBefore}
              readOnly={readOnly}
              onChange={(r) => set('factorsBefore', r)}
            />
            <FactorEditor
              label="Factores del candidato después"
              rows={draft.factorsAfter}
              readOnly={readOnly}
              onChange={(r) => set('factorsAfter', r)}
            />
            <FactorEditor
              label="Factores del patrón observados hoy"
              rows={draft.referenceFactors}
              readOnly={readOnly}
              onChange={(r) => set('referenceFactors', r)}
            />
          </div>
          {isRev && (
            <p className="text-xs text-gray-500">
              En una reverificación, los factores «antes» deben ser idénticos a los de la última verificación (R5); no ajuste el equipo antes de medir.
            </p>
          )}
          <Checkbox
            label="Nivel 4 habilitado por el Director Técnico (fuertemente desaconsejado, TAD §4.5; reverificación trimestral)"
            checked={draft.directorOverrideLevel4}
            disabled={readOnly || !can(me, 'level4.override')}
            onChange={(v) => set('directorOverrideLevel4', v)}
          />
        </div>
      </Card>

      <Card title="Validación de trazabilidad (§7)">
        <div className="space-y-3">
          {!trace ? (
            <p className="text-sm text-gray-500">Elija el patrón y el candidato para validar la cadena de trazabilidad.</p>
          ) : trace.blocking.length === 0 && trace.warnings.length === 0 ? (
            <Alert tone="green">
              Sin bloqueos ni advertencias en la vista previa.{trace.candidateLevel ? ` El candidato quedaría de nivel ${trace.candidateLevel}.` : ''}
            </Alert>
          ) : (
            <>
              <IssueLists blocking={trace.blocking} warnings={trace.warnings} source="vista previa" />
              {trace.candidateLevel && <p className="text-sm text-gray-600">Con este patrón el candidato quedaría de nivel {trace.candidateLevel}.</p>}
            </>
          )}
          {serverIssues && <IssueLists blocking={serverIssues.issues} warnings={serverIssues.warnings} source="servidor (último cálculo)" />}
          <p className="text-xs text-gray-500">
            La vista previa se calcula en este equipo; el servidor vuelve a validar al calcular con los datos guardados y su resultado es el que vale.
          </p>
        </div>
      </Card>
    </div>
  );
}
