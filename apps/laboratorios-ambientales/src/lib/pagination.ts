// Paginación del Buscador. Son 19 056 registros (382 páginas): pintarlos todos
// no es viable y un tope mudo escondería datos, así que se pagina.
export const PAGE_SIZE = 50;

export function totalPages(totalItems: number): number {
  // Mínimo 1: sin registros la UI sigue diciendo «Página 1 de 1», no «0 de 0».
  return Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
}

// Acota la página al rango válido para que la función sea total: un índice
// inválido nunca deja la tabla en blanco.
function clampPage(page: number, totalItems: number): number {
  return Math.min(Math.max(1, Math.trunc(page)), totalPages(totalItems));
}

export function pageSlice<T>(items: T[], page: number): T[] {
  const inicio = (clampPage(page, items.length) - 1) * PAGE_SIZE;
  return items.slice(inicio, inicio + PAGE_SIZE);
}

export function pageRange(totalItems: number, page: number): { desde: number; hasta: number } {
  if (totalItems === 0) return { desde: 0, hasta: 0 };
  const inicio = (clampPage(page, totalItems) - 1) * PAGE_SIZE;
  return { desde: inicio + 1, hasta: Math.min(inicio + PAGE_SIZE, totalItems) };
}
