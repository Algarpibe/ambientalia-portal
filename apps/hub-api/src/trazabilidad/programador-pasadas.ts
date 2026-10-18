/**
 * Pasadas nocturnas (lote 10): el CUÁNDO. Cada noche a las 02:00 de Colombia
 * se lanza el ejecutor (pasadas-nocturnas-repo.ts), que reclama el día de cada
 * tipo, lee el plan y aplica sólo lo limpio. Colombia es UTC−5 todo el año, sin
 * horario de verano: las 02:00 de allí son siempre las 07:00 UTC.
 *
 * Mismo estilo que registro-estados.ts:
 *   · lo enciende index.ts tras inicializar la base, y nadie más: importar este
 *     módulo no arranca nada, así que en las pruebas no hay temporizadores;
 *   · un `setTimeout` hasta el próximo 02:00, que se vuelve a programar en cada
 *     disparo (no un intervalo de 24 h: así no deriva);
 *   · al arrancar después de las 02:00 de Colombia, una pasada de recuperación
 *     a los `RECUPERACION_MS`. Si ese día ya tiene su fila (salió de noche, o
 *     la hizo otra instancia) el ejecutor no hace nada: reclamar el día es lo
 *     que lo comprueba;
 *   · una sola pasada a la vez en el proceso; un fallo se apunta (consola y
 *     Sentry) y no para nada; los temporizadores no retienen el proceso (`unref`).
 */
import type { Pool } from '@algarpibe/zoho-sync';
import { captureError } from '../sentry.js';
import { ejecutarPasadasNocturnas } from './pasadas-nocturnas-repo.js';

const HORA = 3_600_000;
const DIA = 24 * HORA;
/** Las 02:00 de Colombia, en milisegundos desde la medianoche UTC. */
const PASADA_UTC = 7 * HORA;
/** Colombia respecto de UTC. */
const COLOMBIA = -5 * HORA;
/** Cuánto espera la de recuperación tras arrancar: lo justo para no competir con el arranque. */
export const RECUPERACION_MS = 2 * 60_000;

const CONTEXTO = 'tmc_pasadas_nocturnas';
const enElDia = (ms: number): number => ((ms % DIA) + DIA) % DIA;

/** Milisegundos desde `ahora` hasta las próximas 02:00 de Colombia (si es justo esa hora, las de mañana). Puro. */
export function msHastaProximaPasada(ahora: number): number {
  const t = enElDia(ahora);
  return t < PASADA_UTC ? PASADA_UTC - t : DIA - t + PASADA_UTC;
}

/** ¿Son ya las 02:00 o más tarde en Colombia, en el día de allí? Puro. */
export function yaPasoLaHoraHoy(ahora: number): boolean {
  return enElDia(ahora + COLOMBIA) >= PASADA_UTC + COLOMBIA;
}

type Ejecutar = (db: Pool) => Promise<unknown>;

let enCurso: Promise<void> | null = null;
interface Temporizadores { siguiente: ReturnType<typeof setTimeout> | null; recuperacion: ReturnType<typeof setTimeout> | null }
let temporizadores: Temporizadores | null = null;

/** Lanza una pasada y nunca rechaza. Si ya hay una en curso, devuelve ESA. */
export function pasadaNocturnaSinFallar(db: Pool, ejecutar: Ejecutar = ejecutarPasadasNocturnas): Promise<void> {
  if (enCurso) return enCurso;
  const pasada: Promise<void> = (async () => {
    try {
      await ejecutar(db);
    } catch (e) {
      console.error(`${CONTEXTO} error`, e);
      captureError(e, { endpoint: CONTEXTO });
    }
  })().finally(() => {
    if (enCurso === pasada) enCurso = null;
  });
  enCurso = pasada;
  return pasada;
}

/**
 * Enciende el programador. Devuelve false, sin tocar nada, si ya estaba
 * encendido. `ejecutar` y `ahora` son para las pruebas.
 */
export function iniciarPasadasNocturnas(db: Pool, opts: { ejecutar?: Ejecutar; ahora?: () => number } = {}): boolean {
  if (temporizadores) return false;
  const ahora = opts.ahora ?? Date.now;
  const mios: Temporizadores = { siguiente: null, recuperacion: null };
  const programar = (): void => {
    mios.siguiente = setTimeout(() => {
      // Si lo apagaron (y quizá lo volvieron a encender) mientras tanto, ya no es cosa suya.
      if (temporizadores !== mios) return;
      programar();
      void pasadaNocturnaSinFallar(db, opts.ejecutar);
    }, msHastaProximaPasada(ahora()));
    mios.siguiente.unref?.();
  };
  if (yaPasoLaHoraHoy(ahora())) {
    mios.recuperacion = setTimeout(() => {
      if (temporizadores === mios) void pasadaNocturnaSinFallar(db, opts.ejecutar);
    }, RECUPERACION_MS);
    mios.recuperacion.unref?.();
  }
  programar();
  temporizadores = mios;
  return true;
}

/** Apaga el programador. Una pasada que ya esté en curso termina. */
export function detenerPasadasNocturnas(): void {
  if (!temporizadores) return;
  if (temporizadores.siguiente) clearTimeout(temporizadores.siguiente);
  if (temporizadores.recuperacion) clearTimeout(temporizadores.recuperacion);
  temporizadores = null;
}

/** Para las pruebas: apaga el programador y olvida la pasada en curso. */
export function reiniciarPasadasNocturnas(): void {
  detenerPasadasNocturnas();
  enCurso = null;
}
