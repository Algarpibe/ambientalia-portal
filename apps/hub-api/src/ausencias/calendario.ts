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

// ── La vista anual ─────────────────────────────────────────────────────────
//
// El año NO reutiliza `marcasDelMes`, y no es por pereza: la rejilla del mes
// necesita una marca POR DÍA porque rellena celdas, y el año necesita FRANJAS
// porque dibuja barras. Expandir 365 días × plantilla para volver a agruparlos
// en el navegador serían ~14.600 objetos en la respuesta y otros tantos nodos en
// el DOM, cuando lo que se pinta de verdad son unas trescientas barras.
//
// Y lo que se manda son OFFSETS en días, no fechas que el navegador tenga que
// restar. Es el mismo principio que abre este fichero: la aritmética de fechas
// vive donde hay tests. El frontend solo divide enteros para sacar porcentajes.

/** El primer dígito no puede ser 0, por lo mismo que en `MES`. */
const ANIO = /^[1-9]\d{3}$/;

export function esAnioValido(v: string): boolean {
  return ANIO.test(v);
}

/** Primer y último día de un año. */
export function rangoDelAnio(anio: string): { desde: string; hasta: string } {
  if (!esAnioValido(anio)) throw new Error(`año inválido: ${JSON.stringify(anio)}`);
  return { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
}

/** Cuántos días tiene ese año: 365, o 366 si es bisiesto. */
export function diasDelAnio(anio: string): number {
  const n = Number(anio);
  // La regla completa, no el `% 4` a secas: 1900 no fue bisiesto y 2000 sí. Da
  // igual para los años que esta app va a ver, pero un 365 donde toca 366
  // desplazaría TODAS las barras a partir de marzo, y ese fallo se ve como un
  // calendario ligeramente torcido que nadie sabe explicar.
  const bisiesto = (n % 4 === 0 && n % 100 !== 0) || n % 400 === 0;
  return bisiesto ? 366 : 365;
}

/** Un mes dentro de la franja anual: dónde empieza y cuánto ocupa. */
export interface MesDelAnio {
  /** `YYYY-MM`, para poder saltar a la vista mensual desde su etiqueta. */
  mes: string;
  /** Ordinal del día 1 de ese mes dentro del año, empezando en 1. */
  desdeDia: number;
  dias: number;
}

/**
 * Los doce meses con su posición en el año.
 *
 * Existe para que el navegador pueda pintar las separaciones y las etiquetas sin
 * hacer una sola cuenta de fechas: los anchos salen de dividir `dias` entre el
 * total, y la posición de `desdeDia`. Sin esto, el frontend tendría que saber
 * cuántos días tiene febrero — justo lo que este módulo existe para evitar.
 */
export function mesesDelAnio(anio: string): MesDelAnio[] {
  if (!esAnioValido(anio)) throw new Error(`año inválido: ${JSON.stringify(anio)}`);
  const meses: MesDelAnio[] = [];
  let desdeDia = 1;
  for (let m = 1; m <= 12; m++) {
    const mes = `${anio}-${String(m).padStart(2, '0')}`;
    // El día 0 del mes siguiente es el último del actual, igual que en
    // `rangoDelMes`: resuelve solo los de 30 y el febrero bisiesto.
    const dias = new Date(Date.UTC(Number(anio), m, 0)).getUTCDate();
    meses.push({ mes, desdeDia, dias });
    desdeDia += dias;
  }
  return meses;
}

/** Una ausencia como barra: dónde empieza y dónde acaba dentro del año. */
export interface FranjaCalendario {
  empleadoId: string;
  tipo: TipoSolicitud;
  estado: EstadoSolicitud;
  /** Ya RECORTADAS al año: una ausencia a caballo entre dos años se parte. */
  fechaInicio: string;
  fechaFin: string;
  /** Ordinales dentro del año, ambos inclusive y empezando en 1. */
  desdeDia: number;
  hastaDia: number;
}

/** El ordinal de una fecha dentro de su año, empezando en 1. */
function diaDelAnio(fecha: string): number {
  const anio = fecha.slice(0, 4);
  const ms = Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${anio}-01-01T00:00:00Z`);
  return ms / 86_400_000 + 1;
}

/**
 * Las ausencias como franjas del año, ya recortadas.
 *
 * Mismo contrato que `marcasDelMes` en las tres cosas que importan: valida TODAS
 * las fechas antes de filtrar nada (una rechazada con la fecha corrupta tiene que
 * dar el mismo error, aunque no se fuera a pintar), descarta las rechazadas
 * —nunca llegaron a ocurrir— y recorta al rango en vez de descartar lo que se
 * sale, para que una ausencia a caballo entre dos años se pinte entera en los
 * dos, cada uno con su trozo.
 */
export function franjasDelAnio(anio: string, ausencias: AusenciaRango[]): FranjaCalendario[] {
  const { desde, hasta } = rangoDelAnio(anio);
  const franjas: FranjaCalendario[] = [];

  for (const a of ausencias) {
    if (!esFechaValida(a.fechaInicio)) throw errorFechaInvalida('fechaInicio', a.fechaInicio);
    if (!esFechaValida(a.fechaFin)) throw errorFechaInvalida('fechaFin', a.fechaFin);
  }

  for (const a of ausencias) {
    if (a.estado === 'rechazada') continue;

    // Comparación de cadenas: con YYYY-MM-DD el orden lexicográfico ES el
    // cronológico, y no hay zona horaria que pueda desplazar nada.
    const ini = a.fechaInicio > desde ? a.fechaInicio : desde;
    const fin = a.fechaFin < hasta ? a.fechaFin : hasta;
    if (ini > fin) continue;

    franjas.push({
      empleadoId: a.empleadoId,
      tipo: a.tipo,
      estado: a.estado,
      fechaInicio: ini,
      fechaFin: fin,
      desdeDia: diaDelAnio(ini),
      hastaDia: diaDelAnio(fin),
    });
  }

  return franjas;
}
