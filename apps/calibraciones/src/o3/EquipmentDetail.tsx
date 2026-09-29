import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, GitBranch, Pencil, Plus } from 'lucide-react';
import { api } from '../api';
import { APPLICATION_LABEL, BUCKET, can, EQUIPMENT_TYPE_LABEL, KIND_LABEL, RESULT, ROUTE_LABEL, STATUS } from '../lib/domain';
import { formatDate, formatIntercept, formatPpb, formatSlope } from '../lib/format';
import type { Route } from '../lib/hash';
import type { EquipmentDetail, Me, TreeNode } from '../types';
import { Alert, Badge, Button, Card, Loading, NUM, TableWrap, TD, TH } from '../ui';
import DownstreamImpactView from './DownstreamImpact';
import EquipmentForm from './EquipmentForm';

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-gray-900">{children}</dd>
    </div>
  );
}

/** Traceability tree SRP → Level 2 → Level 3, centred on this equipment. */
function TraceabilityTree({ detail, onOpen }: { detail: EquipmentDetail; onOpen: (id: string) => void }) {
  const chain: (TreeNode & { self?: boolean })[] = [
    ...[...detail.ancestors].reverse(),
    {
      equipmentId: detail.equipment.id,
      internalCode: detail.equipment.internalCode,
      brand: detail.equipment.brand,
      model: detail.equipment.model,
      currentLevel: detail.equipment.currentLevel,
      application: detail.equipment.application,
      verificationId: detail.currentVerification?.id ?? null,
      depth: 0,
      self: true,
    },
    ...detail.descendants,
  ];
  const minDepth = Math.min(...chain.map((n) => n.depth));
  return (
    <ol className="space-y-2" aria-label="Árbol de trazabilidad">
      {chain.map((n) => (
        <li key={n.equipmentId} style={{ paddingLeft: `${(n.depth - minDepth) * 1.25}rem` }}>
          <button
            type="button"
            disabled={n.self}
            onClick={() => onOpen(n.equipmentId)}
            className={`flex min-h-[44px] w-full max-w-md items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm ${
              n.self ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gray-900 text-xs font-bold text-white">
              {n.currentLevel ? `N${n.currentLevel}` : '—'}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-gray-900">{n.internalCode}</span>
              <span className="block truncate text-xs text-gray-500">
                {n.brand} {n.model} · {APPLICATION_LABEL[n.application as 'BENCH' | 'FIELD'] ?? n.application}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export default function EquipmentDetailView({
  me,
  id,
  navigate,
  onChanged,
  onBack,
}: {
  me: Me;
  id: string;
  navigate: (r: { type: 'o3'; section: Route['section']; id: string | null }) => void;
  onChanged: () => void;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<EquipmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [impact, setImpact] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .getEquipment(id)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(() => {
    setDetail(null);
    setEditing(false);
    setImpact(false);
    load();
  }, [load]);

  const openEquipment = (eqId: string) => navigate({ type: 'o3', section: 'equipos', id: eqId });
  const openVerification = (vId: string) => navigate({ type: 'o3', section: 'verificaciones', id: vId });

  if (error) return <Alert tone="red">{error}</Alert>;
  if (!detail) return <Loading />;
  const e = detail.equipment;
  const cv = detail.currentVerification;

  if (editing) {
    return (
      <EquipmentForm
        me={me}
        initial={e}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onChanged();
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden /> Equipos
        </Button>
        <div className="flex flex-wrap gap-2">
          {can(me, 'verification.write') && (
            <Button onClick={() => navigate({ type: 'o3', section: 'verificaciones', id: 'nueva' })}>
              <Plus className="h-4 w-4" aria-hidden /> Nueva verificación
            </Button>
          )}
          {can(me, 'equipment.write') && (
            <Button variant="primary" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden /> Editar
            </Button>
          )}
        </div>
      </div>

      <Card
        title={
          <span className="flex flex-wrap items-center gap-3">
            {e.internalCode}
            <Badge tone={BUCKET[detail.validity.bucket].tone}>{BUCKET[detail.validity.bucket].label}</Badge>
            {!e.active && <Badge tone="gray">Inactivo</Badge>}
          </span>
        }
      >
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Equipo">
            {e.brand} {e.model}
          </Info>
          <Info label="Serie">{e.serial}</Info>
          <Info label="Tipo">{EQUIPMENT_TYPE_LABEL[e.type]}</Info>
          <Info label="Fotómetro">{e.hasPhotometer ? 'Sí' : 'No'}</Info>
          <Info label="Aplicación">{APPLICATION_LABEL[e.application]}</Info>
          <Info label="Nivel">{e.currentLevel ?? 'Sin nivel'}</Info>
          <Info label="Vence">
            {formatDate(detail.validity.dueDate)}
            {detail.validity.daysLeft !== null && (
              <span className="ml-1 text-xs font-normal text-gray-500">
                ({detail.validity.daysLeft >= 0 ? `faltan ${detail.validity.daysLeft} días` : `hace ${-detail.validity.daysLeft} días`})
              </span>
            )}
          </Info>
          {e.type === 'SRP' && (
            <>
              <Info label="Certificado">{e.certificateNumber ?? '—'}</Info>
              <Info label="Rango certificado">{e.certificateMaxPpb !== null ? `${formatPpb(e.certificateMaxPpb)} ppb` : '—'}</Info>
              <Info label="Ruta del certificado">{e.certificateRoute ? ROUTE_LABEL[e.certificateRoute] : '—'}</Info>
            </>
          )}
          {cv && (
            <>
              <Info label="m̄ / b̄ vigentes">
                {formatSlope(cv.meanSlope)} / {formatIntercept(cv.meanIntercept)} ppb
              </Info>
              <Info label="Rango verificado">{cv.maxVerifiedPointPpb !== null ? `${formatPpb(cv.maxVerifiedPointPpb)} ppb` : '—'}</Info>
              <Info label="Opción de trazabilidad">{cv.traceabilityOption === 2 ? 'Opción 2 (Ec. 10)' : 'Opción 1 (ajuste de factores)'}</Info>
            </>
          )}
        </dl>
        {e.notes && <p className="mt-4 whitespace-pre-wrap text-sm text-gray-600">{e.notes}</p>}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Árbol de trazabilidad">
          <TraceabilityTree detail={detail} onOpen={openEquipment} />
          <p className="mt-3 text-xs text-gray-500">Construido con las verificaciones vigentes (aprobadas y conformes) de cada equipo.</p>
        </Card>
        <Card
          title="Impacto aguas abajo"
          actions={
            !impact && (
              <Button onClick={() => setImpact(true)}>
                <GitBranch className="h-4 w-4" aria-hidden /> Ver equipos afectados
              </Button>
            )
          }
        >
          {impact ? (
            <DownstreamImpactView equipmentId={e.id} onOpenVerification={openVerification} />
          ) : (
            <p className="text-sm text-gray-600">
              Si este patrón resulta NO CONFORME, lista los equipos verificados con él desde su última verificación válida (§7.10).
            </p>
          )}
        </Card>
      </div>

      <Card title="Historial de verificaciones">
        {detail.history.length === 0 ? (
          <p className="text-sm text-gray-500">Este equipo todavía no tiene verificaciones como candidato.</p>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr>
                  <th className={TH}>Fecha</th>
                  <th className={TH}>Tipo</th>
                  <th className={`${TH} ${NUM}`}>Versión</th>
                  <th className={TH}>Estado</th>
                  <th className={TH}>Resultado</th>
                  <th className={`${TH} ${NUM}`}>m̄</th>
                  <th className={`${TH} ${NUM}`}>b̄ (ppb)</th>
                  <th className={TH}>Vigente hasta</th>
                </tr>
              </thead>
              <tbody>
                {detail.history.map((v) => (
                  <tr key={v.id} className="cursor-pointer hover:bg-blue-50/40" onClick={() => openVerification(v.id)}>
                    <td className={TD}>{formatDate(v.verificationDate)}</td>
                    <td className={TD}>{KIND_LABEL[v.kind]}</td>
                    <td className={`${TD} ${NUM}`}>{v.version}</td>
                    <td className={TD}>
                      <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>
                    </td>
                    <td className={TD}>{v.overallResult ? <Badge tone={RESULT[v.overallResult].tone}>{RESULT[v.overallResult].label}</Badge> : '—'}</td>
                    <td className={`${TD} ${NUM}`}>{formatSlope(v.meanSlope)}</td>
                    <td className={`${TD} ${NUM}`}>{formatIntercept(v.meanIntercept)}</td>
                    <td className={TD}>{formatDate(v.validUntil)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
