// @suite/http — helpers de respuesta HTTP compartidos por las apps del portal.
// Cierra AI-611: salestracker y contabilidad definían mensajeDeError() con ramas
// divergentes (salestracker cubría 401/403/409/400; contabilidad solo 401/403).

/**
 * Traduce una respuesta NO ok del hub-api a un mensaje en español accionable.
 * Para 400/409 usa el campo `error` del cuerpo JSON si viene. Las apps con lógica
 * de error específica de dominio (p. ej. WO-sales, con validación de fechas)
 * mantienen la suya en vez de usar esta.
 */
export async function mensajeDeError(res: Response): Promise<string> {
  if (res.status === 401) return 'Tu sesión ha caducado. Vuelve a entrar en el portal e inténtalo de nuevo.';
  if (res.status === 403) return 'No tienes esta aplicación asignada. Pide acceso a un administrador del portal.';
  if (res.status === 409) {
    try { const d = (await res.json()) as { error?: string }; if (d.error) return d.error; } catch { /* sin body */ }
    return 'Ya existe un registro con ese nombre.';
  }
  if (res.status === 400) {
    try { const d = (await res.json()) as { error?: string }; if (d.error) return d.error; } catch { /* sin cuerpo JSON */ }
    return 'Datos inválidos. Revisa el formulario e inténtalo de nuevo.';
  }
  return `No se pudieron cargar los datos (error ${res.status}). Inténtalo de nuevo en un momento.`;
}
