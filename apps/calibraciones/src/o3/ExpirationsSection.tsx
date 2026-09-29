import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { APPLICATION_LABEL, BUCKET } from '../lib/domain';
import { formatDate } from '../lib/format';
import type { Route } from '../lib/hash';
import type { ExpirationItem, ValidityBucket } from '../types';
import { Alert, Badge, Button, Card, Loading, NUM, TableWrap, TD, TH } from '../ui';
import DownstreamImpactView from './DownstreamImpact';
import ListExport from './ListExport';
import { expirationsSheet } from '../lib/exports';

const ORDER: ValidityBucket[] = ['EXPIRED', 'DUE_TODAY', 'DUE_15', 'DUE_30', 'OK', 'NO_VALIDITY'];
const TILE: Record<string, string> = {
  red: 'border-red-200 bg-red-50 text-red-800',
  orange: 'border-orange-200 bg-orange-50 text-orange-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  gray: 'border-gray-200 bg-gray-50 text-gray-700',
  blue: 'border-blue-200 bg-blue-50 text-blue-800',
};

/** Expiration board with 30/15/0-day alerts (§7.9) and the downstream impact of an equipment (§7.10). */
export default function ExpirationsSection({ route, navigate }: { route: Route; navigate: (r: Route) => void }) {
  const [items, setItems] = useState<ExpirationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<ValidityBucket | null>(null);

  useEffect(() => {
    api
      .expirations()
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, []);

  const counts = useMemo(() => {
    const c = Object.fromEntries(ORDER.map((b) => [b, 0])) as Record<ValidityBucket, number>;
    for (const i of items ?? []) c[i.bucket]++;
    return c;
  }, [items]);

  const selected = route.id ? items?.find((i) => i.equipmentId === route.id) : undefined;
  const visible = (items ?? []).filter((i) => !bucket || i.bucket === bucket);

  if (error) return <Alert tone="red">{error}</Alert>;
  if (!items) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {ORDER.map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={bucket === b}
            onClick={() => setBucket(bucket === b ? null : b)}
            className={`min-h-[72px] rounded-2xl border p-3 text-left transition-shadow ${TILE[BUCKET[b].tone]} ${bucket === b ? 'ring-2 ring-blue-500' : ''}`}
          >
            <span className="block text-2xl font-bold tabular-nums">{counts[b]}</span>
            <span className="block text-xs font-medium">{BUCKET[b].label}</span>
          </button>
        ))}
      </div>

      <Card
        title={bucket ? `Equipos: ${BUCKET[bucket].label.toLowerCase()}` : 'Vencimientos'}
        actions={<ListExport fileBase="vencimientos_o3" sheet={() => expirationsSheet(visible)} />}
      >
        {visible.length === 0 ? (
          <p className="text-sm text-gray-500">No hay equipos en este grupo.</p>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr>
                  <th className={TH}>Equipo</th>
                  <th className={`${TH} ${NUM}`}>Nivel</th>
                  <th className={TH}>Aplicación</th>
                  <th className={TH}>Vence</th>
                  <th className={`${TH} ${NUM}`}>Días</th>
                  <th className={TH}>Estado</th>
                  <th className={TH}>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => (
                  <tr key={i.equipmentId} className={route.id === i.equipmentId ? 'bg-blue-50' : ''}>
                    <td className={TD}>
                      <button
                        type="button"
                        className="min-h-[36px] text-left font-semibold text-blue-700 hover:underline"
                        onClick={() => navigate({ type: 'o3', section: 'equipos', id: i.equipmentId })}
                      >
                        {i.internalCode}
                      </button>
                      <span className="block text-xs text-gray-500">
                        {i.brand} {i.model}
                      </span>
                    </td>
                    <td className={`${TD} ${NUM}`}>{i.currentLevel ?? '—'}</td>
                    <td className={TD}>{APPLICATION_LABEL[i.application]}</td>
                    <td className={TD}>
                      {formatDate(i.dueDate)}
                      {i.reverificationDue && i.reverificationDue === i.dueDate && (
                        <span className="block text-xs text-gray-500">reverificación</span>
                      )}
                    </td>
                    <td className={`${TD} ${NUM}`}>{i.daysLeft ?? '—'}</td>
                    <td className={TD}>
                      <Badge tone={BUCKET[i.bucket].tone}>{BUCKET[i.bucket].label}</Badge>
                    </td>
                    <td className={TD}>
                      <Button variant="ghost" onClick={() => navigate({ type: 'o3', section: 'vencimientos', id: i.equipmentId })}>
                        Impacto aguas abajo
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {route.id && (
        <Card title={`Impacto aguas abajo: ${selected?.internalCode ?? ''}`}>
          <DownstreamImpactView
            equipmentId={route.id}
            onOpenVerification={(id) => navigate({ type: 'o3', section: 'verificaciones', id })}
          />
        </Card>
      )}
    </div>
  );
}
