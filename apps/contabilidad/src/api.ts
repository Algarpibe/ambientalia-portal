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
  presupuesto2026: number;
  facturacion2025: number;
  facturacion2024: number;
  cumplimientoPct: number;
}

export interface ContabilidadData {
  facturas: FacturaContable[];
  resumen: Resumen;
}

async function mensajeDeError(res: Response): Promise<string> {
  if (res.status === 401) return 'Tu sesión ha caducado. Vuelve a entrar en el portal e inténtalo de nuevo.';
  if (res.status === 403) return 'No tienes esta aplicación asignada. Pide acceso a un administrador del portal.';
  return `No se pudieron cargar los datos (error ${res.status}). Inténtalo de nuevo en un momento.`;
}

/** Carga las facturas 2026 + resumen. Lanza Error con mensaje en español si falla. */
export async function fetchContabilidad(): Promise<ContabilidadData> {
  const res = await fetch(`${API_BASE}/api/contabilidad/facturas`, { headers: authHeaders() });
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
