/**
 * Verification report (Annex A of IN.5.5.3-XX / -YY) as a react-pdf document.
 * Layout only: every value comes formatted from `buildReportModel` and is
 * made WinAnsi-safe here (built-in Helvetica, no font download).
 */
import { Circle, Document, G, Line, Page, Rect, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import { chartGeometry } from '../lib/chartGeometry';
import { pdfSafeDeep } from '../lib/pdfText';
import type { ReportModel, Row, SummaryRow } from '../lib/report';

export const CYCLE_COLORS = ['#2563eb', '#059669', '#d97706'];

const s = StyleSheet.create({
  page: { paddingTop: 88, paddingBottom: 44, paddingHorizontal: 32, fontSize: 8, fontFamily: 'Helvetica', color: '#111827' },
  header: { position: 'absolute', top: 24, left: 32, right: 32, borderBottomWidth: 1, borderBottomColor: '#1f2937', paddingBottom: 6 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  company: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  title: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  small: { fontSize: 7, color: '#4b5563' },
  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.5, color: '#6b7280', borderTopWidth: 0.5, borderTopColor: '#d1d5db', paddingTop: 4 },
  watermark: { position: 'absolute', top: 360, left: 40, width: 520, textAlign: 'center', fontSize: 44, fontFamily: 'Helvetica-Bold', color: '#dc2626', opacity: 0.16, transform: 'rotate(-35deg)' },
  h2: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 4, color: '#1e3a8a' },
  h3: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', marginTop: 6, marginBottom: 2 },
  kvGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  kv: { width: '50%', flexDirection: 'row', paddingVertical: 1.5, paddingRight: 6, borderBottomWidth: 0.4, borderBottomColor: '#e5e7eb' },
  kvLabel: { width: '45%', color: '#4b5563' },
  kvValue: { width: '55%', fontFamily: 'Helvetica-Bold' },
  table: { borderWidth: 0.5, borderColor: '#9ca3af' },
  tr: { flexDirection: 'row', borderBottomWidth: 0.4, borderBottomColor: '#d1d5db' },
  th: { backgroundColor: '#f3f4f6', fontFamily: 'Helvetica-Bold' },
  td: { paddingVertical: 2, paddingHorizontal: 3 },
  num: { textAlign: 'right' },
  fail: { color: '#b91c1c', fontFamily: 'Helvetica-Bold' },
  conclusion: { marginTop: 8, padding: 8, borderWidth: 1.5 },
  sigRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 26 },
  sig: { width: '45%', borderTopWidth: 0.8, borderTopColor: '#111827', paddingTop: 3 },
});

function KV({ rows }: { rows: Row[] }) {
  return (
    <View style={s.kvGrid}>
      {rows.map((r) => (
        <View key={r.label} style={s.kv} wrap={false}>
          <Text style={s.kvLabel}>{r.label}</Text>
          <Text style={s.kvValue}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

interface Col {
  title: string;
  width: string;
  num?: boolean;
}

function Table({ cols, rows, failCol }: { cols: Col[]; rows: string[][]; failCol?: number }) {
  return (
    <View style={s.table}>
      <View style={[s.tr, s.th]} fixed>
        {cols.map((c, i) => (
          <Text key={i} style={[s.td, { width: c.width }, ...(c.num ? [s.num] : [])]}>
            {c.title}
          </Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.tr} wrap={false}>
          {r.map((cell, j) => (
            <Text
              key={j}
              style={[s.td, { width: cols[j].width }, ...(cols[j].num ? [s.num] : []), ...(j === failCol && /^No/.test(cell) ? [s.fail] : [])]}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const passText = (p: boolean | null) => (p === null ? '—' : p ? 'Cumple' : 'No cumple');

function summaryRows(rows: SummaryRow[]) {
  return rows.map((r) => [r.label, r.value, r.limit, passText(r.pass)]);
}

function Chart({ model }: { model: ReportModel }) {
  const width = 520;
  const height = 260;
  const g = chartGeometry(model.chart, { width, height, padLeft: 36, padRight: 12, padTop: 10, padBottom: 28 });
  const { plot } = g;
  return (
    <View wrap={false}>
      <Svg width={width} height={height}>
        <Rect x={plot.x} y={plot.y} width={plot.width} height={plot.height} stroke="#9ca3af" strokeWidth={0.6} fill="none" />
        {g.xTicks.map((t) => (
          <G key={`x${t.label}`}>
            <Line x1={t.pos} y1={plot.y} x2={t.pos} y2={plot.y + plot.height} stroke="#e5e7eb" strokeWidth={0.4} />
            <Text x={t.pos - 6} y={plot.y + plot.height + 10} style={{ fontSize: 6.5 }}>
              {t.label}
            </Text>
          </G>
        ))}
        {g.yTicks.map((t) => (
          <G key={`y${t.label}`}>
            <Line x1={plot.x} y1={t.pos} x2={plot.x + plot.width} y2={t.pos} stroke="#e5e7eb" strokeWidth={0.4} />
            <Text x={plot.x - 24} y={t.pos + 2} style={{ fontSize: 6.5 }}>
              {t.label}
            </Text>
          </G>
        ))}
        <Line {...g.identity} stroke="#6b7280" strokeWidth={0.8} strokeDasharray="3,2" />
        {g.lines.map((l) => (
          <Line key={`l${l.cycle}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={CYCLE_COLORS[(l.cycle - 1) % 3]} strokeWidth={1} />
        ))}
        {g.points.map((p, i) => (
          <Circle key={i} cx={p.cx} cy={p.cy} r={2} fill={CYCLE_COLORS[(p.cycle - 1) % 3]} />
        ))}
        <Text x={plot.x + plot.width / 2 - 40} y={height - 4} style={{ fontSize: 7 }}>
          x patrón (ppb)
        </Text>
      </Svg>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 2 }}>
        {model.chart.cycles.map((c) => (
          <Text key={c.index} style={{ color: CYCLE_COLORS[(c.index - 1) % 3] }}>
            • Ciclo {c.index} (regresión Ec. 5)
          </Text>
        ))}
        <Text style={{ color: '#6b7280' }}>- - línea 1:1</Text>
      </View>
      <Text style={s.small}>Eje vertical: y candidato (ppb).</Text>
    </View>
  );
}

export function ReportDocument({ model: raw }: { model: ReportModel }) {
  const m = pdfSafeDeep(raw);
  const ok = raw.conclusion.result === 'CONFORME';
  const pointCols: Col[] = [
    { title: 'Punto', width: '9%' },
    { title: 'Setpoint (ppb)', width: '11%', num: true },
    { title: 'x leído (ppb)', width: '11%', num: true },
    ...(m.eq10Applied ? [{ title: 'x patrón Ec.10', width: '11%', num: true }] : []),
    { title: 'y (ppb)', width: '11%', num: true },
    { title: 'T celda x/y (°C)', width: m.eq10Applied ? '12%' : '15%', num: true },
    { title: 'P celda x/y (torr)', width: m.eq10Applied ? '13%' : '16%', num: true },
    { title: '%Diff / AbsDiff', width: '13%', num: true },
    { title: 'Cumple', width: m.eq10Applied ? '9%' : '14%' },
  ];

  return (
    <Document title={`Informe ${m.recordId}`} author={m.company} subject={m.title}>
      <Page size="A4" style={s.page}>
        <View style={s.header} fixed>
          <View style={s.headerRow}>
            <Text style={s.company}>{m.company}</Text>
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>{m.procedure.code} · Anexo A</Text>
          </View>
          <Text style={s.title}>{m.title}</Text>
          <View style={s.headerRow}>
            <Text style={s.small}>{m.procedure.title}</Text>
            <Text style={s.small}>
              Registro {m.recordId} · versión {m.version} · {m.statusLabel}
            </Text>
          </View>
        </View>
        {m.watermark && (
          <Text style={s.watermark} fixed>
            {m.watermark}
          </Text>
        )}

        <Text style={s.h2}>1. Datos generales</Text>
        <KV rows={m.general} />
        {m.changeReason && <Text style={[s.small, { marginTop: 3 }]}>Motivo de esta versión: {m.changeReason}</Text>}
        <Text style={s.h2}>Pruebas de aceptación y condiciones ambientales</Text>
        <KV rows={m.acceptance} />

        <Text style={s.h2}>2. Datos por ciclo</Text>
        {m.cycles.map((c) => (
          <View key={c.index} wrap={false}>
            <Text style={s.h3}>
              Ciclo {c.index} · {c.date}
            </Text>
            <Table
              cols={pointCols}
              failCol={pointCols.length - 1}
              rows={c.rows.map((r) => [r.label, r.setpoint, r.x, ...(m.eq10Applied ? [r.xStd] : []), r.y, r.cellT, r.cellP, r.diff, r.pass])}
            />
          </View>
        ))}
        <Text style={s.small}>
          %Diff (Ec. 1) para x por encima del umbral; diferencia absoluta en ppb (Ec. 2) para x hasta el umbral, incluido el cero. Punto 0 = cero.
        </Text>

        <Text style={s.h2} break>
          3. Resultados
        </Text>
        <Table
          cols={[
            { title: 'Ciclo', width: '8%' },
            { title: 'Fecha', width: '12%' },
            { title: 'Pendiente m', width: '13%', num: true },
            { title: 'Criterio m', width: '14%' },
            { title: 'Cumple', width: '10%' },
            { title: 'Intercepto b (ppb)', width: '15%', num: true },
            { title: 'Criterio b', width: '14%' },
            { title: 'Cumple', width: '14%' },
          ]}
          rows={m.results.cycles.map((c) => [
            String(c.index),
            c.date,
            c.slope,
            c.slopeCheck?.limit ?? '—',
            passText(c.slopeCheck?.pass ?? null),
            c.intercept,
            c.interceptCheck?.limit ?? '—',
            passText(c.interceptCheck?.pass ?? null),
          ])}
        />
        <Text style={s.h3}>Promedios y desviaciones estándar (poblacionales)</Text>
        <Table
          cols={[
            { title: 'Magnitud', width: '40%' },
            { title: 'Valor', width: '20%', num: true },
            { title: 'Criterio', width: '20%' },
            { title: 'Resultado', width: '20%' },
          ]}
          failCol={3}
          rows={summaryRows(m.results.summary)}
        />
        {m.results.reverification.length > 0 && (
          <>
            <Text style={s.h3}>Reverificación: comparación con la última verificación completa</Text>
            <Table
              cols={[
                { title: 'Magnitud', width: '40%' },
                { title: 'Valor', width: '20%', num: true },
                { title: 'Criterio', width: '20%' },
                { title: 'Resultado', width: '20%' },
              ]}
              failCol={3}
              rows={summaryRows(m.results.reverification)}
            />
          </>
        )}

        <View style={[s.conclusion, { borderColor: ok ? '#059669' : '#b91c1c' }]} wrap={false}>
          <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: ok ? '#065f46' : '#991b1b' }}>{m.conclusion.result}</Text>
          {m.conclusion.failReasons.map((r) => (
            <Text key={r} style={{ color: '#991b1b' }}>
              • {r}
            </Text>
          ))}
          <KV
            rows={[
              { label: 'Nivel asignado', value: m.conclusion.level },
              { label: 'Vigente hasta', value: m.conclusion.validUntil },
              ...(m.conclusion.reverificationDue ? [{ label: 'Reverificación antes de', value: m.conclusion.reverificationDue }] : []),
              { label: 'Ec. 10 vigente del candidato', value: m.conclusion.eq10 },
              { label: 'Uso de la Ec. 10', value: m.conclusion.eq10Applies ? 'Sí (opción 2)' : 'No (opción 1: factores ajustados)' },
            ]}
          />
          <View style={s.sigRow}>
            <View style={s.sig}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>Técnico que realizó la verificación</Text>
              <Text>{m.conclusion.technician}</Text>
            </View>
            <View style={s.sig}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>Director Técnico</Text>
              <Text>
                {m.conclusion.director} · {m.conclusion.approvedAt}
              </Text>
            </View>
          </View>
        </View>

        <Text style={s.h2}>Gráfico y vs x con las rectas de regresión</Text>
        <Chart model={m} />

        <Text style={s.h2} break>
          4. Criterios de aceptación y referencias normativas
        </Text>
        <Table
          cols={[
            { title: 'Regla', width: '7%' },
            { title: 'Criterio', width: '33%' },
            { title: 'Valor', width: '11%', num: true },
            { title: 'Límite', width: '11%' },
            { title: 'Resultado', width: '11%' },
            { title: 'Referencia normativa', width: '27%' },
          ]}
          failCol={4}
          rows={m.rules.map((r) => [r.id, r.text, r.value, r.limit, r.result, r.reference])}
        />
        <Text style={s.small}>Las reglas V1 y V2 de cada punto están en las tablas del apartado 2.</Text>

        <View style={s.footer} fixed>
          <Text>
            Motor {m.engineVersion} · límites {m.limitsVersion} · resultado calculado por el servidor · generado el {m.generatedAt}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
