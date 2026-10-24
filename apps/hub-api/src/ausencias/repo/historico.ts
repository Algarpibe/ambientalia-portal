import type { Pool } from '@algarpibe/zoho-sync';
import type { TipoSolicitud } from '../types.js';

// ARQ-612 — la importación del histórico de la hoja de Google, sacada de
// repo.ts tal cual. Es el único escritor de solicitudes exento de la regla del
// solape (ver el JSDoc de `importarHistorico`), y no depende de ningún otro
// grupo del repositorio. No confundir con ../historico.ts, que valida y resuelve
// las filas de la hoja antes de que lleguen aquí. repo.ts lo reexporta: el resto
// del código lo sigue llamando como `repo.*` (lo vigila barril.test.ts).

/** Una fila lista para insertar: el empleado ya viene resuelto por el servicio. */
export interface FilaHistoricoResuelta {
  empleadoId: string;
  tipo: TipoSolicitud;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  comentarios: string | null;
  observaciones: string | null;
  estado: 'aprobada' | 'registrada';
}

/** Lo que la previsualización enseña antes de escribir nada. */
export interface ResultadoImportacion {
  total: number;
  importadas: number;
  yaExistian: number;
}

const ENTRADA_HISTORICO = `
  jsonb_to_recordset($1::jsonb) AS f(
    empleado_id uuid, tipo text, fecha_inicio date, fecha_fin date,
    dias numeric, comentarios text, observaciones text, estado text)`;

/**
 * Solo las filas que NO están ya en la tabla, mirando por
 * (empleado, tipo, fechas). Es la misma condición que usa el INSERT, extraída
 * para poder responder la previsualización sin escribir nada.
 *
 * Cubre los dos casos de choque: lo que ya se importó antes y lo que **creó el
 * portal** (el índice único parcial solo vigila `origen='hoja'`, así que la
 * solicitud de prueba que la app grabó de verdad se detecta aquí).
 */
const NO_EXISTE_YA = `
  NOT EXISTS (
    SELECT 1 FROM portal.solicitudes_ausencia s
     WHERE s.empleado_id = f.empleado_id
       AND s.tipo        = f.tipo
       AND s.fecha_inicio = f.fecha_inicio
       AND s.fecha_fin    = f.fecha_fin)`;

function aJsonHistorico(filas: FilaHistoricoResuelta[]): string {
  return JSON.stringify(
    filas.map((f) => ({
      empleado_id: f.empleadoId,
      tipo: f.tipo,
      fecha_inicio: f.fechaInicio,
      fecha_fin: f.fechaFin,
      dias: f.dias,
      comentarios: f.comentarios,
      observaciones: f.observaciones,
      estado: f.estado,
    })),
  );
}

/**
 * Mete el histórico de la hoja. Con `dryRun` solo cuenta, sin escribir.
 *
 * `created_at` se pone a la fecha de inicio y no a `now()`: «Mis solicitudes»
 * ordena por fecha de creación, y con `now()` las 52 filas antiguas se
 * amontonarían todas arriba, por encima de las recientes.
 *
 * ⚠️ Es el ÚNICO escritor de solicitudes que no pasa por la regla del
 * solapamiento, y está exento a propósito: la hoja trae precisamente los datos
 * que ya la incumplen —comprobado el 2026-08-18 contra producción, un empleado
 * tiene vacaciones aprobadas del 10 al 14 de agosto de 2026 y un permiso
 * aprobado el 14—, y una importación que los rechazara dejaría el histórico a
 * medias. Es la misma razón por la que no hay constraint en la BD (ver
 * `solapeDe`). Lo que sí impide es duplicar: de eso responde el `ON CONFLICT`.
 */
export async function importarHistorico(
  db: Pool,
  filas: FilaHistoricoResuelta[],
  dryRun: boolean,
): Promise<ResultadoImportacion> {
  if (filas.length === 0) return { total: 0, importadas: 0, yaExistian: 0 };
  const payload = aJsonHistorico(filas);

  if (dryRun) {
    const { rows } = await db.query(
      `SELECT count(*)::int AS nuevas FROM ${ENTRADA_HISTORICO} WHERE ${NO_EXISTE_YA}`,
      [payload],
    );
    const nuevas = (rows[0] as { nuevas: number }).nuevas;
    return { total: filas.length, importadas: nuevas, yaExistian: filas.length - nuevas };
  }

  const { rowCount } = await db.query(
    `INSERT INTO portal.solicitudes_ausencia
       (tipo, empleado_id, solicitante_email, fecha_inicio, fecha_fin, dias_habiles,
        comentarios, estado, aprobador_correo, observaciones, origen, created_at)
     SELECT f.tipo, f.empleado_id, e.correo, f.fecha_inicio, f.fecha_fin, f.dias,
            f.comentarios, f.estado, e.aprobador_correo, f.observaciones, 'hoja',
            f.fecha_inicio::timestamptz
       FROM ${ENTRADA_HISTORICO}
       JOIN portal.empleados e ON e.id = f.empleado_id
      WHERE ${NO_EXISTE_YA}
     ON CONFLICT (empleado_id, tipo, fecha_inicio, fecha_fin) WHERE origen = 'hoja' DO NOTHING`,
    [payload],
  );
  const importadas = rowCount ?? 0;
  return { total: filas.length, importadas, yaExistian: filas.length - importadas };
}
