/** Spanish (es-CO) labels of the domain enumerations, permissions and dates. */
import type { Application, EquipmentType, OverallResult, Route, VerificationStatus } from '../engine';
import type { CalAction, CalRole, Me, StoredVerificationKind, ValidityBucket } from '../types';

export const can = (me: Me | null, action: CalAction) => !!me?.permissions.includes(action);

export const ROLE_LABEL: Record<CalRole, string> = {
  LECTOR: 'Lector',
  TECNICO: 'Técnico',
  DIRECTOR_TECNICO: 'Director Técnico',
};

export const EQUIPMENT_TYPE_LABEL: Record<EquipmentType, string> = {
  SRP: 'SRP (patrón de referencia)',
  PHOTOMETRIC_CALIBRATOR: 'Calibrador fotométrico',
  GENERATOR_ONLY: 'Solo generador',
  ANALYZER: 'Analizador',
};

export const APPLICATION_LABEL: Record<Application, string> = { BENCH: 'Banco', FIELD: 'Campo' };

export const ROUTE_LABEL: Record<Route, string> = {
  SAMPLE_IN: 'Entrada de muestra (SAMPLE IN)',
  INTERNAL: 'Interna',
  OTHER: 'Otra',
};

export const KIND_LABEL: Record<StoredVerificationKind, string> = {
  VERIFICATION_3_CYCLES: 'Verificación (3 ciclos)',
  REVERIFICATION_1_CYCLE: 'Reverificación (1 ciclo)',
  CROSS_CHECK: 'Verificación cruzada',
};

export type Tone = 'green' | 'amber' | 'orange' | 'red' | 'gray' | 'blue';

export const STATUS: Record<VerificationStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Borrador', tone: 'gray' },
  CALCULATED: { label: 'Calculada', tone: 'blue' },
  APPROVED: { label: 'Aprobada', tone: 'green' },
  REJECTED: { label: 'Rechazada', tone: 'red' },
};

export const RESULT: Record<OverallResult, { label: string; tone: Tone }> = {
  CONFORME: { label: 'CONFORME', tone: 'green' },
  NO_CONFORME: { label: 'NO CONFORME', tone: 'red' },
};

export const BUCKET: Record<ValidityBucket, { label: string; tone: Tone }> = {
  EXPIRED: { label: 'Vencido', tone: 'red' },
  DUE_TODAY: { label: 'Vence hoy', tone: 'red' },
  DUE_15: { label: 'Vence en ≤ 15 días', tone: 'orange' },
  DUE_30: { label: 'Vence en ≤ 30 días', tone: 'amber' },
  OK: { label: 'Vigente', tone: 'green' },
  NO_VALIDITY: { label: 'Sin vigencia', tone: 'gray' },
};

const BOGOTA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today's calendar date in Colombia, YYYY-MM-DD (the server's default `today`). */
export function todayInColombia(now: Date = new Date()): string {
  return BOGOTA.format(now);
}
