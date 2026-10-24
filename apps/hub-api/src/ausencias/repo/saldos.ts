import type { Pool } from '@algarpibe/zoho-sync';
import type { Solicitud, TipoSolicitud } from '../types.js';
import { ramaDeDosNiveles, type Consultable } from './comun.js';
import { aEmpleadoConSaldo, type EmpleadoConSaldo, type FilaEmpleadoSaldoDb } from './filas.js';

// ARQ-612 — las consultas de los saldos (vacaciones y compensatorios), sacadas
// de repo.ts tal cual. El cálculo está en ../saldo.ts; esto solo lee la
// configuración de corte y las solicitudes que la tocan, y la fija. La
// traducción de la fila de empleado vive en filas.ts porque la comparte la
// vista de retirados (retiro.ts). repo.ts lo reexporta: el resto del código lo
// sigue llamando como `repo.*` (lo vigila barril.test.ts).

export type { EmpleadoConSaldo };

/**
 * Empleados activos con su configuración de saldo.
 *
 * Dos filtros independientes, cada uno null = sin acotar:
 *  - `soloDe` acota a los que aprueba ese correo, en cualquiera de los dos
 *    niveles (privacidad): un aprobador no tiene por qué ver el saldo de gente
 *    que no aprueba. Incluye a los «nietos» —el equipo de sus subordinados—
 *    porque con la cascada tiene que firmar sus vacaciones, y firmarlas sin ver
 *    el saldo es decidir a ciegas justo en el único tipo que lo consume.
 *  - `empleadoId` acota a una sola persona (rendimiento): el endpoint de
 *    contexto, que se llama en cada carga de la app, solo necesita el saldo de
 *    quien ha entrado y no puede pagar un escaneo entero de la tabla por eso.
 *
 * `empleadoId` NO tiene valor por defecto a propósito: los dos filtros son del
 * mismo tipo (`string | null`), así que un valor por defecto dejaría compilar
 * `empleadosConSaldo(db, id)` con `id` colado en `soloDe` — y ese error falla
 * en SILENCIO, porque `aprobador_correo` nunca es un uuid: la consulta no
 * lanza, simplemente devuelve `[]`. Quien no quiera acotar por empleado tiene
 * que escribir el `null` explícito.
 */
export async function empleadosConSaldo(
  db: Consultable,
  soloDe: string | null,
  empleadoId: string | null,
): Promise<EmpleadoConSaldo[]> {
  const { rows } = await db.query(
    // Los casts NO son estilo. Sin `::float8` un NUMERIC llega como string y
    // cualquier aritmética posterior lo concatena; sin `::text` un DATE llega
    // como objeto Date, y ahí `fechaInicio >= fechaCorte` se compara vía
    // ToPrimitive numérico contra NaN: SIEMPRE false, así que no se descontaría
    // nada nunca y en silencio. Es el gotcha por el que `calcularSaldo` lanza.
    `SELECT e.id, e.nombre_completo, e.correo,
            e.saldo_corte::float8 AS saldo_corte,
            e.fecha_corte::text   AS fecha_corte,
            e.compensatorios_saldo_corte::float8 AS compensatorios_saldo_corte,
            e.compensatorios_fecha_corte::text   AS compensatorios_fecha_corte,
            e.fecha_retiro::text   AS fecha_retiro,
            e.retirado_por
       FROM portal.empleados e
      WHERE e.activo
        AND ${ramaDeDosNiveles()}
        AND ($2::uuid IS NULL OR e.id = $2::uuid)
      ORDER BY e.nombre_completo`,
    [soloDe, empleadoId],
  );
  return (rows as FilaEmpleadoSaldoDb[]).map(aEmpleadoConSaldo);
}

/** Una solicitud reducida a lo que el cálculo de los saldos necesita. */
export interface AusenciaDeEmpleado {
  empleadoId: string;
  tipo: TipoSolicitud;
  fechaInicio: string;
  diasHabiles: number;
  estado: Solicitud['estado'];
  /** Solo lo miran los otorgamientos. El porqué, en `AusenciaParaElSaldo`. */
  createdAt: string;
}

interface FilaAusenciaDb {
  empleado_id: string;
  tipo: TipoSolicitud;
  fecha_inicio: string;
  dias_habiles: number;
  estado: Solicitud['estado'];
  created_at: string;
}

function aAusenciaDeEmpleado(r: FilaAusenciaDb): AusenciaDeEmpleado {
  return {
    empleadoId: r.empleado_id,
    tipo: r.tipo,
    fechaInicio: r.fecha_inicio,
    diasHabiles: r.dias_habiles,
    estado: r.estado,
    createdAt: r.created_at,
  };
}

/**
 * Las solicitudes de esos empleados que pueden tocar alguna de las dos bolsas.
 *
 * Los dos tipos en una sola consulta: son dos contabilidades independientes, pero
 * viven en la misma tabla y quien pregunta por una casi siempre quiere la otra.
 *
 * Se filtra por tipo aquí además de en el módulo del saldo porque traer permisos e
 * incapacidades para descartarlos después es tráfico gratis; el filtro del módulo
 * puro se queda igualmente como red de seguridad — y ahora es doble red, porque
 * cada bolsa tiene que descartar además los tipos de la otra.
 */
export async function ausenciasQueTocanElSaldo(db: Consultable, ids: string[]): Promise<AusenciaDeEmpleado[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query(
    // `created_at` es TIMESTAMPTZ y se recorta a fecha AQUÍ, no en el módulo
    // puro: allí se compara con `>=` contra `fecha_corte`, que es un
    // YYYY-MM-DD, y un timestamp entero rompería el orden lexicográfico. El
    // `::text` va por lo mismo que en las otras dos fechas — sin él llega un
    // objeto Date y la comparación se resuelve contra NaN, siempre false.
    `SELECT empleado_id, tipo, fecha_inicio::text AS fecha_inicio,
            dias_habiles::float8 AS dias_habiles, estado,
            created_at::date::text AS created_at
       FROM portal.solicitudes_ausencia
      WHERE tipo IN ('vacaciones', 'compensatorio', 'otorgamiento')
        AND empleado_id = ANY($1::uuid[])`,
    [ids],
  );
  return (rows as FilaAusenciaDb[]).map(aAusenciaDeEmpleado);
}

/** Un punto de corte a escribir: los dos campos, o los dos a null para vaciarlo. */
export interface CorteAFijar {
  saldoCorte: number | null;
  fechaCorte: string | null;
}

/**
 * Fija (o vacía) los puntos de corte de un empleado. Devuelve false si no existía
 * (o estaba inactivo: ver más abajo).
 *
 * `compensatorios` en `null` significa «el cliente no mandó esa pareja: NO la
 * toques», que es distinto de mandarla con los dos campos a null («vacíala»).
 * Esa distinción es lo único que impide que un panel viejo —que solo conoce la
 * pareja de vacaciones— borre la bolsa de compensatorios de alguien la primera
 * vez que un admin le corrija el saldo durante la ventana de despliegue.
 *
 * No encola nada en el outbox, igual que la edición del registro general: ajustar
 * un saldo es corregir el registro, no tomar una decisión que haya que comunicar.
 *
 * El `AND activo` es obligatorio y no cosmético: la escritura tiene que cubrir
 * el mismo conjunto que la lectura (`empleadosConSaldo` también lleva
 * `WHERE activo`). Sin él, se podría fijar el saldo de alguien desactivado y
 * el servicio creería que fue bien (`true`) cuando en realidad ninguna lectura
 * posterior lo va a mostrar nunca — el servicio no lanzaría su 404 y el
 * siguiente `empleadosConSaldo` devolvería una lista vacía para ese id.
 */
export async function fijarSaldo(
  db: Pool,
  empleadoId: string,
  vacaciones: CorteAFijar,
  compensatorios: CorteAFijar | null,
): Promise<boolean> {
  const { rowCount } = await db.query(
    // Un solo UPDATE y no dos sentencias: sin una transacción que las una, un
    // fallo entre medias dejaría media fila escrita.
    //
    // `CASE` y no `COALESCE` porque aquí NULL es un valor CON significado
    // («vaciar la bolsa»), así que la nulidad del parámetro no puede servir a la
    // vez para decir «no tocar». Lo dice la bandera aparte. El `::boolean` va
    // explícito porque pg manda el booleano como texto y dentro de un `CASE`
    // Postgres no tiene de dónde inferir el tipo.
    `UPDATE portal.empleados
        SET saldo_corte = $2,
            fecha_corte = $3::date,
            compensatorios_saldo_corte = CASE WHEN $4::boolean THEN $5::numeric ELSE compensatorios_saldo_corte END,
            compensatorios_fecha_corte = CASE WHEN $4::boolean THEN $6::date    ELSE compensatorios_fecha_corte END
      WHERE id = $1 AND activo`,
    [
      empleadoId,
      vacaciones.saldoCorte,
      vacaciones.fechaCorte,
      compensatorios !== null,
      compensatorios?.saldoCorte ?? null,
      compensatorios?.fechaCorte ?? null,
    ],
  );
  return (rowCount ?? 0) > 0;
}
