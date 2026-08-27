import { PackageOpen } from 'lucide-react';
import OVPendientes from './OVPendientes';

/**
 * App independiente del portal (`ov-pendientes`): SOLO el listado de OV pendientes
 * de facturar. Reutiliza el mismo componente que la pestaña de Contabilidad —luces,
 * filtros y modal de detalle incluidos—, así que esa lógica se mantiene en un único
 * sitio. Se asigna por separado a quien no necesita ver la facturación.
 */
export default function AppOV() {
  return (
    <main className="flex-grow bg-transparent p-6 overflow-y-auto">
      <header className="mb-6 flex items-center gap-3">
        <PackageOpen className="h-6 w-6 text-amber-600" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">OV pendientes de facturar</h1>
          <p className="text-sm text-gray-500">
            Órdenes de venta con saldo por facturar, en vivo desde Zoho. Haz clic en una fila para ver su detalle.
          </p>
        </div>
      </header>
      <OVPendientes bare />
    </main>
  );
}
