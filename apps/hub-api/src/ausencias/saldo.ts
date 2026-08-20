import { esFechaValida } from './dias-habiles.js';
import { ESTADOS_EN_TRAMITE, esOtorgamiento, type EstadoSolicitud, type TipoSolicitud } from './types.js';

// Las dos bolsas de días. Puro a propósito: sin Pool, sin fechas del sistema
// (el «hoy» se inyecta), para que todas las reglas se puedan probar sin BD.
//
// VACACIONES. No se recalcula desde la fecha de ingreso. Se parte del saldo que
// hoy vive en la hoja `Total` del Excel y se sigue desde ahí:
//
//   saldo(hoy) = saldo_corte
//              + (días desde el corte / 30) × 1,25
//              − vacaciones aprobadas con inicio >= corte
//
// Es idéntico a recalcular desde el ingreso porque el devengo es proporcional al
// tiempo y a la misma tasa para todos, sin tramos por antigüedad.
//
// COMPENSATORIOS. La misma forma menos el término del medio:
//
//   saldo(hoy) = saldo_corte − compensatorios aprobados con inicio >= corte
//
// Un compensatorio NO devenga con el tiempo: se gana por horas o días extra y hay
// que otorgarlo. Por eso su fecha de corte es solo una frontera de descuento, y
// por eso las dos bolsas comparten el recuento (`sumarDesdeElCorte`) pero no la
// fórmula.

/** Días de vacaciones al año que reconoce la empresa. */
const DIAS_AL_ANIO = 15;

/**
 * Días naturales que la fórmula considera un mes.
 *
 * Son 30 y no 30,44 porque es lo que hace el Excel, y de ahí salen los saldos de
 * partida. El efecto es que el año devenga 15,2 días en vez de 15 (365/30 × 1,25).
 * Corregirlo descuadraría contra el consolidado, así que se mantiene.
 */
const DIAS_POR_MES = 30;

/** 1,25 días por mes trabajado. */
const DEVENGO_MENSUAL = DIAS_AL_ANIO / 12;

/** El punto de partida de un empleado. Null mientras nadie lo haya configurado. */
export interface ConfigSaldo {
  saldoCorte: number;
  /**
   * YYYY-MM-DD. Frontera desde la que se descuenta — y, SOLO en la bolsa de
   * vacaciones, desde la que además se devenga. En compensatorios no hay devengo
   * que originar: la fecha únicamente decide qué solicitudes cuentan.
   */
  fechaCorte: string;
}

/** Una solicitud, reducida a lo que los saldos necesitan mirar. */
export interface AusenciaParaElSaldo {
  tipo: TipoSolicitud;
  fechaInicio: string;
  diasHabiles: number;
  estado: EstadoSolicitud;
  /**
   * YYYY-MM-DD. Solo lo miran los OTORGAMIENTOS, y por eso existe este campo.
   *
   * Los otros tipos se cuentan desde el corte por `fechaInicio`, que en ellos es
   * cuándo empieza la ausencia. En un otorgamiento esa fecha es la del TRABAJO
   * EXTRA, y está en el pasado casi siempre: filtrarlo por ahí dejaría fuera del
   * saldo casi todos los días concedidos, en silencio. Lo que decide si un
   * otorgamiento ya estaba dentro del número del corte es cuándo se PIDIÓ.
   */
  createdAt: string;
}

export interface SaldoVacaciones {
  /**
   * Quien llama (el servicio) pasa `config: null` cuando al empleado le falta
   * `saldo_corte` o `fecha_corte`; la constraint `empleados_saldo_completo` en
   * BD garantiza que los dos van siempre juntos, así que esta función se fía
   * de ese contrato y no vuelve a comprobar campo por campo.
   */
  configurado: boolean;
  saldoCorte: number;
  fechaCorte: string;
  /** Devengado entre el corte y hoy. */
  devengadas: number;
  /** Aprobadas con inicio >= corte. */
  disfrutadas: number;
  /** Pendientes de aprobar con inicio >= corte. No bajan el saldo firme. */
  enTramite: number;
  /** saldoCorte + devengadas − disfrutadas. */
  disponible: number;
}

/**
 * El saldo de compensatorios de un empleado.
 *
 * NO tiene `devengadas`, y esa ausencia es el diseño. Por un lado sería falso:
 * diría «este mes has ganado cero» cuando lo que pasa es que esta bolsa no se
 * gana con el tiempo. Por otro es lo único que impide, en tiempo de compilación,
 * enchufar esta bolsa a algo escrito para la otra — con los mismos campos,
 * TypeScript las daría por intercambiables, porque compara por forma y no por
 * nombre.
 *
 * Sitio reservado para la fase del otorgamiento: entra aquí `otorgados: number` y
 * `disponible` pasa a `saldoCorte + otorgados − disfrutadas`. La firma de
 * `calcularSaldoCompensatorios` no cambia por ello.
 */
export interface SaldoCompensatorios {
  configurado: boolean;
  saldoCorte: number;
  fechaCorte: string;
  /** Concedidos y ya firmes, PEDIDOS desde el corte. Ver `sumarOtorgados`. */
  otorgados: number;
  /** Aprobados con inicio >= corte. */
  disfrutadas: number;
  /** Pendientes de aprobar con inicio >= corte. No bajan el saldo firme. */
  enTramite: number;
  /** saldoCorte + otorgados − disfrutadas. */
  disponible: number;
}

/**
 * Un objeto NUEVO en cada llamada, no una constante compartida: hub-api es un
 * proceso de larga vida, y si esto fuera un único objeto reusado, mutar la
 * respuesta de un empleado (a propósito o por un bug aguas abajo) contaminaría
 * la de todos los siguientes mientras el proceso siga vivo.
 */
function sinConfigurar(): SaldoVacaciones {
  return {
    configurado: false,
    saldoCorte: 0,
    fechaCorte: '',
    devengadas: 0,
    disfrutadas: 0,
    enTramite: 0,
    disponible: 0,
  };
}

/** Objeto nuevo en cada llamada, por lo mismo que `sinConfigurar`. */
function sinConfigurarCompensatorios(): SaldoCompensatorios {
  return {
    configurado: false,
    saldoCorte: 0,
    fechaCorte: '',
    otorgados: 0,
    disfrutadas: 0,
    enTramite: 0,
    disponible: 0,
  };
}

/** Un decimal, que es la precisión con la que se enseña y la de NUMERIC(5,1). */
function redondear(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Lo que se puede pedir sin descubrirse: el saldo firme menos lo que espera firma.
 *
 * Redondea, y no es cosmético. `disponible − enTramite` sobre floats produce
 * cosas como 3.9000000000000004 —el mismo ruido binario que documenta el test
 * del cuadre de décimas—, y comparado contra los días de una solicitud eso
 * decide bloqueos justo en el borde exacto en el que la pantalla dice «te falta
 * 0». El servidor y el cliente tienen que redondear IGUAL o discreparán ahí;
 * por eso `dominio.ts` lleva el espejo de esta función.
 *
 * El parámetro va estructural a propósito: sirve para las dos bolsas.
 */
export function pedible(saldo: { disponible: number; enTramite: number }): number {
  return redondear(saldo.disponible - saldo.enTramite);
}

/**
 * El error de «fecha inválida», con el valor recibido tal cual.
 *
 * JSON.stringify y no una plantilla con `${valor}`: si `valor` es un objeto
 * Date (el gotcha de un `::text` olvidado en el SELECT), la plantilla lo
 * convierte a texto con la zona HORARIA LOCAL del proceso y el mensaje
 * mentiría sobre qué día era —justo en el caso que esta validación existe
 * para diagnosticar—. JSON.stringify llama a `toJSON`, que en Date es
 * `toISOString`, siempre en UTC.
 */
function errorFechaInvalida(campo: string, valor: unknown): Error {
  return new Error(`${campo} inválida (tipo ${typeof valor}): ${JSON.stringify(valor)}`);
}

/** Días naturales entre dos fechas YYYY-MM-DD, en UTC. */
function diasEntre(desde: string, hasta: string): number {
  return (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000;
}

/**
 * La fecha de hoy en Colombia (UTC−5, sin horario de verano).
 *
 * Se resta el desfase ANTES de tomar la fecha. Sin esto, entre las 19:00 y la
 * medianoche hora local el servidor —que corre en UTC— ya estaría en el día
 * siguiente y el saldo de todo el mundo se adelantaría un día cada tarde.
 */
export function hoyEnColombia(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Lo que las dos bolsas comparten: validar las fechas de TODAS las ausencias y
 * sumar los días de UN tipo, por lista de estados, desde el corte.
 *
 * Extraído y no copiado por lo mismo que `ocupaAgenda` dejó de estar escrita dos
 * veces (ver su JSDoc en repo.ts). Aquí la trampa sería peor: cada bolsa se
 * prueba en su propio `describe`, así que desviar una de las dos copias dejaría
 * verde el bloque de la otra y el fallo saldría en producción, en el saldo de
 * alguien.
 *
 * Se llama SIEMPRE con la `fechaCorte` ya validada: la validación de `hoy` y del
 * corte se queda arriba, en cada bolsa, porque cada una decide qué devolver
 * cuando no hay configuración.
 */
function sumarDesdeElCorte(
  ausencias: AusenciaParaElSaldo[],
  tipo: TipoSolicitud,
  fechaCorte: string,
): { disfrutadas: number; enTramite: number } {
  // Se valida ANTES del filtro y para TODAS las solicitudes, no solo dentro
  // del callback de `sumar`: `fechaInicio` entra en una comparación `>=`
  // contra `fechaCorte`, y una fecha malformada ahí falla en silencio de dos
  // formas distintas. Si es un Date, `>=` lo compara vía ToPrimitive numérico
  // —el timestamp contra Number('YYYY-MM-DD'), que es NaN— y la comparación
  // es SIEMPRE false: la ausencia no se descontaría jamás. Si es una fecha
  // sin cero de relleno («2026-2-1»), rompe el orden lexicográfico en
  // cualquier sentido: podría contar como posterior a un corte muy posterior.
  for (const a of ausencias) {
    if (!esFechaValida(a.fechaInicio)) throw errorFechaInvalida('fechaInicio', a.fechaInicio);
    // `createdAt` entra en la misma comparación `>=` cuando el tipo es un
    // otorgamiento (ver `sumarOtorgados`), así que se valida con el mismo rasero
    // y aquí, junto a la otra: separarlas es como una de las dos se queda sin
    // validar el día que alguien añada un tercer término.
    if (!esFechaValida(a.createdAt)) throw errorFechaInvalida('createdAt', a.createdAt);
  }

  // Toma una LISTA de estados, no uno: desde la aprobación en cascada, «en
  // trámite» son dos estados —`pendiente` y `pendiente_2`— y con un solo estado
  // exacto la media firma desaparecería del saldo sin sumar en ningún sitio.
  const sumar = (estados: readonly EstadoSolicitud[]) =>
    ausencias
      // El filtro es por fecha de INICIO, no por si ya ocurrió respecto a
      // `hoy`: una aprobada con inicio futuro se descuenta igual, porque el
      // saldo de partida del Excel todavía no la trae descontada.
      .filter((a) => a.tipo === tipo && estados.includes(a.estado) && a.fechaInicio >= fechaCorte)
      .reduce((total, a) => total + a.diasHabiles, 0);

  return {
    // Media firma NO descuenta: sigue en trámite hasta que la solicitud queda firme.
    disfrutadas: redondear(sumar(['aprobada'])),
    enTramite: redondear(sumar(ESTADOS_EN_TRAMITE)),
  };
}

/**
 * Los días de compensatorio CONCEDIDOS y ya firmes desde el corte.
 *
 * ⚠️ Filtra por `createdAt` y NO por `fechaInicio`, y ésa es la diferencia que
 * hace que la función exista en vez de ser una llamada más a `sumarDesdeElCorte`.
 * La `fechaInicio` de un otorgamiento es el día del TRABAJO EXTRA, y está en el
 * pasado casi siempre: con el corte en agosto y un sábado trabajado en julio,
 * `'2026-07-15' >= '2026-08-20'` es `false` y el día concedido no contaría nunca
 * — sin error, sin aviso, y con el empleado viendo que su bolsa no sube.
 *
 * Lo que decide si un otorgamiento ya estaba dentro del número del corte es
 * cuándo se PIDIÓ, que es lo que compara esta función.
 *
 * Solo `aprobada`: un otorgamiento a medio firmar no ha concedido nada. Y no
 * tiene contador «en trámite» propio a propósito — sumar días que aún no
 * existen animaría a gastarlos.
 */
function sumarOtorgados(ausencias: AusenciaParaElSaldo[], fechaCorte: string): number {
  return redondear(
    ausencias
      .filter((a) => esOtorgamiento(a.tipo) && a.estado === 'aprobada' && a.createdAt >= fechaCorte)
      .reduce((total, a) => total + a.diasHabiles, 0),
  );
}

/**
 * El saldo de vacaciones de un empleado a fecha `hoy`.
 *
 * `vacaciones` puede traer solicitudes de cualquier tipo y estado: el filtrado es
 * cosa de esta función, para que ninguna llamada pueda olvidarse una regla.
 */
export function calcularSaldo(
  config: ConfigSaldo | null,
  vacaciones: AusenciaParaElSaldo[],
  hoy: string,
): SaldoVacaciones {
  // Una fecha malformada es un error de programación de quien llama, no una
  // entrada legítima con la que seguir (mismo criterio que esFechaValida en
  // dias-habiles.ts). Lanzar aquí evita que la API responda 200 con un saldo
  // en blanco —o, si una fecha llegara como objeto Date por un SELECT sin
  // `::text`, con un `disfrutadas` en 0 igual de silencioso— sin dejar rastro
  // en los logs.
  if (!esFechaValida(hoy)) throw errorFechaInvalida('hoy', hoy);
  if (!config) return sinConfigurar();
  if (!esFechaValida(config.fechaCorte)) throw errorFechaInvalida('fechaCorte', config.fechaCorte);

  // Nunca negativo: una fecha de corte futura significa «aún no empieza a
  // devengar», no un descuento.
  const dias = Math.max(0, diasEntre(config.fechaCorte, hoy));
  // Redondeado YA aquí, no solo en el campo de salida: ver el porqué junto a
  // `disponible` más abajo.
  const devengadas = redondear((dias / DIAS_POR_MES) * DEVENGO_MENSUAL);

  const { disfrutadas, enTramite } = sumarDesdeElCorte(vacaciones, 'vacaciones', config.fechaCorte);

  return {
    configurado: true,
    saldoCorte: config.saldoCorte,
    fechaCorte: config.fechaCorte,
    devengadas,
    disfrutadas,
    enTramite,
    // Se suma el devengo YA redondeado (no el crudo): saldoCorte, devengadas y
    // disfrutadas son entonces las tres décimas exactas que se enseñan en
    // pantalla, y su suma cuadra exactamente con disponible. Sumar el devengo
    // sin redondear puede caer justo en un empate x,x5 que el error binario de
    // la resta empuja hacia abajo, restando 0,1 días de más siempre en
    // perjuicio del empleado (ver test del caso 10,4 + 5,8 − 6,5).
    disponible: redondear(config.saldoCorte + devengadas - disfrutadas),
  };
}

/**
 * El saldo de compensatorios de un empleado a fecha `hoy`.
 *
 * `hoy` entra aunque no intervenga en el cálculo, y es deliberado: es lo que
 * permite validarlo igual que en la otra bolsa —lanzar en vez de devolver un
 * saldo en blanco— y lo que deja la firma quieta cuando el otorgamiento traiga
 * un término que sí dependa de la fecha. Cobrar ese parámetro ahora sale más
 * barato que cambiar a todos los llamantes después.
 */
export function calcularSaldoCompensatorios(
  config: ConfigSaldo | null,
  ausencias: AusenciaParaElSaldo[],
  hoy: string,
): SaldoCompensatorios {
  if (!esFechaValida(hoy)) throw errorFechaInvalida('hoy', hoy);
  if (!config) return sinConfigurarCompensatorios();
  if (!esFechaValida(config.fechaCorte)) throw errorFechaInvalida('fechaCorte', config.fechaCorte);

  const { disfrutadas, enTramite } = sumarDesdeElCorte(ausencias, 'compensatorio', config.fechaCorte);
  const otorgados = sumarOtorgados(ausencias, config.fechaCorte);

  return {
    configurado: true,
    saldoCorte: config.saldoCorte,
    fechaCorte: config.fechaCorte,
    otorgados,
    disfrutadas,
    enTramite,
    // Los dos sumandos entran YA redondeados, por lo mismo que el devengo en la
    // otra bolsa: así las tres cifras que se enseñan son las décimas exactas y
    // su cuenta cuadra con `disponible` sin arrastrar el ruido de la resta.
    disponible: redondear(config.saldoCorte + otorgados - disfrutadas),
  };
}
