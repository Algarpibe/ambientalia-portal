import { useState } from 'react';
import type { Resumen } from './api';
import { formatCOP, formatPct } from './format';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

interface Props {
  resumen: Resumen;
  anio: number;
  puedeEditar: boolean; // rol admin
  onGuardarPresupuesto: (presupuesto: number) => void;
  guardandoPresupuesto: boolean;
}

export default function ResumenMensual({ resumen, anio, puedeEditar, onGuardarPresupuesto, guardandoPresupuesto }: Props) {
  return (
    <section className="mt-8 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700">Resumen {anio}</h2>

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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kpi label={`Facturado ${anio} (sin IVA)`} value={formatCOP(resumen.totalFacturadoSinIva)} />
        <PresupuestoKpi
          anio={anio}
          presupuesto={resumen.presupuesto}
          puedeEditar={puedeEditar}
          guardando={guardandoPresupuesto}
          onGuardar={onGuardarPresupuesto}
        />
        <Kpi label="Cumplimiento" value={resumen.cumplimientoPct === null ? '—' : formatPct(resumen.cumplimientoPct)} />
        <Kpi label={`IVA total ${anio}`} value={formatCOP(resumen.totalIva)} />
        {resumen.comparativos.map((c) => (
          <Kpi key={c.anio} label={`Facturación ${c.anio}`} value={formatCOP(c.facturado)} />
        ))}
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

function PresupuestoKpi({
  anio, presupuesto, puedeEditar, guardando, onGuardar,
}: {
  anio: number; presupuesto: number | null; puedeEditar: boolean; guardando: boolean; onGuardar: (n: number) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');

  if (editando) {
    return (
      <div className="rounded-2xl border border-blue-300 bg-white p-4 shadow-soft">
        <div className="text-[11px] uppercase tracking-wide text-gray-500">Presupuesto {anio}</div>
        <input
          autoFocus
          type="number"
          defaultValue={presupuesto ?? ''}
          onChange={(e) => setValor(e.target.value)}
          disabled={guardando}
          className="mt-1 w-full rounded border border-gray-300 px-1 py-0.5 text-lg tabular-nums focus:border-blue-400 focus:outline-none"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => { const n = Number(valor); if (Number.isFinite(n) && n >= 0) onGuardar(n); setEditando(false); }}
            className="rounded bg-blue-500 px-2 py-0.5 text-xs font-semibold text-white hover:bg-blue-600"
          >Guardar</button>
          <button onClick={() => setEditando(false)} className="rounded px-2 py-0.5 text-xs text-gray-500 hover:text-gray-800">Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-gray-500">Presupuesto {anio}</div>
        {puedeEditar && (
          <button onClick={() => { setValor(String(presupuesto ?? '')); setEditando(true); }} className="text-[11px] text-blue-500 hover:underline">
            editar
          </button>
        )}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
        {presupuesto === null ? 'sin configurar' : formatCOP(presupuesto)}
      </div>
    </div>
  );
}
