/** Standard label (IN.5.5.3 §11.1) as a one-page react-pdf document of a configurable size. */
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { labelPageSize, type LabelModel } from '../lib/label';
import { pdfSafeDeep } from '../lib/pdfText';

export function LabelDocument({ model: raw, size }: { model: LabelModel; size: { widthMm: number; heightMm: number } }) {
  const m = pdfSafeDeep(raw);
  const [w, h] = labelPageSize(size);
  // Font scales with the page width so the same layout fits 100 mm and A5.
  const base = Math.max(6, Math.min(10, w / 42));
  const s = StyleSheet.create({
    page: { padding: 10, fontFamily: 'Helvetica', fontSize: base, color: '#111827' },
    frame: { borderWidth: 1.2, borderColor: '#111827', padding: 6, flexGrow: 1 },
    head: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 0.8, borderBottomColor: '#111827', paddingBottom: 3, marginBottom: 3 },
    bold: { fontFamily: 'Helvetica-Bold' },
    title: { fontFamily: 'Helvetica-Bold', fontSize: base * 1.25, textAlign: 'center', marginVertical: 2 },
    legend: { fontFamily: 'Helvetica-Bold', fontSize: base * 1.3, textAlign: 'center', color: '#ffffff', backgroundColor: '#111827', paddingVertical: 2, marginBottom: 3 },
    row: { flexDirection: 'row', paddingVertical: 0.8, borderBottomWidth: 0.3, borderBottomColor: '#d1d5db' },
    label: { width: '42%', color: '#374151' },
    value: { width: '58%', fontFamily: 'Helvetica-Bold' },
    tr: { flexDirection: 'row', borderBottomWidth: 0.3, borderBottomColor: '#9ca3af' },
    td: { width: '25%', paddingVertical: 0.8, textAlign: 'right' },
    small: { fontSize: base * 0.8, color: '#4b5563', marginTop: 3 },
  });
  const cell = (t: string, first = false) => <Text style={[s.td, ...(first ? [{ textAlign: 'left' as const }] : [])]}>{t}</Text>;

  return (
    <Document title={`Etiqueta ${m.recordRef}`} author={m.company}>
      <Page size={[w, h]} style={s.page}>
        <View style={s.frame}>
          <View style={s.head}>
            <Text style={s.bold}>{m.company}</Text>
            <Text>{m.procedureCode}</Text>
          </View>
          <Text style={s.title}>PATRÓN DE TRANSFERENCIA DE OZONO</Text>
          {m.benchLegend && <Text style={s.legend}>{m.benchLegend}</Text>}
          {m.fields.map((f) => (
            <View key={f.label} style={s.row}>
              <Text style={s.label}>{f.label}</Text>
              <Text style={s.value}>{f.value}</Text>
            </View>
          ))}
          <View style={{ marginTop: 4 }}>
            <View style={[s.tr, s.bold]}>
              {cell('Ciclo', true)}
              {cell('Fecha')}
              {cell('Pendiente m')}
              {cell('Intercepto b')}
            </View>
            {m.cycles.map((c) => (
              <View key={c.index} style={s.tr}>
                {cell(String(c.index), true)}
                {cell(c.date)}
                {cell(c.slope)}
                {cell(c.intercept)}
              </View>
            ))}
            <View style={[s.tr, s.bold]}>
              {cell('Promedio', true)}
              {cell('')}
              {cell(m.mean.slope)}
              {cell(m.mean.intercept)}
            </View>
          </View>
          {m.eq10 && (
            <Text style={[s.bold, { marginTop: 4 }]}>
              Ec. 10 vigente: {m.eq10}
            </Text>
          )}
          <Text style={s.small}>Intercepto en ppb. Registro {m.recordRef}.</Text>
        </View>
      </Page>
    </Document>
  );
}
