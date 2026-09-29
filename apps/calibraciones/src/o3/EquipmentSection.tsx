import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '../api';
import { APPLICATION_LABEL, BUCKET, can, EQUIPMENT_TYPE_LABEL } from '../lib/domain';
import { formatDate } from '../lib/format';
import type { EquipmentWithValidity } from '../types';
import { Alert, Badge, Button, Card, Loading, NUM, TableWrap, TD, TextInput, TH } from '../ui';
import type { SectionProps } from './O3Tab';
import EquipmentDetailView from './EquipmentDetail';
import EquipmentForm from './EquipmentForm';
import ListExport from './ListExport';
import { equipmentSheet } from '../lib/exports';

/** Equipos: list · `#o3/equipos/nuevo` form · `#o3/equipos/<id>` detail. */
export default function EquipmentSection({ me, route, navigate }: SectionProps) {
  const [items, setItems] = useState<EquipmentWithValidity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .listEquipment()
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (items ?? []).filter(
      (e) =>
        (showInactive || e.active) &&
        (!f || [e.internalCode, e.brand, e.model, e.serial].some((v) => v.toLowerCase().includes(f))),
    );
  }, [items, filter, showInactive]);

  const go = (id: string | null) => navigate({ type: 'o3', section: 'equipos', id });

  if (route.id === 'nuevo') {
    return (
      <EquipmentForm
        me={me}
        initial={null}
        onCancel={() => go(null)}
        onSaved={(e) => {
          load();
          go(e.id);
        }}
      />
    );
  }
  if (route.id) {
    return <EquipmentDetailView me={me} id={route.id} navigate={navigate} onChanged={load} onBack={() => go(null)} />;
  }

  return (
    <Card
      title="Equipos"
      actions={
        <div className="flex flex-wrap gap-2">
          <ListExport fileBase="equipos_o3" sheet={items ? () => equipmentSheet(visible) : null} />
          {can(me, 'equipment.write') && (
            <Button variant="primary" onClick={() => go('nuevo')}>
              <Plus className="h-4 w-4" aria-hidden /> Registrar equipo
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <TextInput
            aria-label="Buscar equipo"
            placeholder="Buscar por código, marca, modelo o serie"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-9"
          />
        </div>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="h-5 w-5" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Mostrar inactivos
        </label>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      {!items && !error && <Loading />}
      {items && visible.length === 0 && (
        <p className="py-6 text-sm text-gray-500">
          {items.length === 0 ? 'Todavía no hay equipos registrados. Empiece por el SRP (Nivel 1).' : 'Ningún equipo coincide con la búsqueda.'}
        </p>
      )}
      {visible.length > 0 && (
        <TableWrap>
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr>
                <th className={TH}>Código</th>
                <th className={TH}>Equipo</th>
                <th className={TH}>Tipo</th>
                <th className={TH}>Aplicación</th>
                <th className={`${TH} ${NUM}`}>Nivel</th>
                <th className={TH}>Vigencia</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.id} className="cursor-pointer hover:bg-blue-50/40" onClick={() => go(e.id)}>
                  <td className={TD}>
                    <button type="button" className="min-h-[36px] font-semibold text-blue-700 hover:underline" onClick={() => go(e.id)}>
                      {e.internalCode}
                    </button>
                    {!e.active && <span className="ml-2 text-xs text-gray-400">inactivo</span>}
                  </td>
                  <td className={TD}>
                    {e.brand} {e.model}
                    <span className="block text-xs text-gray-500">Serie {e.serial}</span>
                  </td>
                  <td className={TD}>
                    {EQUIPMENT_TYPE_LABEL[e.type]}
                    {!e.hasPhotometer && <span className="block text-xs text-gray-500">sin fotómetro</span>}
                  </td>
                  <td className={TD}>{APPLICATION_LABEL[e.application]}</td>
                  <td className={`${TD} ${NUM}`}>{e.currentLevel ?? '—'}</td>
                  <td className={TD}>
                    <Badge tone={BUCKET[e.validity.bucket].tone}>{BUCKET[e.validity.bucket].label}</Badge>
                    {e.validity.dueDate && <span className="ml-2 text-xs text-gray-500">{formatDate(e.validity.dueDate)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
