import { useState } from 'react';
import { api } from '../api';
import type { Application, EquipmentType, Level, Route } from '../engine';
import { ApiError } from '../lib/apiError';
import { APPLICATION_LABEL, can, EQUIPMENT_TYPE_LABEL, ROUTE_LABEL } from '../lib/domain';
import { formatInputNumber } from '../lib/format';
import { parseDecimal } from '../lib/parse';
import type { Equipment, EquipmentInput, Me } from '../types';
import { Alert, Button, Card, Checkbox, DecimalInput, Field, Select, TextInput } from '../ui';

interface FormState {
  brand: string;
  model: string;
  serial: string;
  internalCode: string;
  type: EquipmentType;
  hasPhotometer: boolean;
  application: Application;
  currentLevel: string;
  notes: string;
  certificateNumber: string;
  certificateValidUntil: string;
  certificateMaxPpb: string;
  certificateRoute: Route | '';
  active: boolean;
}

function toForm(e: Equipment | null): FormState {
  return {
    brand: e?.brand ?? '',
    model: e?.model ?? '',
    serial: e?.serial ?? '',
    internalCode: e?.internalCode ?? '',
    type: e?.type ?? 'PHOTOMETRIC_CALIBRATOR',
    hasPhotometer: e?.hasPhotometer ?? true,
    application: e?.application ?? 'BENCH',
    currentLevel: e?.currentLevel ? String(e.currentLevel) : '',
    notes: e?.notes ?? '',
    certificateNumber: e?.certificateNumber ?? '',
    certificateValidUntil: e?.certificateValidUntil ?? '',
    certificateMaxPpb: formatInputNumber(e?.certificateMaxPpb),
    certificateRoute: e?.certificateRoute ?? '',
    active: e?.active ?? true,
  };
}

/** Create / edit an equipment (type, photometer, application, level, SRP certificate). */
export default function EquipmentForm({
  me,
  initial,
  onSaved,
  onCancel,
}: {
  me: Me;
  initial: Equipment | null;
  onSaved: (e: Equipment) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormState>(() => toForm(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const canLevel = can(me, 'equipment.level');
  const isSrp = f.type === 'SRP';
  const maxPpb = parseDecimal(f.certificateMaxPpb);
  const fieldError = (name: string) => (error instanceof ApiError && error.field === name ? error.message : null);

  async function save() {
    if (maxPpb !== null && Number.isNaN(maxPpb)) {
      setError(new Error('El rango del certificado no es un número.'));
      return;
    }
    const body: EquipmentInput = {
      brand: f.brand,
      model: f.model,
      serial: f.serial,
      internalCode: f.internalCode,
      type: f.type,
      hasPhotometer: f.type === 'GENERATOR_ONLY' ? false : f.hasPhotometer,
      application: f.application,
      currentLevel: f.currentLevel ? (Number(f.currentLevel) as Level) : null,
      notes: f.notes || null,
      certificateNumber: f.certificateNumber || null,
      certificateValidUntil: f.certificateValidUntil || null,
      certificateMaxPpb: maxPpb,
      certificateRoute: f.certificateRoute || null,
      active: f.active,
    };
    setBusy(true);
    setError(null);
    try {
      onSaved(initial ? await api.updateEquipment(initial.id, body) : await api.createEquipment(body));
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={initial ? `Editar ${initial.internalCode}` : 'Registrar equipo'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-5"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Código interno" hint="Ej.: 6103-S" error={fieldError('internalCode')}>
            <TextInput value={f.internalCode} onChange={(e) => set('internalCode', e.target.value)} required />
          </Field>
          <Field label="Marca" error={fieldError('brand')}>
            <TextInput value={f.brand} onChange={(e) => set('brand', e.target.value)} required />
          </Field>
          <Field label="Modelo" error={fieldError('model')}>
            <TextInput value={f.model} onChange={(e) => set('model', e.target.value)} required />
          </Field>
          <Field label="Serie" error={fieldError('serial')}>
            <TextInput value={f.serial} onChange={(e) => set('serial', e.target.value)} required />
          </Field>
          <Field label="Tipo" error={fieldError('type')}>
            <Select value={f.type} onChange={(e) => set('type', e.target.value as EquipmentType)}>
              {Object.entries(EQUIPMENT_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Aplicación">
            <Select value={f.application} onChange={(e) => set('application', e.target.value as Application)}>
              {Object.entries(APPLICATION_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Nivel de trazabilidad"
            hint={canLevel ? 'Se asigna solo al aprobar una verificación CONFORME; a mano, solo para el SRP (Nivel 1).' : 'Solo el Director Técnico puede fijarlo a mano.'}
            error={fieldError('currentLevel')}
          >
            <Select value={f.currentLevel} disabled={!canLevel} onChange={(e) => set('currentLevel', e.target.value)}>
              <option value="">Sin nivel</option>
              {[1, 2, 3, 4].map((l) => (
                <option key={l} value={l}>
                  Nivel {l}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col justify-end gap-2">
            <Checkbox
              label="Tiene fotómetro"
              checked={f.type !== 'GENERATOR_ONLY' && f.hasPhotometer}
              disabled={f.type === 'GENERATOR_ONLY'}
              onChange={(v) => set('hasPhotometer', v)}
            />
          </div>
        </div>

        {f.type === 'GENERATOR_ONLY' && (
          <Alert tone="amber">Un equipo solo generador no puede ser patrón ni candidato (TAD 2023 §3.2).</Alert>
        )}

        {isSrp && (
          <fieldset className="rounded-xl border border-gray-200 p-4">
            <legend className="px-1 text-sm font-semibold text-gray-800">Certificado del SRP (Nivel 1)</legend>
            <p className="mb-3 text-xs text-gray-500">
              El SRP se certifica fuera de la app: su certificado hace de verificación vigente del patrón.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Número de certificado">
                <TextInput value={f.certificateNumber} onChange={(e) => set('certificateNumber', e.target.value)} />
              </Field>
              <Field label="Vigente hasta" error={fieldError('certificateValidUntil')}>
                <TextInput type="date" value={f.certificateValidUntil} onChange={(e) => set('certificateValidUntil', e.target.value)} />
              </Field>
              <Field label="Rango certificado (ppb)" error={fieldError('certificateMaxPpb')}>
                <DecimalInput
                  value={f.certificateMaxPpb}
                  invalid={maxPpb !== null && Number.isNaN(maxPpb)}
                  onChange={(e) => set('certificateMaxPpb', e.target.value)}
                />
              </Field>
              <Field label="Ruta del certificado">
                <Select value={f.certificateRoute} onChange={(e) => set('certificateRoute', e.target.value as Route | '')}>
                  <option value="">Sin indicar</option>
                  {Object.entries(ROUTE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </fieldset>
        )}

        <Field label="Notas">
          <textarea
            value={f.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            className="block w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        </Field>
        {initial && <Checkbox label="Equipo activo" checked={f.active} onChange={(v) => set('active', v)} />}

        {error && !(error instanceof ApiError && error.field) && <Alert tone="red">{error.message}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onCancel}>Cancelar</Button>
          <Button type="submit" variant="primary" busy={busy}>
            {initial ? 'Guardar cambios' : 'Registrar equipo'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
