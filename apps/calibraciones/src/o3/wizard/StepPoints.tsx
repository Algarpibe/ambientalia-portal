import { Fragment, useRef, useState } from 'react';
import { Copy, Download, Plus, Ruler, Trash2, Upload } from 'lucide-react';
import { computeCalibrationScale, proposeSetpoints } from '../../engine';
import { buildCsvTemplate, parsePointsCsv } from '../../lib/csv';
import { convertUnit, emptyRow, type DraftState, type PointRow, type Unit } from '../../lib/draft';
import { formatDiff, formatInputNumber, formatIntercept, formatNumber, formatPpb, formatSlope } from '../../lib/format';
import { parseDecimal } from '../../lib/parse';
import { Alert, Button, Card, DecimalInput, downloadText, Field, NUM, PassMark, Segmented, TableWrap, TD, TH } from '../../ui';
import type { LiveEvaluation, Updater } from './VerificationWizard';

const CELL_COLUMNS: [keyof PointRow, string][] = [
  ['cellTempX', 'T celda x (°C)'],
  ['cellTempY', 'T celda y (°C)'],
  ['cellPressX', 'P celda x (torr)'],
  ['cellPressY', 'P celda y (torr)'],
];

const invalid = (t: string) => {
  const n = parseDecimal(t);
  return n !== null && Number.isNaN(n);
};

function ScaleAssistant({ draft, update, readOnly }: { draft: DraftState; update: Updater; readOnly: boolean }) {
  const [max3y, setMax3y] = useState('');
  const [standard, setStandard] = useState('');
  const m = parseDecimal(max3y);
  const s = parseDecimal(standard);
  let scale: ReturnType<typeof computeCalibrationScale> | null = null;
  let setpoints: number[] | null = null;
  let error: string | null = null;
  if (m !== null && s !== null && !Number.isNaN(m) && !Number.isNaN(s)) {
    scale = computeCalibrationScale({ max3yHourlyPpb: m, standardPpb: s });
    try {
      setpoints = proposeSetpoints(scale.scalePpb);
    } catch {
      error = 'La escala debe ser mayor que el punto más bajo (15 ppb).';
    }
  }
  const factor = draft.unit === 'ppm' ? 1 / 1000 : 1;

  function apply() {
    if (!setpoints || !scale) return;
    const sp = setpoints;
    const scalePpb = scale.scalePpb;
    update((d) => ({
      ...d,
      calibrationScalePpb: formatInputNumber(scalePpb),
      cycles: d.cycles.map((c) => {
        const rows = [...c.rows];
        while (rows.length < sp.length) rows.push(emptyRow());
        return { ...c, rows: rows.map((r, i) => (i < sp.length ? { ...r, setpoint: formatInputNumber(Number((sp[i] * factor).toPrecision(12))) } : r)) };
      }),
    }));
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Escala = 1,5 × máximo horario de 3 años; si queda por debajo de la norma, 1,5 × la norma. Se proponen el cero y 6 puntos (§7.6).
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Máximo horario de 3 años (ppb)">
          <DecimalInput value={max3y} invalid={invalid(max3y)} onChange={(e) => setMax3y(e.target.value)} />
        </Field>
        <Field label="Norma de calidad del aire (ppb)">
          <DecimalInput value={standard} invalid={invalid(standard)} onChange={(e) => setStandard(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button variant="primary" disabled={readOnly || !setpoints} onClick={apply}>
            Aplicar a todos los ciclos
          </Button>
        </div>
      </div>
      {scale && (
        <p className="text-sm text-gray-800">
          Escala: <b className="tabular-nums">{formatPpb(scale.scalePpb)} ppb</b> ({scale.basis === 'STANDARD' ? '1,5 × la norma' : '1,5 × máximo de 3 años'})
          {setpoints && (
            <>
              . Puntos: <span className="tabular-nums">{setpoints.map((p) => formatNumber(p, 1)).join(' · ')}</span> ppb
            </>
          )}
        </p>
      )}
      {error && <Alert tone="amber">{error}</Alert>}
      {draft.calibrationScalePpb && <p className="text-xs text-gray-500">Escala guardada en el registro: {draft.calibrationScalePpb} ppb.</p>}
    </div>
  );
}

/** Step 3: editable point table per cycle, CSV import, scale assistant, live calculation. */
export default function StepPoints({
  draft,
  update,
  readOnly,
  rowOrders,
  live,
  eq10Applied,
}: {
  draft: DraftState;
  update: Updater;
  readOnly: boolean;
  rowOrders: Record<number, (number | null)[]>;
  live: LiveEvaluation;
  eq10Applied: boolean;
}) {
  const [showCells, setShowCells] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const unit = draft.unit;

  const setCell = (cycle: number, row: number, key: keyof PointRow, value: string) =>
    update((d) => ({
      ...d,
      cycles: d.cycles.map((c) => (c.index !== cycle ? c : { ...c, rows: c.rows.map((r, i) => (i === row ? { ...r, [key]: value } : r)) })),
    }));
  const addRow = (cycle: number) =>
    update((d) => ({ ...d, cycles: d.cycles.map((c) => (c.index === cycle ? { ...c, rows: [...c.rows, emptyRow()] } : c)) }));
  const removeRow = (cycle: number, row: number) =>
    update((d) => ({ ...d, cycles: d.cycles.map((c) => (c.index === cycle ? { ...c, rows: c.rows.filter((_, i) => i !== row) } : c)) }));
  const copySetpoints = () =>
    update((d) => {
      const first = d.cycles.find((c) => c.index === 1);
      if (!first) return d;
      return {
        ...d,
        cycles: d.cycles.map((c) => {
          if (c.index === 1) return c;
          const rows = [...c.rows];
          while (rows.length < first.rows.length) rows.push(emptyRow());
          return { ...c, rows: rows.map((r, i) => (i < first.rows.length ? { ...r, setpoint: first.rows[i].setpoint } : r)) };
        }),
      };
    });

  async function importCsv(file: File) {
    setImportErrors([]);
    setImportNotice(null);
    const r = parsePointsCsv(await file.text());
    const maxCycle = draft.cycles.length;
    const extra = r.cycles.filter((c) => c.index > maxCycle).map((c) => c.index);
    const errors = [...r.errors];
    if (extra.length) errors.push(`El archivo trae el ciclo ${extra.join(', ')} pero este registro tiene ${maxCycle} ciclo(s).`);
    if (r.cycles.length === 0 && errors.length === 0) errors.push('El archivo no tiene puntos.');
    if (errors.length) {
      setImportErrors(errors);
      return;
    }
    update((d) => {
      const converted = convertUnit(d, r.unit);
      return {
        ...converted,
        cycles: converted.cycles.map((c) => r.cycles.find((x) => x.index === c.index) ?? c),
      };
    });
    setImportNotice(`Importados ${r.cycles.reduce((n, c) => n + c.rows.length, 0)} puntos (${r.unit}).`);
  }

  const liveCycles = live?.result?.cycles ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<Unit>
            label="Unidad de concentración"
            value={unit}
            onChange={(u) => update((d) => convertUnit(d, u))}
            options={[
              ['ppb', 'ppb'],
              ['ppm', 'ppm'],
            ]}
          />
          <Button onClick={() => setShowCells((v) => !v)}>{showCells ? 'Ocultar T/P de celda' : 'Mostrar T/P de celda'}</Button>
          <Button onClick={() => setShowScale((v) => !v)}>
            <Ruler className="h-4 w-4" aria-hidden /> Asistente de escala
          </Button>
          <Button onClick={() => downloadText(`plantilla-puntos-${draft.cycles.length}-ciclos.csv`, buildCsvTemplate(draft.kind))}>
            <Download className="h-4 w-4" aria-hidden /> Plantilla CSV
          </Button>
          {!readOnly && (
            <>
              <Button onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" aria-hidden /> Importar CSV
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void importCsv(f);
                }}
              />
            </>
          )}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Se admite coma o punto decimal. Los valores se guardan en ppb. La plantilla usa «;» como separador y coma decimal (Excel en español); también se acepta «,» con punto decimal.
        </p>
        {showScale && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <ScaleAssistant draft={draft} update={update} readOnly={readOnly} />
          </div>
        )}
        {importErrors.length > 0 && (
          <div className="mt-3">
            <Alert tone="red" title="No se importó el archivo">
              <ul className="list-disc pl-5">
                {importErrors.slice(0, 20).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Alert>
          </div>
        )}
        {importNotice && (
          <div className="mt-3">
            <Alert tone="green">{importNotice}</Alert>
          </div>
        )}
      </Card>

      {eq10Applied && (
        <Alert tone="blue">Las lecturas x se convierten con la Ec. 10 del patrón antes de calcular; la columna «x std» muestra el valor usado.</Alert>
      )}
      {live?.error && <Alert tone="red">{live.error}</Alert>}

      {draft.cycles.map((c) => {
        const lc = liveCycles.find((x) => x.index === c.index);
        const orders = rowOrders[c.index] ?? [];
        return (
          <Card
            key={c.index}
            title={`Ciclo ${c.index}`}
            actions={
              c.index === 1 &&
              draft.cycles.length > 1 &&
              !readOnly && (
                <Button onClick={copySetpoints}>
                  <Copy className="h-4 w-4" aria-hidden /> Copiar setpoints a los demás ciclos
                </Button>
              )
            }
          >
            <TableWrap>
              <table className={`w-full text-sm ${showCells ? 'min-w-[1100px]' : 'min-w-[720px]'}`}>
                <thead>
                  <tr>
                    <th className={TH}>#</th>
                    <th className={TH}>Setpoint ({unit})</th>
                    <th className={TH}>x patrón ({unit})</th>
                    <th className={TH}>y candidato ({unit})</th>
                    {showCells && CELL_COLUMNS.map(([k, l]) => <th key={k} className={TH}>{l}</th>)}
                    {eq10Applied && <th className={`${TH} ${NUM}`}>x std (ppb)</th>}
                    <th className={`${TH} ${NUM}`}>Diferencia</th>
                    <th className={TH}>Resultado</th>
                    {!readOnly && <th className={TH}><span className="sr-only">Quitar</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {c.rows.map((r, i) => {
                    const order = orders[i];
                    const lp = order ? lc?.points.find((p) => p.order === order) : undefined;
                    const input = (key: keyof PointRow, label: string, width = 'w-28') => (
                      <td className={`${TD} py-1`}>
                        <DecimalInput
                          aria-label={`${label}, ciclo ${c.index}, fila ${i + 1}`}
                          value={r[key]}
                          disabled={readOnly}
                          invalid={invalid(r[key])}
                          onChange={(e) => setCell(c.index, i, key, e.target.value)}
                          className={width}
                        />
                      </td>
                    );
                    return (
                      <tr key={i} className={lp ? (lp.pass ? '' : 'bg-red-50/60') : ''}>
                        <td className={`${TD} text-gray-500`}>{i + 1}</td>
                        {input('setpoint', 'Setpoint')}
                        {input('x', 'x patrón')}
                        {input('y', 'y candidato')}
                        {showCells && CELL_COLUMNS.map(([k, l]) => <Fragment key={k}>{input(k, l, 'w-24')}</Fragment>)}
                        {eq10Applied && <td className={`${TD} ${NUM}`}>{lp ? formatPpb(lp.xPpb) : '—'}</td>}
                        <td className={`${TD} ${NUM} whitespace-nowrap`}>{lp ? formatDiff(lp.diffValue, lp.diffType) : '—'}</td>
                        <td className={`${TD} whitespace-nowrap`}>{lp ? <PassMark pass={lp.pass} /> : <span className="text-gray-400">—</span>}</td>
                        {!readOnly && (
                          <td className={`${TD} py-1`}>
                            <Button variant="ghost" aria-label={`Quitar fila ${i + 1}`} onClick={() => removeRow(c.index, i)}>
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              {!readOnly ? (
                <Button variant="ghost" onClick={() => addRow(c.index)}>
                  <Plus className="h-4 w-4" aria-hidden /> Añadir punto
                </Button>
              ) : (
                <span />
              )}
              <div className="text-sm text-gray-700" aria-live="polite">
                {lc?.regression ? (
                  <span className="tabular-nums">
                    m = <b>{formatSlope(lc.regression.slope)}</b> · b = <b>{formatIntercept(lc.regression.intercept)}</b> ppb · r² ={' '}
                    <b>{formatNumber(lc.regression.r2, 5)}</b>
                  </span>
                ) : lc?.regressionError ? (
                  <span className="text-amber-700">{lc.regressionError}</span>
                ) : (
                  <span className="text-gray-400">Sin datos suficientes para la regresión</span>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
