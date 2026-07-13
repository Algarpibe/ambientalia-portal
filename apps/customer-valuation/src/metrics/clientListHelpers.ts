// Derivaciones puras de la lista de clientes (ARQ-001 tarea E): filtro por
// cuadrante/segmento/búsqueda y nombres únicos para el dropdown. Extraídas de
// los useMemo/derivaciones de App sin cambiar la lógica.
import type { ClientProfile, ExtendedClientProfile } from '../types';

export interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
}

type AnyClient = ClientProfile | ExtendedClientProfile;

/** Filtra clientes con scores y los ordena según la columna/dirección del
 * ranking. Extraído del useMemo de RankingTable sin cambiar la lógica. */
export function rankClients(clients: AnyClient[], sortConfig: SortConfig): AnyClient[] {
  const list = clients.filter((c) => c.scores !== null);

  return [...list].sort((a, b) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let valA: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let valB: any;

    switch (sortConfig.key) {
      case 'CLIENTE':
        valA = a.displayName;
        valB = b.displayName;
        break;
      case 'S':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        valA = (a.scores as any)?.salesScore ?? -1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        valB = (b.scores as any)?.salesScore ?? -1;
        break;
      case 'V':
        valA = a.scores!.valueScore;
        valB = b.scores!.valueScore;
        break;
      case 'P':
        valA = a.scores!.paymentScore;
        valB = b.scores!.paymentScore;
        break;
      case 'T':
        valA = a.scores!.totalScore;
        valB = b.scores!.totalScore;
        break;
      case 'SEGMENTO':
        valA = a.scores!.segment;
        valB = b.scores!.segment;
        break;
      case 'VENTAS':
        valA = a.quickMetrics?.salesTotal ?? 0;
        valB = b.quickMetrics?.salesTotal ?? 0;
        break;
      case 'MARGEN%':
        valA = a.quickMetrics?.gmPct ?? 0;
        valB = b.quickMetrics?.gmPct ?? 0;
        break;
      case 'DPD P95':
        valA = a.payments?.raw6m.maxDpd ?? 0;
        valB = b.payments?.raw6m.maxDpd ?? 0;
        break;
      case '% MORA':
        valA = a.quickMetrics?.lateValueRate ?? 0;
        valB = b.quickMetrics?.lateValueRate ?? 0;
        break;
      default:
        return 0;
    }

    if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });
}

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
