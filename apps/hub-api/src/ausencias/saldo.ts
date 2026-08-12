import type { EstadoSolicitud, TipoSolicitud } from './types.js';

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
  /** False si al empleado le falta el saldo o la fecha de corte. */
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

const SIN_CONFIGURAR: SaldoVacaciones = {
  configurado: false,
  saldoCorte: 0,
  fechaCorte: '',
  devengadas: 0,
  disfrutadas: 0,
  enTramite: 0,
  disponible: 0,
};

/** Un decimal, que es la precisión con la que se enseña y la de NUMERIC(5,1). */
function redondear(n: number): number {
  return Math.round(n * 10) / 10;
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
  if (!config) return SIN_CONFIGURAR;

  // Nunca negativo: una fecha de corte futura significa «aún no empieza a
  // devengar», no un descuento.
  const dias = Math.max(0, diasEntre(config.fechaCorte, hoy));
  const devengadas = (dias / DIAS_POR_MES) * DEVENGO_MENSUAL;

  const sumar = (estado: EstadoSolicitud) =>
    vacaciones
      .filter((v) => v.tipo === 'vacaciones' && v.estado === estado && v.fechaInicio >= config.fechaCorte)
      .reduce((total, v) => total + v.diasHabiles, 0);

  const disfrutadas = sumar('aprobada');

  return {
    configurado: true,
    saldoCorte: config.saldoCorte,
    fechaCorte: config.fechaCorte,
    devengadas: redondear(devengadas),
    disfrutadas: redondear(disfrutadas),
    enTramite: redondear(sumar('pendiente')),
    // Con el devengo SIN redondear: redondear dos veces desviaría el resultado.
    disponible: redondear(config.saldoCorte + devengadas - disfrutadas),
  };
}
