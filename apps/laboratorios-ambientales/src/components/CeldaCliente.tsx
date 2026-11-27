import type { CruceZoho, EstadoCliente, EstadoCruce } from '../lib/clientes';
import { ETIQUETA_ESTADO_CLIENTE, estadoCliente, hechosDe } from '../lib/clientes';

type Props = {
  nit: string;
  cruce: CruceZoho | null;
  estadoCruce: EstadoCruce;
  hoy: string;
};

// La etiqueta lleva siempre su texto: el color solo acompaña.
const INSIGNIA_CLIENTE: Record<EstadoCliente, string> = {
  activo: 'bg-emerald-100 text-emerald-800',
  antiguo: 'bg-amber-100 text-amber-800',
  'sin-compras': 'bg-sky-100 text-sky-800',
  'no-en-zoho': 'bg-slate-100 text-slate-700',
  'sin-nit': 'bg-slate-100 text-slate-600',
};

export default function CeldaCliente({ nit, cruce, estadoCruce, hoy }: Props) {
  // El aviso para lectores de pantalla va en la línea del recuento, una sola vez.
  if (estadoCruce === 'cargando') return <span className="text-xs text-slate-500">Consultando…</span>;
  if (estadoCruce === 'error' || cruce === null) return <span className="text-slate-500">—</span>;

  const estado = estadoCliente(nit, cruce, hoy);
  const hechos = hechosDe(nit, cruce);
  return (
    <>
      <span
        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${INSIGNIA_CLIENTE[estado]}`}
      >
        {ETIQUETA_ESTADO_CLIENTE[estado]}
      </span>
      {hechos?.ultimaFactura && (
        <p className="mt-1 text-xs text-slate-600 whitespace-nowrap">Última factura {hechos.ultimaFactura}</p>
      )}
      {hechos?.ocmaVendido && <p className="text-xs text-slate-600 whitespace-nowrap">OCMA vendido {hechos.ocmaVendido}</p>}
      {hechos?.ultimosRepuestos && (
        <p className="text-xs text-slate-600 whitespace-nowrap">Repuestos OCMA {hechos.ultimosRepuestos}</p>
      )}
    </>
  );
}
