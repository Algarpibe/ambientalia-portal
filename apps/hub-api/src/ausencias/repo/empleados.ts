import type { Pool } from '@algarpibe/zoho-sync';
import type { EnlaceJerarquia } from '../jerarquia.js';
import type { Empleado } from '../types.js';
import { withTransaction, type Consultable } from './comun.js';

// ARQ-612 — las fichas de empleado y el organigrama, sacados de repo.ts tal
// cual: buscar y crear la ficha de un usuario, sincronizar desde portal.users,
// los enlaces de la jerarquía, y fijar jefe, copia y segunda firma. Los dos
// bloques comparten `COLS_EMPLEADO` y `aEmpleado`, por eso van juntos. Las
// llaves de la ficha (visores) y el saldo tienen sus propios ficheros.
// repo.ts lo reexporta: el resto del código lo sigue llamando como `repo.*`
// (lo vigila barril.test.ts).

const COLS_EMPLEADO = `
  id, nombre_completo, correo, cargo, credencial,
  aprobador_correo, copia_correo, user_id, activo, ve_adjuntos, exporta_registro, ve_toda_la_empresa,
  ve_kpis,
  requiere_segunda_firma,
  fecha_retiro::text AS fecha_retiro,
  retirado_por,
  retirado_at::text AS retirado_at`;

interface FilaEmpleadoDb {
  id: string;
  nombre_completo: string;
  correo: string;
  cargo: string | null;
  credencial: number | null;
  aprobador_correo: string;
  copia_correo: string | null;
  user_id: string | null;
  activo: boolean;
  ve_adjuntos: boolean;
  exporta_registro: boolean;
  ve_toda_la_empresa: boolean;
  ve_kpis: boolean;
  requiere_segunda_firma: boolean;
  fecha_retiro: string | null;
  retirado_por: string | null;
  retirado_at: string | null;
}

function aEmpleado(r: FilaEmpleadoDb): Empleado {
  return {
    id: r.id,
    nombreCompleto: r.nombre_completo,
    correo: r.correo,
    cargo: r.cargo,
    credencial: r.credencial,
    aprobadorCorreo: r.aprobador_correo,
    copiaCorreo: r.copia_correo,
    veAdjuntos: r.ve_adjuntos,
    exportaRegistro: r.exporta_registro,
    veTodaLaEmpresa: r.ve_toda_la_empresa,
    veKpis: r.ve_kpis,
    requiereSegundaFirma: r.requiere_segunda_firma,
    userId: r.user_id,
    activo: r.activo,
    fechaRetiro: r.fecha_retiro,
    retiradoPor: r.retirado_por,
    retiradoAt: r.retirado_at,
  };
}

/**
 * El empleado de un usuario del portal. Busca primero por `user_id` (el vínculo
 * explícito) y, si no lo hay, por correo: los empleados se importan desde la
 * hoja de Google antes de que existan sus cuentas, así que el `user_id` puede
 * estar todavía sin rellenar.
 */
export async function empleadoDeUsuario(db: Pool, userId: string | null, email: string): Promise<Empleado | null> {
  const { rows } = await db.query(
    `SELECT ${COLS_EMPLEADO} FROM portal.empleados
      WHERE activo AND (($1::uuid IS NOT NULL AND user_id = $1::uuid) OR lower(correo) = lower($2))
      ORDER BY (user_id IS NOT NULL) DESC
      LIMIT 1`,
    [userId, email],
  );
  return rows.length ? aEmpleado(rows[0] as FilaEmpleadoDb) : null;
}

/**
 * Devuelve la ficha del usuario, **creándola si no existe** a partir de su
 * cuenta del portal.
 *
 * La ficha casi no aporta datos propios: nombre y correo ya están en
 * `portal.users`, `aprobador_correo` tiene DEFAULT y `cargo` es decorativo. El
 * permiso real lo da tener la app asignada, así que exigir además un alta
 * manual solo servía para dejar a la gente mirando una pantalla sin formulario.
 *
 * Hace dos cosas, en este orden:
 *  1. Si ya hay ficha con ese correo pero sin `user_id`, la vincula (es el caso
 *     de las importadas desde la hoja antes de que existiera la cuenta).
 *  2. Si no hay ninguna, la crea desde `portal.users`.
 *
 * Devuelve null si el usuario no está en `portal.users` (token legacy de
 * AUTH_USERS) o si su ficha está desactivada: desactivar a alguien es una
 * decisión del admin y esto no debe deshacerla.
 */
export async function asegurarEmpleado(db: Pool, userId: string | null, email: string): Promise<Empleado | null> {
  const existente = await empleadoDeUsuario(db, userId, email);
  if (existente) {
    if (!existente.userId && userId) {
      await db.query('UPDATE portal.empleados SET user_id = $2 WHERE id = $1 AND user_id IS NULL', [
        existente.id,
        userId,
      ]);
      return { ...existente, userId };
    }
    return existente;
  }

  // ON CONFLICT DO NOTHING y no DO UPDATE: si ya existe una ficha desactivada
  // con ese correo, se respeta tal cual y el re-read de abajo devuelve null.
  await db.query(
    `INSERT INTO portal.empleados (nombre_completo, correo, user_id)
     SELECT u.full_name, lower(u.email), u.id
       FROM portal.users u
      WHERE u.status = 'active'
        AND (($1::uuid IS NOT NULL AND u.id = $1::uuid) OR lower(u.email) = lower($2))
      LIMIT 1
     ON CONFLICT (correo) DO NOTHING`,
    [userId, email],
  );

  return empleadoDeUsuario(db, userId, email);
}

/**
 * Da de alta de golpe a todos los usuarios activos con la app asignada.
 *
 * Se hace en dos pasos y no en un solo upsert para poder decirle al admin qué
 * pasó: cuántas fichas se crearon y cuántas ya existían y solo se vincularon
 * (las que venían de la hoja de Google).
 */
export async function sincronizarDesdeUsuarios(
  db: Pool,
  appId: string,
): Promise<{ creados: number; vinculados: number }> {
  return withTransaction(db, async (client) => {
    const vinculados = await client.query(
      `UPDATE portal.empleados e
          SET user_id = u.id
         FROM portal.users u
              JOIN portal.user_apps ua ON ua.user_id = u.id AND ua.app_id = $1
        WHERE e.user_id IS NULL
          AND u.status = 'active'
          AND lower(e.correo) = lower(u.email)`,
      [appId],
    );

    const creados = await client.query(
      `INSERT INTO portal.empleados (nombre_completo, correo, user_id)
       SELECT u.full_name, lower(u.email), u.id
         FROM portal.users u
         JOIN portal.user_apps ua ON ua.user_id = u.id AND ua.app_id = $1
        WHERE u.status = 'active'
       ON CONFLICT (correo) DO NOTHING`,
      [appId],
    );

    return { creados: creados.rowCount ?? 0, vinculados: vinculados.rowCount ?? 0 };
  });
}

/**
 * True si alguien tiene a este correo como aprobador. Se pregunta por el
 * maestro y no solo por las solicitudes vivas: quien aprueba sigue siendo
 * aprobador aunque ahora mismo no tenga nada pendiente, y la pestaña de la
 * bandeja debe estar ahí igual (si no, parecería que la función se ha perdido).
 *
 * La segunda rama cubre el caso contrario, que solo aparece con la cascada: el
 * segundo aprobador de una solicitud viva cuyo jefe intermedio se ha desactivado
 * desde entonces. Ya no es jefe de nadie en el maestro, pero tiene una firma
 * pendiente; sin este OR la pestaña desaparecería y la solicitud se quedaría
 * muerta hasta que la sacara un admin.
 */
export async function esAprobadorDeAlguien(db: Pool, email: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 WHERE EXISTS (
       SELECT 1 FROM portal.empleados
        WHERE activo AND lower(aprobador_correo) = lower($1)
     ) OR EXISTS (
       SELECT 1 FROM portal.solicitudes_ausencia
        WHERE estado IN ('pendiente', 'pendiente_2')
          AND (lower(aprobador_correo) = lower($1) OR lower(segundo_aprobador_correo) = lower($1))
     )`,
    [email],
  );
  return rows.length > 0;
}

/**
 * El enlace hacia arriba de un correo, si tiene ficha ACTIVA. `null` si no está
 * en el maestro o si alguien la desactivó — las dos cosas significan lo mismo
 * para la cascada: aquí se acaba el árbol.
 */
export async function enlaceDe(db: Consultable, correo: string): Promise<EnlaceJerarquia | null> {
  const { rows } = await db.query(
    `SELECT lower(correo) AS correo, lower(aprobador_correo) AS aprobador_correo
       FROM portal.empleados
      WHERE activo AND lower(correo) = lower($1)
      LIMIT 1`,
    [correo],
  );
  const fila = rows[0] as { correo: string; aprobador_correo: string } | undefined;
  return fila ? { correo: fila.correo, aprobadorCorreo: fila.aprobador_correo } : null;
}

/**
 * Todos los enlaces activos, para derivar el organigrama entero en el panel y
 * detectar ciclos. Sin paginar: la plantilla son decenas de filas, no miles.
 */
/**
 * El nombre de quien tiene ese correo, para poder nombrar a una persona en vez de
 * a un buzón. `null` si no tiene ficha activa —el aprobador por defecto puede no
 * tenerla— y entonces al llamante le toca caer de vuelta al correo.
 */
export async function nombreDeCorreo(db: Pool, correo: string): Promise<string | null> {
  const { rows } = await db.query(
    'SELECT nombre_completo FROM portal.empleados WHERE activo AND lower(correo) = lower($1) LIMIT 1',
    [correo],
  );
  return rows.length ? (rows[0] as { nombre_completo: string }).nombre_completo : null;
}

export async function enlacesActivos(db: Pool): Promise<EnlaceJerarquia[]> {
  const { rows } = await db.query(
    `SELECT lower(correo) AS correo, lower(aprobador_correo) AS aprobador_correo
       FROM portal.empleados WHERE activo`,
  );
  return (rows as { correo: string; aprobador_correo: string }[]).map((r) => ({
    correo: r.correo,
    aprobadorCorreo: r.aprobador_correo,
  }));
}

export async function listarEmpleados(db: Pool): Promise<Empleado[]> {
  const { rows } = await db.query(`SELECT ${COLS_EMPLEADO} FROM portal.empleados ORDER BY nombre_completo`);
  return (rows as FilaEmpleadoDb[]).map(aEmpleado);
}

/**
 * Los correos con rol de administrador en el portal, en minúsculas.
 *
 * Existe para que la pestaña Organigrama pueda callar las tres casillas de
 * permisos en las filas de un admin: el rol ya se las da todas plegadas
 * (`esAdmin || …` en los tres booleanos del contexto), así que una casilla sin
 * marcar en esa fila afirma lo contrario de lo que pasa.
 *
 * Cruza por CORREO y no por `user_id`, aunque la columna exista: las fichas se
 * importan de la hoja de Google antes de que existan las cuentas, así que
 * `user_id` puede estar sin rellenar y ese cruce dejaría fuera precisamente a
 * los admin cuya ficha nadie ha vinculado todavía. Es el mismo criterio de
 * `esVisorDeAdjuntos` y compañía, que también preguntan por correo.
 *
 * ⚠️ Mira SOLO el rol, sin filtrar por `status`. Es a propósito: quien decide el
 * bypass en hub-api es `requireAdmin`, que lee `role` del JWT y nada más. Añadir
 * aquí un `AND status = 'active'` haría que el panel contestara una pregunta
 * distinta de la que contesta el servidor, y esa clase de discrepancia no falla
 * — solo enseña una casilla de más o de menos, y nadie la relaciona con esto.
 *
 * Devuelve un Set porque quien llama lo consulta una vez por empleado.
 */
export async function correosDeAdmin(db: Pool): Promise<Set<string>> {
  const { rows } = await db.query(`SELECT lower(email) AS email FROM portal.users WHERE role = 'admin'`);
  return new Set((rows as { email: string }[]).map((r) => r.email));
}

export async function empleadoPorId(db: Pool, id: string): Promise<Empleado | null> {
  const { rows } = await db.query(`SELECT ${COLS_EMPLEADO} FROM portal.empleados WHERE id = $1 AND activo`, [id]);
  return rows.length ? aEmpleado(rows[0] as FilaEmpleadoDb) : null;
}

/**
 * Hermana de `empleadoPorId`, SIN el `AND activo`.
 *
 * Hace falta porque `retirarEmpleado` (service.ts) relee la ficha justo
 * DESPUÉS de aplicar la baja: si esa relectura pasara por `empleadoPorId`,
 * una ficha recién desactivada por `fijarRetiro`/`aplicarRetirosVencidos`
 * dejaría de verse a sí misma y la operación devolvería un 404 sobre el
 * propio retiro que acaba de tener éxito. Y `reactivarEmpleado` necesita leer
 * una ficha YA inactiva para poder deshacer su baja.
 */
export async function empleadoPorIdIncluyendoInactivos(db: Pool, id: string): Promise<Empleado | null> {
  const { rows } = await db.query(`SELECT ${COLS_EMPLEADO} FROM portal.empleados WHERE id = $1`, [id]);
  return rows[0] ? aEmpleado(rows[0] as FilaEmpleadoDb) : null;
}

/**
 * Cambia el jefe inmediato. El `AND activo` es el mismo criterio que `fijarSaldo`:
 * la escritura cubre exactamente el conjunto que la lectura enseña.
 *
 * No valida nada: los ciclos y la existencia del jefe los comprueba el servicio,
 * que es quien tiene el árbol entero delante.
 */
export async function fijarJefe(db: Pool, empleadoId: string, aprobadorCorreo: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE portal.empleados SET aprobador_correo = lower($2) WHERE id = $1 AND activo`,
    [empleadoId, aprobadorCorreo],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Fija (o quita, con `null`) la copia de un empleado. Devuelve false si no
 * existía o estaba inactivo, igual que `fijarJefe`.
 */
export async function fijarCopia(db: Pool, empleadoId: string, copiaCorreo: string | null): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE portal.empleados SET copia_correo = lower($2) WHERE id = $1 AND activo`,
    [empleadoId, copiaCorreo],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Enciende o apaga la segunda firma de un empleado. Devuelve false si no existía
 * o estaba inactivo, igual que `fijarJefe` y `fijarCopia`.
 */
export async function fijarSegundaFirma(db: Pool, empleadoId: string, requiere: boolean): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE portal.empleados SET requiere_segunda_firma = $2 WHERE id = $1 AND activo`,
    [empleadoId, requiere],
  );
  return (rowCount ?? 0) > 0;
}
