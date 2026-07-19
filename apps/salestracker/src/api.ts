const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// Espejo de apps/hub-api/src/salestracker/types.ts
export type RecordType = 'SALES_ORDER' | 'INVOICE' | 'BACKLOG';
export interface SalesRow {
  categoryName: string;
  recordType: RecordType;
  month: number;
  year: number;
  amountUsd: number;
}

async function mensajeDeError(res: Response): Promise<string> {
  if (res.status === 401) return 'Tu sesión ha caducado. Vuelve a entrar en el portal e inténtalo de nuevo.';
  if (res.status === 403) return 'No tienes esta aplicación asignada. Pide acceso a un administrador del portal.';
  return `No se pudieron cargar los datos (error ${res.status}). Inténtalo de nuevo en un momento.`;
}

/** Carga las filas de ventas agregadas del hub. Lanza Error con mensaje en español si falla. */
export async function fetchSales(): Promise<SalesRow[]> {
  const res = await fetch(`${API_BASE}/api/salestracker/sales`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const data = (await res.json()) as { rows?: SalesRow[] };
  if (!Array.isArray(data.rows)) throw new Error('Formato inesperado del hub (ventas).');
  return data.rows;
}

// Espejo de apps/hub-api/src/salestracker/types.ts
export type RecordTypeIO = 'SALES_ORDER' | 'INVOICE';
export interface ItemSalesRow {
  itemId: string;
  sku: string | null;
  nombre: string;
  categoria: string | null;
  cantidad: number;
  importe: number;
}

/** Ventas por artículo (tipo OV/FAC, rango de fechas YYYY-MM-DD). */
export async function fetchItemSales(params: { tipo: RecordTypeIO; desde: string; hasta: string }): Promise<ItemSalesRow[]> {
  const qs = new URLSearchParams({ tipo: params.tipo, desde: params.desde, hasta: params.hasta });
  const res = await fetch(`${API_BASE}/api/salestracker/item-sales?${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const data = (await res.json()) as { rows?: ItemSalesRow[] };
  if (!Array.isArray(data.rows)) throw new Error('Formato inesperado del hub (artículos).');
  return data.rows;
}

// Espejo de apps/hub-api/src/salestracker/types.ts
export interface CustomerYearRow {
  customer: string;
  year: number;
  ventas: number;
}

/** Ventas por cliente y año (tipo OV/FAC, rango de años). */
export async function fetchCustomerSales(params: { tipo: RecordTypeIO; desdeAnio: number; hastaAnio: number }): Promise<CustomerYearRow[]> {
  const qs = new URLSearchParams({ tipo: params.tipo, desdeAnio: String(params.desdeAnio), hastaAnio: String(params.hastaAnio) });
  const res = await fetch(`${API_BASE}/api/salestracker/customer-sales?${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const data = (await res.json()) as { rows?: CustomerYearRow[] };
  if (!Array.isArray(data.rows)) throw new Error('Formato inesperado del hub (clientes).');
  return data.rows;
}

// Espejo de apps/hub-api/src/salestracker/types.ts
export interface CustomerItemRow {
  customer: string;
  sku: string | null;
  marca: string | null;
  nombre: string;
  categoria: string | null;
  cantidad: number;
  importe: number;
}
export interface CustomerMonthRow {
  customer: string;
  mes: number;
  importe: number;
}
export interface MarginCustomerRow {
  customer: string;
  ventas: number;
  costo: number;
}

/** Helper genérico: GET {path}?{params} → { rows: T[] }. Lanza Error en español si falla. */
async function fetchRows<T>(path: string, params: Record<string, string>, contexto: string): Promise<T[]> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${API_BASE}${path}?${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const data = (await res.json()) as { rows?: T[] };
  if (!Array.isArray(data.rows)) throw new Error(`Formato inesperado del hub (${contexto}).`);
  return data.rows;
}

/** Ventas por (cliente, artículo) en un año (tipo OV/FAC). */
export const fetchCustomerItemSales = (p: { tipo: RecordTypeIO; anio: number }) =>
  fetchRows<CustomerItemRow>('/api/salestracker/customer-item-sales', { tipo: p.tipo, anio: String(p.anio) }, 'cliente×artículo');

/** Ventas por (cliente, mes) en un año (tipo OV/FAC). */
export const fetchCustomerMonthSales = (p: { tipo: RecordTypeIO; anio: number }) =>
  fetchRows<CustomerMonthRow>('/api/salestracker/customer-month-sales', { tipo: p.tipo, anio: String(p.anio) }, 'estacionalidad');

/** Ventas y costo estándar por cliente en un año (tipo OV/FAC). */
export const fetchMarginByCustomer = (p: { tipo: RecordTypeIO; anio: number }) =>
  fetchRows<MarginCustomerRow>('/api/salestracker/margin-by-customer', { tipo: p.tipo, anio: String(p.anio) }, 'margen');
