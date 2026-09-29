/**
 * hub-api error bodies → a typed Error for the UI.
 *
 * Not @suite/http's `mensajeDeError`: for 400/409 it returns the raw `error`
 * code, and for 403 it always says "app not assigned". The Calibraciones API
 * sends a Spanish `message` (plus `field` and `detail`) that is more useful,
 * and a 403 here is often a role limit, not a missing app.
 */
import type { TraceabilityBlockedDetail } from '../types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field: string | undefined;
  readonly detail: unknown;

  constructor(status: number, code: string, message: string, field?: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
    this.detail = detail;
  }
}

const SESSION_EXPIRED = 'Tu sesión ha caducado. Vuelve a entrar en el portal e inténtalo de nuevo.';
const APP_NOT_ASSIGNED = 'No tienes esta aplicación asignada. Pide acceso a un administrador del portal.';

export function errorFromResponse(status: number, body: unknown): ApiError {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const code = typeof b.error === 'string' ? b.error : `http_${status}`;
  const message = typeof b.message === 'string' && b.message.trim() !== '' ? b.message : null;
  const field = typeof b.field === 'string' ? b.field : undefined;
  if (status === 401) return new ApiError(status, code, SESSION_EXPIRED, field, b.detail);
  if (message) return new ApiError(status, code, message, field, b.detail);
  if (status === 403) return new ApiError(status, code, APP_NOT_ASSIGNED, field, b.detail);
  return new ApiError(
    status,
    code,
    `No se pudo completar la operación (error ${status}). Inténtalo de nuevo en un momento.`,
    field,
    b.detail,
  );
}

/** Blocking issues + warnings of a 422 `traceability_blocked`, or null. */
export function traceabilityDetailOf(e: unknown): TraceabilityBlockedDetail | null {
  if (!(e instanceof ApiError) || e.code !== 'traceability_blocked') return null;
  const d = e.detail as Partial<TraceabilityBlockedDetail> | undefined;
  return { issues: Array.isArray(d?.issues) ? d.issues : [], warnings: Array.isArray(d?.warnings) ? d.warnings : [] };
}
