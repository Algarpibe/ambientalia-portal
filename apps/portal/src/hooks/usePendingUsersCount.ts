import { useEffect, useRef, useState } from 'react';
import { authFetch } from '../lib/api';

// Solicitudes de acceso pendientes, para el aviso del enlace «Usuarios» del menú
// (spec docs/superpowers/specs/2026-11-20-aviso-solicitudes-pendientes-design.md).

/**
 * Evento global para que el menú vuelva a contar en cuanto el panel de usuarios
 * aprueba o elimina una cuenta, sin esperar al siguiente sondeo. Mismo patrón
 * que PROFILE_UPDATED en useProfile.ts.
 */
export const PENDING_USERS_CHANGED = 'pending-users-changed';
export function notifyPendingUsersChanged(): void {
  window.dispatchEvent(new Event(PENDING_USERS_CHANGED));
}

/** Cada cuánto se vuelve a contar mientras la pestaña está visible. */
export const PENDING_POLL_MS = 5 * 60_000;

/**
 * Distancia mínima entre consultas lanzadas al volver a la pestaña. hub-api
 * limita /api/users/* a 20 peticiones por minuto, compartidas con las acciones
 * del panel: cambiar de pestaña a menudo no debe gastarlas.
 */
export const PENDING_MIN_GAP_MS = 30_000;

/**
 * Número de cuentas en `pending`. Con `enabled` falso (quien no es admin) no hace
 * ninguna petición y devuelve 0. Cualquier fallo se ignora y se conserva el
 * último valor bueno: un 429 pasajero no debe hacer parpadear el aviso.
 */
export function usePendingUsersCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  const lastFetchRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let vivo = true;
    // Si dos consultas se cruzan (p. ej. dos aprobaciones seguidas), una
    // respuesta solo se aplica si no se aplicó ya otra lanzada después: la vieja
    // no pisa a la nueva, pero si la nueva falla, la vieja sí sirve.
    let lanzadas = 0;
    let aplicada = 0;

    const consultar = async () => {
      const esta = ++lanzadas;
      lastFetchRef.current = Date.now();
      try {
        const res = await authFetch('/api/users/pending-count');
        if (!res.ok) return;
        const body = (await res.json()) as { pending?: unknown };
        if (vivo && esta > aplicada && typeof body.pending === 'number') {
          aplicada = esta;
          setCount(body.pending);
        }
      } catch {
        /* silencioso: se conserva el último valor bueno */
      }
    };

    const visible = () => document.visibilityState === 'visible';
    const alIntervalo = () => {
      if (visible()) void consultar();
    };
    const alVolver = () => {
      if (visible() && Date.now() - lastFetchRef.current >= PENDING_MIN_GAP_MS) void consultar();
    };
    const alCambiar = () => {
      void consultar();
    };

    void consultar();
    const id = setInterval(alIntervalo, PENDING_POLL_MS);
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener(PENDING_USERS_CHANGED, alCambiar);
    return () => {
      vivo = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener(PENDING_USERS_CHANGED, alCambiar);
    };
  }, [enabled]);

  return enabled ? count : 0;
}
