import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Calculator, Save } from 'lucide-react';
import { api } from '../../api';
import {
  DEFAULT_CONFIG,
  DEFAULT_LIMITS,
  evaluateVerification,
  type EngineConfig,
  type EvaluationResult,
  type Limits,
} from '../../engine';
import { traceabilityDetailOf } from '../../lib/apiError';
import { can, KIND_LABEL, RESULT, STATUS, todayInColombia } from '../../lib/domain';
import { emptyDraft, fromDetail, liveEngineInput, toPayload, type DraftState, type LiveContext } from '../../lib/draft';
import { liveTraceability, pickCurrentVerification } from '../../lib/traceabilityLive';
import type {
  EquipmentDetail,
  EquipmentWithValidity,
  Me,
  TraceabilityBlockedDetail,
  Verification,
  VerificationDetail,
} from '../../types';
import { Alert, Badge, Button, Loading } from '../../ui';
import StepSetup from './StepSetup';
import StepChecklist from './StepChecklist';
import StepPoints from './StepPoints';
import StepResults from './StepResults';
import StepReview from './StepReview';

const STEPS = ['Tipo, patrón y candidato', 'Pruebas de aceptación', 'Captura de puntos', 'Resultados', 'Revisión y aprobación'] as const;

export type Updater = (fn: (d: DraftState) => DraftState) => void;

export type LiveEvaluation = { result: EvaluationResult; error: null } | { result: null; error: string } | null;

/**
 * 5-step verification wizard. The browser evaluates live with the same engine
 * the server runs; «Calcular en el servidor» saves and runs the authoritative
 * calculation (the server resolves the reference from the database).
 */
export default function VerificationWizard({
  me,
  id,
  onCreated,
  onOpen,
  onBack,
}: {
  me: Me;
  id: string | null;
  /** A new draft was stored: the URL takes its id without remounting the wizard. */
  onCreated: (id: string) => void;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const [equipment, setEquipment] = useState<EquipmentWithValidity[] | null>(null);
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);
  const [config, setConfig] = useState<EngineConfig>(DEFAULT_CONFIG);
  const [defaultsWarning, setDefaultsWarning] = useState(false);
  const [saved, setSaved] = useState<VerificationDetail | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [step, setStep] = useState(0);
  const [refDetail, setRefDetail] = useState<EquipmentDetail | null>(null);
  const [candDetail, setCandDetail] = useState<EquipmentDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [serverIssues, setServerIssues] = useState<TraceabilityBlockedDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Loaded once per mount: after «nueva» is saved the id prop changes but the
  // state in memory is already the stored record.
  useEffect(() => {
    let alive = true;
    Promise.all([
      api.listEquipment(),
      api.getLimits().catch(() => null),
      api.getConfig().catch(() => null),
      id ? api.getVerification(id) : Promise.resolve(null),
    ])
      .then(([eq, lim, cfg, v]) => {
        if (!alive) return;
        setEquipment(eq);
        if (lim) setLimits(lim.active.limits);
        if (cfg) setConfig(cfg);
        setDefaultsWarning(!lim || !cfg);
        setSaved(v);
        setDraft(v ? fromDetail(v) : emptyDraft(todayInColombia()));
        if (v) setStep(v.status === 'DRAFT' ? 0 : v.status === 'CALCULATED' ? 3 : 4);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const refId = draft?.referenceEquipmentId ?? '';
  const candId = draft?.candidateEquipmentId ?? '';
  useEffect(() => {
    setRefDetail(null);
    if (!refId) return;
    let alive = true;
    api.getEquipment(refId).then((d) => alive && setRefDetail(d)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [refId]);
  useEffect(() => {
    setCandDetail(null);
    if (!candId) return;
    let alive = true;
    api.getEquipment(candId).then((d) => alive && setCandDetail(d)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [candId]);

  const update: Updater = (fn) => setDraft((d) => (d ? fn(d) : d));

  const payloadResult = useMemo(() => (draft ? toPayload(draft) : null), [draft]);
  const payload = payloadResult?.payload ?? null;
  const reference = equipment?.find((e) => e.id === refId) ?? null;
  const candidate = equipment?.find((e) => e.id === candId) ?? null;

  const refVerification: Verification | null = useMemo(() => {
    if (!refDetail || !draft || reference?.type === 'SRP') return null;
    if (draft.referenceVerificationId) return refDetail.history.find((v) => v.id === draft.referenceVerificationId) ?? null;
    return pickCurrentVerification(refDetail.history, draft.verificationDate);
  }, [refDetail, draft, reference]);

  const lastFull: Verification | null = useMemo(() => {
    if (!candDetail || !draft) return null;
    return pickCurrentVerification(
      candDetail.history.filter((v) => v.id !== saved?.id),
      draft.verificationDate,
      'VERIFICATION_3_CYCLES',
    );
  }, [candDetail, draft, saved?.id]);

  const ctx: LiveContext = useMemo(
    () => ({
      ...(refVerification && refVerification.meanSlope !== null && refVerification.meanIntercept !== null
        ? {
            referenceVerification: {
              traceabilityOption: refVerification.traceabilityOption,
              meanSlope: refVerification.meanSlope,
              meanIntercept: refVerification.meanIntercept,
            },
          }
        : {}),
      ...(lastFull && lastFull.meanSlope !== null && lastFull.meanIntercept !== null
        ? {
            lastVerification: {
              meanSlope: lastFull.meanSlope,
              meanIntercept: lastFull.meanIntercept,
              ...((lastFull.internalFactorsAfter ?? lastFull.internalFactorsBefore)
                ? { internalFactors: (lastFull.internalFactorsAfter ?? lastFull.internalFactorsBefore)! }
                : {}),
            },
          }
        : {}),
    }),
    [refVerification, lastFull],
  );

  const trace = useMemo(
    () =>
      reference && candidate && payload && (reference.type === 'SRP' || refDetail)
        ? liveTraceability({ reference, candidate, referenceVerification: refVerification, payload })
        : null,
    [reference, candidate, payload, refVerification, refDetail],
  );

  const live: LiveEvaluation = useMemo(() => {
    if (!payload || payload.kind === 'CROSS_CHECK') return null;
    if (payload.cycles.every((c) => c.points.length === 0)) return null;
    try {
      return { result: evaluateVerification(liveEngineInput(payload, ctx), config, limits), error: null };
    } catch (e) {
      return {
        result: null,
        error:
          payload.kind === 'REVERIFICATION_1_CYCLE'
            ? 'Una reverificación debe tener exactamente un ciclo.'
            : `No se pudo calcular: ${(e as Error).message}`,
      };
    }
  }, [payload, ctx, config, limits]);

  const savedJson = useMemo(() => (saved ? JSON.stringify(toPayload(fromDetail(saved)).payload) : null), [saved]);
  const dirty = !saved || (payload !== null && JSON.stringify(payload) !== savedJson);
  const locked = saved?.status === 'APPROVED' || saved?.status === 'REJECTED';
  const readOnly = locked || !can(me, 'verification.write');
  const serverEval = saved && saved.status !== 'DRAFT' && !dirty ? saved.evaluation : null;

  if (error && !draft) return <Alert tone="red">{error}</Alert>;
  if (!draft || !equipment || !payloadResult) return <Loading />;

  async function persist(): Promise<VerificationDetail | null> {
    if (!payloadResult || !payload) return null;
    if (payloadResult.problems.length) {
      setShowProblems(true);
      setError('Corrija los datos marcados antes de guardar.');
      return null;
    }
    if (!payload.referenceEquipmentId || !payload.candidateEquipmentId) {
      setError('Elija el patrón y el candidato (paso 1) antes de guardar.');
      setStep(0);
      return null;
    }
    const stored = saved ? await api.updateVerification(saved.id, payload) : await api.createVerification(payload);
    setSaved(stored);
    if (!saved) onCreated(stored.id);
    return stored;
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      const t = traceabilityDetailOf(e);
      if (t) {
        setServerIssues(t);
        setError('El servidor bloqueó el cálculo por las reglas de trazabilidad (paso 1).');
      } else setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run('save', async () => {
      if (await persist()) setNotice('Borrador guardado.');
    });

  const calculate = () =>
    run('calculate', async () => {
      const stored = dirty ? await persist() : saved;
      if (!stored) return;
      const result = await api.calculate(stored.id);
      setSaved(result);
      setServerIssues(null);
      setStep(3);
      setNotice('Cálculo del servidor guardado. Es el resultado oficial del registro.');
    });

  /** Workflow actions of step 5 replace the stored record. */
  const act = (label: string, fn: () => Promise<VerificationDetail>, message: string) =>
    run(label, async () => {
      const r = await fn();
      setSaved(r);
      setDraft(fromDetail(r));
      setNotice(message);
    });

  const hasBlocking = (trace?.blocking.length ?? 0) > 0 || (serverIssues?.issues.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden /> Verificaciones
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {saved ? (
            <>
              <Badge tone={STATUS[saved.status].tone}>{STATUS[saved.status].label}</Badge>
              {saved.overallResult && !dirty && (
                <Badge tone={RESULT[saved.overallResult].tone}>{RESULT[saved.overallResult].label}</Badge>
              )}
              <span className="text-xs text-gray-500">Versión {saved.version}</span>
            </>
          ) : (
            <Badge tone="gray">Sin guardar</Badge>
          )}
          {dirty && saved && !readOnly && <span className="text-xs font-medium text-amber-700">Cambios sin guardar</span>}
        </div>
      </div>

      <h2 className="text-lg font-semibold text-gray-900">
        {saved ? KIND_LABEL[saved.kind] : 'Nueva verificación'}
        {reference && candidate && (
          <span className="ml-2 font-normal text-gray-500">
            {reference.internalCode} → {candidate.internalCode}
          </span>
        )}
      </h2>

      <ol className="grid grid-cols-5 gap-1 sm:gap-2" aria-label="Pasos">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={step === i ? 'step' : undefined}
              className={`flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-2 text-center text-xs sm:flex-row sm:gap-2 sm:text-sm ${
                step === i ? 'border-blue-500 bg-blue-50 font-semibold text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  i === 0 && hasBlocking ? 'bg-red-600 text-white' : step === i ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                }`}
              >
                {i + 1}
              </span>
              <span className="hidden md:inline">{label}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="text-sm font-medium text-gray-700 md:hidden">
        Paso {step + 1}: {STEPS[step]}
      </p>

      {locked && (
        <Alert tone="blue" title={`Registro ${saved?.status === 'APPROVED' ? 'aprobado' : 'rechazado'} y bloqueado`}>
          No se puede modificar. {saved?.status === 'APPROVED' && 'Cualquier cambio exige una nueva versión con su motivo (paso 5).'}
        </Alert>
      )}
      {!locked && !can(me, 'verification.write') && <Alert tone="blue">Su rol es de solo lectura.</Alert>}
      {defaultsWarning && (
        <Alert tone="amber">
          No se pudieron leer los límites o la configuración activos: la vista previa usa los valores por defecto del motor.
        </Alert>
      )}
      {error && <Alert tone="red">{error}</Alert>}
      {notice && <Alert tone="green">{notice}</Alert>}
      {showProblems && payloadResult.problems.length > 0 && (
        <Alert tone="amber" title="Datos por corregir">
          <ul className="mt-1 list-disc pl-5">
            {payloadResult.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}

      {step === 0 && (
        <StepSetup
          me={me}
          draft={draft}
          update={update}
          readOnly={readOnly}
          equipment={equipment}
          reference={reference}
          referenceVerification={refVerification}
          referenceLoaded={!refId || reference?.type === 'SRP' || !!refDetail}
          lastFull={lastFull}
          trace={trace}
          serverIssues={serverIssues}
        />
      )}
      {step === 1 && <StepChecklist draft={draft} update={update} readOnly={readOnly} />}
      {step === 2 && (
        <StepPoints
          draft={draft}
          update={update}
          readOnly={readOnly}
          rowOrders={payloadResult.rowOrders}
          live={live}
          eq10Applied={ctx.referenceVerification?.traceabilityOption === 2}
        />
      )}
      {step === 3 && <StepResults live={live} server={serverEval} saved={saved} dirty={dirty} />}
      {step === 4 && (
        <StepReview
          me={me}
          saved={saved}
          dirty={dirty}
          busy={busy}
          onApprove={() => saved && act('approve', () => api.approve(saved.id), 'Verificación aprobada. El registro queda bloqueado.')}
          onReject={(reason) => saved && act('reject', () => api.reject(saved.id, reason), 'Verificación rechazada.')}
          onNewVersion={(reason) =>
            saved &&
            run('version', async () => {
              const v = await api.newVersion(saved.id, reason);
              onOpen(v.id);
            })
          }
          onDelete={() =>
            saved &&
            run('delete', async () => {
              await api.deleteVerification(saved.id);
              onBack();
            })
          }
          onRecalcCheck={() => (saved ? api.recalculateCheck(saved.id) : Promise.reject(new Error('Sin registro')))}
          reference={reference}
          candidate={candidate}
          referenceVerification={refVerification}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-4">
        <div className="flex gap-2">
          <Button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            Anterior
          </Button>
          <Button disabled={step === STEPS.length - 1} onClick={() => setStep((s) => s + 1)}>
            Siguiente
          </Button>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} busy={busy === 'save'} disabled={!!busy || (!dirty && !!saved)}>
              <Save className="h-4 w-4" aria-hidden /> Guardar borrador
            </Button>
            {can(me, 'verification.calculate') && (
              <Button variant="primary" onClick={calculate} busy={busy === 'calculate'} disabled={!!busy || draft.kind === 'CROSS_CHECK'}>
                <Calculator className="h-4 w-4" aria-hidden /> Calcular en el servidor
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
