// Derivaciones puras de la lista de clientes (ARQ-001 tarea E): filtro por
// cuadrante/segmento/búsqueda y nombres únicos para el dropdown. Extraídas de
// los useMemo/derivaciones de App sin cambiar la lógica.
import type { ClientProfile } from '../types';

export interface ClientListFilters {
  selectedQuadrant: string | null;
  selectedSegment: string | null;
  search: string;
}

/** Filtra por cuadrante, segmento y término de búsqueda (nombre o clientKey). */
export function filterClients(clients: ClientProfile[], f: ClientListFilters): ClientProfile[] {
  return clients.filter((c) => {
    const matchesQuadrant = f.selectedQuadrant ? c.scores?.quadrant === f.selectedQuadrant : true;
    const matchesSegment = f.selectedSegment ? c.scores?.segment === f.selectedSegment : true;
    const matchesSearch = f.search
      ? c.displayName.toLowerCase().includes(f.search.toLowerCase()) || c.clientKey.includes(f.search.toLowerCase())
      : true;
    return matchesQuadrant && matchesSegment && matchesSearch;
  });
}

/** Nombres de cliente únicos, ordenados (para el dropdown). */
export function uniqueClientNames(clients: ClientProfile[]): string[] {
  return Array.from(new Set(clients.map((c) => c.displayName))).sort((a, b) => a.localeCompare(b));
}
