/** Cuerpos de error de hub-api → Error tipado con mensaje en español para la UI. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field: string | undefined;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export function errorFromResponse(status: number, body: unknown): ApiError {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const code = typeof b.error === 'string' ? b.error : `http_${status}`;
  const field = typeof b.field === 'string' ? b.field : undefined;
  const message = typeof b.message === 'string' && b.message.trim() !== '' ? b.message : null;
  if (status === 401) return new ApiError(status, code, 'Tu sesión ha caducado. Vuelve a entrar en el portal e inténtalo de nuevo.', field);
  if (message) return new ApiError(status, code, message, field);
  if (status === 403) return new ApiError(status, code, 'No tienes esta aplicación asignada. Pide acceso a un administrador del portal.', field);
  return new ApiError(status, code, `No se pudo completar la operación (error ${status}). Inténtalo de nuevo en un momento.`, field);
}
