/**
 * Cliente HTTP de la API de «Equipos en taller» (hub-api, `/api/equipos-taller/*`). No hay
 * «actualizar»: la pantalla se actualiza sola con la corrida que lanza cada sincronización de n8n.
 */
import { authHeaders } from '@suite/auth-client';
import type { Ajuste, AjusteFirmado, LlavesUsuario, RespuestaEquipos, UsuarioConLlaves } from './nucleo';

export interface ApiEquipos {
  estado(senal?: AbortSignal): Promise<RespuestaEquipos>;
  guardarAjuste(clave: string, t: Ajuste['t'], m?: string): Promise<AjusteFirmado>;
  borrarAjuste(clave: string): Promise<void>;
  llaves(): Promise<UsuarioConLlaves[]>;
  guardarLlaves(userId: string, l: LlavesUsuario): Promise<UsuarioConLlaves>;
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

export function apiEquipos(base = BASE, f: typeof fetch = (...a) => fetch(...a), cabeceras: () => Record<string, string> = authHeaders): ApiEquipos {
  async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown, senal?: AbortSignal): Promise<T> {
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
  }
  const k = (clave: string) => '/ajustes/' + encodeURIComponent(clave);
  return {
    estado: (senal) => pedir<RespuestaEquipos>('GET', '', undefined, senal),
    guardarAjuste: async (clave, t, m = '') => (await pedir<{ ajuste: AjusteFirmado }>('PUT', k(clave), { t, m })).ajuste,
    borrarAjuste: async (clave) => { await pedir<void>('DELETE', k(clave)); },
    llaves: () => pedir<UsuarioConLlaves[]>('GET', '/llaves'),
    guardarLlaves: (userId, l) => pedir<UsuarioConLlaves>('PUT', '/llaves/' + encodeURIComponent(userId), l),
  };
}
