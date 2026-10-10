/**
 * Lectura del MAESTRO de equipos: la tabla desk.equipos de la base de Desk 2.0
 * (lote 9b). Sólo un SELECT, por la conexión de sólo lectura de db-desk2.ts,
 * la misma de la agenda. La mantiene a mano la app Desk 2.0 (no viene de
 * Zoho); el serial no es único, y hay «active» y también borrado físico.
 *
 * Tabla y columnas, comprobadas contra el código de Desk 2.0 (repositorio
 * aparte, Desk2: = C:\dev\Desk_2_R1.023, HEAD b24a86a; sólo se leyó):
 *
 *   desk.equipos                 Desk2:packages/zoho-sync/src/db/schema.sql:189-201
 *     id                         schema.sql:190 (texto, clave primaria)
 *     serial                     schema.sql:191 (NOT NULL, sin unicidad: sólo el índice de la 202)
 *     marca, modelo              schema.sql:192-193 (el modelo va como «EDM180C», sin espacio)
 *     cliente_nombre             schema.sql:195
 *     active                     schema.sql:197 (lo cambia Desk2:apps/desk/server/db/equipos.ts:153-154)
 *   Va sin calificar en schema.sql y queda en el esquema desk
 *   (Desk2:packages/zoho-sync/src/db/migrate.ts:63-64 y :117).
 *
 * ⚠️ El rol de DESK2_DB_URL (portal_agenda_reader) tiene SELECT sólo sobre
 * unas columnas (id, serial, marca, modelo, tipo, cliente_nombre, client_id,
 * modelo_id, codigo_interno, active, pendiente_validar, source, created_at,
 * updated_at), no sobre «raw» (schema.sql:198) ni el resto: aquí no cabe un
 * asterisco ni la fila entera. maestro.test.ts vigila lo que se nombra.
 *
 * Tolerante a fallos, como la fuente de la agenda, pero SIN compartir estado
 * con ella: no entra en su sonda (estadoFuente) ni mueve su cortacircuitos,
 * así que un fallo aquí no manda la agenda al respaldo. Tampoco tiene uno
 * propio: esto lo pide una persona (al abrir Configuración o al sincronizar)
 * y la espera ya la acotan los topes del pool (3 s y 5 s). De la fuente sólo
 * se reutiliza lo que no tiene estado: los motivos y cómo se clasifica un
 * error. En respaldo NO hay maestro: la réplica tiene esa tabla vacía.
 */

import { clasificarFallo, type DbLectura, type MotivoRespaldo } from './fuente.js';
import type { EquipoMaestro } from './maestro.js';

export const MENSAJE_SIN_MAESTRO: Record<MotivoRespaldo, string> = {
  sin_variable: 'La conexión con Desk 2.0 no está configurada (falta DESK2_DB_URL): sin ella no hay maestro de equipos.',
  error_conexion: 'No se pudo conectar con la base de Desk 2.0.',
  timeout: 'La base de Desk 2.0 tardó demasiado en responder.',
  error_consulta: 'La base de Desk 2.0 rechazó la consulta del maestro de equipos (permisos o esquema).',
};

/** Lo que dio el maestro en UNA lectura: los equipos, o por qué no los hay. Nunca el error crudo. */
export type LecturaMaestro = { disponible: true; equipos: EquipoMaestro[] } | { disponible: false; motivo: MotivoRespaldo };
export type LectorMaestro = () => Promise<LecturaMaestro>;

/** Todos los equipos del maestro, de todas las marcas (el cruce informativo las cuenta); filtrar los GRIMM EDM 180 es de maestro.ts. */
export async function leerEquiposDesk2(db: DbLectura): Promise<EquipoMaestro[]> {
  const { rows } = await db.query(`SELECT e.id, e.serial, e.marca, e.modelo, e.cliente_nombre, e.active FROM desk.equipos e ORDER BY e.id`);
  return rows.map((r) => ({ id: String(r.id), serial: String(r.serial ?? ''), marca: r.marca ?? null, modelo: r.modelo ?? null, cliente: r.cliente_nombre ?? null, activo: r.active === true }));
}

/**
 * El lector del maestro sobre la conexión de Desk 2.0 (null si no está
 * configurada; se pide en cada lectura). No lanza: un intento por llamada y,
 * si falla, el motivo. Al registro sólo van el motivo y el código del error.
 */
export function crearLectorMaestro(desk2: () => DbLectura | null): LectorMaestro {
  return async () => {
    try {
      const db = desk2();
      return db ? { disponible: true, equipos: await leerEquiposDesk2(db) } : { disponible: false, motivo: 'sin_variable' };
    } catch (e) {
      const motivo = clasificarFallo(e);
      const code = (e as { code?: unknown } | null)?.code;
      console.warn(`maestro de equipos: la base de Desk 2.0 no respondió (${motivo}, código ${typeof code === 'string' ? code : 'desconocido'})`);
      return { disponible: false, motivo };
    }
  };
}
