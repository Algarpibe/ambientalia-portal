/**
 * Cuándo se apuntan los cambios de estado de los tickets de Desk.
 *
 * Sólo de servidor. El QUÉ es `registrarEstados` (repo.ts): mira el estado de
 * cada ticket sin cerrar y escribe en portal.tmc_estados_historial los cambios
 * que ve. Este fichero decide el CUÁNDO, por dos caminos que pasan por la
 * misma puerta (`registrarEstadosAlDia`):
 *
 *   a) un programador dentro de hub-api: cada `INTERVALO_MS`, con la primera
 *      pasada `PRIMERA_PASADA_MS` después de arrancar. Lo enciende index.ts
 *      tras inicializar la base, y nadie más: importar este módulo no arranca
 *      nada, así que en los tests no hay temporizadores sueltos;
 *   b) GET /trazabilidad/servicios, antes de leer, para que la vista esté al
 *      día sin esperar a la pasada siguiente.
 *
 * Para que (a) y (b) no hagan el trabajo dos veces:
 *   · una sola pasada a la vez en este proceso: quien llega mientras hay una en
 *     curso se cuelga de ella en vez de lanzar otra;
 *   · una petición no repite una pasada que acabó bien hace menos de
 *     `FRESCURA_MS` (el programador sí: `forzar`, que por algo tiene su turno);
 *   · entre procesos (dos réplicas de hub-api), `registrarEstados` se pone en
 *     fila con un bloqueo de la base, y la segunda no encuentra nada que apuntar.
 *
 * El rol de cada estado (cuenta / standby / terminado) no se decide aquí ni se
 * guarda con el tramo: se mira al leer (`calcularReloj`, plazos.ts).
 */

import type { Pool } from '@algarpibe/zoho-sync';
import { captureError } from '../sentry.js';
import { registrarEstados } from './repo.js';

/** Cada cuánto pasa el programador. */
export const INTERVALO_MS = 5 * 60_000;
/** Cuánto espera la primera pasada tras arrancar: lo justo para no competir con el arranque. */
export const PRIMERA_PASADA_MS = 20_000;
/** Una petición no vuelve a apuntar si la última pasada buena es más reciente que esto. */
export const FRESCURA_MS = 30_000;

/** El nombre con el que salen sus errores en el registro y en Sentry. */
const CONTEXTO = 'tmc_registrar_estados';

type Tarea = (db: Pool) => Promise<unknown>;

export interface OpcionesRegistro {
  /** True = apuntar aunque se acabe de hacer (lo usa el programador). Nunca lanza una segunda pasada a la vez. */
  forzar?: boolean;
  /** Qué se ejecuta; por defecto, `registrarEstados`. Los tests ponen un doble. */
  tarea?: Tarea;
}

export interface OpcionesProgramador {
  tarea?: Tarea;
  intervaloMs?: number;
  primeraMs?: number;
}

let enCurso: Promise<void> | null = null;
let ultimaBuena = Number.NEGATIVE_INFINITY;
interface Temporizadores {
  primera: ReturnType<typeof setTimeout>;
  intervalo: ReturnType<typeof setInterval> | null;
}
let temporizadores: Temporizadores | null = null;

/**
 * Apunta los cambios de estado, si hace falta. Si ya hay una pasada en curso,
 * devuelve ESA (acaba cuando ella acaba, y falla si ella falla). Si la última
 * buena es reciente y no se fuerza, no hace nada.
 */
export function registrarEstadosAlDia(db: Pool, opts: OpcionesRegistro = {}): Promise<void> {
  if (enCurso) return enCurso;
  if (!opts.forzar && Date.now() - ultimaBuena < FRESCURA_MS) return Promise.resolve();
  const tarea = opts.tarea ?? registrarEstados;
  const pasada: Promise<void> = (async () => {
    await tarea(db);
    ultimaBuena = Date.now();
  })().finally(() => {
    if (enCurso === pasada) enCurso = null;
  });
  enCurso = pasada;
  return pasada;
}

/** Lo mismo, pero nunca rechaza: un fallo se apunta (consola y Sentry) y no pasa de aquí. */
export async function registrarEstadosSinFallar(db: Pool, opts: OpcionesRegistro = {}): Promise<void> {
  try {
    await registrarEstadosAlDia(db, opts);
  } catch (e) {
    console.error(`${CONTEXTO} error`, e);
    captureError(e, { endpoint: CONTEXTO });
  }
}

/**
 * Enciende el programador. Devuelve false, sin tocar nada, si ya estaba
 * encendido: no se arranca dos veces. Los temporizadores no retienen el
 * proceso (`unref`).
 */
export function iniciarRegistroEstados(db: Pool, opts: OpcionesProgramador = {}): boolean {
  if (temporizadores) return false;
  const pasada = (): void => void registrarEstadosSinFallar(db, { forzar: true, tarea: opts.tarea });
  const mios: Temporizadores = {
    primera: setTimeout(() => {
      pasada();
      // Si lo apagaron (y quizá lo volvieron a encender) antes de esta primera pasada, el intervalo ya no es cosa suya.
      if (temporizadores !== mios) return;
      mios.intervalo = setInterval(pasada, opts.intervaloMs ?? INTERVALO_MS);
      mios.intervalo.unref?.();
    }, opts.primeraMs ?? PRIMERA_PASADA_MS),
    intervalo: null,
  };
  mios.primera.unref?.();
  temporizadores = mios;
  return true;
}

/** Apaga el programador. Una pasada que ya esté en curso termina. */
export function detenerRegistroEstados(): void {
  if (!temporizadores) return;
  clearTimeout(temporizadores.primera);
  if (temporizadores.intervalo) clearInterval(temporizadores.intervalo);
  temporizadores = null;
}

/** Para los tests: apaga el programador y olvida la pasada en curso y la última buena. */
export function reiniciarRegistroEstados(): void {
  detenerRegistroEstados();
  enCurso = null;
  ultimaBuena = Number.NEGATIVE_INFINITY;
}
