import { clearToken, RUTA_INICIAR_SESION } from '../auth';

/**
 * Salida del portal cuando hub-api responde 401 (FE-412). Va aparte de
 * `main.tsx` para poder probarla: el punto de entrada monta React al importarse.
 *
 * Manda a «Iniciar sesion» y no a /auth a secas: quien tenia sesion ya tiene
 * cuenta, y /auth por defecto abre en «Crear cuenta». Si ya esta en /auth no se
 * recarga, para no entrar en bucle con los 401 del propio formulario.
 */
export function salirPorSesionCaducada(): void {
  clearToken();
  if (window.location.pathname !== '/auth') window.location.assign(RUTA_INICIAR_SESION);
}
