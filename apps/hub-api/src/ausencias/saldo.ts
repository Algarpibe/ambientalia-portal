import { esFechaValida } from './dias-habiles.js';
import { ESTADOS_EN_TRAMITE, type EstadoSolicitud, type TipoSolicitud } from './types.js';

// El saldo de vacaciones. Puro a propósito: sin Pool, sin fechas del sistema
// (el «hoy» se inyecta), para que todas las reglas se puedan probar sin BD.
//
// No se recalcula desde la fecha de ingreso. Se parte del saldo que hoy vive en
// la hoja `Total` del Excel y se sigue desde ahí:
//
//   saldo(hoy) = saldo_corte
//              + (días desde el corte / 30) × 1,25
//              − vacaciones aprobadas con inicio >= corte
//
// Es idéntico a recalcular desde el ingreso porque el devengo es proporcional al
// tiempo y a la misma tasa para todos, sin tramos por antigüedad.

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
  /** YYYY-MM-DD. Frontera: desde aquí se devenga y se descuenta. */
  fechaCorte: string;
}

/** Una solicitud, reducida a lo que el saldo necesita mirar. */
export interface VacacionTomada {
  tipo: TipoSolicitud;
  fechaInicio: string;
  diasHabiles: number;
  estado: EstadoSolicitud;
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

/** Un decimal, que es la precisión con la que se enseña y la de NUMERIC(5,1). */
function redondear(n: number): number {
  return Math.round(n * 10) / 10;
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
 * El saldo de un empleado a fecha `hoy`.
 *
 * `vacaciones` puede traer solicitudes de cualquier tipo y estado: el filtrado es
 * cosa de esta función, para que ninguna llamada pueda olvidarse una regla.
 */
export function calcularSaldo(
  config: ConfigSaldo | null,
  vacaciones: VacacionTomada[],
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

  // Se valida ANTES del filtro y para TODAS las solicitudes, no solo dentro
  // del callback de `sumar`: `fechaInicio` entra en una comparación `>=`
  // contra `fechaCorte`, y una fecha malformada ahí falla en silencio de dos
  // formas distintas. Si es un Date, `>=` lo compara vía ToPrimitive numérico
  // —el timestamp contra Number('YYYY-MM-DD'), que es NaN— y la comparación
  // es SIEMPRE false: la vacación no se descontaría jamás. Si es una fecha
  // sin cero de relleno («2026-2-1»), rompe el orden lexicográfico en
  // cualquier sentido: podría contar como posterior a un corte muy posterior.
  for (const v of vacaciones) {
    if (!esFechaValida(v.fechaInicio)) throw errorFechaInvalida('fechaInicio', v.fechaInicio);
  }

  // Nunca negativo: una fecha de corte futura significa «aún no empieza a
  // devengar», no un descuento.
  const dias = Math.max(0, diasEntre(config.fechaCorte, hoy));
  // Redondeado YA aquí, no solo en el campo de salida: ver el porqué junto a
  // `disponible` más abajo.
  const devengadas = redondear((dias / DIAS_POR_MES) * DEVENGO_MENSUAL);

  // Toma una LISTA de estados, no uno: desde la aprobación en cascada, «en
  // trámite» son dos estados —`pendiente` y `pendiente_2`— y con un solo estado
  // exacto la media firma desaparecería del saldo sin sumar en ningún sitio.
  const sumar = (estados: readonly EstadoSolicitud[]) =>
    vacaciones
      // El filtro es por fecha de INICIO, no por si ya ocurrió respecto a
      // `hoy`: una aprobada con inicio futuro se descuenta igual, porque el
      // saldo de partida del Excel todavía no la trae descontada.
      .filter((v) => v.tipo === 'vacaciones' && estados.includes(v.estado) && v.fechaInicio >= config.fechaCorte)
      .reduce((total, v) => total + v.diasHabiles, 0);

  // Media firma NO descuenta: sigue en trámite hasta que la solicitud queda firme.
  const disfrutadas = redondear(sumar(['aprobada']));

  return {
    configurado: true,
    saldoCorte: config.saldoCorte,
    fechaCorte: config.fechaCorte,
    devengadas,
    disfrutadas,
    enTramite: redondear(sumar(ESTADOS_EN_TRAMITE)),
    // Se suma el devengo YA redondeado (no el crudo): saldoCorte, devengadas y
    // disfrutadas son entonces las tres décimas exactas que se enseñan en
    // pantalla, y su suma cuadra exactamente con disponible. Sumar el devengo
    // sin redondear puede caer justo en un empate x,x5 que el error binario de
    // la resta empuja hacia abajo, restando 0,1 días de más siempre en
    // perjuicio del empleado (ver test del caso 10,4 + 5,8 − 6,5).
    disponible: redondear(config.saldoCorte + devengadas - disfrutadas),
  };
}
