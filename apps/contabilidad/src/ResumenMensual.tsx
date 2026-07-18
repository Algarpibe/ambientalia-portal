import type { Resumen } from './api';
import { formatCOP, formatPct } from './format';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export default function ResumenMensual({ resumen }: { resumen: Resumen }) {
  return (
    <section className="mt-8 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700">Resumen 2026</h2>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-soft">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-2 py-2 text-left font-semibold">Concepto</th>
              {MESES.map((m) => (
                <th key={m} className="px-2 py-2 text-right font-semibold">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="px-2 py-1 font-medium">Facturación</td>
              {resumen.meses.map((m) => (
                <td key={m.mes} className="px-2 py-1 text-right tabular-nums">{formatCOP(m.facturacion)}</td>
              ))}
            </tr>
            <tr>
              <td className="px-2 py-1 font-medium">Acumulado</td>
              {resumen.meses.map((m) => (
                <td key={m.mes} className="px-2 py-1 text-right tabular-nums">{formatCOP(m.acumulado)}</td>
              ))}
            </tr>
            <tr>
              <td className="px-2 py-1 font-medium">IVA</td>
              {resumen.meses.map((m) => (
                <td key={m.mes} className="px-2 py-1 text-right tabular-nums">{formatCOP(m.iva)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Facturado 2026 (sin IVA)" value={formatCOP(resumen.totalFacturadoSinIva)} />
        <Kpi label="Presupuesto 2026" value={formatCOP(resumen.presupuesto2026)} />
        <Kpi label="Cumplimiento" value={formatPct(resumen.cumplimientoPct)} />
        <Kpi label="IVA total 2026" value={formatCOP(resumen.totalIva)} />
        <Kpi label="Facturación 2025" value={formatCOP(resumen.facturacion2025)} />
        <Kpi label="Facturación 2024" value={formatCOP(resumen.facturacion2024)} />
      </div>
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-soft">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{value}</div>
    </div>
  );
}
