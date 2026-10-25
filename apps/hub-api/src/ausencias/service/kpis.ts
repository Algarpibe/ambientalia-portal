import type { Pool } from '@algarpibe/zoho-sync';
import {
  absentismoPorMes,
  acumulacionExcesiva,
  diasDesde,
  estacionalidadPorMes,
  friccion,
  ventanaDeKpis,
  pendientesPorAntiguedad,
  tiemposPorAprobador,
  type Absentismo,
  type AcumulacionExcesiva,
  type Estacionalidad,
  type Friccion,
  type PendientesPorAntiguedad,
  type TiempoDeAprobador,
} from '../kpis.js';
import * as repo from '../repo.js';
import { hoyEnColombia } from '../saldo.js';
import { combinar } from './saldos.js';

// ARQ-612 — el panel de KPIs, sacado de service.ts tal cual: las ventanas y los
// umbrales, y `kpis`, que junta las consultas del repo con los cálculos puros
// de ../kpis.ts. service.ts lo reexporta (lo vigila barril.test.ts).

/** Cuántos meses hacia atrás mira el KPI de tiempos de aprobación. */
const MESES_DE_VENTANA = 12;

/**
 * La ventana de la ESTACIONALIDAD, más larga que la de los demás a propósito.
 *
 * Con doce meses cada mes aparece una sola vez, y una serie así es descriptiva
 * —«esto pasó»— pero no estacional: no hay con qué comparar agosto. Con
 * veinticuatro se ve el mismo mes dos veces, que es el mínimo para empezar a
 * distinguir un patrón de una casualidad. Aprovecha además el histórico
 * importado de la hoja, que llega más atrás que el uso de la app.
 */
const MESES_DE_ESTACIONALIDAD = 24;

/**
 * Los dos umbrales de acumulación de vacaciones, EN DÍAS.
 *
 * No son números redondos por casualidad: esta app devenga 1,25 días al mes
 * (`DEVENGO_MENSUAL` en `saldo.ts`), o sea unos 15 al año. Así que 15 días de
 * saldo son UN AÑO sin disfrutar vacaciones —todavía corregible planificando— y
 * 30 son DOS, que ya es un problema que hay que gestionar.
 *
 * Quien los cambie debería pensarlos en años y mover los dos a la vez: el par
 * es el que separa «hay que hablarlo» de «hay que actuar».
 */
const UMBRAL_ACUMULACION_AVISO = 15;
const UMBRAL_ACUMULACION_ALARMA = 30;

export interface Kpis {
  /**
   * La deuda: cuántos días de vacaciones y de compensatorios tiene acumulados
   * la plantilla activa, sumados. Es la cifra que hoy no ve nadie —Saldos la
   * enseña persona a persona y nunca sumada—.
   */
  pasivo: {
    diasVacaciones: number;
    diasCompensatorios: number;
    /** Sobre cuántas fichas activas se ha sumado. Un total sin su denominador
     *  no se puede comparar con el del mes que viene. */
    empleados: number;
  };
  /**
   * Quién concentra ese pasivo. El total de arriba dice cuánto se debe; esto
   * dice a quién, que es lo único con lo que se puede hacer algo.
   */
  acumulacion: AcumulacionExcesiva;
  /**
   * Días de trabajo perdidos por incapacidad, mes a mes. La tendencia se lee de
   * la serie: aquí no se calcula ninguna pendiente ni media móvil, porque con
   * el histórico que hay una línea así invita a ver señal donde hay ruido.
   */
  absentismo: Absentismo;
  /**
   * Días de ausencia por mes y tipo, para ver cuándo se concentran. Su ventana
   * es MÁS LARGA que la del resto (ver `MESES_DE_ESTACIONALIDAD`), así que su
   * serie no se puede comparar mes a mes con la de `absentismo`.
   */
  estacionalidad: Estacionalidad;
  /**
   * Cuánto roce genera el proceso: rechazos, anulaciones y cambios de fecha.
   * Comparte ventana con `tiempos` —los dos miden el proceso de aprobación—.
   */
  friccion: Friccion;
  tiempos: TiempoDeAprobador[];
  pendientes: PendientesPorAntiguedad;
  /** El inicio de la ventana de `tiempos`, en ISO, para poder decirlo en la
   *  pantalla en vez de que el lector tenga que suponerlo. */
  desde: string;
  /**
   * El año que se está mirando, o `null` si es la ventana móvil por defecto.
   * Viaja de vuelta para que la pantalla sepa qué tiene seleccionado sin
   * guardarlo por su cuenta y arriesgarse a que discrepen.
   */
  anio: number | null;
  /** Los años que el selector puede ofrecer, del más reciente al más antiguo. */
  aniosDisponibles: number[];
}

/**
 * Los tres KPIs del panel.
 *
 * ⚠️ NO recibe `Sesion`, y es deliberado: esto es un agregado de la compañía
 * entera, no una vista recortada por quien pregunta. Quién puede pedirlo lo
 * decide el router ANTES de llamar aquí —rol de admin, o la llave `ve_kpis`—,
 * y ese sí es un candado de verdad: la respuesta lleva los datos dentro, así
 * que no basta con no pintar el botón.
 *
 * ⚠️ EL PASIVO SE REUTILIZA, NO SE RECALCULA. Sale del mismo `combinar()` que
 * alimenta la pestaña Saldos, y no de un `SUM()` en SQL, aunque un SUM sería
 * más corto. El motivo: `disponible` no es una columna, es el resultado de
 * `saldoCorte + devengado − disfrutado` con el devengo congelado ficha a ficha
 * (ver `saldo.ts`). Reescribir esa cuenta en SQL crearía una segunda verdad, y
 * el día que las dos pantallas discreparan nadie sabría cuál creer.
 */
export async function kpis(db: Pool, anio: number | null = null): Promise<Kpis> {
  const hoy = hoyEnColombia();

  // Las dos ventanas. Con `anio` las dos son ese año natural; sin él, cada una
  // mira sus meses (12 el general, 24 la estacionalidad — ver por qué en
  // `MESES_DE_ESTACIONALIDAD`).
  const general = ventanaDeKpis(anio, hoy, MESES_DE_VENTANA);
  const estacional = ventanaDeKpis(anio, hoy, MESES_DE_ESTACIONALIDAD);

  // `decisionesParaKpi` y `solicitudesParaFriccion` comparan contra
  // `created_at`, que es TIMESTAMPTZ: se les pasa el instante y no el día.
  const desdeIso = `${general.desde}T00:00:00Z`;

  const empleados = await repo.empleadosConSaldo(db, null, null);
  const [
    ausenciasDelSaldo,
    decisiones,
    pendientes,
    incapacidades,
    ausencias,
    paraFriccion,
    planificacion,
    aniosDisponibles,
  ] = await Promise.all([
      repo.ausenciasQueTocanElSaldo(
        db,
        empleados.map((e) => e.empleadoId),
      ),
      repo.decisionesParaKpi(db, desdeIso),
      repo.pendientesParaKpi(db),
      repo.incapacidadesParaKpi(db, general.desde, general.hasta),
      repo.ausenciasParaKpi(db, estacional.desde, estacional.hasta),
      repo.solicitudesParaFriccion(db, desdeIso),
      // La planificación NO se filtra por año: son las señales de HOY —cuánto
      // lleva sin descansar, qué tiene pedido—, igual que el pasivo y las
      // pendientes. Pasarle la ventana convertiría «no tiene nada previsto» en
      // «no tenía nada previsto en 2024», que no significa lo mismo.
      repo.planificacionDeVacaciones(db, hoy),
      repo.aniosConAusencias(db),
    ]);

  const saldos = combinar(empleados, ausenciasDelSaldo, hoy);
  const porEmpleado = new Map(planificacion.map((p) => [p.empleadoId, p]));

  return {
    pasivo: {
      diasVacaciones: redondearDias(saldos.reduce((t, s) => t + s.saldo.disponible, 0)),
      diasCompensatorios: redondearDias(saldos.reduce((t, s) => t + s.compensatorios.disponible, 0)),
      empleados: saldos.length,
    },
    // Sale de la MISMA lista `saldos` que el pasivo, sin consulta añadida: es
    // el mismo número desglosado por persona en vez de sumado, así que el
    // total de arriba y estas listas no pueden discrepar.
    acumulacion: acumulacionExcesiva(
      saldos.map((s) => {
        // Por `empleadoId` y no por posición: las dos listas salen de consultas
        // distintas y que vengan en el mismo orden es cierto hoy pero no lo
        // comprueba nadie. Equivocarse de fila aquí le atribuiría a alguien el
        // «lleva dos años sin vacaciones» de otro.
        const plan = porEmpleado.get(s.empleadoId);
        return {
          empleadoId: s.empleadoId,
          nombreCompleto: s.nombreCompleto,
          dias: s.saldo.disponible,
          // `?? null` y no `?? 0`: sin fila de planificación no sabemos cuándo
          // descansó, que no es lo mismo que saber que fue hoy.
          diasSinVacaciones: diasDesde(plan?.ultimasVacaciones ?? null, hoy),
          diasProgramados: plan?.diasProgramados ?? 0,
        };
      }),
      UMBRAL_ACUMULACION_AVISO,
      UMBRAL_ACUMULACION_ALARMA,
    ),
    // La serie va del primer mes de la ventana al mes en curso, incluido: el
    // mes actual sale a medias por definición, y esconderlo dejaría la gráfica
    // terminando siempre en el mes pasado.
    absentismo: absentismoPorMes(incapacidades, general.desde.slice(0, 7), general.hasta.slice(0, 7)),
    estacionalidad: estacionalidadPorMes(
      ausencias,
      estacional.desde.slice(0, 7),
      estacional.hasta.slice(0, 7),
    ),
    friccion: friccion(paraFriccion),
    tiempos: tiemposPorAprobador(decisiones),
    pendientes: pendientesPorAntiguedad(pendientes, new Date().toISOString()),
    desde: desdeIso,
    anio,
    aniosDisponibles,
  };
}

/**
 * Un decimal. Sumar cien `disponible` en coma flotante produce colas del tipo
 * `1234.5999999999999`, y esta cifra se lee como si fuera contable.
 */
function redondearDias(n: number): number {
  return Math.round(n * 10) / 10;
}
