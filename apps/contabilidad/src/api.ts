const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// Espejo de apps/hub-api/src/contabilidad/domain.ts
export interface FacturaContable {
  invoiceNumber: string;
  razonSocial: string;
  qt: string;
  fechaFactura: string;
  fechaVencimiento: string;
  ov: string;
  trato: string;
  ticket: string;
  total: number;
  iva: number;
  totalConIva: number;
  cobradoPct: number;
  cobrado: number;
  porCobrar: number;
  retenciones: number;
  participacion: number;
  cartera: string;
}

export interface ResumenMes {
  mes: number;
  facturacion: number;
  iva: number;
  acumulado: number;
}

export interface Resumen {
  meses: ResumenMes[];
  totalFacturadoSinIva: number;
  totalIva: number;
  presupuesto: number | null;
  cumplimientoPct: number | null;
  comparativos: { anio: number; facturado: number }[];
}

export interface ContabilidadData {
  facturas: FacturaContable[];
  resumen: Resumen;
  anioActual: number;
  aniosDisponibles: number[];
}

// Espejo de apps/hub-api/src/salesOrders.ts (endpoint /api/sales-orders/pending)
export interface PendingSalesOrder {
  salesorder_number: string;
  date: string;
  customer_name: string | null;
  status: string; // 'open' | 'overdue' | 'partially_invoiced'
  currency_code: string | null;
  total: number;
  pending: number; // valor aún por facturar
  shipment_date: string | null;
}

export interface OVPendienteFacturable extends PendingSalesOrder {
  despachada: boolean;
  soloPaquete: boolean;
  ticketPorFacturar: boolean;
  facturable: boolean;
  ticket: string | null;
}

async function mensajeDeError(res: Response): Promise<string> {
  if (res.status === 401) return 'Tu sesión ha caducado. Vuelve a entrar en el portal e inténtalo de nuevo.';
  if (res.status === 403) return 'No tienes esta aplicación asignada. Pide acceso a un administrador del portal.';
  return `No se pudieron cargar los datos (error ${res.status}). Inténtalo de nuevo en un momento.`;
}

/** Carga las facturas del año + resumen. Lanza Error con mensaje en español si falla. */
export async function fetchContabilidad(year?: number): Promise<ContabilidadData> {
  const qs = year ? `?year=${year}` : '';
  const res = await fetch(`${API_BASE}/api/contabilidad/facturas${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return (await res.json()) as ContabilidadData;
}

/** Guarda la cartera de una factura. Lanza Error con mensaje en español si falla. */
export async function guardarCartera(invoiceNumber: string, cartera: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/contabilidad/cartera/${encodeURIComponent(invoiceNumber)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ cartera }),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}

/** Guarda el presupuesto de un año (solo admin en el backend). */
export async function guardarPresupuesto(year: number, presupuesto: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/contabilidad/budget/${year}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ presupuesto }),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}

/** Carga las OV pendientes con las señales "facturable" (endpoint propio de contabilidad). */
export async function fetchOVPendientes(): Promise<OVPendienteFacturable[]> {
  const res = await fetch(`${API_BASE}/api/contabilidad/ov-pendientes`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const data = (await res.json()) as { orders?: OVPendienteFacturable[] };
  if (!Array.isArray(data.orders)) throw new Error('Formato inesperado del hub (OV pendientes).');
  return data.orders;
}

/** True si el JWT en localStorage tiene rol admin (solo para gating de UX). */
export function esAdmin(): boolean {
  const t = localStorage.getItem('ambientalia_token');
  if (!t) return false;
  try {
    const payload = JSON.parse(atob(t.split('.')[1] || ''));
    return payload.role === 'admin';
  } catch {
    return false;
  }
}
