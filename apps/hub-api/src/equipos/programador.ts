/**
 * La corrida diaria de «Equipos en taller»: a la `EQUIPOS_HORA_DIARIA` de Colombia
 * (06:30 por defecto). Colombia es UTC−5 todo el año, sin horario de verano.
 *
 * Mismo estilo que trazabilidad/programador-pasadas.ts:
 *   · lo enciende index.ts tras inicializar la base, y nadie más: importar este
 *     módulo no arranca nada;
 *   · un `setTimeout` hasta la próxima hora, que se vuelve a programar en cada
 *     disparo (no un intervalo de 24 h: así no deriva); no retiene el proceso;
 *   · SIN corrida de recuperación al arrancar: un despliegue después de la hora no
 *     lanza nada (contaría como corrida programada para el incidente). Para eso
 *     está el botón.
 *   · un fallo se apunta y no para nada. Dos corridas a la vez las impide el
 *     candado de la base.
 */
const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
const COLOMBIA_MS = -5 * HORA_MS;

/** Milisegundos desde `ahora` hasta la próxima HH:MM de Colombia (si es justo esa hora, la de mañana). Puro. */
export function msHastaProxima(hora: string, ahora: number): number {
  const [h, m] = hora.split(':').map(Number);
  const objetivoUtc = ((h * HORA_MS + m * 60_000 - COLOMBIA_MS) % DIA_MS + DIA_MS) % DIA_MS;
  const t = ((ahora % DIA_MS) + DIA_MS) % DIA_MS;
  return t < objetivoUtc ? objetivoUtc - t : DIA_MS - t + objetivoUtc;
}

let temporizador: ReturnType<typeof setTimeout> | null = null;

/**
 * Enciende el programador. Devuelve false, sin tocar nada, si ya estaba
 * encendido. `ahora` es para las pruebas.
 */
export function iniciarProgramadorEquipos(
  ejecutar: () => Promise<unknown>,
  o: { hora: string; ahora?: () => number; log?: (t: string) => void },
): boolean {
  if (temporizador) return false;
  const ahora = o.ahora ?? Date.now;
  const log = o.log ?? ((t: string) => console.log(t));
  const programar = (): void => {
    const ms = msHastaProxima(o.hora, ahora());
    const mio = setTimeout(() => {
      if (temporizador !== mio) return;
      programar();
      void ejecutar().catch(() => log('equipos-taller: la corrida programada no pudo empezar'));
    }, ms);
    mio.unref?.();
    temporizador = mio;
  };
  programar();
  log('equipos-taller: corrida diaria a las ' + o.hora + ' (Colombia)');
  return true;
}

/** Apaga el programador. Una corrida que ya esté en marcha termina. */
export function detenerProgramadorEquipos(): void {
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;
}
