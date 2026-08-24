import { useEffect, useMemo, useState } from 'react';
import { getToken } from '../auth';
import { authFetch } from '../lib/api';

// Hook de sesión del Portal. Lee el JWT de localStorage (clave ambientalia_token
// vía getToken) y decodifica su payload SIN verificar la firma — solo para gating
// de UX (rol, apps asignadas). El backend siempre re-valida.
//
// Las APPS son la excepción: se pintan con las del token para el primer render y
// se sustituyen por las de la BD en cuanto `GET /api/users/me` contesta.
//
// El motivo es que el token no se refresca NUNCA —`issueTokenForUser` solo se
// llama desde `loginUser`—, así que quien recibía una app con la sesión abierta
// seguía sin verla hasta cerrar sesión o agotar el TTL. El servidor ya la dejaba
// entrar (SEC-224 relee rol y apps de la BD en cada petición); era solo el
// navegador el que no pintaba el icono y el guardia de cliente el que la cortaba.
//
// No se espera a la respuesta para pintar: con una pantalla de carga, el guardia
// de ruta enseñaría un «no tienes acceso» durante el viaje. Con las del token
// primero, lo peor que pasa es lo de hoy, y se corrige solo al llegar la
// respuesta.

export type UserRole = 'admin' | 'reader';

export interface AuthState {
  isAuthenticated: boolean;
  user_id: string | null;
  email: string | null;
  role: UserRole | null;
  apps: string[];
}

const EMPTY: AuthState = { isAuthenticated: false, user_id: null, email: null, role: null, apps: [] };

/** Devuelve un array de strings; [] si el valor no es un array o trae no-strings (Req 4.6). */
function sanitizeApps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is string => typeof a === 'string');
}

/**
 * Decodifica el estado de sesión desde el JWT actual. Estado vacío
 * (isAuthenticated:false, apps:[]) si el token está ausente, expirado o
 * malformado. `apps` malformado → [].
 */
export function readAuthState(): AuthState {
  const token = getToken();
  if (!token) return EMPTY;
  try {
    const payload = JSON.parse(atob(token.split('.')[1] || ''));
    // Coherente con auth.isAuthenticated: exige exp numérico y no expirado.
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return EMPTY;
    const role: UserRole | null = payload.role === 'admin' || payload.role === 'reader' ? payload.role : null;
    return {
      isAuthenticated: true,
      user_id: typeof payload.user_id === 'string' ? payload.user_id : null,
      email: typeof payload.sub === 'string' ? payload.sub : null,
      role,
      apps: sanitizeApps(payload.apps),
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Las apps que dice la BD, cacheadas a nivel de MÓDULO y no por componente.
 *
 * Este hook lo usan siete pantallas a la vez (rejilla, barra lateral, dashboard,
 * herramientas, guardia de ruta…). Con estado por componente, cada una pediría
 * su propio `/users/me` en cada carga de página.
 *
 * Va con `userId` dentro y no suelto: si la cache fuera solo el array, iniciar
 * sesión con otra cuenta en la misma pestaña heredaría las apps de la anterior
 * durante el instante que tarda la nueva petición. Comparando el id, una cache
 * de otro simplemente no se usa.
 */
let cacheDeApps: { userId: string; apps: string[] } | null = null;
let peticionEnVuelo: Promise<void> | null = null;
const suscriptores = new Set<() => void>();

async function cargarAppsDelServidor(userId: string): Promise<void> {
  try {
    const res = await authFetch('/api/users/me');
    if (!res.ok) return;
    const perfil = (await res.json()) as { id?: unknown; apps?: unknown };
    // Que el perfil sea de quien preguntó: entre la petición y la respuesta ha
    // podido cambiar la sesión, y escribir la cache con el id viejo le daría al
    // recién llegado las apps del anterior.
    if (perfil?.id !== userId) return;
    // Un hub-api que todavía no manda `apps` —los dos servicios se despliegan
    // por separado— deja la cache sin tocar, y el portal se queda con las del
    // token, que es exactamente como funcionaba antes.
    if (!Array.isArray(perfil.apps)) return;
    cacheDeApps = { userId, apps: sanitizeApps(perfil.apps) };
    for (const avisar of suscriptores) avisar();
  } catch {
    /* silencioso: se sigue con las del token, que es el comportamiento de antes */
  } finally {
    peticionEnVuelo = null;
  }
}

/**
 * Hook reactivo: recalcula el estado ante cambios de localStorage (p.ej. login
 * en otra pestaña). En la misma pestaña, el login navega/re-monta y el estado
 * se recomputa al inicializarse.
 */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(readAuthState);

  useEffect(() => {
    const update = () => setState(readAuthState());
    window.addEventListener('storage', update);
    // El mismo `update` sirve de aviso para la cache: `readAuthState` devuelve
    // un objeto nuevo, así que el re-render recalcula las apps efectivas de
    // abajo con lo que acabe de llegar.
    suscriptores.add(update);
    return () => {
      window.removeEventListener('storage', update);
      suscriptores.delete(update);
    };
  }, []);

  useEffect(() => {
    if (!state.isAuthenticated || !state.user_id) return;
    if (cacheDeApps?.userId === state.user_id) return;
    // Una sola petición aunque monten siete componentes a la vez.
    if (!peticionEnVuelo) peticionEnVuelo = cargarAppsDelServidor(state.user_id);
  }, [state.isAuthenticated, state.user_id]);

  const apps = cacheDeApps?.userId === state.user_id ? cacheDeApps.apps : state.apps;

  // Se devuelve el MISMO objeto mientras nada cambie. Un objeto nuevo en cada
  // render haría trabajar de más a quien tenga `apps` en las dependencias de un
  // efecto — el registro de widgets ya se defiende de eso con su `appsKey`, pero
  // no todos los consumidores tienen por qué hacerlo.
  return useMemo(() => (apps === state.apps ? state : { ...state, apps }), [state, apps]);
}
