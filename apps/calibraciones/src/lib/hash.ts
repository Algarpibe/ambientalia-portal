/**
 * Hash routing: `#<calibration type>/<section>/<id>`.
 * Top level = calibration type (one tab each); today only `o3`. A new type
 * adds its id to CALIBRATION_TYPES and its own sections.
 */

export const CALIBRATION_TYPES = [{ id: 'o3', label: 'Verificación Patrones de Ozono' }] as const;
export type CalibrationTypeId = (typeof CALIBRATION_TYPES)[number]['id'];

export const O3_SECTIONS = [
  'equipos',
  'verificaciones',
  'calculadoras',
  'vencimientos',
  'configuracion',
  'roles',
] as const;
export type O3Section = (typeof O3_SECTIONS)[number];

export interface Route {
  type: CalibrationTypeId;
  section: O3Section;
  /** Selected record (equipment id, verification id or `nueva`). */
  id: string | null;
}

const DEFAULT_ROUTE: Route = { type: 'o3', section: 'equipos', id: null };

export function parseHash(hash: string): Route {
  const [type, section, ...rest] = hash.replace(/^#/, '').split('/');
  if (!CALIBRATION_TYPES.some((t) => t.id === type)) return { ...DEFAULT_ROUTE };
  if (!(O3_SECTIONS as readonly string[]).includes(section)) return { ...DEFAULT_ROUTE };
  const raw = rest.join('/');
  let id: string | null = null;
  if (raw) {
    try {
      id = decodeURIComponent(raw);
    } catch {
      id = raw;
    }
  }
  return { type: type as CalibrationTypeId, section: section as O3Section, id };
}

export function buildHash(r: Route): string {
  return `#${r.type}/${r.section}${r.id ? `/${encodeURIComponent(r.id)}` : ''}`;
}
