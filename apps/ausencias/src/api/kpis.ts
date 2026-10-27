import { get } from './http';

// ARQ-612 — el panel de KPIs, sacado de api.ts tal cual: los tipos de cada
// indicador, tal como los agrega hub-api, y `kpis`. api.ts lo reexporta (lo
// vigila barril.test.ts).

/** El tiempo que tarda un aprobador en firmar, ya agregado por hub-api. */
export interface TiempoDeAprobador {
  aprobadorCorreo: string;
  /** Cuántas decisiones sostienen la cifra: un p90 de una muestra no vale lo
   *  mismo que uno de cincuenta, y la pantalla tiene que poder decirlo. */
  n: number;
  medianaHoras: number;
  p90Horas: number;
}

/** Una ficha con demasiadas vacaciones sin disfrutar. */
export interface FichaAcumulada {
  empleadoId: string;
  nombreCompleto: string;
  /** Días de vacaciones disponibles. */
  dias: number;
  /**
   * Días de calendario desde que terminaron sus últimas vacaciones. `null` si
   * no ha disfrutado ninguna, que NO es cero: cero diría «acaba de volver».
   */
  diasSinVacaciones: number | null;
  /**
   * Días de vacaciones que ya tiene pedidos hacia adelante (incluidas las que
   * esperan firma). Separa a quien acumula porque no planifica de quien
   * acumula pero ya tiene el viaje reservado.
   */
  diasProgramados: number;
}

/**
 * Quién concentra el pasivo, en dos grupos EXCLUYENTES: nadie aparece en los
 * dos. Los umbrales los manda el servidor para que la pantalla no los
 * reinvente — si el 15 y el 30 vivieran aquí, cambiarlos allí dejaría el
 * rótulo mintiendo.
 */
export interface AcumulacionExcesiva {
  aviso: FichaAcumulada[];
  alarma: FichaAcumulada[];
  umbralAviso: number;
  umbralAlarma: number;
}

/** Un mes de la serie de absentismo. */
export interface MesDeAbsentismo {
  /** `YYYY-MM`. */
  mes: string;
  /** Días de TRABAJO perdidos, no de calendario. */
  diasHabiles: number;
  episodios: number;
  /** Personas distintas. Dos incapacidades de la misma persona son dos
   *  episodios y una persona. */
  personas: number;
  /** Quiénes, en orden alfabético. ⚠️ Son datos de salud: se enseñan en el
   *  tooltip a propósito, pero no se propaguen a un CSV sin pensarlo. */
  nombres: string[];
}

export interface Absentismo {
  /** Un elemento por mes, incluidos los que están a cero: si faltaran, la
   *  gráfica uniría dos meses separados y pintaría una tendencia inventada. */
  meses: MesDeAbsentismo[];
  totalDiasHabiles: number;
  /** Una incapacidad partida entre dos meses cuenta UNA vez aquí. */
  totalEpisodios: number;
}

/** Un mes de la serie de estacionalidad, con su desglose por tipo. */
export interface MesDeEstacionalidad {
  /** `YYYY-MM`. */
  mes: string;
  vacaciones: number;
  permiso: number;
  compensatorio: number;
  incapacidad: number;
  /** La suma de los cuatro, calculada en el servidor para que la barra y su
   *  etiqueta no puedan discrepar por sumar en dos sitios. */
  total: number;
  /** Quiénes, por tipo y en orden alfabético. La misma persona puede salir en
   *  dos tipos, pero nunca dos veces dentro del mismo. */
  nombres: { vacaciones: string[]; permiso: string[]; compensatorio: string[]; incapacidad: string[] };
}

export interface Estacionalidad {
  meses: MesDeEstacionalidad[];
  totalPorTipo: { vacaciones: number; permiso: number; compensatorio: number; incapacidad: number };
  total: number;
  /** El mes con más días de ausencia, o `null` si no hubo ninguna. */
  mesPico: string | null;
}

/**
 * Cuánto roce genera el proceso.
 *
 * ⚠️ `rechazadas` y `anuladas` NO son lo mismo aunque en la base compartan el
 * estado `rechazada`: un rechazo es «el jefe dijo que no» y una anulación es
 * «el solicitante cambió de idea». Piden acciones distintas y por eso viajan
 * separadas; no sumarlas en la pantalla.
 */
export interface Friccion {
  /** El denominador: solicitudes ya resueltas. Las pendientes no entran. */
  decididas: number;
  rechazadas: number;
  anuladas: number;
  cambiosDeFecha: number;
  /** `null` cuando no hay decididas. Un 0% se leería como «no se rechaza
   *  nada», y sin datos eso no se sabe: hay que pintar «—», no «0%». */
  pctRechazo: number | null;
  pctAnulacion: number | null;
  pctCambioDeFecha: number | null;
}

/** Los KPIs del panel. */
export interface Kpis {
  pasivo: {
    /** Días de vacaciones acumulados por la plantilla activa. Deuda real. */
    diasVacaciones: number;
    diasCompensatorios: number;
    /** El denominador: sobre cuántas fichas activas se ha sumado. */
    empleados: number;
  };
  /**
   * Quién concentra ese pasivo. El total de arriba dice cuánto se debe; esto
   * dice a quién, que es lo único con lo que se puede hacer algo.
   */
  acumulacion: AcumulacionExcesiva;
  /** Días perdidos por incapacidad, mes a mes. La tendencia se lee de la serie:
   *  el servidor no calcula ninguna pendiente ni media móvil. */
  absentismo: Absentismo;
  /**
   * Días de ausencia por mes y tipo. ⚠️ Su ventana es MÁS LARGA que la del
   * resto del panel (24 meses frente a 12), así que su serie NO se puede
   * comparar mes a mes con la de `absentismo`.
   */
  estacionalidad: Estacionalidad;
  /** Rechazos, anulaciones y cambios de fecha. Comparte ventana con `tiempos`:
   *  los dos miden el proceso de aprobación. */
  friccion: Friccion;
  /** De más lento a más rápido: el atasco va arriba. */
  tiempos: TiempoDeAprobador[];
  pendientes: {
    total: number;
    hasta2Dias: number;
    de2a5Dias: number;
    masDe5Dias: number;
  };
  /** Inicio de la ventana de `tiempos`, en ISO. La pantalla lo dice en voz alta. */
  desde: string;
  /** El año seleccionado, o `null` si es la ventana móvil. Lo manda el servidor
   *  para que el rótulo y los datos no puedan discrepar. */
  anio: number | null;
  /** Los años que el selector puede ofrecer, del más reciente al más antiguo. */
  aniosDisponibles: number[];
}

/**
 * El panel de KPIs. Contesta 403 a quien no tenga la llave `ve_kpis`, y ese
 * 403 es el candado de verdad: la respuesta lleva dentro el agregado de la
 * plantilla entera, así que esconder la pestaña no bastaría.
 */
export const kpis = (anio: number | null = null) =>
  get<Kpis>(anio === null ? '/api/ausencias/kpis' : `/api/ausencias/kpis?year=${anio}`);
