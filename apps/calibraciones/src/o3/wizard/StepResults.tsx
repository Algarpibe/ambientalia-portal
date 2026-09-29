import type { EvaluationResult } from '../../engine';
import { RESULT } from '../../lib/domain';
import { formatDiff, formatIntercept, formatNumber, formatPpb, formatSlope } from '../../lib/format';
import { compareEvaluations, formatRuleValue, summaryRules } from '../../lib/results';
import type { VerificationDetail } from '../../types';
import { Alert, Badge, Card, NUM, PassMark, TableWrap, TD, TH } from '../../ui';
import ResultsCharts from './ResultsCharts';
import type { LiveEvaluation } from './VerificationWizard';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-gray-900">{value}</dd>
    </div>
  );
}

/** Step 4: server result when calculated (authoritative), otherwise the live preview. */
export default function StepResults({
  live,
  server,
  saved,
  dirty,
}: {
  live: LiveEvaluation;
  server: EvaluationResult | null;
  saved: VerificationDetail | null;
  dirty: boolean;
}) {
  const e = server ?? live?.result ?? null;
  if (!e) {
    return (
      <Card>
        {live?.error ? (
          <Alert tone="red">{live.error}</Alert>
        ) : (
          <p className="text-sm text-gray-500">Capture puntos en el paso 3 para ver los resultados.</p>
        )}
      </Card>
    );
  }
  const diffs = server && live?.result ? compareEvaluations(live.result, server) : [];
  const res = RESULT[e.overallResult];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {server ? (
          <Badge tone="blue">Resultado del servidor (oficial)</Badge>
        ) : (
          <Badge tone="gray">Vista previa en vivo, sin calcular en el servidor</Badge>
        )}
        <span className="text-gray-500">
          Motor {e.engineVersion}, límites {e.limitsVersion}
          {server && saved?.calculatedAt ? `, calculado el ${saved.calculatedAt.slice(0, 10)}` : ''}
        </span>
      </div>
      {saved && saved.status !== 'DRAFT' && dirty && (
        <Alert tone="amber">Hay cambios sin calcular: se muestra la vista previa, no el resultado guardado.</Alert>
      )}
      {server && diffs.length > 0 && (
        <Alert tone="amber" title="La vista previa difiere del resultado del servidor">
          <p>El servidor usa la verificación del patrón y los límites guardados en la base de datos; su resultado es el que vale.</p>
          <ul className="mt-1 list-disc pl-5">
            {diffs.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </Alert>
      )}
      {server && live?.result && diffs.length === 0 && <p className="text-xs text-gray-500">La vista previa coincide con el resultado del servidor.</p>}

      <section
        className={`rounded-2xl border-2 p-4 sm:p-5 ${e.overallResult === 'CONFORME' ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}
        aria-live="polite"
      >
        <p className={`text-2xl font-bold tracking-tight ${res.tone === 'green' ? 'text-emerald-800' : 'text-red-800'}`}>{res.label}</p>
        {e.requiresFullVerification && <p className="mt-1 font-semibold text-red-800">El equipo requiere una verificación completa de 3 ciclos.</p>}
        {e.failReasons.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-900">
            {e.failReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {e.eq10Applied && <p className="mt-2 text-sm text-gray-700">Se aplicó la Ec. 10 a las lecturas x del patrón.</p>}
      </section>

      {e.aggregates && (
        <Card title="Promedios y desviaciones (Ec. 6–9)">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="m̄ (pendiente media)" value={formatSlope(e.aggregates.meanSlope)} />
            <Stat label="b̄ (intercepto medio, ppb)" value={formatIntercept(e.aggregates.meanIntercept)} />
            <Stat label="SDm (poblacional)" value={formatSlope(e.aggregates.sdSlope)} />
            <Stat label="SDb (poblacional, ppb)" value={formatIntercept(e.aggregates.sdIntercept)} />
            <Stat label="Rango verificado (ppb)" value={formatPpb(e.aggregates.maxVerifiedPointPpb)} />
          </dl>
        </Card>
      )}

      <Card title="Regresión por ciclo (Ec. 3–4)">
        <TableWrap>
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr>
                <th className={TH}>Ciclo</th>
                <th className={`${TH} ${NUM}`}>Pendiente m</th>
                <th className={`${TH} ${NUM}`}>Intercepto b (ppb)</th>
                <th className={`${TH} ${NUM}`}>r²</th>
                <th className={TH}>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {e.cycles.map((c) => (
                <tr key={c.index}>
                  <td className={TD}>{c.index}</td>
                  <td className={`${TD} ${NUM}`}>{formatSlope(c.regression?.slope)}</td>
                  <td className={`${TD} ${NUM}`}>{formatIntercept(c.regression?.intercept)}</td>
                  <td className={`${TD} ${NUM}`}>{formatNumber(c.regression?.r2, 5)}</td>
                  <td className={TD}>{c.regressionError ? <span className="text-red-700">{c.regressionError}</span> : <PassMark pass={c.pass} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card title="Puntos">
        <TableWrap>
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr>
                <th className={TH}>Ciclo</th>
                <th className={TH}>#</th>
                <th className={`${TH} ${NUM}`}>Setpoint</th>
                <th className={`${TH} ${NUM}`}>x leído</th>
                {e.eq10Applied && <th className={`${TH} ${NUM}`}>x std (Ec. 10)</th>}
                <th className={`${TH} ${NUM}`}>y</th>
                <th className={`${TH} ${NUM}`}>Diferencia</th>
                <th className={`${TH} ${NUM}`}>ŷ ajustado</th>
                <th className={`${TH} ${NUM}`}>Residuo</th>
                <th className={TH}>Semáforo</th>
              </tr>
            </thead>
            <tbody>
              {e.cycles.flatMap((c) =>
                c.points.map((p) => (
                  <tr key={`${c.index}-${p.order}`} className={p.pass ? '' : 'bg-red-50/60'}>
                    <td className={TD}>{c.index}</td>
                    <td className={TD}>{p.order}</td>
                    <td className={`${TD} ${NUM}`}>{formatPpb(p.setpointPpb)}</td>
                    <td className={`${TD} ${NUM}`}>{formatPpb(p.xRawPpb)}</td>
                    {e.eq10Applied && <td className={`${TD} ${NUM}`}>{formatPpb(p.xPpb)}</td>}
                    <td className={`${TD} ${NUM}`}>{formatPpb(p.yPpb)}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{formatDiff(p.diffValue, p.diffType)}</td>
                    <td className={`${TD} ${NUM}`}>{formatPpb(p.fitted)}</td>
                    <td className={`${TD} ${NUM}`}>{formatPpb(p.residual)}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <PassMark pass={p.pass} />
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </TableWrap>
        <p className="mt-2 text-xs text-gray-500">Concentraciones en ppb. %Diff (Ec. 1) para x &gt; umbral; diferencia absoluta (Ec. 2) para x ≤ umbral.</p>
      </Card>

      <Card title="Criterios de aceptación">
        <TableWrap>
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr>
                <th className={TH}>Regla</th>
                <th className={TH}>Criterio</th>
                <th className={`${TH} ${NUM}`}>Valor</th>
                <th className={TH}>Límite</th>
                <th className={TH}>Resultado</th>
                <th className={TH}>Referencia normativa</th>
              </tr>
            </thead>
            <tbody>
              {summaryRules(e.rules).map((r, i) => (
                <tr key={`${r.id}-${r.cycleIndex ?? ''}-${i}`} className={!r.pass && !r.informative ? 'bg-red-50/60' : ''}>
                  <td className={`${TD} font-semibold`}>{r.id}</td>
                  <td className={TD}>
                    {r.textEs}
                    {r.cycleIndex !== undefined && <span className="text-gray-500"> (ciclo {r.cycleIndex})</span>}
                  </td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{formatRuleValue(r)}</td>
                  <td className={`${TD} whitespace-nowrap`}>{r.limitText}</td>
                  <td className={`${TD} whitespace-nowrap`}>{r.informative ? <Badge tone="gray">Informativo</Badge> : <PassMark pass={r.pass} />}</td>
                  <td className={`${TD} text-xs text-gray-600`}>{r.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <p className="mt-2 text-xs text-gray-500">Las reglas V1 y V2 de cada punto están en la tabla de puntos.</p>
      </Card>

      <ResultsCharts evaluation={e} />
    </div>
  );
}
