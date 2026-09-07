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

/**
 * Un decimal. Los tiempos se pintan como «3,5 h» y arrastrar la cola binaria de
 * la división daría «3,4999999999999996» en cuanto alguien los formatee mal.
 */
function redondear(n: number): number {
  return Math.round(n * 10) / 10;
}
