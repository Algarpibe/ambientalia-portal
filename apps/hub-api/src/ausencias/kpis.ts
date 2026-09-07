import { contarDiasHabiles } from './dias-habiles.js';
import { ESTADOS_EN_TRAMITE, type EstadoSolicitud } from './types.js';

// El motor del panel de KPIs: aritmética pura, sin BD y sin Express.
//
// Vive aparte de `service.ts` a propósito. Lo que hay aquí son números que
// gerencia va a leer como si fueran hechos —el pasivo de vacaciones se parece
// mucho a una cifra contable, y los tiempos por aprobador se parecen mucho a
// una evaluación de desempeño—, así que conviene que se puedan probar con
// listas escritas a mano y sin levantar Postgres.
//
// El PASIVO no está aquí, y no es un olvido: se calcula sumando el `disponible`
// que ya produce `saldo.ts` para cada ficha, y duplicar esa cuenta aquí crearía
// una segunda verdad que puede divergir de la que enseña la pestaña Saldos.
// Ver `service.kpis`.

/**
 * El percentil `p` (0-100) de una lista de números, por interpolación lineal
 * entre los dos vecinos —el método por defecto de numpy y del tipo 7 de R—.
 *
 * Devuelve `null` con la lista vacía, y ESO IMPORTA: cero es un valor legítimo
 * en esta pantalla («se firma al instante»), así que devolverlo cuando no hay
 * ninguna muestra pintaría al aprobador más rápido de la compañía justo donde
 * no hay datos. El que llama decide cómo se dice «sin datos».
 *
 * Ordena por su cuenta: las filas llegan de la BD por fecha, no por duración.
 */
export function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  if (orden.length === 1) return orden[0];

  const pos = (p / 100) * (orden.length - 1);
  const bajo = Math.floor(pos);
  const alto = Math.ceil(pos);
  if (bajo === alto) return orden[bajo];
  return orden[bajo] + (orden[alto] - orden[bajo]) * (pos - bajo);
}

/** Horas de reloj entre dos instantes ISO. Ver el porqué en `tiemposPorAprobador`. */
export function horasEntre(desde: string, hasta: string): number {
  return (Date.parse(hasta) - Date.parse(desde)) / 3_600_000;
}

/** Una decisión ya tomada, reducida a lo que el KPI de tiempos necesita. */
export interface DecisionParaKpi {
  aprobadorCorreo: string;
  createdAt: string;
  /** `null` mientras nadie ha firmado. Esas filas NO entran en el cálculo. */
  decididaAt: string | null;
}

export interface TiempoDeAprobador {
  aprobadorCorreo: string;
  /** Cuántas decisiones sostienen la mediana. Sin esto, un p90 de una sola
   *  muestra se lee igual que uno de cincuenta, y no valen lo mismo. */
  n: number;
  medianaHoras: number;
  p90Horas: number;
}

/**
 * Mediana y p90 del tiempo que tarda cada aprobador en firmar, de más lento a
 * más rápido: el panel se lee de arriba abajo y la pregunta que responde es
 * «¿qué bandeja está atascada?».
 *
 * ⚠️ HORAS DE RELOJ, no horas hábiles. Un viernes a las 17:00 firmado el lunes
 * a las 09:00 cuenta 64 horas. Descontar noches y fines de semana daría un
 * número más halagüeño, pero mentiría sobre lo que de verdad espera quien pidió
 * las vacaciones, que es justo lo que este KPI mide.
 *
 * ⚠️ Las solicitudes SIN DECIDIR se descartan. Contarlas como cero premiaría al
 * aprobador que no ha firmado nada, que es el reverso exacto de lo que se
 * quiere señalar; y contarlas con el tiempo transcurrido hasta hoy mezclaría
 * dos medidas distintas en el mismo número. Lo que espera sin firmar lo cuenta
 * `pendientesPorAntiguedad`.
 *
 * ⚠️ Este número mide a PERSONAS CONCRETAS. Que la mediana suba puede ser una
 * bandeja desatendida, o puede ser alguien de vacaciones, o un mes de picos.
 * Es una señal para preguntar, no un veredicto.
 */
export function tiemposPorAprobador(decisiones: DecisionParaKpi[]): TiempoDeAprobador[] {
  const porAprobador = new Map<string, number[]>();

  for (const d of decisiones) {
    if (d.decididaAt === null) continue;
    // En minúsculas: los correos entran por el `sub` del JWT y por la hoja de
    // Google, y ninguno de los dos garantiza la caja. Sin normalizar, un mismo
    // jefe saldría en dos filas y las dos medianas serían falsas.
    const clave = d.aprobadorCorreo.toLowerCase();
    const horas = porAprobador.get(clave) ?? [];
    horas.push(horasEntre(d.createdAt, d.decididaAt));
    porAprobador.set(clave, horas);
  }

  return [...porAprobador.entries()]
    .map(([aprobadorCorreo, horas]) => ({
      aprobadorCorreo,
      n: horas.length,
      // El `!` es seguro: la clave solo existe si se le empujó al menos un
      // valor, así que la lista nunca está vacía aquí.
      medianaHoras: redondear(percentil(horas, 50)!),
      p90Horas: redondear(percentil(horas, 90)!),
    }))
    .sort((a, b) => b.medianaHoras - a.medianaHoras);
}

/** Una solicitud que sigue esperando firma, reducida a lo que el KPI necesita. */
export interface PendienteParaKpi {
  createdAt: string;
}

export interface PendientesPorAntiguedad {
  total: number;
  hasta2Dias: number;
  de2a5Dias: number;
  masDe5Dias: number;
}

/**
 * Las solicitudes que esperan firma ahora mismo, repartidas por lo que llevan
 * esperando.
 *
 * Los bordes van al tramo de ARRIBA: exactamente 2 días cuenta como «hasta 2»,
 * y exactamente 5 como «de 2 a 5». Los tres tramos suman siempre el total, y
 * eso es lo que hay que mirar si algún día los números parecen raros: un `<`
 * donde va un `<=` mueve una solicitud de tramo sin más síntoma que un
 * descuadre.
 */
export function pendientesPorAntiguedad(
  pendientes: PendienteParaKpi[],
  ahora: string,
): PendientesPorAntiguedad {
  const r: PendientesPorAntiguedad = { total: 0, hasta2Dias: 0, de2a5Dias: 0, masDe5Dias: 0 };

  for (const p of pendientes) {
    const dias = horasEntre(p.createdAt, ahora) / 24;
    r.total += 1;
    if (dias <= 2) r.hasta2Dias += 1;
    else if (dias <= 5) r.de2a5Dias += 1;
    else r.masDe5Dias += 1;
  }
  return r;
}

// ── Acumulación excesiva ───────────────────────────────────────────────────

/** Una ficha reducida a lo que el KPI de acumulación necesita. */
export interface FichaAcumulada {
  empleadoId: string;
  nombreCompleto: string;
  /** Días disponibles de vacaciones. Puede ser negativo (ver el JSDoc). */
  dias: number;
  /**
   * Días de calendario desde que terminó sus últimas vacaciones. `null` si no
   * ha disfrutado ninguna: alguien recién entrado, o alguien que lleva años sin
   * tomarlas. NO es cero — ver `diasDesde`.
   */
  diasSinVacaciones: number | null;
  /**
   * Días hábiles de vacaciones que ya tiene pedidos hacia adelante.
   *
   * Es la señal que separa dos casos que el saldo solo no distingue: quien
   * acumula porque no planifica, y quien acumula pero ya tiene el viaje
   * reservado para enero. Sin esto la pantalla los pinta idénticos y la mitad
   * de la lista son falsos positivos.
   */
  diasProgramados: number;
}

/**
 * Días de CALENDARIO entre una fecha y hoy, o `null` si no hay fecha.
 *
 * Calendario y no hábiles a propósito: la pregunta que responde es «cuánto
 * lleva sin desconectar», y el descanso no se mide en jornadas laborables. Del
 * viernes al lunes han pasado tres días de vida, no uno de trabajo.
 *
 * ⚠️ El `null` NO es un cero disfrazado. Significa «nunca ha disfrutado
 * vacaciones»; devolver 0 diría «acaba de volver», que es lo contrario, y en la
 * lista de acumulación excesiva pintaría de tranquilo justo el peor caso.
 */
export function diasDesde(fecha: string | null, hoy: string): number | null {
  if (fecha === null) return null;
  return Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${fecha}T00:00:00Z`)) / 86_400_000);
}

export interface AcumulacionExcesiva {
  /** Quienes están entre los dos umbrales. Corregible planificando. */
  aviso: FichaAcumulada[];
  /** Quienes pasan del umbral alto. Ya no se corrige solo. */
  alarma: FichaAcumulada[];
  /** Los umbrales aplicados, para que la pantalla los diga en vez de
   *  reinventarlos: si el número viviera también en el front, cambiarlo aquí
   *  dejaría el rótulo mintiendo. */
  umbralAviso: number;
  umbralAlarma: number;
}

/**
 * Quién lleva demasiadas vacaciones sin disfrutar, en dos grupos.
 *
 * ⚠️ La escala no es arbitraria: esta app devenga 1,25 días al mes
 * (`DEVENGO_MENSUAL` en `saldo.ts`), o sea unos 15 al año. Así que cada 15 días
 * de saldo son UN AÑO sin disfrutar vacaciones, y 30 son dos. Quien cambie los
 * umbrales debería pensarlos en años, no en días sueltos.
 *
 * Los dos grupos son EXCLUYENTES: quien está en `alarma` no vuelve a salir en
 * `aviso`. Si se solaparan, la pantalla contaría dos veces a la misma persona y
 * las dos listas dejarían de sumar la plantilla afectada.
 *
 * Los bordes cuentan como ALCANZADOS (`>=`): quien está clavado en 30,0 va a
 * alarma, no al grupo suave. Un `>` ahí dejaría el caso más grave en la lista
 * que no se mira con prisa.
 *
 * ⚠️ Los saldos NEGATIVOS no entran en ningún grupo. Pasan de verdad —quien
 * disfruta más días de los que ha devengado queda en negativo hasta que
 * recupera—, y son exactamente lo contrario de acumular: colarlos aquí
 * señalaría por acumulación excesiva a quien no acumula nada.
 */
export function acumulacionExcesiva(
  fichas: FichaAcumulada[],
  umbralAviso: number,
  umbralAlarma: number,
): AcumulacionExcesiva {
  // De más a menos: el peor caso arriba, igual que la tabla de tiempos.
  const porDiasDesc = (a: FichaAcumulada, b: FichaAcumulada) => b.dias - a.dias;

  return {
    aviso: fichas.filter((f) => f.dias >= umbralAviso && f.dias < umbralAlarma).sort(porDiasDesc),
    alarma: fichas.filter((f) => f.dias >= umbralAlarma).sort(porDiasDesc),
    umbralAviso,
    umbralAlarma,
  };
}

// ── Absentismo por incapacidad ─────────────────────────────────────────────

/** Una incapacidad reducida a lo que el KPI de absentismo necesita. */
export interface IncapacidadParaKpi {
  /** Para contar personas distintas, que no es lo mismo que episodios. */
  empleadoId: string;
  nombreCompleto: string;
  fechaInicio: string;
  fechaFin: string;
}

export interface MesDeAbsentismo {
  /** `YYYY-MM`. */
  mes: string;
  /** Días de trabajo perdidos ese mes. */
  diasHabiles: number;
  /** Cuántas incapacidades tocaron ese mes. */
  episodios: number;
  /** Cuántas PERSONAS distintas. Dos incapacidades de la misma persona son dos
   *  episodios y una persona. */
  personas: number;
  /**
   * Quiénes, por nombre y en orden alfabético. Es `personas` con nombres, así
   * que sale de la misma cuenta: si `nombres.length` y `personas` discreparan,
   * uno de los dos estaría mal.
   *
   * ⚠️ Son datos de salud. La pantalla los enseña porque se pidió a propósito
   * (ver el tooltip de absentismo); no se propaguen a un CSV ni a un correo sin
   * volver a pensarlo.
   */
  nombres: string[];
}

export interface Absentismo {
  /** Un elemento por mes de la ventana, incluidos los que están a cero. */
  meses: MesDeAbsentismo[];
  totalDiasHabiles: number;
  /** Episodios DISTINTOS: una incapacidad partida entre dos meses cuenta una
   *  vez aquí, aunque aparezca en los dos meses de la serie. */
  totalEpisodios: number;
}

/**
 * Días de trabajo perdidos por incapacidad, mes a mes.
 *
 * ⚠️ DÍAS HÁBILES, no de calendario. Esto mide absentismo laboral —días de
 * trabajo que se pierden—, así que un viernes-a-lunes son 2 días y no 4.
 * Contar calendario inflaría la cifra de toda la compañía en torno a un 40%.
 * (Ojo: NO es la cuenta que usa la EPS para pagar, que sí va en calendario. Si
 * algún día hace falta el coste, es otro KPI y otra unidad.)
 *
 * ⚠️ UNA INCAPACIDAD A CABALLO ENTRE DOS MESES SE REPARTE. Imputarla entera al
 * mes de inicio es más simple, pero carga a un mes días que se perdieron en el
 * otro, y esta serie existe justo para mirar la evolución mes a mes.
 *
 * ⚠️ Los meses SIN incapacidades salen igualmente, con cero. Si desaparecieran,
 * la gráfica uniría agosto con octubre y pintaría una línea continua donde hubo
 * un mes limpio: la forma más fácil de leer una tendencia que no existe.
 *
 * Los dos extremos son `YYYY-MM` inclusive.
 */
export function absentismoPorMes(
  incapacidades: IncapacidadParaKpi[],
  desdeMes: string,
  hastaMes: string,
): Absentismo {
  // La serie completa primero, para que los meses vacíos existan desde el
  // principio en vez de depender de que algún dato caiga en ellos.
  // `personas` es un Map de id → nombre y no un Set de nombres: dos personas
  // distintas pueden llamarse igual, y un Set las fundiría en una sola.
  const serie = new Map<
    string,
    { diasHabiles: number; episodios: number; personas: Map<string, string> }
  >();
  for (const mes of mesesEntre(desdeMes, hastaMes)) {
    serie.set(mes, { diasHabiles: 0, episodios: 0, personas: new Map() });
  }

  let totalEpisodios = 0;

  for (const inc of incapacidades) {
    // `tocaAlgunMes` decide si el episodio cuenta para el total, y se calcula
    // sobre los tramos que caen DENTRO de la ventana: una incapacidad de hace
    // tres años no puede sumar al total de una serie que no la enseña.
    let tocaAlgunMes = false;

    for (const [mes, dias] of tramosPorMes(inc.fechaInicio, inc.fechaFin, serie.keys())) {
      const casilla = serie.get(mes)!;
      tocaAlgunMes = true;
      casilla.diasHabiles += dias;
      casilla.episodios += 1;
      casilla.personas.set(inc.empleadoId, inc.nombreCompleto);
    }

    // Fuera del bucle de meses: una incapacidad partida entre septiembre y
    // octubre aparece en los dos meses de la serie pero es UN episodio.
    if (tocaAlgunMes) totalEpisodios += 1;
  }

  const meses = [...serie.entries()].map(([mes, c]) => ({
    mes,
    diasHabiles: c.diasHabiles,
    episodios: c.episodios,
    personas: c.personas.size,
    // Alfabético: las filas llegan de la BD por fecha, y sin ordenar el mismo
    // mes cambiaría el orden de los nombres en cuanto alguien registrara una
    // ausencia vieja.
    nombres: ordenarNombres([...c.personas.values()]),
  }));

  return {
    meses,
    totalDiasHabiles: meses.reduce((t, m) => t + m.diasHabiles, 0),
    totalEpisodios,
  };
}

// ── Estacionalidad ─────────────────────────────────────────────────────────

/**
 * Los cuatro tipos que SON una ausencia.
 *
 * ⚠️ `otorgamiento` NO está, y no es un olvido. Lo dice el propio `types.ts`:
 * «el otorgamiento NO es una ausencia, y es el único de la lista que no lo es».
 * Sus `dias_habiles` son días CONCEDIDOS por trabajar un sábado, y su
 * `fecha_inicio` es el día de ese trabajo extra. Colarlo aquí sumaría días
 * TRABAJADOS a una serie de días AUSENTE, y encima subiría justo en los meses
 * de más faena, que es lo contrario de lo que el KPI quiere enseñar.
 */
export const TIPOS_DE_AUSENCIA = ['vacaciones', 'permiso', 'compensatorio', 'incapacidad'] as const;
export type TipoDeAusencia = (typeof TIPOS_DE_AUSENCIA)[number];

/** Una ausencia reducida a lo que el KPI de estacionalidad necesita. */
export interface AusenciaParaKpi {
  tipo: TipoDeAusencia;
  empleadoId: string;
  nombreCompleto: string;
  fechaInicio: string;
  fechaFin: string;
}

export interface MesDeEstacionalidad {
  /** `YYYY-MM`. */
  mes: string;
  vacaciones: number;
  permiso: number;
  compensatorio: number;
  incapacidad: number;
  /** La suma de los cuatro. Viaja calculado para que la barra y su etiqueta no
   *  puedan discrepar por sumar en dos sitios distintos. */
  total: number;
  /**
   * Quiénes, POR TIPO y en orden alfabético. Va por tipo y no como una lista
   * plana del mes porque el tooltip ya se lee así —«vacaciones 21, permisos
   * 1»—: con una sola lista no se sabría quién es de cuál.
   *
   * La misma persona puede salir en dos tipos —vacaciones y un permiso el mismo
   * mes son dos hechos distintos—, pero nunca dos veces dentro del mismo.
   */
  nombres: Record<TipoDeAusencia, string[]>;
}

export interface Estacionalidad {
  meses: MesDeEstacionalidad[];
  totalPorTipo: Record<TipoDeAusencia, number>;
  total: number;
  /** El mes con más días de ausencia, o `null` si no hubo ninguna. `null` y no
   *  el primer mes: señalar un pico de cero días diría que ese fue el momento
   *  de más ausencias del año. */
  mesPico: string | null;
}

/**
 * Días de ausencia por mes y por tipo, para ver cuándo se concentran.
 *
 * Reparte igual que `absentismoPorMes` —comparten `tramosPorMes`— y por lo
 * mismo: una ausencia a caballo entre dos meses pertenece a los dos.
 *
 * ⚠️ Con una ventana de un solo año esto es DESCRIPTIVO, no estacional: cada
 * mes aparece una vez y no hay con qué compararlo. La estacionalidad de verdad
 * necesita ver el mismo mes repetido, y por eso la ventana de este KPI es más
 * larga que la de los demás (ver `MESES_DE_ESTACIONALIDAD` en `service.ts`).
 */
export function estacionalidadPorMes(
  ausencias: AusenciaParaKpi[],
  desdeMes: string,
  hastaMes: string,
): Estacionalidad {
  const serie = new Map<string, MesDeEstacionalidad>();
  // Map de id → nombre por tipo, por lo mismo que en absentismo: dos personas
  // distintas pueden llamarse igual y un Set de nombres las fundiría.
  const gente = new Map<string, Record<TipoDeAusencia, Map<string, string>>>();

  for (const mes of mesesEntre(desdeMes, hastaMes)) {
    serie.set(mes, {
      mes,
      vacaciones: 0,
      permiso: 0,
      compensatorio: 0,
      incapacidad: 0,
      total: 0,
      nombres: { vacaciones: [], permiso: [], compensatorio: [], incapacidad: [] },
    });
    gente.set(mes, {
      vacaciones: new Map(),
      permiso: new Map(),
      compensatorio: new Map(),
      incapacidad: new Map(),
    });
  }

  for (const au of ausencias) {
    for (const [mes, dias] of tramosPorMes(au.fechaInicio, au.fechaFin, serie.keys())) {
      const casilla = serie.get(mes)!;
      casilla[au.tipo] += dias;
      casilla.total += dias;
      gente.get(mes)![au.tipo].set(au.empleadoId, au.nombreCompleto);
    }
  }

  const meses = [...serie.values()].map((m) => ({
    ...m,
    nombres: {
      vacaciones: ordenarNombres([...gente.get(m.mes)!.vacaciones.values()]),
      permiso: ordenarNombres([...gente.get(m.mes)!.permiso.values()]),
      compensatorio: ordenarNombres([...gente.get(m.mes)!.compensatorio.values()]),
      incapacidad: ordenarNombres([...gente.get(m.mes)!.incapacidad.values()]),
    },
  }));
  const totalPorTipo = Object.fromEntries(
    TIPOS_DE_AUSENCIA.map((t) => [t, meses.reduce((s, m) => s + m[t], 0)]),
  ) as Record<TipoDeAusencia, number>;

  // El pico se busca solo entre los meses con algo: sin este filtro, una
  // ventana entera a cero devolvería el primer mes como si fuera el más
  // cargado del año.
  const conAusencias = meses.filter((m) => m.total > 0);
  const pico = conAusencias.reduce<MesDeEstacionalidad | null>(
    (mejor, m) => (mejor === null || m.total > mejor.total ? m : mejor),
    null,
  );

  return {
    meses,
    totalPorTipo,
    total: meses.reduce((s, m) => s + m.total, 0),
    mesPico: pico?.mes ?? null,
  };
}

// ── Fricción ───────────────────────────────────────────────────────────────

/** Una solicitud reducida a las tres señales de fricción que el KPI mira. */
export interface SolicitudParaFriccion {
  estado: EstadoSolicitud;
  /**
   * Tiene `anulada_at`. **Es lo ÚNICO que separa una anulación de un rechazo**:
   * las dos dejan la solicitud en `rechazada`.
   */
  anulada: boolean;
  /** Le aprobaron al menos un cambio de fechas. */
  cambioDeFechas: boolean;
}

export interface Friccion {
  /** El denominador: solicitudes ya resueltas. Las pendientes no entran. */
  decididas: number;
  /** El aprobador dijo que no. */
  rechazadas: number;
  /** El solicitante la retiró. */
  anuladas: number;
  /** Solicitudes con al menos un cambio de fechas aprobado. */
  cambiosDeFecha: number;
  /** `null` cuando no hay decididas: un 0% se leería como «no se rechaza nada,
   *  todo va bien», y con cero solicitudes eso no se sabe. */
  pctRechazo: number | null;
  pctAnulacion: number | null;
  pctCambioDeFecha: number | null;
}

/**
 * Cuánto roce genera el proceso: rechazos, anulaciones y cambios de fecha.
 *
 * ⚠️ RECHAZO Y ANULACIÓN NO SON LO MISMO, aunque compartan estado. Las dos
 * dejan la solicitud en `rechazada` y solo las separa `anulada_at` (ver
 * `repo.aplicarALaSolicitud`). Un rechazo es «el jefe dijo que no»; una
 * anulación es «el solicitante cambió de idea». Sumarlas daría un número que no
 * significa nada, porque una subida podría ser cualquiera de las dos y las dos
 * piden acciones distintas.
 *
 * ⚠️ Las PENDIENTES no entran ni en el numerador ni en el denominador. Una
 * pedida ayer y aún sin firmar no puede haber sido rechazada: contarla abajo
 * hundiría el porcentaje por el mero hecho de que alguien acabe de mandar una
 * solicitud.
 *
 * Las `registrada` SÍ cuentan como decididas: una incapacidad se informa y no
 * necesita firma de nadie, así que es una solicitud resuelta.
 *
 * Las tres categorías NO son excluyentes a propósito: una solicitud puede haber
 * cambiado de fechas y acabar anulada, y son dos fricciones distintas sobre el
 * mismo caso.
 */
export function friccion(solicitudes: SolicitudParaFriccion[]): Friccion {
  const decididas = solicitudes.filter((s) => !ESTADOS_EN_TRAMITE.includes(s.estado));

  const rechazadas = decididas.filter((s) => s.estado === 'rechazada' && !s.anulada).length;
  const anuladas = decididas.filter((s) => s.estado === 'rechazada' && s.anulada).length;
  const cambiosDeFecha = decididas.filter((s) => s.cambioDeFechas).length;

  const pct = (n: number) => (decididas.length === 0 ? null : redondear((n / decididas.length) * 100));

  return {
    decididas: decididas.length,
    rechazadas,
    anuladas,
    cambiosDeFecha,
    pctRechazo: pct(rechazadas),
    pctAnulacion: pct(anuladas),
    pctCambioDeFecha: pct(cambiosDeFecha),
  };
}

/**
 * Reparte un rango de fechas entre los meses de la serie que toca, devolviendo
 * los DÍAS HÁBILES que le corresponden a cada uno.
 *
 * Es el corazón compartido de `absentismoPorMes` y `estacionalidadPorMes`: los
 * dos tienen que repartir igual, y escribirlo dos veces es la forma segura de
 * que un día dejen de coincidir. Omite los meses que el rango no toca, así que
 * quien llame puede usar el propio bucle para saber si la ausencia entró en la
 * ventana o se quedó fuera entera.
 */
function tramosPorMes(
  fechaInicio: string,
  fechaFin: string,
  meses: Iterable<string>,
): [string, number][] {
  const tramos: [string, number][] = [];
  for (const mes of meses) {
    const desde = mayor(fechaInicio, `${mes}-01`);
    const hasta = menor(fechaFin, ultimoDiaDe(mes));
    if (desde > hasta) continue; // el rango no toca este mes
    tramos.push([mes, contarDiasHabiles(desde, hasta)]);
  }
  return tramos;
}

// ── Ventanas ───────────────────────────────────────────────────────────────

/** El tramo de fechas que mira un KPI, en `YYYY-MM-DD` y ambos incluidos. */
export interface VentanaDeKpis {
  desde: string;
  hasta: string;
}

/**
 * La ventana de un KPI: un año natural concreto, o los últimos N meses.
 *
 * Con `anio`, el año manda y `mesesPorDefecto` se IGNORA. Si se sumaran, pedir
 * 2025 en la estacionalidad —que por defecto mira 24 meses— devolvería dos años
 * mientras el rótulo de la pantalla dijera «2025».
 *
 * ⚠️ El año EN CURSO se corta en hoy, no en diciembre. Con diciembre la serie
 * arrastraría los meses que aún no han pasado como barras a cero, y una gráfica
 * que se desploma al final se lee como una caída, no como «esto todavía no ha
 * ocurrido».
 *
 * Sin año, el comienzo es el DÍA 1 del mes, no el día suelto de hace N meses:
 * las series se agrupan por mes, y empezar a mitad dejaría el primer mes
 * incompleto y su barra más baja que la realidad.
 */
export function ventanaDeKpis(
  anio: number | null,
  hoy: string,
  mesesPorDefecto: number,
): VentanaDeKpis {
  if (anio === null) {
    const [a, m] = hoy.split('-').map(Number);
    const inicio = new Date(Date.UTC(a, m - 1 - mesesPorDefecto, 1));
    return { desde: inicio.toISOString().slice(0, 10), hasta: hoy };
  }

  const finDeAnio = `${anio}-12-31`;
  return { desde: `${anio}-01-01`, hasta: menor(finDeAnio, hoy) };
}

/** Los `YYYY-MM` entre dos extremos, ambos incluidos. */
function mesesEntre(desdeMes: string, hastaMes: string): string[] {
  const meses: string[] = [];
  let [anio, mes] = desdeMes.split('-').map(Number);
  while (`${anio}-${String(mes).padStart(2, '0')}` <= hastaMes) {
    meses.push(`${anio}-${String(mes).padStart(2, '0')}`);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      anio += 1;
    }
  }
  return meses;
}

/**
 * El último día de un `YYYY-MM`. `Date.UTC(anio, mes, 0)` es el día cero del mes
 * SIGUIENTE, que es el último del pedido: así no hay que escribir la tabla de
 * los treinta días trae noviembre ni acordarse de los bisiestos.
 */
function ultimoDiaDe(mes: string): string {
  const [anio, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(anio, m, 0)).toISOString().slice(0, 10);
}

/**
 * Nombres en orden alfabético español: `localeCompare` con `es` para que la Ñ
 * caiga entre la N y la O y los acentos no manden a nadie al final de la lista.
 */
function ordenarNombres(nombres: string[]): string[] {
  return [...nombres].sort((a, b) => a.localeCompare(b, 'es'));
}

const mayor = (a: string, b: string) => (a > b ? a : b);
const menor = (a: string, b: string) => (a < b ? a : b);

/**
 * Un decimal. Los tiempos se pintan como «3,5 h» y arrastrar la cola binaria de
 * la división daría «3,4999999999999996» en cuanto alguien los formatee mal.
 */
function redondear(n: number): number {
  return Math.round(n * 10) / 10;
}
