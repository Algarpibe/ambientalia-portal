import { esFechaValida } from './dias-habiles.js';
import { festivosColombia } from './festivos.js';
import type { EstadoSolicitud, TipoSolicitud } from './types.js';

// El calendario de ausencias. Puro a propósito: sin Pool y sin leer la hora del
// sistema, para que todas las reglas se puedan probar sin BD.
//
// La pieza que importa es que la expansión de un rango a días concretos vive
// AQUÍ y no en el navegador. Es el cálculo que más errores de un día produce, y
// esta app ya lleva dos: el `+1` del fin exclusivo de Google Calendar y el
// UTC−5 del saldo. Aquí hay tests; en el frontend del portal no.

// El primer dígito no puede ser 0: sin esto, '0099-01' cuela como mes válido y
// `Date.UTC(99, ...)` interpreta el año 99 como 1999 (ver el comentario en
// `rangoDelMes`), produciendo un rango de casi 1900 años.
const MES = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/;

/** Un día del mes, con lo que el frontend necesita para sombrearlo. */
export interface DiaCalendario {
  fecha: string;
  laborable: boolean;
}

/** Una celda pintada: esta persona, este día. */
export interface MarcaCalendario {
  empleadoId: string;
  fecha: string;
  tipo: TipoSolicitud;
  estado: EstadoSolicitud;
}

/** Una ausencia sin expandir, tal como sale del repo. */
export interface AusenciaRango {
  empleadoId: string;
  tipo: TipoSolicitud;
  estado: EstadoSolicitud;
  fechaInicio: string;
  fechaFin: string;
}

export function esMesValido(v: string): boolean {
  return MES.test(v);
}

/** Primer y último día de un mes `YYYY-MM`. */
export function rangoDelMes(mes: string): { desde: string; hasta: string } {
  if (!esMesValido(mes)) throw new Error(`mes inválido: ${JSON.stringify(mes)}`);
  const anio = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  // Día 0 del mes SIGUIENTE es el último del actual, y `Date.UTC` cuenta los
  // meses desde 0: por eso `m` sin restarle uno ya apunta al siguiente. Resuelve
  // solo los meses de 30, febrero bisiesto y el salto de diciembre a enero.
  const ultimo = new Date(Date.UTC(anio, m, 0)).toISOString().slice(0, 10);
  return { desde: `${mes}-01`, hasta: ultimo };
}

/** Los días del mes, marcando cuáles son laborables en Colombia. */
export function diasDelMes(mes: string): DiaCalendario[] {
  const { desde, hasta } = rangoDelMes(mes);
  const festivos = festivosColombia(Number(mes.slice(0, 4)));
  const dias: DiaCalendario[] = [];
  const fin = Date.parse(`${hasta}T00:00:00Z`);
  for (let ms = Date.parse(`${desde}T00:00:00Z`); ms <= fin; ms += 86_400_000) {
    const d = new Date(ms);
    const fecha = d.toISOString().slice(0, 10);
    const diaSemana = d.getUTCDay();
    dias.push({ fecha, laborable: diaSemana !== 0 && diaSemana !== 6 && !festivos.has(fecha) });
  }
  return dias;
}

/**
 * El error de «fecha inválida», con el valor recibido tal cual.
 *
 * Mismo criterio que `errorFechaInvalida` en saldo.ts: `JSON.stringify` y no una
 * plantilla, porque si `valor` fuera un objeto `Date` (el gotcha de un `::text`
 * olvidado en el SELECT), la plantilla lo convertiría con la zona horaria LOCAL
 * del proceso y el mensaje mentiría sobre qué día era. Se incluye también el
 * `typeof` para que el mensaje diga, sin ambigüedad, qué clase de valor llegó.
 */
function errorFechaInvalida(campo: string, valor: unknown): Error {
  return new Error(`${campo} inválida (tipo ${typeof valor}): ${JSON.stringify(valor)}`);
}

/**
 * Expande las ausencias a una marca por día, acotadas al mes pedido.
 *
 * El acotado es lo que permite que una ausencia a caballo entre dos meses se
 * pinte entera en los dos, cada uno con su trozo.
 */
export function marcasDelMes(mes: string, ausencias: AusenciaRango[]): MarcaCalendario[] {
  const { desde, hasta } = rangoDelMes(mes);
  const marcas: MarcaCalendario[] = [];

  // Se valida ANTES de saltarse las rechazadas y para TODAS las ausencias, no
  // solo las que sobreviven el filtro (mismo criterio que saldo.ts, ver su
  // comentario largo junto al bucle equivalente): si el `continue` de abajo
  // fuera antes, una rechazada con la fecha corrupta pasaría sin ruido. No
  // llegaría a pintar un día equivocado, pero se perdería el diagnóstico.
  for (const a of ausencias) {
    if (!esFechaValida(a.fechaInicio)) throw errorFechaInvalida('fechaInicio', a.fechaInicio);
    if (!esFechaValida(a.fechaFin)) throw errorFechaInvalida('fechaFin', a.fechaFin);
  }

  for (const a of ausencias) {
    // Una rechazada no es una ausencia: nunca llegó a ocurrir.
    if (a.estado === 'rechazada') continue;

    // Comparación de cadenas: con YYYY-MM-DD el orden lexicográfico ES el
    // cronológico, y no hay zona horaria que pueda desplazar nada.
    const ini = a.fechaInicio > desde ? a.fechaInicio : desde;
    const fin = a.fechaFin < hasta ? a.fechaFin : hasta;
    if (ini > fin) continue;

    const ultimo = Date.parse(`${fin}T00:00:00Z`);
    for (let ms = Date.parse(`${ini}T00:00:00Z`); ms <= ultimo; ms += 86_400_000) {
      marcas.push({
        empleadoId: a.empleadoId,
        fecha: new Date(ms).toISOString().slice(0, 10),
        tipo: a.tipo,
        estado: a.estado,
      });
    }
  }

  return marcas;
}
