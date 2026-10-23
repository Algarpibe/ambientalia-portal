import type { Pool } from '@algarpibe/zoho-sync';
import { estaEnElCalendario, ESTADOS, ESTADOS_EN_TRAMITE, type EstadoSolicitud } from '../types.js';
import {
  TIPOS_DE_AUSENCIA,
  type AusenciaParaKpi,
  type DecisionParaKpi,
  type IncapacidadParaKpi,
  type PendienteParaKpi,
  type SolicitudParaFriccion,
  type TipoDeAusencia,
} from '../kpis.js';

// ARQ-612 — las consultas del panel de KPIs, sacadas de repo.ts tal cual. Solo
// leen y no dependen de ningún otro grupo del repositorio; la aritmética de
// cada KPI está en ../kpis.ts. repo.ts las reexporta: el resto del código las
// sigue llamando como `repo.*` (lo vigila barril.test.ts).

/**
 * Las solicitudes YA DECIDIDAS desde `desdeIso`, para medir cuánto se tarda en
 * firmar. La aritmética la hace `kpis.tiemposPorAprobador`.
 *
 * Tres recortes, y los tres importan:
 *
 * · `decidida_at IS NOT NULL` — lo que no se ha firmado no mide un tiempo de
 *   firma. Las pendientes las cuenta `pendientesParaKpi`.
 *
 * · `estado <> 'registrada'` — son las filas que trajo la hoja de Google al
 *   importar el histórico. Nadie las decidió en esta app, así que atribuirle su
 *   duración a un aprobador sería inventarle un tiempo por una solicitud que
 *   jamás vio.
 *
 * · `aprobador_correo IS NOT NULL` — sin aprobador no hay a quién atribuirlo, y
 *   agruparlas bajo una clave vacía crearía una fila fantasma en la tabla.
 *
 * `created_at` y `decidida_at` salen como `::text` (ISO) y no como Date: el
 * motor de KPIs solo resta instantes, y un Date por medio arrastra la zona
 * horaria del proceso a un número que no la necesita.
 */
export async function decisionesParaKpi(db: Pool, desdeIso: string): Promise<DecisionParaKpi[]> {
  const { rows } = await db.query(
    `SELECT aprobador_correo,
            created_at::text  AS created_at,
            decidida_at::text AS decidida_at
       FROM portal.solicitudes_ausencia
      WHERE decidida_at IS NOT NULL
        AND estado <> 'registrada'
        AND aprobador_correo IS NOT NULL
        AND created_at >= $1::timestamptz
      ORDER BY created_at`,
    [desdeIso],
  );
  return (rows as { aprobador_correo: string; created_at: string; decidida_at: string }[]).map((r) => ({
    aprobadorCorreo: r.aprobador_correo,
    createdAt: r.created_at,
    decididaAt: r.decidida_at,
  }));
}

/**
 * Las solicitudes que esperan firma AHORA MISMO, sin ventana temporal: una que
 * lleve dos años parada es exactamente la que hay que ver.
 *
 * ⚠️ El recorte va por ESTADO y no por `decidida_at IS NULL`, y esa es la
 * trampa que esta consulta evita: una `registrada` del histórico importado
 * tampoco tiene `decidida_at`, así que el filtro «natural» se tragaría el
 * histórico entero y el panel diría que hay cientos de solicitudes esperando
 * firma. Lo vigila `repo.kpis.db.test.ts`.
 */
export async function pendientesParaKpi(db: Pool): Promise<PendienteParaKpi[]> {
  const { rows } = await db.query(
    `SELECT created_at::text AS created_at
       FROM portal.solicitudes_ausencia
      WHERE estado = ANY($1::varchar[])
      ORDER BY created_at`,
    [[...ESTADOS_EN_TRAMITE]],
  );
  return (rows as { created_at: string }[]).map((r) => ({ createdAt: r.created_at }));
}

/**
 * Las incapacidades que ROZAN la ventana `[desde, hasta]`, para el KPI de
 * absentismo. La aritmética la hace `kpis.absentismoPorMes`.
 *
 * Tres recortes:
 *
 * · `tipo = 'incapacidad'` — este KPI mide salud laboral, no ausencia a secas.
 *   Colar las vacaciones lo convertiría en «días que la gente no vino», que es
 *   otra cosa y además sube en agosto por motivos alegres.
 *
 * · `estado <> 'rechazada'` — anular una solicitud la deja en `rechazada` con
 *   `anulada_at` y NO la borra (ver `aplicarALaSolicitud`), así que sigue en la
 *   tabla con su rango intacto. Sin este recorte, unos días que nadie llegó a
 *   perder entrarían en la serie. Se escribe por exclusión y no listando los
 *   estados válidos a propósito: una incapacidad vive en `registrada`, pero el
 *   histórico importado y las correcciones de administración pueden dejar
 *   otros, y lo que de verdad hay que dejar fuera es lo anulado.
 *
 * · El solape con la ventana, que NO es `fecha_inicio BETWEEN ...`: una
 *   incapacidad que empieza en agosto y acaba en septiembre pierde sus días de
 *   septiembre si se descarta por dónde empieza. Por eso viaja con sus fechas
 *   ORIGINALES, sin recortar: recortar es trabajo del motor, que es quien sabe
 *   repartir por mes.
 */
export async function incapacidadesParaKpi(
  db: Pool,
  desde: string,
  hasta: string,
): Promise<IncapacidadParaKpi[]> {
  const { rows } = await db.query(
    `SELECT s.empleado_id,
            e.nombre_completo,
            s.fecha_inicio::text AS fecha_inicio,
            s.fecha_fin::text    AS fecha_fin
       FROM portal.solicitudes_ausencia s
       JOIN portal.empleados e ON e.id = s.empleado_id
      WHERE s.tipo = 'incapacidad'
        AND s.estado <> 'rechazada'
        AND s.fecha_fin   >= $1::date
        AND s.fecha_inicio <= $2::date
      ORDER BY s.fecha_inicio`,
    [desde, hasta],
  );
  return (
    rows as { empleado_id: string; nombre_completo: string; fecha_inicio: string; fecha_fin: string }[]
  ).map((r) => ({
    empleadoId: r.empleado_id,
    nombreCompleto: r.nombre_completo,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
  }));
}

/**
 * Las ausencias que ROZAN la ventana, para el KPI de estacionalidad. La
 * aritmética la hace `kpis.estacionalidadPorMes`.
 *
 * · `tipo = ANY(TIPOS_DE_AUSENCIA)` — los CUATRO que son una ausencia. El
 *   quinto, `otorgamiento`, queda fuera y ése es el error trampa de este KPI:
 *   dice «trabajé el sábado, concédeme un día», así que sus `dias_habiles` son
 *   días CONCEDIDOS y su `fecha_inicio` es la del trabajo extra. Sumarlo aquí
 *   metería días TRABAJADOS en una serie de días AUSENTE, y subiría en los
 *   meses de más faena. Se pasa la lista de `kpis.ts` en vez de escribir el
 *   `<> 'otorgamiento'` para que exista UNA definición de «esto es una
 *   ausencia» y no dos que puedan separarse.
 *
 * · `estado = ANY(...)` con los de `estaEnElCalendario` — lo que OCUPA AGENDA.
 *   Deja fuera las pendientes (que pueden acabar rechazadas: contarlas
 *   inflaría el mes con días que quizá nadie tome) y las anuladas, que siguen
 *   en la tabla como `rechazada` con su rango intacto.
 *
 * · El mismo solape con la ventana que `incapacidadesParaKpi`, y por lo mismo:
 *   las filas viajan con sus fechas originales porque recortar es trabajo del
 *   motor, que es quien sabe repartir por mes.
 */
export async function ausenciasParaKpi(db: Pool, desde: string, hasta: string): Promise<AusenciaParaKpi[]> {
  const { rows } = await db.query(
    `SELECT s.tipo,
            s.empleado_id,
            e.nombre_completo,
            s.fecha_inicio::text AS fecha_inicio,
            s.fecha_fin::text    AS fecha_fin
       FROM portal.solicitudes_ausencia s
       JOIN portal.empleados e ON e.id = s.empleado_id
      WHERE s.tipo   = ANY($3::varchar[])
        AND s.estado = ANY($4::varchar[])
        AND s.fecha_fin   >= $1::date
        AND s.fecha_inicio <= $2::date
      ORDER BY s.fecha_inicio`,
    [desde, hasta, [...TIPOS_DE_AUSENCIA], ESTADOS.filter(estaEnElCalendario)],
  );
  return (
    rows as {
      tipo: TipoDeAusencia;
      empleado_id: string;
      nombre_completo: string;
      fecha_inicio: string;
      fecha_fin: string;
    }[]
  ).map((r) => ({
    tipo: r.tipo,
    empleadoId: r.empleado_id,
    nombreCompleto: r.nombre_completo,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
  }));
}

/**
 * Las solicitudes creadas desde `desdeIso`, con sus tres señales de fricción.
 * El reparto en porcentajes lo hace `kpis.friccion`.
 *
 * ⚠️ `anulada_at IS NOT NULL` es lo ÚNICO que separa una anulación de un
 * rechazo: las dos dejan la solicitud en `rechazada` (ver
 * `aplicarALaSolicitud`). Sin ese campo aquí, el motor no podría distinguir «el
 * jefe dijo que no» de «el solicitante cambió de idea» por mucho que quisiera,
 * y el KPI sumaría dos cosas opuestas.
 *
 * ⚠️ El cambio de fechas se resuelve con un `EXISTS` y no con un JOIN, y eso
 * NO es estilo: un JOIN contra `solicitud_modificaciones` duplicaría la fila de
 * una solicitud con dos cambios aprobados, y el denominador del porcentaje se
 * inflaría solo. El `EXISTS` contesta sí o no una vez por solicitud.
 *
 * Solo cuentan las modificaciones de clase `fechas` y estado `aprobada`:
 * pedirlo no es cambiarlo, y una de clase `anulacion` ya se cuenta por
 * `anulada_at` —sumarla aquí sería contar el mismo hecho dos veces bajo dos
 * etiquetas—.
 *
 * NO recorta las pendientes: el repo trae lo que hay y el motor decide qué
 * entra en el denominador. Repartir esa regla entre los dos sitios es como se
 * desincronizan.
 */
export async function solicitudesParaFriccion(
  db: Pool,
  desdeIso: string,
): Promise<SolicitudParaFriccion[]> {
  const { rows } = await db.query(
    `SELECT s.estado,
            (s.anulada_at IS NOT NULL) AS anulada,
            EXISTS (
              SELECT 1 FROM portal.solicitud_modificaciones m
               WHERE m.solicitud_id = s.id
                 AND m.clase  = 'fechas'
                 AND m.estado = 'aprobada'
            ) AS cambio_de_fechas
       FROM portal.solicitudes_ausencia s
      WHERE s.created_at >= $1::timestamptz
      ORDER BY s.created_at`,
    [desdeIso],
  );
  return (rows as { estado: EstadoSolicitud; anulada: boolean; cambio_de_fechas: boolean }[]).map((r) => ({
    estado: r.estado,
    anulada: r.anulada,
    cambioDeFechas: r.cambio_de_fechas,
  }));
}

/** Las dos señales de planificación de un empleado. */
export interface PlanificacionDeEmpleado {
  empleadoId: string;
  /** Fin de sus últimas vacaciones YA disfrutadas, o `null` si no hay. */
  ultimasVacaciones: string | null;
  /** Días hábiles de vacaciones pedidos hacia adelante. */
  diasProgramados: number;
}

/**
 * Cuándo descansó por última vez cada empleado activo y cuánto tiene ya pedido.
 *
 * Las dos señales miran la MISMA tabla con recortes opuestos —pasado contra
 * futuro— y por eso van en una sola consulta: separarlas daría dos recorridos
 * de lo mismo y dos sitios donde equivocarse con el `hoy`.
 *
 * ⚠️ Parte de `portal.empleados` con LEFT JOIN y no de las solicitudes: la
 * lista de acumulación recorre la plantilla entera, y si esto devolviera solo a
 * quien tiene solicitudes, el resto se quedaría sin señales y la pantalla no
 * podría distinguir «no tiene plan» de «no tengo el dato».
 *
 * Los tres recortes de `ultimas_vacaciones`:
 * · `tipo = 'vacaciones'` — estar de incapacidad no es haber descansado, y es
 *   la confusión más cara de esta pantalla: dejaría de señalar a quien lleva
 *   dos años sin vacaciones justo porque estuvo enfermo.
 * · `fecha_fin <= hoy` — unas vacaciones futuras no son las últimas
 *   disfrutadas. Contarlas pintaría de «acaba de descansar» a quien tiene el
 *   viaje reservado pero aún no se ha ido, que es justo a quien hay que
 *   distinguir del que ya volvió.
 * · el estado, que aquí exige haberlas disfrutado de verdad (`aprobada` o
 *   `registrada`): una anulada quedó en `rechazada` con su rango intacto.
 *
 * En `dias_programados` el recorte de estado es MÁS ANCHO a propósito e incluye
 * las pendientes de firma: quien ya las pidió ha planificado, aunque su jefe no
 * haya firmado todavía. Para la pregunta que responde la señal —«¿tiene algo
 * previsto?»— una pendiente vale igual que una aprobada.
 */
export async function planificacionDeVacaciones(
  db: Pool,
  hoy: string,
): Promise<PlanificacionDeEmpleado[]> {
  const { rows } = await db.query(
    `SELECT e.id AS empleado_id,
            (SELECT MAX(v.fecha_fin)::text
               FROM portal.solicitudes_ausencia v
              WHERE v.empleado_id = e.id
                AND v.tipo    = 'vacaciones'
                AND v.estado  = ANY($2::varchar[])
                AND v.fecha_fin <= $1::date
            ) AS ultimas_vacaciones,
            COALESCE((SELECT SUM(p.dias_habiles)
               FROM portal.solicitudes_ausencia p
              WHERE p.empleado_id = e.id
                AND p.tipo    = 'vacaciones'
                AND p.estado  = ANY($3::varchar[])
                AND p.fecha_inicio > $1::date
            ), 0)::float8 AS dias_programados
       FROM portal.empleados e
      WHERE e.activo`,
    [hoy, ESTADOS.filter(estaEnElCalendario), [...ESTADOS.filter(estaEnElCalendario), ...ESTADOS_EN_TRAMITE]],
  );
  return (
    rows as { empleado_id: string; ultimas_vacaciones: string | null; dias_programados: number }[]
  ).map((r) => ({
    empleadoId: r.empleado_id,
    ultimasVacaciones: r.ultimas_vacaciones,
    diasProgramados: r.dias_programados,
  }));
}

/**
 * Los años que tienen alguna solicitud, del más reciente al más antiguo. Es lo
 * que el selector del panel de KPIs puede ofrecer.
 *
 * Salen de los DATOS y no de un rango fijo: un desplegable con años vacíos
 * invita a mirar pantallas en blanco, y uno que se queda corto esconde el
 * histórico importado de la hoja.
 *
 * ⚠️ Une los años de `fecha_inicio` Y de `fecha_fin`, no solo el primero: una
 * ausencia del 28 de diciembre al 4 de enero pertenece a los dos años, y
 * mirando solo dónde empieza el año siguiente no aparecería en la lista aunque
 * tuviera días de ausencia dentro.
 *
 * NO recorta por estado: este selector solo decide qué ventana se puede pedir,
 * y filtrar aquí dejaría fuera un año que la gráfica de fricción sí sabe
 * pintar. Cada KPI aplica sus propios recortes después.
 */
export async function aniosConAusencias(db: Pool): Promise<number[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT anio FROM (
       SELECT EXTRACT(YEAR FROM fecha_inicio)::int AS anio FROM portal.solicitudes_ausencia
       UNION ALL
       SELECT EXTRACT(YEAR FROM fecha_fin)::int    AS anio FROM portal.solicitudes_ausencia
     ) t
     ORDER BY anio DESC`,
  );
  return (rows as { anio: number }[]).map((r) => r.anio);
}
