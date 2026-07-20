import type { CustomerSortKey, CustomerSortDir } from './customer-sales';

export interface ClientesViewState {
  tipo: 'SALES_ORDER' | 'INVOICE';
  desdeAnio: number; hastaAnio: number;
  search: string;
  sortKey: CustomerSortKey; sortDir: CustomerSortDir;
  comparar: boolean; anioA: number; anioB: number;
  onlyFav: boolean;
}
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Valida un state crudo (de una vista guardada). Devuelve null si no encaja. */
export function parseClientesState(raw: unknown): ClientesViewState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const okTipo = s.tipo === 'SALES_ORDER' || s.tipo === 'INVOICE';
  const okSortKey = s.sortKey === 'customer' || s.sortKey === 'total' || s.sortKey === 'delta' || isNum(s.sortKey);
  const okDir = s.sortDir === 'asc' || s.sortDir === 'desc';
  if (!okTipo || !isNum(s.desdeAnio) || !isNum(s.hastaAnio) || typeof s.search !== 'string' || !okSortKey || !okDir || !isNum(s.anioA) || !isNum(s.anioB)) return null;
  return {
    tipo: s.tipo as 'SALES_ORDER' | 'INVOICE',
    desdeAnio: s.desdeAnio as number, hastaAnio: s.hastaAnio as number,
    search: s.search as string,
    sortKey: s.sortKey as CustomerSortKey, sortDir: s.sortDir as CustomerSortDir,
    comparar: typeof s.comparar === 'boolean' ? s.comparar : false,
    anioA: s.anioA as number, anioB: s.anioB as number,
    onlyFav: typeof s.onlyFav === 'boolean' ? s.onlyFav : false,
  };
}
