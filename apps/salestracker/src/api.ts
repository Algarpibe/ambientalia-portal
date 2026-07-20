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
  if (res.status === 409) return 'Ya existe una categoría con ese nombre.';
  if (res.status === 400) {
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) return data.error;
    } catch { /* sin cuerpo JSON */ }
    return 'Datos inválidos. Revisa el formulario e inténtalo de nuevo.';
  }
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
export interface MarginYearRow {
  year: number;
  ventas: number;
  costo: number;
}
export interface MarginItemRow {
  itemId: string;
  sku: string | null;
  nombre: string;
  ventas: number;
  costo: number;
}
export interface CategoryMonthRow {
  mes: number;
  categoria: string | null;
  importe: number;
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

/** Ventas y costo estándar agregados por año, toda la historia (tipo OV/FAC). */
export const fetchMarginByYear = (p: { tipo: RecordTypeIO }) =>
  fetchRows<MarginYearRow>('/api/salestracker/margin-by-year', { tipo: p.tipo }, 'margen por año');

/** Ventas y costo estándar por artículo en un año (tipo OV/FAC). */
export const fetchMarginByItem = (p: { tipo: RecordTypeIO; anio: number }) =>
  fetchRows<MarginItemRow>('/api/salestracker/margin-by-item', { tipo: p.tipo, anio: String(p.anio) }, 'margen por artículo');

/** Ventas por (mes, categoría) en un año (tipo OV/FAC). */
export const fetchCategoryMonthSales = (p: { tipo: RecordTypeIO; anio: number }) =>
  fetchRows<CategoryMonthRow>('/api/salestracker/category-month-sales', { tipo: p.tipo, anio: String(p.anio) }, 'estacionalidad por categoría');

// --- Estado per-usuario: favoritos + vistas guardadas ---
export interface SavedView { id: string; name: string; state: unknown; }

export async function fetchFavorites(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/salestracker/favorites`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return ((await res.json()) as { favorites?: string[] }).favorites ?? [];
}
export async function toggleFavorite(customer: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/salestracker/favorites/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ customer }) });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return ((await res.json()) as { favorited: boolean }).favorited;
}
export async function fetchSavedViews(viewKey: string): Promise<SavedView[]> {
  const res = await fetch(`${API_BASE}/api/salestracker/saved-views?viewKey=${encodeURIComponent(viewKey)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return ((await res.json()) as { views?: SavedView[] }).views ?? [];
}
export async function saveView(viewKey: string, name: string, state: unknown): Promise<void> {
  const res = await fetch(`${API_BASE}/api/salestracker/saved-views`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ viewKey, name, state }) });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}
export async function deleteSavedView(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/salestracker/saved-views/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}

// --- Categorías (config admin) ---
// Espejo de apps/hub-api/src/salestracker/categories.ts
export interface Category { id: string; name: string; description: string | null; color: string; sort_order: number; is_active: boolean; }

/** True si el JWT tiene rol admin (solo para gating de UX; el backend re-verifica). */
export function esAdmin(): boolean {
  const t = localStorage.getItem('ambientalia_token');
  if (!t) return false;
  try { return (JSON.parse(atob(t.split('.')[1] || '')) as { role?: string }).role === 'admin'; }
  catch { return false; }
}

export async function fetchCategories(): Promise<Category[]> {
  const res = await fetch(`${API_BASE}/api/salestracker/categories`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return ((await res.json()) as { categories?: Category[] }).categories ?? [];
}
async function writeJson(path: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}
export const createCategory = (input: { name: string; description?: string; color?: string }) => writeJson('/api/salestracker/categories', 'POST', input);
export const updateCategory = (id: string, patch: Record<string, unknown>) => writeJson(`/api/salestracker/categories/${encodeURIComponent(id)}`, 'PATCH', patch);
export const deleteCategory = (id: string) => writeJson(`/api/salestracker/categories/${encodeURIComponent(id)}`, 'DELETE');
export async function importCategories(): Promise<number> {
  const res = await fetch(`${API_BASE}/api/salestracker/categories/import`, { method: 'POST', headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return ((await res.json()) as { added: number }).added;
}

// --- Agrupaciones de categorías (config admin) ---
// Espejo de apps/hub-api/src/salestracker/groupings.ts
export interface GroupMapping { id: string; group_id: string; category_id: string; }
export interface CategoryGroup { id: string; name: string; color: string | null; sort_order: number; mappings: GroupMapping[]; }

export async function fetchCategoryGroups(): Promise<CategoryGroup[]> {
  const res = await fetch(`${API_BASE}/api/salestracker/category-groups`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return ((await res.json()) as { groups?: CategoryGroup[] }).groups ?? [];
}
export const createCategoryGroup = (input: { name: string; categoryIds: string[]; color?: string }) => writeJson('/api/salestracker/category-groups', 'POST', input);
export const updateCategoryGroup = (id: string, input: { name: string; categoryIds: string[]; color?: string }) => writeJson(`/api/salestracker/category-groups/${encodeURIComponent(id)}`, 'PATCH', input);
export const deleteCategoryGroup = (id: string) => writeJson(`/api/salestracker/category-groups/${encodeURIComponent(id)}`, 'DELETE');
export const reorderCategoryGroups = (orderedIds: string[]) => writeJson('/api/salestracker/category-groups/reorder', 'POST', { orderedIds });
