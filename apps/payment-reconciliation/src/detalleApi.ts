const API_BASE = import.meta.env.VITE_HUB_API_URL as string;
function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export interface DetalleLinea { sku: string; nombre: string; cantidad: number; precio: number; total: number; }
export interface DetalleFactura {
  numero: string; cliente: string; nit: string | null; direccion: string | null;
  fecha: string; vencimiento: string | null; terminos: string | null; ov: string | null;
  saldo: number; lineas: DetalleLinea[]; subtotal: number; iva: number; total: number;
}
export interface DetalleOV {
  numero: string; cliente: string; nit: string | null; direccion: string | null;
  fecha: string; entrega: string | null; terminos: string | null;
  lineas: DetalleLinea[]; subtotal: number; iva: number; total: number;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 404) throw new Error('No encontrado.');
  if (!res.ok) throw new Error(`No se pudo cargar el detalle (error ${res.status}).`);
  return (await res.json()) as T;
}
export const fetchFacturaDetalle = (numero: string) =>
  get<DetalleFactura>(`${API_BASE}/api/invoices/${encodeURIComponent(numero)}/detail`);
export const fetchOVDetalle = (numero: string) =>
  get<DetalleOV>(`${API_BASE}/api/sales-orders/${encodeURIComponent(numero)}/detail`);
