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
