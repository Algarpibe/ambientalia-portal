import { useState, type ReactNode } from 'react';
import { CheckCircle2, FilePlus2, Lock, RefreshCcw, Trash2, XCircle } from 'lucide-react';
import { can, KIND_LABEL, RESULT, STATUS } from '../../lib/domain';
import { formatDate, formatIntercept, formatPpb, formatSlope } from '../../lib/format';
import type { Equipment, Me, ReproducibilityReport, Verification, VerificationDetail } from '../../types';
import { Alert, Badge, Button, Card, Field } from '../../ui';
import VerificationDocuments from '../VerificationDocuments';
import { IssueLists } from './parts';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-gray-100 py-2 text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-gray-900">{children}</dd>
    </div>
  );
}

function ReasonForm({ label, action, variant, busy, onSubmit }: { label: string; action: string; variant: 'danger' | 'primary'; busy: boolean; onSubmit: (r: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim()) onSubmit(reason.trim());
      }}
    >
      <Field label={label}>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          required
          className="block w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
        />
      </Field>
      <Button type="submit" variant={variant} busy={busy} disabled={!reason.trim()}>
        {action}
      </Button>
    </form>
  );
}

/** Step 5: review and approval by the Technical Director; locked record → new version. */
export default function StepReview({
  me,
  saved,
  dirty,
  busy,
  onApprove,
  onReject,
  onNewVersion,
  onDelete,
  onRecalcCheck,
  reference,
  candidate,
  referenceVerification,
}: {
  me: Me;
  saved: VerificationDetail | null;
  dirty: boolean;
  busy: string | null;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onNewVersion: (reason: string) => void;
  onDelete: () => void;
  onRecalcCheck: () => Promise<ReproducibilityReport>;
  reference: Equipment | null;
  candidate: Equipment | null;
  referenceVerification: Verification | null;
}) {
  const [mode, setMode] = useState<'reject' | 'version' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [check, setCheck] = useState<ReproducibilityReport | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  if (!saved) {
    return (
      <Card>
        <p className="text-sm text-gray-500">Guarde el borrador y calcule en el servidor para enviarlo a revisión.</p>
      </Card>
    );
  }
  const v = saved;
  const director = can(me, 'verification.approve');

  return (
    <div className="space-y-4">
      {v.status === 'APPROVED' && (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
          <div className="text-sm text-emerald-900">
            <p className="font-semibold">Aprobada por {v.approvedByEmail ?? '—'} el {formatDate(v.approvedAt)}. Registro bloqueado.</p>
            <p>Cualquier cambio exige una nueva versión con su motivo; esta versión se conserva tal cual.</p>
          </div>
        </div>
      )}
      {v.status === 'REJECTED' && (
        <Alert tone="red" title={`Rechazada por ${v.approvedByEmail ?? '—'} el ${formatDate(v.rejectedAt)}`}>
          Motivo: {v.rejectionReason}
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Resumen del registro">
          <dl>
            <Row label="Tipo">{KIND_LABEL[v.kind]}</Row>
            <Row label="Estado">
              <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>
            </Row>
            <Row label="Resultado">{v.overallResult ? <Badge tone={RESULT[v.overallResult].tone}>{RESULT[v.overallResult].label}</Badge> : '—'}</Row>
            <Row label="Fecha de la prueba">{formatDate(v.verificationDate)}</Row>
            <Row label="Técnico">{v.technicianEmail}</Row>
            <Row label="Versión">
              {v.version}
              {v.changeReason && <span className="block text-xs font-normal text-gray-500">Motivo: {v.changeReason}</span>}
            </Row>
            <Row label="m̄ / b̄">
              {formatSlope(v.meanSlope)} / {formatIntercept(v.meanIntercept)} ppb
            </Row>
            <Row label="SDm / SDb">
              {formatSlope(v.sdSlope)} / {formatIntercept(v.sdIntercept)} ppb
            </Row>
            <Row label="Rango verificado">{v.maxVerifiedPointPpb !== null ? `${formatPpb(v.maxVerifiedPointPpb)} ppb` : '—'}</Row>
            <Row label="Nivel del candidato">{v.candidateLevel ?? '—'}</Row>
            <Row label="Vigente hasta">{formatDate(v.validUntil)}</Row>
            {v.reverificationDue && <Row label="Reverificación antes de">{formatDate(v.reverificationDue)}</Row>}
            <Row label="Versión del motor / límites">
              {v.engineVersion ?? '—'} / {v.limitsVersion ?? '—'}
            </Row>
          </dl>
        </Card>

        <Card title="Revisión del Director Técnico">
          <div className="space-y-4">
            {v.status === 'DRAFT' && <Alert tone="blue">Calcule en el servidor para enviar la verificación a revisión.</Alert>}
            {v.status === 'CALCULATED' && dirty && (
              <Alert tone="amber">Hay cambios sin calcular. Guárdelos y recalcule antes de aprobar.</Alert>
            )}
            {v.status === 'CALCULATED' && !director && <p className="text-sm text-gray-600">Pendiente de revisión del Director Técnico.</p>}
            {v.status === 'CALCULATED' && director && !dirty && (
              <>
                {v.overallResult === 'NO_CONFORME' && (
                  <Alert tone="amber">
                    El resultado es NO CONFORME: aprobar firma el registro pero no da vigencia al equipo.
                  </Alert>
                )}
                <div className="flex flex-wrap gap-2">
                  {confirmApprove ? (
                    <>
                      <Button variant="success" busy={busy === 'approve'} onClick={onApprove}>
                        <CheckCircle2 className="h-4 w-4" aria-hidden /> Confirmar aprobación
                      </Button>
                      <Button onClick={() => setConfirmApprove(false)}>Cancelar</Button>
                    </>
                  ) : (
                    <Button variant="success" onClick={() => setConfirmApprove(true)}>
                      <CheckCircle2 className="h-4 w-4" aria-hidden /> Aprobar
                    </Button>
                  )}
                  <Button variant="danger" onClick={() => setMode(mode === 'reject' ? null : 'reject')}>
                    <XCircle className="h-4 w-4" aria-hidden /> Rechazar
                  </Button>
                </div>
                {mode === 'reject' && (
                  <ReasonForm label="Motivo del rechazo" action="Rechazar verificación" variant="danger" busy={busy === 'reject'} onSubmit={onReject} />
                )}
              </>
            )}
            {v.status === 'APPROVED' && can(me, 'verification.newVersion') && (
              <>
                <Button variant="primary" onClick={() => setMode(mode === 'version' ? null : 'version')}>
                  <FilePlus2 className="h-4 w-4" aria-hidden /> Nueva versión
                </Button>
                {mode === 'version' && (
                  <ReasonForm
                    label="Motivo de la nueva versión"
                    action="Crear nueva versión"
                    variant="primary"
                    busy={busy === 'version'}
                    onSubmit={onNewVersion}
                  />
                )}
              </>
            )}
            {(v.status === 'CALCULATED' || v.status === 'APPROVED' || v.status === 'REJECTED') && v.evaluation && (
              <div className="space-y-2 border-t border-gray-100 pt-3">
                <Button
                  onClick={() => {
                    setCheckError(null);
                    onRecalcCheck().then(setCheck, (e: Error) => setCheckError(e.message));
                  }}
                >
                  <RefreshCcw className="h-4 w-4" aria-hidden /> Comprobar reproducibilidad
                </Button>
                {check &&
                  (check.identical ? (
                    <Alert tone="green">Recalculado con sus límites y configuración originales: resultado idéntico.</Alert>
                  ) : (
                    <Alert tone="red" title="El recálculo no coincide">
                      <ul className="list-disc pl-5">
                        {check.differences.slice(0, 10).map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    </Alert>
                  ))}
                {checkError && <Alert tone="red">{checkError}</Alert>}
              </div>
            )}
            {v.status === 'DRAFT' && can(me, 'verification.write') && (
              <div className="border-t border-gray-100 pt-3">
                {confirmDelete ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="danger" busy={busy === 'delete'} onClick={onDelete}>
                      Confirmar: eliminar borrador
                    </Button>
                    <Button onClick={() => setConfirmDelete(false)}>Cancelar</Button>
                  </div>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-4 w-4" aria-hidden /> Eliminar borrador
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      <VerificationDocuments
        verification={v}
        reference={reference}
        candidate={candidate}
        referenceVerification={referenceVerification}
        dirty={dirty && v.status !== 'APPROVED' && v.status !== 'REJECTED'}
      />

      {v.traceabilityWarnings.length > 0 && (
        <Card title="Advertencias de trazabilidad registradas al calcular">
          <IssueLists blocking={[]} warnings={v.traceabilityWarnings} source="servidor" />
        </Card>
      )}
    </div>
  );
}
