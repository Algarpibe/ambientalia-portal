import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../api';
import type { VerificationStatus } from '../engine';
import { can, KIND_LABEL, RESULT, STATUS } from '../lib/domain';
import { formatDate, formatIntercept, formatSlope } from '../lib/format';
import type { VerificationListItem } from '../types';
import { Alert, Badge, Button, Card, Loading, NUM, Select, TableWrap, TD, TH } from '../ui';
import type { SectionProps } from './O3Tab';
import VerificationWizard from './wizard/VerificationWizard';
import ListExport from './ListExport';
import { verificationListSheet } from '../lib/exports';

/** Verificaciones: list · `#o3/verificaciones/nueva` · `#o3/verificaciones/<id>` (wizard). */
export default function VerificationsSection({ me, route, navigate }: SectionProps) {
  const [items, setItems] = useState<VerificationListItem[] | null>(null);
  const [status, setStatus] = useState<VerificationStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const adopted = useRef<string | null>(null);

  useEffect(() => {
    if (route.id) return;
    let alive = true;
    setItems(null);
    setError(null);
    api
      .listVerifications(status ? { status } : {})
      .then((v) => alive && setItems(v))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [route.id, status]);

  const open = (id: string | null, replace = false) => navigate({ type: 'o3', section: 'verificaciones', id }, replace);

  if (route.id) {
    // A draft created from «nueva» takes its id in the URL without remounting
    // the wizard (it keeps the unit, step and any 422 list in memory).
    const key = route.id === adopted.current ? 'nueva' : route.id;
    return (
      <VerificationWizard
        key={key}
        me={me}
        id={route.id === 'nueva' ? null : route.id}
        onCreated={(id) => {
          adopted.current = id;
          open(id, true);
        }}
        onOpen={(id) => open(id)}
        onBack={() => open(null)}
      />
    );
  }

  return (
    <Card
      title="Verificaciones"
      actions={
        <div className="flex flex-wrap gap-2">
          <ListExport fileBase="verificaciones_o3" sheet={items ? () => verificationListSheet(items) : null} />
          {can(me, 'verification.write') && (
            <Button variant="primary" onClick={() => open('nueva')}>
              <Plus className="h-4 w-4" aria-hidden /> Nueva verificación
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-4 max-w-xs">
        <Select aria-label="Filtrar por estado" value={status} onChange={(e) => setStatus(e.target.value as VerificationStatus | '')}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS).map(([v, s]) => (
            <option key={v} value={v}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      {!items && !error && <Loading />}
      {items && items.length === 0 && (
        <p className="py-6 text-sm text-gray-500">
          {status ? 'No hay verificaciones en ese estado.' : 'Todavía no hay verificaciones registradas.'}
        </p>
      )}
      {items && items.length > 0 && (
        <TableWrap>
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr>
                <th className={TH}>Fecha</th>
                <th className={TH}>Tipo</th>
                <th className={TH}>Patrón → candidato</th>
                <th className={`${TH} ${NUM}`}>Versión</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Resultado</th>
                <th className={`${TH} ${NUM}`}>m̄</th>
                <th className={`${TH} ${NUM}`}>b̄ (ppb)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id} className="cursor-pointer hover:bg-blue-50/40" onClick={() => open(v.id)}>
                  <td className={TD}>{formatDate(v.verificationDate)}</td>
                  <td className={TD}>{KIND_LABEL[v.kind]}</td>
                  <td className={TD}>
                    <span className="font-medium">{v.referenceInternalCode}</span> →{' '}
                    <span className="font-semibold text-blue-700">{v.candidateInternalCode}</span>
                  </td>
                  <td className={`${TD} ${NUM}`}>{v.version}</td>
                  <td className={TD}>
                    <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>
                  </td>
                  <td className={TD}>{v.overallResult ? <Badge tone={RESULT[v.overallResult].tone}>{RESULT[v.overallResult].label}</Badge> : '—'}</td>
                  <td className={`${TD} ${NUM}`}>{formatSlope(v.meanSlope)}</td>
                  <td className={`${TD} ${NUM}`}>{formatIntercept(v.meanIntercept)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
