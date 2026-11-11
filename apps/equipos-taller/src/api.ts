/**
 * Cliente HTTP de la API de «Equipos en taller» (hub-api, `/api/equipos-taller/*`). No hay
 * «actualizar»: la pantalla se actualiza sola con la corrida que lanza cada sincronización de n8n.
 */
import { authHeaders } from '@suite/auth-client';
import type { Ajuste, AjusteFirmado, AjustesTablero, Kiosco, LlavesUsuario, RespuestaEquipos, RespuestaTablero, UsuarioConLlaves } from './nucleo';

export interface ApiEquipos {
  estado(senal?: AbortSignal): Promise<RespuestaEquipos>;
  guardarAjuste(clave: string, t: Ajuste['t'], m?: string): Promise<AjusteFirmado>;
  borrarAjuste(clave: string): Promise<void>;
  llaves(): Promise<UsuarioConLlaves[]>;
  guardarLlaves(userId: string, l: LlavesUsuario): Promise<UsuarioConLlaves>;
}

/** Ajustes del tablero y llaves de la TV (solo admin). */
export interface ApiTablero {
  ajustesTablero(): Promise<AjustesTablero>;
  /** Actualización parcial: el servidor valida el resultado combinado. */
  guardarAjustesTablero(parcial: Partial<AjustesTablero>): Promise<AjustesTablero>;
  kioscos(): Promise<Kiosco[]>;
  /** El secreto viene SOLO en esta respuesta. */
  crearKiosco(nombre: string): Promise<{ kiosco: Kiosco; secreto: string }>;
  revocarKiosco(id: string): Promise<void>;
}

/** Error de la API con el código HTTP (el tablero distingue 401 de un fallo de red). */
export class ErrorApi extends Error {
  status: number;
  constructor(mensaje: string, status: number) {
    super(mensaje);
    this.status = status;
  }
}

const BASE = `${(import.meta.env.VITE_HUB_API_URL as string | undefined) ?? ''}/api/equipos-taller`;

function crearPedir(base: string, f: typeof fetch, cabeceras: () => Record<string, string>) {
  return async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown, senal?: AbortSignal): Promise<T> {
    const r = await f(base + ruta, {
      method: metodo,
      ...(senal ? { signal: senal } : {}),
      headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...cabeceras() },
      ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
    });
    if (r.status === 204) return undefined as T;
    const j = (await r.json().catch(() => ({}))) as T & { error?: string; message?: string };
    if (!r.ok) {
      // Solo los textos fijos del servidor para 4xx; un 5xx (o un proxy) no se muestra:
      // su cuerpo puede traer detalle interno.
      const texto = r.status < 500 ? j.message || j.error : undefined;
      throw new ErrorApi(typeof texto === 'string' && texto ? texto : 'Error ' + r.status, r.status);
    }
    return j;
  };
}

export function apiEquipos(base = BASE, f: typeof fetch = (...a) => fetch(...a), cabeceras: () => Record<string, string> = authHeaders): ApiEquipos & ApiTablero {
  const pedir = crearPedir(base, f, cabeceras);
  const k = (clave: string) => '/ajustes/' + encodeURIComponent(clave);
  return {
    estado: (senal) => pedir<RespuestaEquipos>('GET', '', undefined, senal),
    guardarAjuste: async (clave, t, m = '') => (await pedir<{ ajuste: AjusteFirmado }>('PUT', k(clave), { t, m })).ajuste,
    borrarAjuste: async (clave) => { await pedir<void>('DELETE', k(clave)); },
    llaves: () => pedir<UsuarioConLlaves[]>('GET', '/llaves'),
    guardarLlaves: (userId, l) => pedir<UsuarioConLlaves>('PUT', '/llaves/' + encodeURIComponent(userId), l),
    ajustesTablero: () => pedir<AjustesTablero>('GET', '/tablero/ajustes'),
    guardarAjustesTablero: (parcial) => pedir<AjustesTablero>('PUT', '/tablero/ajustes', parcial),
    kioscos: () => pedir<Kiosco[]>('GET', '/kiosco/tokens'),
    crearKiosco: (nombre) => pedir<{ kiosco: Kiosco; secreto: string }>('POST', '/kiosco/tokens', { nombre }),
    revocarKiosco: async (id) => { await pedir<void>('DELETE', '/kiosco/tokens/' + encodeURIComponent(id)); },
  };
}

const FORMA_TOKEN = /^tvk_[A-Za-z0-9_-]{43}$/;

/** La llave de la TV viaja en el fragmento (`#k=`): el navegador no lo manda al servidor ni en el Referer. */
export function leerTokenKiosco(hash: string = location.hash): string | null {
  const k = new URLSearchParams(hash.replace(/^#/, '')).get('k');
  return k && FORMA_TOKEN.test(k) ? k : null;
}

/** Cliente de la TV sin sesión: la llave va SOLO en X-Kiosk-Token, nunca en la URL ni en el cuerpo. */
export function apiKiosco(token: string, base = BASE, f: typeof fetch = (...a) => fetch(...a)) {
  const pedir = crearPedir(base, f, () => ({ 'X-Kiosk-Token': token }));
  return { tablero: (senal?: AbortSignal) => pedir<RespuestaTablero>('GET', '/kiosco/tablero', undefined, senal) };
}
