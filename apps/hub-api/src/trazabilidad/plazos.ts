/**
 * Plazos de los servicios abiertos en Zoho Desk, en días hábiles.
 *
 * Sólo de servidor: el calendario laboral (lunes a viernes sin festivos de
 * Colombia) es el de la app de Ausencias y aquí no se repite ninguna regla,
 * se llama a `contarDiasHabiles` y a `festivosColombia`. La app del portal no
 * importa este fichero: recibe ya calculados la fecha límite, los días que
 * quedan, las pausas y el estado.
 *
 * El plazo que se sirve es el de `calcularReloj`, que descuenta el tiempo en
 * standby y para el reloj con el trabajo terminado. `calcularPlazo` y
 * `calcularTramos` son la regla base, sin pausas: lo que da el reloj cuando no
 * hay nada que descontar (plazos.test.ts vigila que coincidan).
 */

import { MAX_DIAS_RANGO, contarDiasHabiles } from '../ausencias/dias-habiles.js';
import { festivosColombia, sumarDias } from '../ausencias/festivos.js';
import { hoyEnColombia } from '../ausencias/saldo.js';
import {
  RETROCESO_MAX_DIAS,
  esFechaIso,
  estadoPlazo,
  rolPausaReloj,
  veredictoTerminado,
  type EstadoPlazo,
  type RangoFechas,
  type RolEstado,
  type TramoPlazo,
} from './dominio.js';

/** Margen de festivos que se manda más allá de la última fecha límite. */
const MARGEN_FESTIVOS_DIAS = 31;

/** Lo ya preguntado: el reloj con pausas mira cada día varias veces. Se vacía solo si crece de más. */
const habiles = new Map<string, boolean>();

export function esHabil(fecha: string): boolean {
  let h = habiles.get(fecha);
  if (h === undefined) {
    h = contarDiasHabiles(fecha, fecha) === 1;
    if (habiles.size > 20_000) habiles.clear();
    habiles.set(fecha, h);
  }
  return h;
}

/**
 * `desde` + `n` días hábiles. El día de partida no cuenta: un ingreso el lunes
 * con plazo de 3 vence el jueves.
 */
export function sumarDiasHabiles(desde: string, n: number): string {
  let fecha = desde;
  for (let quedan = n; quedan > 0; ) {
    fecha = sumarDias(fecha, 1);
    if (esHabil(fecha)) quedan--;
  }
  return fecha;
}

/** Días hábiles de `desde` a `hasta`, ambos incluidos, por tramos que `contarDiasHabiles` admite. */
function habilesInclusive(desde: string, hasta: string): number {
  let total = 0;
  for (let a = desde; a <= hasta; ) {
    const tope = sumarDias(a, MAX_DIAS_RANGO - 1);
    const b = tope < hasta ? tope : hasta;
    total += contarDiasHabiles(a, b);
    a = sumarDias(b, 1);
  }
  return total;
}

/**
 * Días hábiles de `desde` a `hasta` sin contar el de partida: positivo si
 * `hasta` es posterior, negativo si es anterior, 0 si son el mismo día.
 */
export function diasHabilesEntre(desde: string, hasta: string): number {
  if (hasta === desde) return 0;
  // «0 - n» y no «-n»: un atraso de cero días hábiles (sábado tras un límite en viernes) no debe salir como -0.
  return hasta > desde ? habilesInclusive(sumarDias(desde, 1), hasta) : 0 - habilesInclusive(sumarDias(hasta, 1), desde);
}

export interface PlazoCalculado {
  /** Ingreso + plazo en días hábiles; null si el servicio no tiene plazo. */
  fechaLimite: string | null;
  /** Días hábiles hasta la fecha límite; negativo = días hábiles de atraso. */
  diasHabiles: number | null;
  estadoPlazo: EstadoPlazo;
}

/**
 * Fecha límite de un servicio: ingreso + `dias` hábiles, a fecha `hoy`. Sin
 * ingreso o sin plazo configurado para su tipo, no hay fecha límite.
 */
export function calcularPlazo(ingreso: string | null, dias: number | null, hoy: string): PlazoCalculado {
  if (dias === null || !esFechaIso(ingreso)) return { fechaLimite: null, diasHabiles: null, estadoPlazo: 'SIN_PLAZO' };
  const fechaLimite = sumarDiasHabiles(ingreso, dias);
  return { fechaLimite, diasHabiles: diasHabilesEntre(hoy, fechaLimite), estadoPlazo: estadoPlazo(fechaLimite, hoy) };
}

/**
 * Los tramos del plazo de un servicio de tipo compuesto: cada parte ocupa sus
 * días hábiles a continuación de la anterior, empezando en el ingreso. El
 * último tramo acaba en la fecha límite (`calcularPlazo` con la suma), porque
 * sumar días hábiles por partes da lo mismo que sumarlos de una vez. Null si
 * no hay ingreso, no hay partes o a alguna le falta el plazo.
 */
export function calcularTramos(
  ingreso: string | null,
  partes: readonly { clave: string; etiqueta: string; dias: number | null }[],
): TramoPlazo[] | null {
  if (!esFechaIso(ingreso) || partes.length === 0) return null;
  const tramos: TramoPlazo[] = [];
  let desde: string = ingreso;
  for (const p of partes) {
    if (p.dias === null) return null;
    desde = sumarDiasHabiles(desde, p.dias);
    tramos.push({ clave: p.clave, etiqueta: p.etiqueta, dias: p.dias, hasta: desde });
  }
  return tramos;
}

// ── El reloj con pausas ─────────────────────────────────────────────────────
//
// Standby PAUSA el reloj y «trabajo terminado» lo PARA. Cuánto estuvo el ticket
// en cada estado sale de los tramos que el portal ha ido apuntando
// (portal.tmc_estados_historial); el rol de cada estado se mira AQUÍ, con la
// configuración de hoy, así que cambiar el rol de un estado reevalúa el pasado.
//
// Todo va por días de calendario de Bogotá y sólo cuentan los hábiles:
//   · un día hábil está EN PAUSA si al acabar (23:59:59,999 de Bogotá) el ticket
//     estaba en un estado de rol standby o terminado. El día de hoy, que no ha
//     acabado, lo decide el estado de ahora. Una pausa que empieza y acaba el
//     mismo día no pausa nada;
//   · lo anterior al primer tramo apuntado no se puede saber: cuenta como activo;
//   · la fecha límite es el día en que cae el N-ésimo día hábil ACTIVO después
//     del ingreso. Los días que aún no han llegado se dan por activos (es una
//     proyección): mientras el ticket siga en standby, se corre un día hábil
//     por cada día hábil que pasa.

/** Un tramo del historial de un ticket: en qué estado estuvo y entre qué instantes (ms desde la época). */
export interface IntervaloEstado {
  /** El estado normalizado (`claveEstadoDesk`). */
  clave: string;
  desde: number;
  /** Null = sigue en ese estado. */
  hasta: number | null;
  /** True si `desde` es un cambio de estado que el portal vio; false si es la primera vez que vio el ticket (ya estaba así: el comienzo real no se sabe). */
  desdeReal: boolean;
}

export interface DatosReloj {
  ingreso: string | null;
  /** Plazo de su tipo en días hábiles; null = sin plazo. */
  dias: number | null;
  /** Las partes de un tipo compuesto, en orden; null en un tipo simple. */
  partes: readonly { clave: string; etiqueta: string; dias: number | null }[] | null;
  hoy: string;
  /** El rol del estado que el ticket tiene AHORA. */
  rolActual: RolEstado;
  /** Su historial, en cualquier orden. */
  intervalos: readonly IntervaloEstado[];
  /** El rol que tiene hoy cada estado en Configuración. */
  rolDe: (clave: string) => RolEstado;
}

export interface RelojCalculado extends PlazoCalculado {
  /** La fecha límite que tendría sin ninguna pausa (ingreso + plazo). */
  fechaLimiteBase: string | null;
  tramos: TramoPlazo[] | null;
  rolEstado: RolEstado;
  /** True si el estado de ahora es standby: el reloj está en pausa. */
  enPausa: boolean;
  /** Días hábiles en pausa hasta hoy (o hasta que se paró el reloj). */
  diasPausados: number;
  /** Esos días, en rangos de fechas: entre dos días de un rango no hay ningún día hábil activo. */
  pausas: RangoFechas[];
  /** El día en que llegó a «trabajo terminado», si lo está ahora. */
  terminadoEl: string | null;
  /** El día del primer tramo apuntado: desde ahí se mide; antes, todo cuenta como activo. */
  medidoDesde: string | null;
}

/** El día de calendario de Bogotá en que cae un instante. */
const diaEnBogota = (ms: number): string => hoyEnColombia(new Date(ms));

/** El último milisegundo del día `fecha` en Bogotá (UTC−5, sin horario de verano). */
const finDelDia = (fecha: string): number => Date.parse(`${sumarDias(fecha, 1)}T05:00:00Z`) - 1;

/**
 * El primer tramo de la racha de estados «terminado» en la que el ticket está
 * ahora: desde el tramo abierto hacia atrás, mientras el anterior también sea
 * terminado y acabe donde empieza el siguiente. Null si el historial no tiene
 * un tramo abierto de ese rol (todavía no se ha apuntado el estado de ahora).
 */
function inicioDeRacha(orden: readonly IntervaloEstado[], rolDe: (clave: string) => RolEstado): IntervaloEstado | null {
  let i = orden.length - 1;
  if (i < 0 || orden[i].hasta !== null || rolDe(orden[i].clave) !== 'terminado') return null;
  while (i > 0) {
    const previo = orden[i - 1];
    if (previo.hasta === null || previo.hasta < orden[i].desde || rolDe(previo.clave) !== 'terminado') break;
    i--;
  }
  return orden[i];
}

/**
 * El plazo de un servicio descontando el tiempo en pausa, a fecha `hoy`. Sin
 * historial y con el estado de ahora en «cuenta» da lo mismo que
 * `calcularPlazo` y `calcularTramos`.
 *
 * Con el trabajo terminado el reloj se para el día en que el ticket entró en
 * la racha de estados «terminado» en la que sigue: la fecha límite se calcula
 * a ese día (con las pausas anteriores) y ya no se mueve; `estadoPlazo` pasa a
 * ser el veredicto y `diasHabiles`, el margen (o el atraso, en negativo) con
 * que llegó. Si después vuelve a un estado que cuenta, el reloj sigue y los
 * días que pasó terminado quedan en pausa.
 */
export function calcularReloj(d: DatosReloj): RelojCalculado {
  const { ingreso, dias, hoy, rolDe } = d;
  const orden = [...d.intervalos].sort((a, b) => a.desde - b.desde);
  const medidoDesde = orden.length > 0 ? diaEnBogota(orden[0].desde) : null;
  const rolEstado = d.rolActual;

  let terminadoEl: string | null = null;
  let medible = false;
  if (rolEstado === 'terminado') {
    const inicio = inicioDeRacha(orden, rolDe);
    const dia = inicio ? diaEnBogota(inicio.desde) : hoy;
    terminadoEl = dia > hoy ? hoy : dia;
    medible = inicio?.desdeReal === true;
  }
  /** El día al que se mira el reloj: hoy, o el día en que se paró. */
  const corte = terminadoEl ?? hoy;

  /** El rol del estado en que estaba el ticket en un instante; fuera de todo tramo, cuenta. */
  const rolEn = (ms: number): RolEstado => {
    for (let i = orden.length - 1; i >= 0; i--) {
      const t = orden[i];
      if (t.desde <= ms && (t.hasta === null || ms < t.hasta)) return rolDe(t.clave);
    }
    return 'cuenta';
  };

  const pausados = new Set<string>();
  const pausas: RangoFechas[] = [];
  if (esFechaIso(ingreso)) {
    // Antes del primer tramo apuntado nada está en pausa: no hace falta recorrerlo.
    const medido = medidoDesde !== null && medidoDesde < hoy ? medidoDesde : hoy;
    const primero = sumarDias(ingreso, 1);
    // Con el reloj parado, el día en que se paró ya no se mira: cuenta como activo, igual que los que le siguen.
    const ultimo = terminadoEl === null ? hoy : sumarDias(terminadoEl, -1);
    let rango: RangoFechas | null = null;
    for (let f = medido > primero ? medido : primero; f <= ultimo; f = sumarDias(f, 1)) {
      if (!esHabil(f)) continue;
      const rol = f === hoy ? rolEstado : rolEn(finDelDia(f));
      if (!rolPausaReloj(rol)) {
        rango = null;
        continue;
      }
      pausados.add(f);
      if (rango) rango.hasta = f;
      else pausas.push((rango = { desde: f, hasta: f }));
    }
  }

  const comun = { rolEstado, enPausa: rolEstado === 'standby', diasPausados: pausados.size, pausas, terminadoEl, medidoDesde };
  if (dias === null || !esFechaIso(ingreso)) {
    return { fechaLimite: null, fechaLimiteBase: null, diasHabiles: null, estadoPlazo: 'SIN_PLAZO', tramos: null, ...comun };
  }

  /** `desde` + `n` días hábiles ACTIVOS (el de partida no cuenta). */
  const avanzar = (desde: string, n: number): string => {
    let fecha = desde;
    for (let quedan = n; quedan > 0; ) {
      fecha = sumarDias(fecha, 1);
      if (esHabil(fecha) && !pausados.has(fecha)) quedan--;
    }
    return fecha;
  };

  const fechaLimite = avanzar(ingreso, dias);
  let tramos: TramoPlazo[] | null = null;
  if (d.partes && d.partes.length > 0 && d.partes.every((p) => p.dias !== null)) {
    tramos = [];
    let desde: string = ingreso;
    for (const p of d.partes) {
      desde = avanzar(desde, p.dias!);
      tramos.push({ clave: p.clave, etiqueta: p.etiqueta, dias: p.dias!, hasta: desde });
    }
  }

  // Lo que queda son días que aún no han llegado (todos activos). El atraso, en
  // cambio, es pasado: los días en pausa después del límite tampoco cuentan.
  let diasHabiles: number;
  if (fechaLimite >= corte) diasHabiles = diasHabilesEntre(corte, fechaLimite);
  else {
    let enPausa = 0;
    for (const f of pausados) if (f > fechaLimite && f <= corte) enPausa++;
    diasHabiles = enPausa - habilesInclusive(sumarDias(fechaLimite, 1), corte);
  }

  return {
    fechaLimite,
    fechaLimiteBase: sumarDiasHabiles(ingreso, dias),
    diasHabiles,
    estadoPlazo: terminadoEl === null ? estadoPlazo(fechaLimite, hoy) : veredictoTerminado(terminadoEl, fechaLimite, medible),
    tramos,
    ...comun,
  };
}

/**
 * Festivos que caen en el tramo que puede pintar el calendario de barras: desde
 * el tope de retroceso hasta pasada la última fecha límite. La app sombrea con
 * ellos los días no hábiles sin conocer la regla.
 */
export function festivosDelEje(hoy: string, fechasLimite: readonly (string | null)[]): string[] {
  const desde = sumarDias(hoy, -RETROCESO_MAX_DIAS);
  const ultima = fechasLimite.reduce<string>((max, f) => (f && f > max ? f : max), hoy);
  const hasta = sumarDias(ultima, MARGEN_FESTIVOS_DIAS);
  const out: string[] = [];
  for (let anio = Number(desde.slice(0, 4)); anio <= Number(hasta.slice(0, 4)); anio++) {
    for (const f of festivosColombia(anio)) if (f >= desde && f <= hasta) out.push(f);
  }
  return out.sort();
}
