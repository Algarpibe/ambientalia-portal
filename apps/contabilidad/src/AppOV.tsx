import { useState } from 'react';
import { PackageOpen } from 'lucide-react';
import OVPendientes from './OVPendientes';
import FacturasPorEntregar from './FacturasPorEntregar';

/**
 * App independiente del portal (`ov-pendientes`): seguimiento logístico SIN acceso a la
 * facturación. Dos pestañas que cubren los dos extremos del hueco donde se pierden las
 * entregas — antes de facturar (OV pendientes) y después (facturas con mercancía sin
 * empaquetar, que ya no aparecen en el primer listado).
 *
 * Reutiliza los mismos componentes que la app de Contabilidad, así que esa lógica —luces,
 * filtros y detalle— se mantiene en un único sitio.
 */
export default function AppOV() {
  const [tab, setTab] = useState<'ov' | 'entregas'>('ov');

  return (
    <main className="flex-grow bg-transparent p-6 overflow-y-auto">
      <header className="mb-6 flex items-center gap-3">
        <PackageOpen className="h-6 w-6 text-amber-600" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">OV pendientes de facturar</h1>
          <p className="text-sm text-gray-500">
            Seguimiento de entregas en vivo desde Zoho. Haz clic en una fila para ver su detalle.
          </p>
        </div>
      </header>

      {/* Ambas pestañas quedan montadas (se ocultan con `hidden`) para no perder filtros
          ni scroll al cambiar de una a otra. */}
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {([['ov', 'OV pendientes de facturar'], ['entregas', 'Facturas con entrega pendiente']] as const).map(
          ([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              aria-current={tab === k ? 'page' : undefined}
              className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
                tab === k
                  ? 'border-blue-500 font-semibold text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          ),
        )}
      </div>

      <div className={tab === 'ov' ? '' : 'hidden'}>
        <OVPendientes bare />
      </div>
      <div className={tab === 'entregas' ? '' : 'hidden'}>
        <FacturasPorEntregar />
      </div>
    </main>
  );
}
