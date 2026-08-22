import type { Pool } from '@algarpibe/zoho-sync';
import type { AusenciaRango } from './calendario.js';
import type { EnlaceJerarquia } from './jerarquia.js';
import { cambiaLaHoja, esOtorgamiento, estaEnElCalendario } from './types.js';
import type {
  Adjunto,
  ClaseModificacion,
  DecididaPor,
  Empleado,
  EstadoModificacion,
  EventoBorrado,
  EventoCorreccion,
  EventoModificacion,
  EventoOutbox,
  EventoPendiente,
  EventoSolicitud,
  Modificacion,
  Movimiento,
  PayloadEvento,
  Solicitud,
  TipoSolicitud,
  Transicion,
} from './types.js';

// Acceso a datos de la app de ausencias. SQL crudo con parámetros posicionales,
// como el resto del repo (no hay ORM). Todas las tablas van cualificadas con
// `portal.` — la BD zoho-hub tiene un `public` ajeno.

// El tipo del cliente transaccional se deriva del Pool para no depender de un
// import directo de 'pg' (mismo truco que users.repository.ts).
type PoolClient = Awaited<ReturnType<Pool['connect']>>;

/** Ejecuta `fn` dentro de BEGIN/COMMIT; hace ROLLBACK ante cualquier error. */
async function withTransaction<T>(db: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Empleados ──────────────────────────────────────────────────────────────

const COLS_EMPLEADO = `
  id, nombre_completo, correo, cargo, credencial,
  aprobador_correo, copia_correo, user_id, activo, ve_adjuntos, exporta_registro, ve_toda_la_empresa,
  requiere_segunda_firma`;

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
  requiere_segunda_firma: boolean;
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
    requiereSegundaFirma: r.requiere_segunda_firma,
    userId: r.user_id,
    activo: r.activo,
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
export async function enlaceDe(db: Pool, correo: string): Promise<EnlaceJerarquia | null> {
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

// ── Saldos: vacaciones y compensatorios ────────────────────────────────────

/** Un empleado con sus dos configuraciones de saldo, tal como salen de la BD. */
export interface EmpleadoConSaldo {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  /** Null mientras nadie lo haya configurado. Va siempre en pareja con la fecha. */
  saldoCorte: number | null;
  fechaCorte: string | null;
  /** La bolsa de compensatorios, independiente de la de vacaciones. */
  compensatoriosSaldoCorte: number | null;
  compensatoriosFechaCorte: string | null;
}

interface FilaEmpleadoSaldoDb {
  id: string;
  nombre_completo: string;
  correo: string;
  saldo_corte: number | null;
  fecha_corte: string | null;
  compensatorios_saldo_corte: number | null;
  compensatorios_fecha_corte: string | null;
}

function aEmpleadoConSaldo(r: FilaEmpleadoSaldoDb): EmpleadoConSaldo {
  return {
    empleadoId: r.id,
    nombreCompleto: r.nombre_completo,
    correo: r.correo,
    saldoCorte: r.saldo_corte,
    fechaCorte: r.fecha_corte,
    compensatoriosSaldoCorte: r.compensatorios_saldo_corte,
    compensatoriosFechaCorte: r.compensatorios_fecha_corte,
  };
}

/**
 * El recorte por rama: quien pregunta ve a sus subordinados directos y a los de
 * ellos —los «nietos»—, y a nadie más. Con el parámetro a NULL no acota nada,
 * que es lo que necesita un administrador.
 *
 * Existe una sola vez a propósito: lo usan la consulta de saldos y la de
 * movimientos, y tienen que decir EXACTAMENTE lo mismo. Una copia divergente no
 * lanza ni se pone roja — simplemente enseña filas de más, que aquí significa
 * enseñar ausencias de gente que no es de quien mira.
 *
 * Dos niveles y no un CTE recursivo porque es el alcance de lo que ese jefe
 * FIRMA: con la cascada le tocan también las de sus nietos. Un subárbol
 * completo le enseñaría gente cuyas solicitudes no decide nunca.
 *
 * `$1` fijo, sin placeholder configurable: la correspondencia entre un número
 * que se pasa como argumento y la posición real en el array de bindings de
 * `db.query` es una invariante que no comprueba nadie. Si una consulta futura
 * pusiera `soloDe` en otra posición y alguien copiara `ramaDeDosNiveles(1)`
 * por costumbre, el filtro de privacidad quedaría atado al parámetro
 * equivocado EN SILENCIO — ni TypeScript ni Postgres lo cazan. Por eso la
 * regla es al revés: `soloDe` va SIEMPRE como primer parámetro (`$1`) de la
 * consulta que incrusta este fragmento. Lo que hay que sincronizar pasa de
 * dos sitios (el número aquí y la posición allá) a uno solo.
 *
 * Asume que la tabla `portal.empleados` está aliasada como `e` en la consulta
 * que lo incrusta. Lo cumplen las dos que lo usan.
 */
export function ramaDeDosNiveles(): string {
  return `($1::text IS NULL
           OR lower(e.aprobador_correo) = lower($1)
           OR EXISTS (SELECT 1 FROM portal.empleados j
                       WHERE j.activo
                         AND lower(j.correo) = lower(e.aprobador_correo)
                         AND lower(j.aprobador_correo) = lower($1)))`;
}

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
  db: Pool,
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
            e.compensatorios_fecha_corte::text   AS compensatorios_fecha_corte
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
export async function ausenciasQueTocanElSaldo(db: Pool, ids: string[]): Promise<AusenciaDeEmpleado[]> {
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

// ── Organigrama ────────────────────────────────────────────────────────────

export async function empleadoPorId(db: Pool, id: string): Promise<Empleado | null> {
  const { rows } = await db.query(`SELECT ${COLS_EMPLEADO} FROM portal.empleados WHERE id = $1 AND activo`, [id]);
  return rows.length ? aEmpleado(rows[0] as FilaEmpleadoDb) : null;
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

/**
 * Si ese correo tiene la llave maestra de los adjuntos.
 *
 * Consulta por correo y no por id porque quien pregunta es una sesión, y una
 * sesión puede no tener ficha de empleado — en ese caso no es visor, que es la
 * respuesta correcta.
 */
export async function esVisorDeAdjuntos(db: Pool, email: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM portal.empleados WHERE lower(correo) = lower($1) AND activo AND ve_adjuntos`,
    [email],
  );
  return rows.length > 0;
}

/** Datos de un cambio de llave: quién la da, a quién y en qué sentido. */
export interface CambioVisor {
  empleadoId: string;
  veAdjuntos: boolean;
  adminEmail: string;
  empleadoCorreo: string;
}

/**
 * Da o quita la llave Y deja constancia, en la MISMA transacción.
 *
 * No son dos funciones sueltas a propósito. Si el UPDATE cuajara y el INSERT
 * fallara, el reintento se encontraría el valor ya cambiado, el guard de «solo
 * si cambia» saltaría la escritura, y la llave quedaría concedida sin una sola
 * línea de registro — justo lo que esta tabla existe para impedir, y con el
 * reintento consolidando el hueco en vez de repararlo.
 *
 * Devuelve false si la ficha no existía o estaba inactiva, y entonces no se
 * escribe registro: un intento fallido no puede ensuciar la auditoría.
 */
export async function fijarVisorConRegistro(db: Pool, cambio: CambioVisor): Promise<boolean> {
  return withTransaction(db, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE portal.empleados SET ve_adjuntos = $2 WHERE id = $1 AND activo`,
      [cambio.empleadoId, cambio.veAdjuntos],
    );
    if ((rowCount ?? 0) === 0) return false;

    await client.query(
      `INSERT INTO portal.visores_adjuntos_log (admin_email, empleado_id, empleado_correo, concedido)
       VALUES (lower($1), $2, lower($3), $4)`,
      [cambio.adminEmail, cambio.empleadoId, cambio.empleadoCorreo, cambio.veAdjuntos],
    );
    return true;
  });
}

/**
 * Si ese correo tiene marcado el permiso de exportar el registro.
 *
 * Consulta por correo y no por id, por el mismo motivo que `esVisorDeAdjuntos`:
 * quien pregunta es una sesión, y una sesión puede no tener ficha de empleado —
 * en ese caso no puede exportar, que es la respuesta correcta.
 */
export async function puedeExportarRegistro(db: Pool, email: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM portal.empleados WHERE lower(correo) = lower($1) AND activo AND exporta_registro`,
    [email],
  );
  return rows.length > 0;
}

/**
 * Da o quita el permiso de exportar, y lo DEJA REGISTRADO, en la MISMA
 * transacción — mismo motivo que `fijarVisorConRegistro` (ver arriba): si el
 * UPDATE cuajara y el INSERT fallara, el permiso quedaría concedido sin una
 * sola línea de auditoría, y un reintento posterior no tendría forma de
 * notar el hueco (el estado ya coincidiría con lo pedido) para repararlo.
 *
 * El log guarda el correo además del id y sin clave foránea, por lo mismo que
 * `visores_adjuntos_log`: si la ficha se borra, el registro tiene que seguir
 * diciendo a quién se le dio. Un registro que desaparece con su sujeto no es
 * un registro de auditoría.
 *
 * El correo que se registra es el que devuelve el propio UPDATE (`RETURNING
 * correo`) y no uno que traiga quien llama: así la función no depende de que
 * el llamador haya cargado la ficha de antemano, y el log siempre refleja el
 * correo que la fila tenía en el instante del cambio.
 *
 * Devuelve false si la ficha no existía o estaba inactiva, y entonces no se
 * escribe registro: un intento fallido no puede ensuciar la auditoría.
 */
export async function fijarExportador(
  db: Pool,
  adminEmail: string,
  empleadoId: string,
  concedido: boolean,
): Promise<boolean> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE portal.empleados SET exporta_registro = $2 WHERE id = $1 AND activo RETURNING correo`,
      [empleadoId, concedido],
    );
    if (!rows.length) return false;

    await client.query(
      `INSERT INTO portal.exportadores_registro_log
         (admin_email, empleado_id, empleado_correo, concedido)
       VALUES (lower($1), $2, lower($3), $4)`,
      [adminEmail, empleadoId, (rows[0] as { correo: string }).correo, concedido],
    );
    return true;
  });
}

/**
 * Si ese correo ve el calendario y el registro de TODA la compañía sin ser
 * administrador.
 *
 * Consulta por correo y no por id, por lo mismo que `esVisorDeAdjuntos` y
 * `puedeExportarRegistro`: quien pregunta es una sesión, y una sesión puede no
 * tener ficha de empleado — en ese caso no es visor, que es la respuesta
 * correcta.
 *
 * ⚠️ El `AND activo` no es decorativo: sin él, a un ex-empleado cuya ficha
 * siguiera en la tabla se le quedaría abierto el registro de la plantilla
 * entera. Es la misma trampa que el JSDoc de `esVisorDeAdjuntos` señala para su
 * consulta gemela, y aquí sí la vigila un test contra Postgres
 * (`repo.visor-empresa.db.test.ts`).
 */
export async function esVisorDeTodaLaEmpresa(db: Pool, email: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM portal.empleados WHERE lower(correo) = lower($1) AND activo AND ve_toda_la_empresa`,
    [email],
  );
  return rows.length > 0;
}

/**
 * Da o quita la vista de toda la empresa, y lo DEJA REGISTRADO, en la MISMA
 * transacción — mismo motivo que `fijarVisorConRegistro` y `fijarExportador`
 * (ver arriba): si el UPDATE cuajara y el INSERT fallara, el permiso quedaría
 * concedido sin una sola línea de auditoría, y un reintento posterior no
 * tendría forma de notar el hueco (el estado ya coincidiría con lo pedido) para
 * repararlo.
 *
 * El correo que se registra sale del propio UPDATE (`RETURNING correo`) y no de
 * quien llama, igual que en `fijarExportador`: así el log refleja el correo que
 * la fila tenía en el instante del cambio, sin depender de que el llamador
 * hubiera cargado la ficha de antemano.
 *
 * Devuelve false si la ficha no existía o estaba inactiva, y entonces no se
 * escribe registro: un intento fallido no puede ensuciar la auditoría.
 */
export async function fijarVisorDeEmpresa(
  db: Pool,
  adminEmail: string,
  empleadoId: string,
  concedido: boolean,
): Promise<boolean> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE portal.empleados SET ve_toda_la_empresa = $2 WHERE id = $1 AND activo RETURNING correo`,
      [empleadoId, concedido],
    );
    if (!rows.length) return false;

    await client.query(
      `INSERT INTO portal.visores_empresa_log
         (admin_email, empleado_id, empleado_correo, concedido)
       VALUES (lower($1), $2, lower($3), $4)`,
      [adminEmail, empleadoId, (rows[0] as { correo: string }).correo, concedido],
    );
    return true;
  });
}

// ── Histórico importado de la hoja ─────────────────────────────────────────

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

/** Los campos que un admin puede corregir desde el registro general. */
export interface EdicionSolicitud {
  empleadoId: string;
  tipo: TipoSolicitud;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  estado: Solicitud['estado'];
  comentarios: string | null;
  observaciones: string | null;
}

/**
 * Corrige una solicitud. Devuelve la versión actualizada, o null si no existía.
 *
 * `solicitante_email` se rescribe desde el empleado nuevo: está desnormalizado
 * en la fila, y si se reasigna a otra persona sin actualizarlo, el registro
 * diría un nombre y el correo de otro.
 *
 * NO avisa a la cadena de firmas ni al trabajador, y eso sigue siendo a
 * propósito: esto es corregir el registro, no tomar una decisión. Aprobar o
 * rechazar se hace en la bandeja, que es donde sí se avisa a la gente. Un admin
 * arreglando una fecha mal importada no manda a nadie a revisar su solicitud.
 *
 * Lo que sí encola —desde el 2026-08-19— es un `correccion_admin`, y por lo que
 * la decisión original pasaba por alto: el evento del calendario es un artefacto
 * DERIVADO de esta fila, así que o se corrige o se queda mintiendo para siempre
 * sin que nadie se entere. Mover las fechas de una aprobada dejaba el registro
 * diciendo una cosa y Google la anterior. El evento hace las dos mitades del
 * arreglo: la que se puede automatizar —Google, cuando la fila tiene apuntado su
 * `evento_calendario_id`— y la que no —la hoja, a la que n8n hace `append` y a
 * cuya fila no se puede volver—, que se le pide a administración por correo.
 *
 * El portón es `estaEnElCalendario(previa.estado) && cambiaLaHoja(previa,
 * actual)`, y el porqué de cada mitad está donde se aplica, más abajo.
 *
 * ⚠️ Es la CUARTA puerta del solapamiento: el registro general es la única vía
 * INTERACTIVA que puede llevar cualquier ausencia a cualquier fecha, y la única
 * de las cuatro que no pasa por el servicio —el router llama aquí directamente—,
 * así que su comprobación no puede vivir en `exigirSinSolape` como la del alta.
 * Si el destino está ocupado **LANZA** `SolapeAlAplicar`, y de ahí sale que esa
 * señal se exporte: no hay función intermedia donde cazarla, la traduce a 409 el
 * `catch` de la ruta en `router.ts`. Lanzar y no devolver `null` tampoco es
 * gusto: `null` ya significa «no encontrada» aquí, y el router lo contesta con
 * un 404 — un choque saldría diciendo que la solicitud no existe.
 *
 * Lo que NO es: el último escritor de la tabla. `importarHistorico` mete filas
 * sin pasar por puerta ninguna, y está exento a propósito — el porqué, en su
 * JSDoc.
 *
 * Va dentro de una transacción, y conviene decir exacto lo que eso da. Da que la
 * lectura de la foto previa, la comprobación, el UPDATE y el INSERT del outbox
 * viajen por la misma conexión y se deshagan juntos —una corrección que revienta
 * no puede dejar el correo dicho—, y que la relectura final vaya DESPUÉS del
 * UPDATE por ese mismo `client`: el UPDATE deja la fila bloqueada hasta el
 * COMMIT, así que lo que se devuelve lleva lo que ESTA petición escribió y no lo
 * que otra transacción pudiera colar entre dos consultas sueltas del pool. Lo
 * que **no** da es cerrar la ventana de carrera:
 * `BEGIN` pelado es READ COMMITTED y el `SELECT` no lleva `FOR UPDATE`, así que
 * dos correcciones simultáneas la pasan las dos (el porqué entero, en
 * `solapeDe`).
 */
export async function actualizarSolicitud(
  db: Pool,
  id: string,
  campos: EdicionSolicitud,
  adminEmail: string,
  construirPayload: (previa: Solicitud, actual: Solicitud, adminEmail: string) => PayloadEvento,
): Promise<Solicitud | null> {
  return withTransaction(db, async (client) => {
    // Solo hay algo que comprobar si la fila que va a quedar OCUPA agenda. Las
    // dos mitades importan y la del estado se pasó por alto la primera vez: sin
    // ella, corregirle una errata a una RECHAZADA que tuviera una ausencia viva
    // encima —el caso corriente de a quien le rechazan unos días y los vuelve a
    // pedir— salía 409 señalando `fechaInicio`, un campo que nadie había tocado.
    if (ocupaAgenda(campos.tipo, campos.estado)) {
      const choque = await solapeDe(
        client,
        // El empleado DESTINO, no el que tuviera la fila: si la corrección la
        // reasigna, la agenda que hay que mirar es la de quien se la queda.
        campos.empleadoId,
        campos.fechaInicio,
        campos.fechaFin,
        // Excluida por su id, o una corrección que no mueva las fechas —el
        // estado, un comentario, un día mal contado— chocaría contra la propia
        // fila que corrige, y ninguna solicitud VIVA se podría ya tocar (las
        // rechazadas sí: no llegan hasta aquí).
        //
        // ⚠️ Las incapacidades SÍ llegan desde el 2026-08-21, cuando dejaron de
        // estar exentas. Y eso tiene una consecuencia operativa con los datos
        // que ya existían: una incapacidad informada encima de otra ausencia
        // mientras la exención vivía sigue en la tabla, y ahora esa pareja es
        // un estado que la regla prohíbe. Corregirla SIN mover las fechas da
        // 409; lo que sí se puede es moverla a fechas libres —la comprobación
        // mira las NUEVAS— o borrarla, que no pasa por esta puerta.
        id,
      );
      if (choque) throw new SolapeAlAplicar(choque);
    }

    // La foto del ANTES, dentro de la transaccion y antes del UPDATE. Es lo
    // unico que permite saber si la fila estaba en Google y si la correccion
    // desajusta algo: despues del UPDATE ese dato ya no existe en ningun sitio.
    //
    // Va DESPUES de la puerta del solape y no antes, y no es indiferente: por
    // delante, su `return null` contestaria 404 a una correccion sobre una fila
    // borrada cuyo destino esta ocupado, donde hoy sale el solape. Ese reparto
    // esta FIJADO por un test de `repo.solapes.db.test.ts` («sobre una solicitud
    // que no existe manda el solape, no el 404»), que es justo quien caza el
    // volteo. Subirla arriba del todo «para tenerlo junto» cambia una decision
    // ajena a esta feature. Aqui abajo la posicion no cuesta nada: la puerta se
    // pregunta por `campos`, no por `previa`.
    const previa = await solicitudPorId(client, id);
    if (previa === null) return null;

    const { rows } = await client.query(
      `UPDATE portal.solicitudes_ausencia s
          SET empleado_id       = $2,
              solicitante_email = e.correo,
              tipo              = $3,
              fecha_inicio      = $4::date,
              fecha_fin         = $5::date,
              dias_habiles      = $6,
              estado            = $7,
              comentarios       = $8,
              observaciones     = $9
         FROM portal.empleados e
        WHERE s.id = $1 AND e.id = $2
        RETURNING s.id`,
      [
        id,
        campos.empleadoId,
        campos.tipo,
        campos.fechaInicio,
        campos.fechaFin,
        campos.dias,
        campos.estado,
        campos.comentarios,
        campos.observaciones,
      ],
    );
    if (rows.length === 0) return null;

    const actual = await solicitudPorId(client, id);
    // Imposible en la practica —acabamos de escribir esa fila por este mismo
    // client—, pero el tipo lo admite y devolver `previa` seria mentir.
    if (actual === null) return null;

    // Las dos mitades niegan cosas distintas y las dos hacen falta:
    //  - `estaEnElCalendario(previa.estado)`: la fila ESTABA en Google. Corregir
    //    una pendiente no desajusta nada, porque nunca se mando nada. Es ademas
    //    la precondicion que `construirPayloadCorreccion` documenta: su correo
    //    afirma que la ausencia ya estaba alli.
    //  - `cambiaLaHoja`: hay algo que ajustar de verdad. Es el porton unico, y
    //    CONTIENE a `cambiaElCalendario`, asi que no se pierde ninguna
    //    correccion de calendario por pasar por aqui.
    //
    // Y como cada fila del outbox es EXACTAMENTE UN correo, esta condicion es a
    // la vez la de que exista la fila: no hay correccion de calendario sin
    // correo ni correo sin correccion.
    if (estaEnElCalendario(previa.estado) && cambiaLaHoja(previa, actual)) {
      // Anotado y no un literal suelto, por lo mismo que en
      // `decidirModificacion`: el valor viaja al CHECK de `evento` de la 027, y
      // una errata compilaria y reventaria DENTRO de la transaccion, deshaciendo
      // una correccion que el admin cree guardada.
      const evento: EventoCorreccion = 'correccion_admin';
      const payload = construirPayload(previa, actual, adminEmail);
      await client.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [id, evento, JSON.stringify(payload)],
      );
      // Va DESPUES del INSERT y en la MISMA transaccion, igual que en
      // `decidirSolicitud` y `decidirModificacion`: si el evento sale, la marca
      // cambia, y si hay ROLLBACK no cambia ninguna de las dos.
      await anotarEventoDeCalendario(client, actual, payload);
    }

    return actual;
  });
}

/**
 * Borra una solicitud y devuelve lo que había, o null si no existía.
 *
 * Se permite borrar CUALQUIERA, también las importadas: restringirlo a las que
 * nacieron en el portal dejaría el único camino para una fila mala de la hoja en
 * la consola de psql, que es justo lo que este borrado viene a evitar. Y una
 * importada se recupera reimportando el Excel; una del portal, no. La red de
 * seguridad es la confirmación de la interfaz, no una regla en el SQL.
 *
 * Es irreversible y toca el registro de la compañía, así que **encola el borrado
 * de su evento del Google Calendar** antes de irse: hasta el 2026-08-19 hacía un
 * `DELETE` pelado y dejaba el evento huérfano en el calendario de Staff, donde
 * nadie iba a relacionarlo con nada.
 *
 * Tres pasos, y el orden de los dos primeros NO es indiferente:
 *
 *  1. Se lleva las filas del outbox de esa solicitud que sigan **sin servirse**.
 *     Es lo que hacía la cascada de la clave ajena hasta la migración 028, ahora
 *     escrito a propósito: sin esto se entregarían correos anunciando una
 *     solicitud que ya no existe.
 *  2. Encola el `borrado_admin` **si la fila estaba en Google**. Va DESPUÉS del
 *     paso 1 —invertidos, el paso 1 se lleva por delante lo que el 2 acaba de
 *     encolar— y ANTES del paso 3, porque la clave ajena valida en el `INSERT`.
 *  3. Borra la solicitud. La clave ajena, ya `ON DELETE SET NULL`, deja la fila
 *     del paso 2 viva con su `solicitud_id` a `null`.
 *
 * La condición del paso 2 es `estaEnElCalendario`, NO «hay `eventoCalendarioId`»:
 * cada fila del outbox es exactamente un correo, así que esa condición decide si
 * se avisa. Una aprobada anterior a la 026 no tiene id —su `calendario` irá a
 * `null` y el ⚠️ pedirá hacerlo a mano— pero sí hay que avisar de ella, que es
 * justo el caso donde nadie más va a darse cuenta.
 *
 * La transacción da que un fallo del payload no deje ni la solicitud borrada ni
 * el correo dicho. Lo que **no** da es cerrar ninguna ventana de carrera: `BEGIN`
 * pelado, READ COMMITTED, como el resto del fichero.
 *
 * ⚠️ **Aprobar y borrar dentro de los diez minutos es un caso decidido, no un
 * descuido.** El paso 1 se lleva el evento `aprobada` que todavía no se había
 * servido —el que iba a CREAR el evento en Google— y el paso 2 encola el borrado
 * de algo que Google nunca llegó a crear, así que contesta 404. Es uno de los
 * tres códigos que el IF «¿El fallo es esperable?» del workflow ya tolera a
 * propósito, así que sale ruido en el historial de n8n y nada más. La
 * alternativa —conservar el `aprobada` pendiente para que se cree y se borre en
 * orden— entregaría un correo anunciando la aprobación de una solicitud ya
 * borrada, que es peor. Ningún test lo cubre: haría falta Google de verdad.
 */
export async function borrarSolicitud(
  db: Pool,
  id: string,
  adminEmail: string,
  construirPayload: (borrada: Solicitud, adminEmail: string) => PayloadEvento,
): Promise<Solicitud | null> {
  return withTransaction(db, async (client) => {
    const previa = await solicitudPorId(client, id);
    if (previa === null) return null;

    // PASO 1. `enviado_at IS NULL` y no `servido_at IS NULL`: una fila que n8n ya
    // tiene en la mano pero no ha confirmado tambien muere aqui, igual que moria
    // con la cascada. n8n la procesara y su confirmacion no encontrara fila, que
    // es un no-op.
    await client.query(`DELETE FROM portal.ausencias_outbox WHERE solicitud_id = $1 AND enviado_at IS NULL`, [id]);

    // PASO 2.
    if (estaEnElCalendario(previa.estado)) {
      // Anotado y no un literal suelto: el valor viaja al CHECK de la 028, y una
      // errata compilaria y reventaria DENTRO de esta transaccion.
      const evento: EventoBorrado = 'borrado_admin';
      await client.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [id, evento, JSON.stringify(construirPayload(previa, adminEmail))],
      );
    }

    // PASO 3.
    await client.query('DELETE FROM portal.solicitudes_ausencia WHERE id = $1', [id]);
    return previa;
  });
}

// Aquí estaba `todasLasSolicitudes`, la compañía entera sin acotar por nadie,
// que servía al `GET /ausencias/historico` de admin. La sustituye `movimientos`
// (al final del fichero): trae también las anulaciones y los cambios, y sobre
// todo acepta un `soloDe` con el que el servicio recorta por rama. Una consulta
// sin recorte que no llama nadie es una que alguien acaba llamando desde una
// ruta sin guard.

// ── Modificaciones ─────────────────────────────────────────────────────────

/**
 * Las columnas del satélite, siempre con el prefijo `mod_`.
 *
 * El prefijo no es cosmético: estas mismas columnas viajan dentro del `LEFT
 * JOIN` de `SELECT_SOLICITUD`, donde `id`, `estado`, `motivo_rechazo`,
 * `created_at`, `aprobador_correo`, `decidida_at` y `solicitante_email` chocan
 * una a una con las de la solicitud. Con un solo juego de alias, un único mapa
 * (`aModificacion`) sirve para la consulta suelta y para la del JOIN.
 *
 * Se consulta siempre con la tabla aliasada `m` por lo mismo.
 */
const COLS_MODIFICACION = `
  m.id AS mod_id, m.solicitud_id AS mod_solicitud_id, m.clase AS mod_clase,
  m.estado_previo AS mod_estado_previo,
  m.fecha_inicio_previa::text AS mod_fecha_inicio_previa,
  m.fecha_fin_previa::text    AS mod_fecha_fin_previa,
  -- ::float8 por lo mismo que en dias_habiles de la solicitud: NUMERIC llega
  -- como STRING y "5.0" rompe la aritmetica de los correos y de la UI.
  m.dias_habiles_previos::float8 AS mod_dias_habiles_previos,
  m.fecha_inicio_nueva::text  AS mod_fecha_inicio_nueva,
  m.fecha_fin_nueva::text     AS mod_fecha_fin_nueva,
  m.dias_habiles_nuevos::float8 AS mod_dias_habiles_nuevos,
  m.motivo AS mod_motivo, m.estado AS mod_estado,
  m.aprobador_correo AS mod_aprobador_correo,
  m.solicitante_email AS mod_solicitante_email,
  m.decidida_at::text AS mod_decidida_at,
  m.motivo_rechazo AS mod_motivo_rechazo,
  m.created_at::text AS mod_created_at`;

const SELECT_MODIFICACION = `SELECT ${COLS_MODIFICACION} FROM portal.solicitud_modificaciones m`;

interface FilaModificacionDb {
  mod_id: string;
  mod_solicitud_id: string;
  mod_clase: ClaseModificacion;
  mod_estado_previo: Solicitud['estado'];
  mod_fecha_inicio_previa: string;
  mod_fecha_fin_previa: string;
  mod_dias_habiles_previos: number;
  mod_fecha_inicio_nueva: string | null;
  mod_fecha_fin_nueva: string | null;
  mod_dias_habiles_nuevos: number | null;
  mod_motivo: string | null;
  mod_estado: EstadoModificacion;
  mod_aprobador_correo: string;
  mod_solicitante_email: string;
  mod_decidida_at: string | null;
  mod_motivo_rechazo: string | null;
  mod_created_at: string;
}

/** Las mismas columnas vistas desde el LEFT JOIN: todas null si no hay propuesta. */
type FilaModificacionJoinDb = { [K in keyof FilaModificacionDb]: FilaModificacionDb[K] | null };

function aModificacion(r: FilaModificacionDb): Modificacion {
  return {
    id: r.mod_id,
    solicitudId: r.mod_solicitud_id,
    clase: r.mod_clase,
    estadoPrevio: r.mod_estado_previo,
    fechaInicioPrevia: r.mod_fecha_inicio_previa,
    fechaFinPrevia: r.mod_fecha_fin_previa,
    diasHabilesPrevios: r.mod_dias_habiles_previos,
    fechaInicioNueva: r.mod_fecha_inicio_nueva,
    fechaFinNueva: r.mod_fecha_fin_nueva,
    diasHabilesNuevos: r.mod_dias_habiles_nuevos,
    motivo: r.mod_motivo,
    estado: r.mod_estado,
    aprobadorCorreo: r.mod_aprobador_correo,
    solicitanteEmail: r.mod_solicitante_email,
    decididaAt: r.mod_decidida_at,
    motivoRechazo: r.mod_motivo_rechazo,
    createdAt: r.mod_created_at,
  };
}

// ── Solicitudes ────────────────────────────────────────────────────────────

const SELECT_SOLICITUD = `
  SELECT s.id, s.tipo, s.empleado_id, e.nombre_completo AS empleado_nombre, e.cargo AS empleado_cargo,
         s.solicitante_email, s.fecha_inicio::text AS fecha_inicio, s.fecha_fin::text AS fecha_fin,
         -- ::float8 NO es cosmetico: desde que la columna es NUMERIC (para
         -- admitir el medio dia del historico), el driver la devolveria como
         -- STRING para no perder precision, y "5.0" romperia toda la aritmetica
         -- de la UI y de los correos. Cuatro digitos con un decimal caben de
         -- sobra en un double sin error de representacion observable.
         s.dias_habiles::float8 AS dias_habiles,
         s.observaciones, s.origen,
         s.comentarios, s.estado, s.aprobador_correo, s.segundo_aprobador_correo, s.informado_correo,
         -- ::text por lo mismo que las fechas de mas arriba: el driver devuelve
         -- timestamptz como objeto Date, y una comparacion lexicografica contra
         -- una cadena fallaria en silencio.
         s.primera_firma_at::text AS primera_firma_at,
         s.decidida_at::text AS decidida_at, s.motivo_rechazo, s.created_at::text AS created_at,
         s.anulada_at::text AS anulada_at,
         -- Sin ::text: es TEXT en la base, no una fecha ni un numero.
         s.evento_calendario_id,
         a.id AS adjunto_id, a.nombre_archivo, a.mime,
         -- octet_length y no el binario: las listas solo necesitan el tamano.
         octet_length(a.contenido) AS adjunto_bytes,
         e.copia_correo,
         ${COLS_MODIFICACION}
    FROM portal.solicitudes_ausencia s
    JOIN portal.empleados e ON e.id = s.empleado_id
    LEFT JOIN portal.solicitud_adjuntos a ON a.solicitud_id = s.id
    -- La propuesta VIVA, si la hay. El JOIN no puede multiplicar filas: el
    -- indice unico parcial ux_modificaciones_una_pendiente de la 024 admite
    -- como mucho una con estado 'pendiente' por solicitud. Si esa condicion
    -- desapareciera, las OCHO consultas que usan este SELECT empezarian a
    -- duplicar resultados a la vez.
    LEFT JOIN portal.solicitud_modificaciones m
           ON m.solicitud_id = s.id AND m.estado = 'pendiente'`;

interface FilaSolicitudDb extends FilaModificacionJoinDb {
  id: string;
  tipo: TipoSolicitud;
  empleado_id: string;
  empleado_nombre: string;
  empleado_cargo: string | null;
  solicitante_email: string;
  fecha_inicio: string;
  fecha_fin: string;
  dias_habiles: number;
  observaciones: string | null;
  origen: Solicitud['origen'];
  comentarios: string | null;
  estado: Solicitud['estado'];
  aprobador_correo: string | null;
  segundo_aprobador_correo: string | null;
  informado_correo: string | null;
  primera_firma_at: string | null;
  decidida_at: string | null;
  motivo_rechazo: string | null;
  created_at: string;
  adjunto_id: string | null;
  nombre_archivo: string | null;
  mime: string | null;
  adjunto_bytes: number | null;
  copia_correo: string | null;
  anulada_at: string | null;
  evento_calendario_id: string | null;
}

function aSolicitud(r: FilaSolicitudDb): Solicitud {
  const adjunto: Adjunto | null = r.adjunto_id
    ? {
        id: r.adjunto_id,
        nombreArchivo: r.nombre_archivo ?? '',
        mime: r.mime ?? '',
        bytes: r.adjunto_bytes ?? 0,
      }
    : null;
  return {
    id: r.id,
    tipo: r.tipo,
    empleadoId: r.empleado_id,
    empleadoNombre: r.empleado_nombre,
    empleadoCargo: r.empleado_cargo,
    solicitanteEmail: r.solicitante_email,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
    diasHabiles: r.dias_habiles,
    observaciones: r.observaciones,
    origen: r.origen,
    comentarios: r.comentarios,
    estado: r.estado,
    aprobadorCorreo: r.aprobador_correo,
    segundoAprobadorCorreo: r.segundo_aprobador_correo,
    informadoCorreo: r.informado_correo,
    primeraFirmaAt: r.primera_firma_at,
    decididaAt: r.decidida_at,
    motivoRechazo: r.motivo_rechazo,
    createdAt: r.created_at,
    adjunto,
    copiaCorreo: r.copia_correo,
    // El cast es seguro por el `if`: en el LEFT JOIN, o vienen TODAS las
    // columnas del satélite o ninguna, así que `mod_id` decide por las demás.
    modificacionPendiente: r.mod_id ? aModificacion(r as FilaModificacionDb) : null,
    anuladaAt: r.anulada_at,
    eventoCalendarioId: r.evento_calendario_id,
  };
}

export interface DatosInsercion {
  tipo: TipoSolicitud;
  empleadoId: string;
  solicitanteEmail: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  comentarios: string | null;
  estado: Solicitud['estado'];
  aprobadorCorreo: string | null;
  /** Copia congelada: un cambio de organigrama no mueve una solicitud en vuelo. */
  segundoAprobadorCorreo: string | null;
  /** Congelado por lo mismo que los firmantes: nace del árbol, no de un ajuste. */
  informadoCorreo: string | null;
}

/**
 * Deja constancia de si esta solicitud es dueña de un evento VIVO en el
 * calendario.
 *
 * La columna no significa «alguna vez impusimos un id»: significa «ahora
 * mismo hay un evento en Google que responde a este id». `crear` la anota y
 * `borrar` la vacía, porque el evento que describía ya no existe. Las
 * solicitudes aprobadas antes de esto nunca la anotaron: llevan en Google un
 * id que inventó Google y que nadie apuntó, y por eso siguen pidiendo el
 * ajuste a mano. Ver `correccionDeCalendario` en notificaciones.ts.
 *
 * Va en la MISMA transacción que el INSERT del outbox: si el evento sale, la
 * marca cambia, y si hay ROLLBACK no cambia ninguna de las dos.
 */
async function anotarEventoDeCalendario(
  client: PoolClient,
  solicitud: Solicitud,
  payload: PayloadEvento,
): Promise<void> {
  // La condicion se lee del PAYLOAD, no de una lista de eventos copiada aqui:
  // asi la marca se escribe exactamente cuando se emite la accion, y no puede
  // desincronizarse de construirPayload el dia que cambie el reparto de efectos.
  const cal = payload.calendario;
  if (cal?.accion !== 'crear' && cal?.accion !== 'borrar') return;
  // `borrar` la VACIA: la columna dice si hay evento vivo en Google, no si
  // alguna vez impusimos un id. Dejarla puesta tras un borrado hace que la
  // siguiente correccion mande un `actualizar` contra un evento que no existe,
  // y el IF de fallos esperables de n8n se lo traga como 404: en silencio.
  const id = cal.accion === 'crear' ? cal.eventId : null;
  await client.query(`UPDATE portal.solicitudes_ausencia SET evento_calendario_id = $2 WHERE id = $1`, [
    solicitud.id,
    id,
  ]);
  // La fila se leyo con SELECT_SOLICITUD ANTES de este UPDATE, asi que el objeto
  // que se devuelve llevaria un valor que dejo de ser cierto hace dos lineas. Y
  // este campo decide si Google se corrige solo: devolverlo obsoleto es
  // exactamente la clase de texto caducado que mas cara sale en esta app.
  solicitud.eventoCalendarioId = id;
}

/**
 * Crea la solicitud, su adjunto y el evento de outbox **en una transacción**:
 * una solicitud guardada sin su evento nunca notificaría a nadie, y un evento
 * sin solicitud es basura que n8n reintentaría en bucle.
 */
export async function crearSolicitud(
  db: Pool,
  datos: DatosInsercion,
  adjunto: { nombreArchivo: string; mime: string; contenido: Buffer } | null,
  eventos: EventoSolicitud[],
  construirPayload: (solicitud: Solicitud, evento: EventoSolicitud) => PayloadEvento,
): Promise<Solicitud> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO portal.solicitudes_ausencia
         (tipo, empleado_id, solicitante_email, fecha_inicio, fecha_fin,
          dias_habiles, comentarios, estado, aprobador_correo, segundo_aprobador_correo,
          informado_correo)
       VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        datos.tipo,
        datos.empleadoId,
        datos.solicitanteEmail,
        datos.fechaInicio,
        datos.fechaFin,
        datos.diasHabiles,
        datos.comentarios,
        datos.estado,
        datos.aprobadorCorreo,
        datos.segundoAprobadorCorreo,
        datos.informadoCorreo,
      ],
    );
    const id = (rows[0] as { id: string }).id;

    if (adjunto) {
      await client.query(
        `INSERT INTO portal.solicitud_adjuntos (solicitud_id, nombre_archivo, mime, contenido)
         VALUES ($1, $2, $3, $4)`,
        [id, adjunto.nombreArchivo, adjunto.mime, adjunto.contenido],
      );
    }

    const { rows: creada } = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
    const solicitud = aSolicitud(creada[0] as FilaSolicitudDb);

    // El orden importa: el outbox se sirve por `id` ascendente, así que el
    // acuse al solicitante sale antes que el aviso a quien aprueba.
    for (const evento of eventos) {
      const payload = construirPayload(solicitud, evento);
      await client.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [id, evento, JSON.stringify(payload)],
      );
      await anotarEventoDeCalendario(client, solicitud, payload);
    }

    return solicitud;
  });
}

export async function solicitudesDeEmpleado(db: Pool, empleadoId: string): Promise<Solicitud[]> {
  const { rows } = await db.query(`${SELECT_SOLICITUD} WHERE s.empleado_id = $1 ORDER BY s.created_at DESC`, [
    empleadoId,
  ]);
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

/**
 * Las solicitudes que le toca decidir a `aprobadorCorreo` **ahora**. Un admin
 * (`todas`) ve las de todo el mundo: es quien destraba una aprobación bloqueada.
 *
 * El filtro es por TURNO, no por «aparezco en la solicitud»: en `pendiente` solo
 * la ve quien firma primero, y en `pendiente_2` solo quien firma después. Si
 * fuera un OR de los dos correos, el segundo aprobador vería —y podría firmar—
 * solicitudes que su jefe intermedio todavía no ha visto.
 */
export async function solicitudesPendientes(db: Pool, aprobadorCorreo: string, todas: boolean): Promise<Solicitud[]> {
  const { rows } = await db.query(
    `${SELECT_SOLICITUD}
      WHERE s.estado IN ('pendiente', 'pendiente_2')
        AND ($2::boolean
             OR (s.estado = 'pendiente'   AND lower(s.aprobador_correo)         = lower($1))
             OR (s.estado = 'pendiente_2' AND lower(s.segundo_aprobador_correo) = lower($1)))
      ORDER BY s.created_at`,
    [aprobadorCorreo, todas],
  );
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

// Aquí estaba `solicitudesDecididas`, el historial del aprobador: lo ya cerrado
// que le tocaba firmar a un correo. Lo sustituye `movimientos` (al final del
// fichero), que enseña ese mismo rastro y el de toda su rama, con las
// anulaciones y los cambios que esta consulta no alcanzaba. Su `ORDER BY`
// sobrevive en `porFechaDeCierre`, con el porqué del `NULLS LAST` intacto.

/**
 * Las solicitudes que llevan un PDF, de cualquiera y en cualquier estado.
 *
 * Sin acotar por persona: quien llega aquí ya pasó el guard de administración del
 * servicio. Reutiliza `SELECT_SOLICITUD`, así que el binario NO viaja — solo su
 * `octet_length`.
 *
 * Nota: `solicitud_adjuntos` no tiene UNIQUE sobre `solicitud_id`. Hoy no puede
 * haber dos, porque el alta inserta uno como mucho, pero si algún día los
 * hubiera, esta consulta duplicaría la fila y sería aquí donde se vería.
 */
export async function solicitudesConAdjunto(db: Pool): Promise<Solicitud[]> {
  const { rows } = await db.query(`${SELECT_SOLICITUD} WHERE a.id IS NOT NULL ORDER BY s.fecha_inicio DESC`);
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

/**
 * Una solicitud por su id, con lo que le cuelga del `SELECT_SOLICITUD`.
 *
 * Acepta `PoolClient` además de `Pool` por lo mismo que `solapeDe`: cuando
 * `actualizarSolicitud` la usa para releer lo que acaba de escribir, tiene que ir
 * por la conexión de la transacción o no vería el UPDATE sin confirmar y
 * devolvería la fila de antes.
 */
export async function solicitudPorId(db: Pool | PoolClient, id: string): Promise<Solicitud | null> {
  const { rows } = await db.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
  return rows.length ? aSolicitud(rows[0] as FilaSolicitudDb) : null;
}

/**
 * Registra la decisión y encola su notificación, en una transacción.
 *
 * El `WHERE estado = $N` es lo que hace la operación idempotente sin bloqueos:
 * dos clics en «Aprobar» a la vez, o un reintento del navegador, y solo el
 * primero actualiza. El segundo no encuentra fila y el servicio lo traduce a 409,
 * en vez de mandar dos correos contradictorios.
 *
 * ⚠️ `estadoEsperado` es el estado que el servicio LEYÓ, y funciona como testigo
 * de concurrencia optimista. No sustituirlo por un `IN ('pendiente','pendiente_2')`
 * con un CASE para el destino: sería igual de atómico pero destruiría el 409, y un
 * doble clic del jefe inmediato encadenaría `pendiente → pendiente_2 → aprobada`
 * con una sola persona firmando las dos veces.
 *
 * Lo vigila `repo.testigos.db.test.ts`: dos llamadas con el mismo
 * `estadoEsperado` —el doble clic— y la segunda tiene que devolver `null` sin
 * encolar un segundo correo. Falsado sustituyendo el testigo por un `IN`: el
 * test se pone rojo. Corre en el cuarto portón, `npm run test:db`.
 */
export async function decidirSolicitud(
  db: Pool,
  id: string,
  estadoEsperado: Solicitud['estado'],
  transicion: Transicion,
  motivo: string | null,
  userId: string | null,
  construirPayload: (solicitud: Solicitud, evento: EventoSolicitud) => PayloadEvento,
  /**
   * El segundo constructor, para el aviso de la propuesta que caduca. Va aparte
   * del de arriba y no fundido en uno polimórfico porque son dos payloads con
   * dos formas distintas — uno habla de la solicitud y el otro de la propuesta—,
   * y fundirlos obligaría a discriminar por el nombre del evento dentro.
   */
  construirPayloadCaducada: (s: Solicitud, m: Modificacion, evento: EventoModificacion) => PayloadEvento,
): Promise<Solicitud | null> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE portal.solicitudes_ausencia
          SET estado                = $2,
              motivo_rechazo        = $3,
              primera_firma_user_id = CASE WHEN $5::boolean THEN $4 ELSE primera_firma_user_id END,
              primera_firma_at      = CASE WHEN $5::boolean THEN now() ELSE primera_firma_at END,
              aprobador_user_id     = CASE WHEN $6::boolean THEN $4 ELSE aprobador_user_id END,
              decidida_at           = CASE WHEN $6::boolean THEN now() ELSE decidida_at END
        WHERE id = $1 AND estado = $7
        RETURNING id`,
      [
        id,
        transicion.estado,
        motivo,
        userId,
        transicion.esPrimeraFirma,
        transicion.esDecisionFinal,
        estadoEsperado,
      ],
    );
    // Sin fila = ya la decidió otro (o no existe). No es un error de servidor:
    // el servicio lo traduce a 409 y no se encola ninguna notificación.
    if (rows.length === 0) return null;

    const { rows: actualizada } = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
    const solicitud = aSolicitud(actualizada[0] as FilaSolicitudDb);

    const payload = construirPayload(solicitud, transicion.evento);
    await client.query(
      `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
      [id, transicion.evento, JSON.stringify(payload)],
    );
    await anotarEventoDeCalendario(client, solicitud, payload);

    await caducarPropuestaViva(client, id, solicitud, construirPayloadCaducada);

    return solicitud;
  });
}

/**
 * Cierra la petición de cambio que estuviera viva sobre esta solicitud, porque
 * acaba de dejar de poder aplicarse.
 *
 * ⚠️ Esto NO es una decisión de producto que se pueda discutir aparte: la
 * propuesta ya estaba muerta antes de existir esta función. El `TESTIGO_SOLICITUD`
 * de `decidirModificacion` compara el ESTADO de la solicitud, así que en cuanto
 * la solicitud se mueve —y firmarla la mueve SIEMPRE, incluso el paso de
 * `pendiente` a `pendiente_2`— aprobarla contesta 409 y nada la revive. Lo único
 * que cambia aquí es que el sistema lo reconoce en vez de dejarla `pendiente`
 * para siempre.
 *
 * Y lo que arregla no es cosmético. El índice único parcial de la 024 solo admite
 * UNA propuesta viva por solicitud, así que esa fila muerta dejaba al trabajador
 * sin poder pedir otro cambio sobre esa misma solicitud, con un 409 que hablaba
 * de una petición que él daba por perdida.
 *
 * Va DENTRO de la transacción de la firma, y con su aviso en el outbox, por lo
 * mismo que el resto: si se hiciera después y el proceso se cayera entre medias,
 * la propuesta quedaría caducada sin que nadie se lo hubiera dicho a nadie.
 */
async function caducarPropuestaViva(
  client: PoolClient,
  solicitudId: string,
  solicitud: Solicitud,
  construirPayload: (s: Solicitud, m: Modificacion, evento: EventoModificacion) => PayloadEvento,
): Promise<void> {
  const { rows } = await client.query(
    `UPDATE portal.solicitud_modificaciones
        SET estado = 'caducada'
      WHERE solicitud_id = $1 AND estado = 'pendiente'
      RETURNING id`,
    [solicitudId],
  );
  // Lo normal: no había ninguna viva y no hay nada que avisar.
  if (rows.length === 0) return;

  // Se relee con el SELECT común en vez de construirla desde el RETURNING: es lo
  // que garantiza que el correo hable de la MISMA forma de propuesta que el
  // resto del módulo, con sus `::text` incluidos.
  const { rows: cerrada } = await client.query(`${SELECT_MODIFICACION} WHERE m.id = $1`, [
    (rows[0] as { id: string }).id,
  ]);
  const modificacion = aModificacion(cerrada[0] as FilaModificacionDb);

  await client.query(
    `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
    [
      solicitudId,
      'modificacion_caducada',
      JSON.stringify(construirPayload(solicitud, modificacion, 'modificacion_caducada')),
    ],
  );
}

/**
 * El dueño retira su propia solicitud, antes de que nadie la haya firmado.
 *
 * La deja en `rechazada` + `anulada_at`, que es el MISMO estado terminal en el
 * que la dejaría una anulación aprobada. Reutilizarlo y no estrenar un
 * `'retirada'` es deliberado: `estado <> 'rechazada'` está repartido por media
 * docena de consultas —el calendario, el solape, el saldo— y un estado nuevo
 * tendría que añadirse a todas ellas, con el fallo cayendo del lado de contar
 * como ausencia unos días que ya nadie disfruta.
 *
 * ⚠️ El testigo del WHERE es lo único que impide la carrera contra la firma. Las
 * dos condiciones hacen falta y no sobra ninguna:
 *  - `estado = 'pendiente'`: si el jefe firma entre el SELECT del servicio y
 *    este UPDATE, aquí ya no hay fila y gana él. Cero filas → 409, igual que en
 *    `decidirSolicitud`.
 *  - `primera_firma_at IS NULL`: cinturón sobre lo mismo por otra vía. Un admin
 *    puede devolver una solicitud a `pendiente` con el PATCH del registro sin
 *    borrar esa marca, y entonces «pendiente» convive con una firma YA DADA.
 *    Retirarla ahí borraría el visto bueno del jefe inmediato sin decírselo.
 *
 * NO se toca `decidida_at` ni `aprobador_user_id`: no ha decidido nadie. El
 * registro lo enseña como anulada y sin decisor, que es exactamente lo que pasó
 * — y es lo que distingue una retirada de una anulación firmada por un jefe.
 */
export async function retirarSolicitud(
  db: Pool,
  id: string,
  construirPayload: (solicitud: Solicitud, evento: EventoSolicitud) => PayloadEvento,
): Promise<Solicitud | null> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE portal.solicitudes_ausencia
          SET estado = 'rechazada', anulada_at = now()
        WHERE id = $1 AND estado = 'pendiente' AND primera_firma_at IS NULL
        RETURNING id`,
      [id],
    );
    if (rows.length === 0) return null;

    const { rows: actualizada } = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
    const solicitud = aSolicitud(actualizada[0] as FilaSolicitudDb);

    // Sin `anotarEventoDeCalendario`: una `pendiente` nunca creó evento, así que
    // no hay id que apuntar ni nada que borrar en Google.
    await client.query(
      `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
      [id, 'retirada', JSON.stringify(construirPayload(solicitud, 'retirada'))],
    );

    return solicitud;
  });
}

// ── Modificaciones: alta y retirada ────────────────────────────────────────

/** Lo que el servicio ya tiene resuelto cuando pide guardar la propuesta. */
export interface DatosModificacion {
  solicitudId: string;
  clase: ClaseModificacion;
  /**
   * El estado que el servicio LEYÓ de la solicitud. Viaja hasta el SQL como
   * testigo de concurrencia; ver el porqué en `crearModificacion`.
   */
  estadoEsperado: Solicitud['estado'];
  fechaInicioNueva: string | null;
  fechaFinNueva: string | null;
  diasHabilesNuevos: number | null;
  motivo: string | null;
  /** Copiado de la solicitud por el servicio. NUNCA rederivado del organigrama. */
  aprobadorCorreo: string;
}

/**
 * Resultado del alta. Discriminado y no un `null` a secas porque las dos formas
 * de fallar piden mensajes distintos: «alguien decidió la solicitud mientras
 * escribías» no es «ya tienes una propuesta pendiente».
 */
export type ResultadoAlta =
  | { ok: true; modificacion: Modificacion }
  | { ok: false; razon: 'estado' | 'duplicada' };

/**
 * `satisfies` y no una cadena suelta: el literal viaja al CHECK de `evento` de
 * la 024, y una errata aquí compilaría y reventaría DENTRO de la transacción,
 * deshaciendo la propuesta entera por un fallo de tecleo.
 */
const EVENTO_ALTA_MODIFICACION = 'modificacion_solicitada' as const satisfies EventoModificacion;

/** El índice único parcial de la 024. Se nombra para poder reconocer SU 23505. */
const UX_UNA_PENDIENTE = 'ux_modificaciones_una_pendiente';

/**
 * Guarda la propuesta y encola su aviso, en una transacción.
 *
 * ⚠️ Dos cosas sostienen la corrección de este INSERT y ninguna es opcional:
 *
 *  1. El `SELECT` dentro del `INSERT` resuelve la foto previa (estado, fechas,
 *     días, correo del solicitante) en la MISMA sentencia. Leerla antes y
 *     grabarla después dejaría una ventana en la que la foto ya no describe lo
 *     que hay en la tabla. De AQUÍ, y no del testigo, sale que `estado_previo`
 *     sea el estado real de la fila. Con un matiz que conviene no perder: es
 *     cierto respecto al snapshot de ESA sentencia, no para siempre —
 *     `withTransaction` abre un `BEGIN` pelado (READ COMMITTED) y el `SELECT` no
 *     lleva `FOR UPDATE`, así que una aprobación que confirme justo después lo
 *     deja obsoleto. Quien lo verifica en el momento de USARLO es el testigo
 *     TRIPLE de `aplicarALaSolicitud`.
 *  2. El `AND s.estado = $8` lleva el estado que leyó el servicio, y lo que
 *     protege es **`aprobador_correo` (`$7`)**: el único dato de este INSERT que
 *     el servicio DERIVÓ de su lectura anterior, con `decisorDeModificacion`,
 *     que devuelve el firmante DEL TURNO y por tanto depende del estado. Si la
 *     solicitud avanza de nivel entre la lectura y el INSERT, la propuesta se
 *     congela a nombre del jefe que ya firmó y salió del turno — y
 *     `modificacionesPendientes`, `puedeDecidirModificacion` y el correo del
 *     alta filtran los tres por ese mismo campo: la propuesta entera aterriza en
 *     la bandeja de quien ya no tiene el turno, y el firmante que sí lo tiene no
 *     la ve nunca. Sin 403 y sin error.
 *
 * Mismo aviso que en `decidirSolicitud`: NO sustituir el testigo por un
 * `IN ('pendiente','pendiente_2','aprobada')`. Es tentador precisamente porque
 * `estado_previo` seguiría siendo cierto —lo da el `SELECT` de al lado—, pero lo
 * que destruye es la coherencia entre la fila y el decisor congelado sobre ella.
 * Lo vigila `repo.testigos.db.test.ts`, que ejecuta este SQL contra un Postgres
 * de verdad en el cuarto portón (`npm run test:db`).
 *
 * Cero filas ⇒ alguien se adelantó (`razon: 'estado'`). Una violación de
 * `ux_modificaciones_una_pendiente` (23505 **con ese nombre**) ⇒ ya había otra
 * propuesta viva; esa carrera la corta la BASE y no una comprobación previa,
 * porque dos peticiones simultáneas pasarían las dos comprobaciones antes de que
 * ninguna escribiera.
 */
export async function crearModificacion(
  db: Pool,
  datos: DatosModificacion,
  construirPayload: (
    solicitud: Solicitud,
    modificacion: Modificacion,
    evento: typeof EVENTO_ALTA_MODIFICACION,
  ) => PayloadEvento,
): Promise<ResultadoAlta> {
  try {
    return await withTransaction(db, async (client): Promise<ResultadoAlta> => {
      const { rows } = await client.query(
        `INSERT INTO portal.solicitud_modificaciones
           (solicitud_id, clase, estado_previo, fecha_inicio_previa, fecha_fin_previa,
            dias_habiles_previos, fecha_inicio_nueva, fecha_fin_nueva, dias_habiles_nuevos,
            motivo, aprobador_correo, solicitante_email)
         SELECT s.id, $2, s.estado, s.fecha_inicio, s.fecha_fin, s.dias_habiles,
                $3::date, $4::date, $5::numeric, $6, $7, s.solicitante_email
           FROM portal.solicitudes_ausencia s
          -- ⚠️ $8 es el estado que LEYO el servicio, NO una lista de estados
          -- admisibles. No cambiar por IN ('pendiente','pendiente_2','aprobada'):
          -- estado_previo seguiria siendo cierto —sale de s.estado, aqui al
          -- lado—, pero $7, el decisor congelado, lo calculo el servicio con el
          -- estado viejo. Si la solicitud avanza de nivel entre medias, la
          -- propuesta queda a nombre del firmante que ya firmo, y la bandeja, el
          -- guard y el correo la mandan los tres alli: el que tiene el turno no
          -- la ve. Lo vigila repo.testigos.db.test.ts, que ejecuta este SQL
          -- contra un Postgres de verdad; se comprobo poniendo el IN y el test se
          -- pone rojo. Corre en el cuarto porton, "npm run test:db".
          WHERE s.id = $1 AND s.estado = $8
         RETURNING id`,
        [
          datos.solicitudId,
          datos.clase,
          datos.fechaInicioNueva,
          datos.fechaFinNueva,
          datos.diasHabilesNuevos,
          datos.motivo,
          datos.aprobadorCorreo,
          datos.estadoEsperado,
        ],
      );
      if (rows.length === 0) return { ok: false, razon: 'estado' };
      const id = (rows[0] as { id: string }).id;

      const { rows: creada } = await client.query(`${SELECT_MODIFICACION} WHERE m.id = $1`, [id]);
      const modificacion = aModificacion(creada[0] as FilaModificacionDb);

      // La solicitud se relee DESPUÉS del INSERT: así viene ya con su
      // `modificacionPendiente` por el LEFT JOIN, y el correo se redacta sobre
      // exactamente lo que quedó guardado.
      const { rows: solicitudes } = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [datos.solicitudId]);
      const solicitud = aSolicitud(solicitudes[0] as FilaSolicitudDb);

      // El evento va dentro de la transacción, como el resto del fichero: una
      // propuesta guardada sin su aviso no la vería nunca quien tiene que
      // decidirla, y un aviso sin propuesta es basura que n8n reintentaría.
      await client.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [
          datos.solicitudId,
          EVENTO_ALTA_MODIFICACION,
          JSON.stringify(construirPayload(solicitud, modificacion, EVENTO_ALTA_MODIFICACION)),
        ],
      );

      return { ok: true, modificacion };
    });
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    // 23505 = unique_violation, pero se exige además el NOMBRE. Dentro de este
    // `try` hay otra tabla que no controlamos —`ausencias_outbox`—, y añadirle
    // un UNIQUE por idempotencia es de lo más natural que puede pasar en la
    // Fase 3, que mete tres eventos por modificación. El día que ocurra, un
    // fallo real del outbox se convertiría en un «ya tienes una propuesta
    // pendiente» que nadie entiende y que además diría que no se escribió nada.
    if (e?.code === '23505' && e.constraint === UX_UNA_PENDIENTE) {
      return { ok: false, razon: 'duplicada' };
    }
    throw err;
  }
}

// ── Modificaciones: la decisión ────────────────────────────────────────────

/**
 * Resultado de decidir. Las tres formas de fallar son un 409, pero cuentan cosas
 * distintas y el cliente tiene que poder distinguirlas: «alguien ya la decidió»
 * (o un doble clic) no es «la solicitud se movió debajo y hay que mirar».
 *
 * `solape` es la única de las tres que no habla de quien firma: la propuesta era
 * legal cuando se pidió y el destino se ocupó después, así que el mensaje no
 * puede quedarse en «no se puede» — tiene que nombrar la ausencia con la que
 * choca, y por eso esta razón viaja acompañada y las otras dos no.
 */
export type ResultadoDecisionModificacion =
  | { ok: true; modificacion: Modificacion; solicitud: Solicitud }
  | { ok: false; razon: 'ya_decidida' | 'solicitud_cambio_de_estado' }
  | { ok: false; razon: 'solape'; solape: Solape };

/**
 * Señal interna para abortar la transacción cuando el testigo triple no casa.
 *
 * Es un THROW y no un `return` a propósito: cuando el paso 2 falla, el paso 1 ya
 * ha escrito, y **solo el ROLLBACK lo deshace**. Ver el porqué entero en
 * `decidirModificacion`. No sale de este módulo — se caza abajo y se traduce a
 * un resultado normal, para que el servicio no tenga que conocerla.
 */
class ChoqueConLaSolicitud extends Error {}

/**
 * Señal para abortar la transacción cuando las fechas que se van a escribir ya
 * están ocupadas por otra ausencia viva de la misma persona. La lanzan las dos
 * puertas del solapamiento que corren dentro de una transacción de este módulo:
 * firmar el cambio (`decidirModificacion`) y el `PATCH` de admin
 * (`actualizarSolicitud`).
 *
 * En `decidirModificacion` es THROW y no `return` por el mismo motivo que
 * `ChoqueConLaSolicitud`, y allí es todavía más fácil de perder de vista: cuando
 * esto salta, **las dos escrituras ya están hechas** —la propuesta marcada
 * `aprobada` y la solicitud movida a las fechas nuevas—. Un `return` desde dentro
 * de `withTransaction` sale por la puerta del `COMMIT` —no hay error que provoque
 * el `ROLLBACK`—, así que confirmaría las dos y dejaría exactamente el estado que
 * esa puerta existe para impedir: dos ausencias vivas de la misma persona sobre
 * el mismo día, con un 409 devuelto al jefe diciéndole que no se hizo nada. Se
 * comprobó cambiándolo por un `return`: el test del ROLLBACK se pone rojo. En
 * `actualizarSolicitud` la comprobación va ANTES del UPDATE, así que cuando salta
 * no hay nada escrito: allí el throw no deshace la escritura, la impide — y
 * `return null` está ocupado, porque significa «no encontrada».
 *
 * Lleva el choque encima porque el aviso tiene que nombrarlo.
 *
 * ⚠️ Es la única de las dos señales que SALE del módulo, y se exporta por una
 * razón concreta: el `PATCH` va del router al repo sin pasar por el servicio, así
 * que no hay ninguna función intermedia donde cazarla y traducirla a un
 * resultado, como sí hace `decidirModificacion` aquí abajo. La caza el `catch` de
 * esa ruta en `router.ts`.
 */
export class SolapeAlAplicar extends Error {
  constructor(public readonly solape: Solape) {
    super('solape');
  }
}

/**
 * El testigo TRIPLE del UPDATE de la solicitud, escrito una sola vez para que
 * las dos clases de cambio no puedan divergir.
 *
 * `$1` = id, `$2` = estado previo, `$3` = fecha de inicio previa, `$4` = fecha
 * de fin previa. Lo que cada clase escribe empieza en `$5`.
 */
const TESTIGO_SOLICITUD = `
  WHERE id = $1
    -- ⚠️ TRES campos, y los tres hacen falta. Con solo el estado no se detecta
    -- que un admin haya corregido las fechas por PATCH entre que se pidio el
    -- cambio y se aprobo, y la aprobacion le pisaria la correccion EN SILENCIO
    -- (el PATCH no encola nada, asi que nadie se enteraria nunca). Con los tres,
    -- ese choque sale 409 y alguien mira. Es el segundo motivo por el que
    -- existen las columnas *_previa de la 024.
    --
    -- Lo vigilan TRES tests de repo.testigos.db.test.ts, uno por cada cosa que
    -- este testigo puede perder: que un admin corrija las fechas por PATCH entre
    -- medias, que la solicitud avance de nivel —ese es el campo estado, y las
    -- fechas no lo ven— y que la rama de ANULACION lleve el mismo testigo que la
    -- de fechas: las dos comparten esta constante pero tienen SET distintos, y
    -- desenganchar la de anulacion dejaba la bateria entera en verde. Los tres se
    -- falsaron rompiendo el SQL. Corren en el cuarto porton, "npm run test:db",
    -- contra un Postgres de verdad.
    AND estado       = $2
    AND fecha_inicio = $3::date
    AND fecha_fin    = $4::date`;

/**
 * Aplica la propuesta a la fila de la solicitud. Lanza si el testigo no casa.
 *
 * Las dos clases escriben cosas distintas y ninguna es la otra:
 *  - `fechas`    → reescribe las fechas y los días. **El `estado` NO se toca**:
 *    aprobar un cambio no re-decide la solicitud, así que una `pendiente` sigue
 *    `pendiente` y una `aprobada` sigue `aprobada`.
 *  - `anulacion` → `rechazada` + `anulada_at`. No estrena estado: `rechazada` ya
 *    hereda la semántica correcta en los seis filtros que miran el estado (ver
 *    la cabecera de la 024), y `anulada_at` es lo único que la distingue de un
 *    rechazo del jefe.
 */
async function aplicarALaSolicitud(client: PoolClient, m: Modificacion): Promise<void> {
  const testigo = [m.solicitudId, m.estadoPrevio, m.fechaInicioPrevia, m.fechaFinPrevia];
  const { rows } =
    m.clase === 'anulacion'
      ? await client.query(
          `UPDATE portal.solicitudes_ausencia
              SET estado = 'rechazada', anulada_at = now(),
                  -- El motivo que escribio QUIEN PIDIO la anulacion. Sin el, la
                  -- fila quedaria "rechazada" a secas y el historial del jefe no
                  -- diria por que unos dias concedidos no se disfrutaron.
                  motivo_rechazo = $5
            ${TESTIGO_SOLICITUD}
           RETURNING id`,
          [...testigo, m.motivo],
        )
      : await client.query(
          `UPDATE portal.solicitudes_ausencia
              -- Ni el estado, ni decidida_at, ni aprobador_user_id: esto no es
              -- una decision sobre la solicitud, es una enmienda de sus fechas.
              SET fecha_inicio = $5::date, fecha_fin = $6::date, dias_habiles = $7
            ${TESTIGO_SOLICITUD}
           RETURNING id`,
          [...testigo, m.fechaInicioNueva, m.fechaFinNueva, m.diasHabilesNuevos],
        );
  if (rows.length === 0) throw new ChoqueConLaSolicitud();
}

/**
 * El jefe aprueba o rechaza la propuesta, en **una sola transacción** y con el
 * evento del outbox dentro, como el resto del fichero.
 *
 * Tres pasos:
 *
 *  1. **Decidir la propuesta.** El `AND estado = 'pendiente'` mata el doble clic
 *     igual que en `decidirSolicitud`: solo el primero actualiza, el segundo no
 *     encuentra fila y el servicio lo traduce a 409 en vez de mandar dos correos
 *     contradictorios.
 *  2. **Aplicarla a la solicitud**, y solo si se aprueba. Rechazar deja la fila
 *     exactamente como estaba: no hay nada que escribir.
 *  3. Releer, comprobar que el cambio no ha dejado a esa persona con dos
 *     ausencias vivas sobre el mismo día, y encolar el aviso.
 *
 * ⚠️ Esa comprobación del paso 3 es la TERCERA puerta del solapamiento, y la
 * única que llega a tiempo: entre PROPONER el cambio y FIRMARLO le han podido
 * aprobar a esa persona otra ausencia encima, y la de `pedirModificacion` miró
 * cuando el destino aún estaba libre. Va DESPUÉS del UPDATE y no antes porque
 * ahí `solicitud` ya está releída y trae el empleado y el tipo, que es lo único
 * que le falta a `Modificacion`; ve exactamente lo mismo que vería antes, porque
 * `solapeDe` excluye a esta solicitud por su id. Si choca, **LANZA** —por lo
 * mismo que el paso 2, ver abajo— y el ROLLBACK se lleva por delante los pasos
 * 1 y 2, con lo que el outbox se queda sin aviso. Lo que **no** hace es cerrar
 * la carrera: esto es READ COMMITTED y el `SELECT` no lleva `FOR UPDATE` (el
 * porqué entero, en `solapeDe`).
 *
 * ⚠️ Si el paso 2 no encuentra fila, esto **LANZA**, y ese lanzamiento es lo más
 * importante de la función. El ROLLBACK deshace también el paso 1, así que la
 * propuesta se queda `pendiente` y el cliente ve un 409. Si el paso 1 pudiera
 * confirmarse con el paso 2 fallido, la propuesta diría «aprobada» mientras la
 * solicitud conserva las fechas viejas, **y el correo anunciaría un cambio que
 * no ha ocurrido**: el trabajador se iría de vacaciones las fechas que dice el
 * correo y en el registro constarían otras.
 *
 * Es literalmente el argumento que ya está escrito en `fijarVisorConRegistro`
 * más arriba —«si el UPDATE cuajara y el INSERT fallara… quedaría concedida sin
 * una sola línea de registro»—, con la diferencia de que aquí el estado a medias
 * además se comunica por correo. Por eso las dos escrituras van juntas o no van.
 */
export async function decidirModificacion(
  db: Pool,
  id: string,
  aprueba: boolean,
  motivoRechazo: string | null,
  userId: string | null,
  construirPayload: (s: Solicitud, m: Modificacion, evento: EventoModificacion) => PayloadEvento,
): Promise<ResultadoDecisionModificacion> {
  try {
    return await withTransaction(db, async (client): Promise<ResultadoDecisionModificacion> => {
      const { rows } = await client.query(
        `UPDATE portal.solicitud_modificaciones m
            SET estado = $2, decidida_at = now(), aprobador_user_id = $3, motivo_rechazo = $4
          -- Mismo testigo que en decidirSolicitud: el doble clic no decide dos
          -- veces. Cero filas = alguien se adelanto, y el servicio da 409.
          WHERE m.id = $1 AND m.estado = 'pendiente'
         RETURNING ${COLS_MODIFICACION}`,
        [id, aprueba ? 'aprobada' : 'rechazada', userId, motivoRechazo],
      );
      if (rows.length === 0) return { ok: false, razon: 'ya_decidida' };
      const modificacion = aModificacion(rows[0] as FilaModificacionDb);

      if (aprueba) await aplicarALaSolicitud(client, modificacion);

      // La solicitud se relee DESPUÉS de aplicarla: el correo se redacta sobre
      // exactamente lo que quedó guardado. Ya no trae `modificacionPendiente`
      // —la propuesta salió del índice único parcial al dejar de estar viva—,
      // que es justo lo que la interfaz necesita ver.
      const { rows: filas } = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [modificacion.solicitudId]);
      const solicitud = aSolicitud(filas[0] as FilaSolicitudDb);

      // Las tres condiciones, y ninguna sobra igual:
      //  - `aprueba` no es un atajo de rendimiento: rechazar no escribe nada en
      //    la solicitud, así que no puede solapar a nadie, y comprobarlo también
      //    ahí dejaría IRRECHAZABLE una propuesta que se quedó solapada —409 al
      //    jefe cada vez, y solo el solicitante podría quitarla de en medio
      //    retirándola—. Lo vigila un test de `repo.solapes.db.test.ts` escrito
      //    para esto: antes de él, quitarlo dejaba los cuatro portones en verde.
      //  - `ocupaAgenda` es la MISMA función que usan las otras tres puertas, y
      //    no una copia: pregunta si la fila que queda escrita cuenta como
      //    ausencia viva. `solicitud` viene releída, así que su tipo y su estado
      //    son los de la fila, no los que traía la petición. Sigue sin poder
      //    llamarse a `exigirSinSolape` —aquello vive en el servicio, con un
      //    `Pool` y lanzando `AusenciaError`—; lo que se comparte es la REGLA,
      //    que es lo que podía divergir. Divergió: la puerta del `PATCH` nació
      //    copiando solo la mitad del tipo. Alcanzable hoy — ese mismo `PATCH`
      //    admite cualquier tipo con cualquier estado, así que hay
      //    `incapacidad`es en `aprobada`.
      //  - la clase, en cambio, hoy no cambia el resultado por su cuenta: en toda
      //    anulación las tres columnas nuevas van a `null` —lo exige el CHECK
      //    `modificaciones_campos_por_clase` de la 024—, así que el trozo de las
      //    fechas, que pide el compilador (`Modificacion` es plana y
      //    `clase === 'fechas'` no estrecha `string | null`), ya la excluye sola.
      //    Se deja porque nombra a qué clase se aplica la regla, igual que en
      //    `pedirModificacion`, y con la misma letra pequeña: no obliga a nadie a
      //    volver aquí si mañana aparece una tercera clase con fechas.
      if (
        aprueba &&
        ocupaAgenda(solicitud.tipo, solicitud.estado) &&
        modificacion.clase === 'fechas' &&
        modificacion.fechaInicioNueva &&
        modificacion.fechaFinNueva
      ) {
        const choque = await solapeDe(
          client,
          solicitud.empleadoId,
          modificacion.fechaInicioNueva,
          modificacion.fechaFinNueva,
          // El id de la SOLICITUD, no el de la propuesta: sin esta exclusión la
          // ausencia choca SIEMPRE contra sí misma —la fila que se acaba de
          // mover ya lleva las fechas nuevas— y no se podría aprobar ni un solo
          // cambio de los que se piden de verdad.
          modificacion.solicitudId,
        );
        if (choque) throw new SolapeAlAplicar(choque);
      }

      // Anotado y no un literal suelto: el valor viaja al CHECK de `evento` de la
      // 024, y una errata reventaría DENTRO de la transacción, deshaciendo una
      // decisión que el jefe cree tomada.
      const evento: EventoModificacion = aprueba ? 'modificacion_aprobada' : 'modificacion_rechazada';
      const payload = construirPayload(solicitud, modificacion, evento);
      await client.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [modificacion.solicitudId, evento, JSON.stringify(payload)],
      );
      // Va DESPUES del INSERT y en la MISMA transaccion, igual que en
      // `decidirSolicitud`: si el evento sale, la marca cambia, y si hay ROLLBACK
      // no cambia ninguna de las dos.
      await anotarEventoDeCalendario(client, solicitud, payload);

      return { ok: true, modificacion, solicitud };
    });
  } catch (err) {
    // Los dos choques ya provocaron el ROLLBACK dentro de `withTransaction`:
    // aquí solo se traducen a un resultado, para que el servicio no tenga que
    // conocer estas clases ni distinguirlas de un fallo real.
    if (err instanceof ChoqueConLaSolicitud) return { ok: false, razon: 'solicitud_cambio_de_estado' };
    if (err instanceof SolapeAlAplicar) return { ok: false, razon: 'solape', solape: err.solape };
    throw err;
  }
}

/**
 * Las solicitudes con una propuesta VIVA que le toca decidir a este correo. Un
 * admin (`todas`) las ve todas, igual que en `solicitudesPendientes`: es quien
 * destraba una decisión bloqueada.
 *
 * Devuelve SOLICITUDES y no propuestas sueltas, y no es pereza: la propuesta por
 * sí sola no dice de quién es, ni de qué tipo, ni qué comentarios traía, así que
 * una bandeja hecha con ellas necesitaría una segunda consulta por fila. El
 * `LEFT JOIN` de `SELECT_SOLICITUD` ya la cuelga de su solicitud, y la trae
 * completa.
 *
 * El filtro va contra `m.aprobador_correo` —el decisor CONGELADO en la
 * propuesta— y no contra los firmantes de la solicitud, que es el mismo correo
 * que exige `puedeDecidirModificacion`.
 *
 * ⚠️ Eso NO basta para garantizar que todo lo que sale de aquí sea decidible por
 * quien pregunta, y no hay que intentar arreglarlo en este SQL. La RAÍZ del
 * organigrama es su propio jefe (`aprobadoresDe`), así que sobre sus propias
 * solicitudes el decisor congelado es ella misma y el guard del solicitante la
 * frena; y un admin recibe además las de todo el mundo. Quién puede decidir cada
 * fila lo decora el servicio con `puedoDecidirla`, que llama al MISMO guard que
 * el endpoint de decisión — que es lo único que impide que la bandeja ofrezca un
 * botón que responde 403.
 */
export async function modificacionesPendientes(
  db: Pool,
  aprobadorCorreo: string,
  todas: boolean,
): Promise<Solicitud[]> {
  const { rows } = await db.query(
    `${SELECT_SOLICITUD}
      -- El JOIN ya filtra por m.estado = 'pendiente': esto solo descarta las
      -- solicitudes que no tienen ninguna propuesta viva colgando.
      WHERE m.id IS NOT NULL
        AND ($2::boolean OR lower(m.aprobador_correo) = lower($1))
      ORDER BY m.created_at`,
    [aprobadorCorreo, todas],
  );
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

/**
 * El solicitante se echa atrás. La fila NO se borra: pasa a `retirada`, sale del
 * índice único parcial —así puede pedir otra— y deja el rastro de que existió.
 *
 * `decidida_at` se sella también aquí, aunque no sea una decisión del jefe: es
 * el instante en que la propuesta dejó de estar viva, y sin él no habría forma
 * de ordenar el historial de una solicitud con varios intentos.
 *
 * `AND estado = 'pendiente'` por lo mismo que el testigo del alta: si el jefe la
 * decidió mientras tanto, esto no puede pisarle la decisión. Devuelve `null` y
 * el servicio lo traduce a 409.
 *
 * No encola nada: retirar deja la solicitud exactamente como estaba, así que no
 * hay nada que comunicar a nadie.
 */
export async function retirarModificacion(db: Pool, id: string): Promise<Modificacion | null> {
  const { rows } = await db.query(
    `UPDATE portal.solicitud_modificaciones m
        SET estado = 'retirada', decidida_at = now()
      WHERE m.id = $1 AND m.estado = 'pendiente'
     RETURNING ${COLS_MODIFICACION}`,
    [id],
  );
  return rows.length ? aModificacion(rows[0] as FilaModificacionDb) : null;
}

export async function modificacionPorId(db: Pool, id: string): Promise<Modificacion | null> {
  const { rows } = await db.query(`${SELECT_MODIFICACION} WHERE m.id = $1`, [id]);
  return rows.length ? aModificacion(rows[0] as FilaModificacionDb) : null;
}

/** Los campos de una modificación que un admin puede corregir desde el registro. */
export interface CorreccionModificacion {
  /** Los tres van NULL en una anulación; lo exige el CHECK de la 024. */
  fechaInicioNueva: string | null;
  fechaFinNueva: string | null;
  diasHabilesNuevos: number | null;
  motivo: string | null;
  estado: EstadoModificacion;
}

/**
 * Corrige a mano una fila del registro de movimientos. Solo la usa el admin
 * desde «Registro general».
 *
 * ⚠️ Corrige el ASIENTO, no la solicitud. Cambiar aquí el estado de una
 * anulación de `aprobada` a `rechazada` NO desanula la solicitud: eso ya pasó, y
 * su fila propia es la que dice en qué estado quedó. Las dos son editables por
 * separado desde el mismo registro a propósito — un admin que quiera deshacer
 * de verdad una anulación tiene que tocar las dos, y este comentario existe para
 * que nadie le añada aquí un efecto lateral sobre la solicitud creyendo que
 * arregla una incoherencia. Ese efecto lateral ES la bandeja, y allí ya vive.
 *
 * `clase` NO se puede cambiar, y no es un olvido: es lo que decide qué columnas
 * pueden ir a NULL (el CHECK `modificaciones_campos_por_clase`), así que
 * convertir una anulación en un cambio de fechas exigiría inventarse unas fechas
 * nuevas. Quien se equivocó de clase borra la fila y la vuelve a pedir.
 *
 * `decidida_at` y `aprobador_user_id` tampoco: son el testigo de QUIÉN decidió y
 * CUÁNDO, y el registro existe justo para conservarlos. Editar lo que se decidió
 * es corregir un dato; editar quién lo decidió es falsificarlo.
 */
export async function corregirModificacion(
  db: Pool,
  id: string,
  campos: CorreccionModificacion,
): Promise<Modificacion | null> {
  const { rows } = await db.query(
    `UPDATE portal.solicitud_modificaciones
        SET fecha_inicio_nueva  = $2::date,
            fecha_fin_nueva     = $3::date,
            dias_habiles_nuevos = $4::numeric,
            motivo              = $5,
            estado              = $6
      WHERE id = $1
      RETURNING id`,
    [
      id,
      campos.fechaInicioNueva,
      campos.fechaFinNueva,
      campos.diasHabilesNuevos,
      campos.motivo,
      campos.estado,
    ],
  );
  if (!rows.length) return null;
  // Se relee con el SELECT común en vez de devolver el RETURNING entero: es lo
  // que garantiza que la forma sea EXACTAMENTE la misma que la del resto de
  // lecturas de modificaciones —los casts de `::text` incluidos—, y no una
  // segunda proyección que haya que mantener en paralelo.
  return modificacionPorId(db, id);
}

/**
 * Borra una fila del registro de movimientos. Irreversible.
 *
 * NO toca la solicitud. Borrar la anulación que dejó unas vacaciones anuladas
 * las deja anuladas, y sin nada que explique por qué: es lo que hace que esto
 * sea de admin y quede en el log de hub-api.
 *
 * Devuelve la fila borrada —leída ANTES del DELETE— para que quien llama pueda
 * decir en el log qué era. Después ya no hay a quién preguntárselo.
 */
export async function borrarModificacion(db: Pool, id: string): Promise<Modificacion | null> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(`${SELECT_MODIFICACION} WHERE m.id = $1`, [id]);
    if (!rows.length) return null;
    const borrada = aModificacion(rows[0] as FilaModificacionDb);
    await client.query(`DELETE FROM portal.solicitud_modificaciones WHERE id = $1`, [id]);
    return borrada;
  });
}

// ── Adjuntos ───────────────────────────────────────────────────────────────

export interface AdjuntoCompleto {
  solicitudId: string;
  solicitanteEmail: string;
  aprobadorCorreo: string | null;
  segundoAprobadorCorreo: string | null;
  nombreArchivo: string;
  mime: string;
  contenido: Buffer;
}

export async function adjuntoPorId(db: Pool, id: string): Promise<AdjuntoCompleto | null> {
  const { rows } = await db.query(
    `SELECT a.solicitud_id, s.solicitante_email, s.aprobador_correo, s.segundo_aprobador_correo,
            a.nombre_archivo, a.mime, a.contenido
       FROM portal.solicitud_adjuntos a
       JOIN portal.solicitudes_ausencia s ON s.id = a.solicitud_id
      WHERE a.id = $1`,
    [id],
  );
  if (!rows.length) return null;
  const r = rows[0] as {
    solicitud_id: string;
    solicitante_email: string;
    aprobador_correo: string | null;
    segundo_aprobador_correo: string | null;
    nombre_archivo: string;
    mime: string;
    contenido: Buffer;
  };
  return {
    solicitudId: r.solicitud_id,
    solicitanteEmail: r.solicitante_email,
    aprobadorCorreo: r.aprobador_correo,
    segundoAprobadorCorreo: r.segundo_aprobador_correo,
    nombreArchivo: r.nombre_archivo,
    mime: r.mime,
    contenido: r.contenido,
  };
}

// ── Outbox ─────────────────────────────────────────────────────────────────

/**
 * Cuánto queda reservado un evento tras servirlo. Tiene que ser holgadamente
 * mayor que lo que tarda un lote en enviarse y confirmarse (Gmail, calendario y
 * hoja, hasta 20 eventos), y menor que el barrido de 10 minutos, para que un
 * envío que se cayó de verdad se reintente en la pasada siguiente.
 */
const RESERVA = '5 minutes';

/**
 * Los eventos aún no ejecutados, del más antiguo al más nuevo.
 *
 * Sirve el evento **sin marcarlo como enviado**: el estado solo avanza en
 * `confirmarEventos`. Si Gmail falla a mitad, el evento vuelve a la cola solo. El
 * precio es que un fallo DESPUÉS de enviar el correo puede duplicarlo; se
 * prefiere un correo repetido a una solicitud que nadie ve.
 *
 * Pero servir **sí reserva**: `servido_at` lo aparta de la cola durante unos
 * minutos. Sin eso, los dos disparadores del workflow —el webhook del portal y el
 * barrido de diez minutos— pueden leer las mismas filas si arrancan con pocos
 * segundos de diferencia, porque entre servir y confirmar pasa lo que tarde el
 * envío. Ocurrió en producción: 0,7 s de separación, correo duplicado. Sobre un
 * evento `aprobada` habría sido además un evento de calendario y una fila de la
 * hoja por duplicado.
 *
 * `intentos` se incrementa aquí para poder detectar en la BD un evento que lleva
 * reintentándose sin éxito.
 */
export async function eventosPendientes(db: Pool, limite = 20): Promise<EventoPendiente[]> {
  const { rows } = await db.query(
    `UPDATE portal.ausencias_outbox o
        SET intentos = o.intentos + 1, servido_at = now()
      WHERE o.id IN (
              SELECT id FROM portal.ausencias_outbox
               WHERE enviado_at IS NULL
                 AND (servido_at IS NULL OR servido_at < now() - $2::interval)
               ORDER BY id LIMIT $1)
      RETURNING o.id, o.evento, o.solicitud_id, o.intentos, o.payload`,
    [limite, RESERVA],
  );
  // `solicitud_id` nulable desde la 028: la clave ajena es `ON DELETE SET NULL`
  // para que el borrado de un evento de Google sobreviva a la solicitud que lo
  // pidio. El cast tiene que decirlo o `tsc` se cree un `string` que puede no
  // serlo, y eso convierte un null real en un fallo en tiempo de ejecucion.
  return (rows as {
    id: string;
    evento: EventoOutbox;
    solicitud_id: string | null;
    intentos: number;
    payload: PayloadEvento;
  }[])
    .map((r) => ({
      id: Number(r.id),
      evento: r.evento,
      solicitudId: r.solicitud_id,
      intentos: r.intentos,
      payload: r.payload,
    }))
    .sort((a, b) => a.id - b.id);
}

/** Marca como enviados los ids que n8n confirma. Idempotente. */
export async function confirmarEventos(db: Pool, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await db.query(
    'UPDATE portal.ausencias_outbox SET enviado_at = now() WHERE id = ANY($1::bigint[]) AND enviado_at IS NULL',
    [ids],
  );
  return rowCount ?? 0;
}

// ── Calendario ─────────────────────────────────────────────────────────────

/** Un empleado activo, reducido a lo que la rejilla necesita para su fila. */
export interface EmpleadoActivo {
  id: string;
  nombreCompleto: string;
}

interface FilaEmpleadoActivoDb {
  id: string;
  nombre_completo: string;
}

function aEmpleadoActivo(r: FilaEmpleadoActivoDb): EmpleadoActivo {
  return { id: r.id, nombreCompleto: r.nombre_completo };
}

/**
 * Los empleados activos, para que el calendario tenga una fila por persona.
 *
 * No se reutiliza `listarEmpleados`: esa NO filtra por `activo`, así que
 * arrastraría las fichas dadas de baja —justo lo que se hace con quien deja de
 * ser empleado directo— y saldrían como filas vacías para siempre.
 */
/**
 * Los empleados activos. `soloEmpleadoId` acota a uno: es lo que ve quien no es
 * admin en el calendario. Sin valor por defecto a propósito —igual que en
 * `empleadosConSaldo`—, para que acotar o no acotar sea siempre una decisión
 * escrita en el llamante y no un olvido que enseñe la plantilla entera.
 */
/**
 * A quién alcanza el calendario de quien pregunta: SU propia fila y la de su
 * rama de dos niveles. Con el parámetro a NULL no acota nada, que es lo que
 * necesitan un administrador y quien tenga `ve_toda_la_empresa`.
 *
 * Envuelve `ramaDeDosNiveles()` en vez de reescribirla: la definición de «mi
 * rama» tiene que seguir siendo la MISMA que la del registro de movimientos y
 * la de los saldos, y una copia divergente no lanza — solo enseña las ausencias
 * de gente que no es de quien mira. Lo único que añade es el «y yo», que el
 * recorte por rama no incluye: `aprobador_correo` de uno apunta a su jefe, no a
 * uno mismo, así que sin este OR un jefe vería el calendario de su equipo y no
 * el suyo.
 *
 * ⚠️ Lo usan DOS consultas —las filas y las marcas— y tienen que decir
 * exactamente lo mismo. Si discreparan no fallaría nada: saldría una persona sin
 * marcas, o marcas de alguien que no tiene fila y que por tanto no se pintan.
 * Por eso está aquí y no copiado en cada una.
 *
 * Hereda de `ramaDeDosNiveles` las dos condiciones de uso: `$1` es SIEMPRE el
 * primer parámetro de la consulta que lo incrusta, y la tabla `portal.empleados`
 * va aliasada como `e`.
 */
export function alcanceDelCalendario(): string {
  return `(${ramaDeDosNiveles()} OR lower(e.correo) = lower($1))`;
}

export async function empleadosActivos(db: Pool, soloDe: string | null): Promise<EmpleadoActivo[]> {
  const { rows } = await db.query(
    // Aliasada como `e` porque lo exige el fragmento que se incrusta debajo.
    `SELECT e.id, e.nombre_completo FROM portal.empleados e
      WHERE e.activo AND ${alcanceDelCalendario()}
      ORDER BY e.nombre_completo`,
    [soloDe],
  );
  return (rows as FilaEmpleadoActivoDb[]).map(aEmpleadoActivo);
}

interface FilaAusenciaRangoDb {
  empleado_id: string;
  tipo: TipoSolicitud;
  estado: Solicitud['estado'];
  fecha_inicio: string;
  fecha_fin: string;
}

function aAusenciaRango(r: FilaAusenciaRangoDb): AusenciaRango {
  return {
    empleadoId: r.empleado_id,
    tipo: r.tipo,
    estado: r.estado,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
  };
}

/**
 * Las ausencias que SOLAPAN con el rango, no las contenidas en él.
 *
 * La condición natural (`fecha_inicio >= desde AND fecha_fin <= hasta`) perdería
 * exactamente las que cruzan el cambio de mes, que son las que más importa ver:
 * un mes que no las enseña miente sobre quién está fuera el día 1.
 */
export async function ausenciasEntre(
  db: Pool,
  soloDe: string | null,
  desde: string,
  hasta: string,
): Promise<AusenciaRango[]> {
  const { rows } = await db.query(
    `SELECT s.empleado_id, s.tipo, s.estado,
            s.fecha_inicio::text AS fecha_inicio,
            s.fecha_fin::text    AS fecha_fin
       FROM portal.solicitudes_ausencia s
       JOIN portal.empleados e ON e.id = s.empleado_id
      WHERE e.activo
        AND s.estado <> 'rechazada'
        -- Un otorgamiento no es una ausencia: su fecha es el dia que se trabajo
        -- de mas, y pintarlo aqui diria que esa persona NO estuvo justo el dia
        -- que si estuvo. El filtro va en el SQL y no en el frontend porque el
        -- calendario del portal no filtra nada por su cuenta: pinta lo que le
        -- llega, ya expandido por dia.
        AND s.tipo <> 'otorgamiento'
        -- El MISMO alcance que empleadosActivos, y por eso compartido: si los
        -- dos discreparan saldrian marcas de gente sin fila (invisibles) o
        -- filas sin marcas, y ninguna de las dos cosas falla.
        --
        -- Sin comillas invertidas en este comentario a proposito: vive DENTRO
        -- del template literal de la consulta y una sin escapar lo cierra a
        -- mitad de frase. Ya paso una vez, en la consulta de movimientos.
        AND ${alcanceDelCalendario()}
        AND s.fecha_inicio <= $3::date
        AND s.fecha_fin    >= $2::date
      -- Determinismo del pintado, no estética: dos ausencias solapadas del
      -- mismo empleado producen dos marcas para el mismo (empleadoId, fecha), y
      -- el frontend arma un Map con esa clave, así que gana la última. Sin este
      -- ORDER BY, cuál de las dos "gana" podría cambiar entre peticiones.
      ORDER BY s.fecha_inicio, s.id`,
    // `soloDe` como PRIMER parámetro, siempre: es la regla que imponen
    // `ramaDeDosNiveles` y el fragmento que lo envuelve. Las fechas se corrieron
    // a $2 y $3 por eso, no por gusto.
    [soloDe, desde, hasta],
  );
  return (rows as FilaAusenciaRangoDb[]).map(aAusenciaRango);
}

/** Una ausencia viva que se cruza con un rango. Lo justo para redactar el aviso. */
export interface Solape {
  id: string;
  tipo: TipoSolicitud;
  estado: Solicitud['estado'];
  fechaInicio: string;
  fechaFin: string;
}

/**
 * Qué cuenta como ausencia VIVA, escrito una sola vez.
 *
 * Quedan dos exclusiones y ninguna es la incapacidad. La del ESTADO: una
 * rechazada no concedió ni un día, así que no ocupa nada. La del TIPO: un
 * otorgamiento no es una ausencia, y el porqué está en el cuerpo. La del estado
 * es la que se escapa con facilidad —se lee como una condición de tipo y no lo
 * es, y en el `WHERE` de `solapeDe` va suelta entre las otras—, y escaparse le
 * costó a la puerta del `PATCH` dejar INMODIFICABLE cualquier rechazada con una
 * ausencia viva encima, que es el caso corriente de a quien le rechazan unos
 * días y los vuelve a pedir.
 *
 * ⚠️ La incapacidad SÍ ocupa agenda desde el 2026-08-21, y antes NO. Estuvo
 * exenta a propósito —«una incapacidad no se pide, se informa después de haber
 * estado enfermo»—: se registraba encima de lo que fuera y tampoco frenaba a
 * nadie. Ese mismo día se probó la versión intermedia, dejarla pasar avisando
 * del choque, y se decidió lo contrario. El motivo del bloqueo no es la
 * enfermedad, es el REGISTRO: una baja encima de unas vacaciones aprobadas deja
 * los mismos días contados dos veces, y de ese recuento salen el saldo, la
 * nómina y el calendario. El aviso dejaba la contradicción escrita y confiaba en
 * que alguien la arreglara después; negar el alta obliga a arreglarla antes, que
 * es el único momento en que quien informa la baja tiene las dos solicitudes
 * delante.
 *
 * La exención se quitó SIMÉTRICA a propósito: ni la frenan las demás ni frena
 * ella a las demás. Bloquearla sólo cuando es la fila que se escribe, y seguir
 * ignorándola cuando es la que ya estaba debajo, sería una regla que contesta
 * distinto según cuál de las dos ausencias se registre primero.
 *
 * La llaman los tres sitios que comprueban un solape antes de dejar la fila
 * escrita —`exigirSinSolape` en el servicio (el alta y la propuesta),
 * `decidirModificacion` y `actualizarSolicitud` aquí—, y siempre sobre la fila
 * que van a dejar: la que no ocupa agenda no puede chocar con nadie, y
 * comprobarla igualmente niega correcciones legítimas.
 *
 * Quedan DOS reescrituras que el compilador no puede atar a esta, y no están en
 * la misma situación, por más que las tres tengan que decir lo mismo:
 *
 *  - El `WHERE` de `solapeDe` dice esto en SQL, y **lo vigila** el cuarto
 *    portón: ejecuta contra Postgres de verdad en `repo.solapes.db.test.ts`,
 *    con un test que fija que una incapacidad SÍ sale de esa consulta y dos para
 *    la mitad del estado (la rechazada y la anulada, que es una rechazada con
 *    marca).
 *  - El doble in-memory de `router.test.ts` **no vigila: replica**. Ese fichero
 *    hace `vi.mock('./repo.js')` y reimplementa esta función, así que el
 *    servicio bajo prueba nunca llega a ejecutar ESTA.
 *
 * De donde sale la consecuencia que hay que tener delante antes de tocar la
 * línea de abajo: **romper esta regla no pone rojo el portón rápido.**
 *
 * Que no lo vigile el portón rápido NO significa que no lo vigile nada: el cuarto
 * portón es un step BLOQUEANTE del CI (`ci.yml`, «Tests contra Postgres real»).
 * Lo que se puede romper en silencio es la máquina de quien edita, no la rama.
 *
 * Y de ahí lo que hoy NO está acreditado: las dos puertas que viven en el
 * servicio —el alta y la propuesta— se prueban de sobra, pero contra la copia
 * del doble. Nada comprueba que ejecuten la MISMA regla que las otras dos; el
 * CANDADO de la superficie de `router.test.ts` solo exige que esta función se
 * exporte, no que diga lo mismo.
 *
 * ⚠️ NO confundir con `estaEnElCalendario` (`types.ts`). Esta pregunta si la fila
 * RESERVA días; aquella, si la fila tiene evento en Google. Que desde el
 * 2026-08-21 las dos digan «sí» sobre una incapacidad no las ha unificado:
 * siguen discrepando en las dos direcciones —una `pendiente` ocupa agenda y no
 * está en Google, y un otorgamiento `aprobada` está en Google y no ocupa
 * agenda—, y contestar una con la otra es la forma exacta que tuvo el bug de la
 * cuarta puerta del solapamiento.
 */
export function ocupaAgenda(tipo: TipoSolicitud, estado: Solicitud['estado']): boolean {
  // El otorgamiento es la única exclusión por tipo que queda, y se sostiene por
  // una razón que a la incapacidad nunca le valió: no es una ausencia en
  // absoluto — su fecha es la del día que se TRABAJÓ de más.
  //
  // Sin este corte, la regla de solapes bloquearía justo el caso más típico:
  // pedir el compensatorio por un sábado trabajado DURANTE las propias
  // vacaciones chocaría contra esas mismas vacaciones.
  return !esOtorgamiento(tipo) && estado !== 'rechazada';
}

/**
 * La primera ausencia VIVA de esta persona que se cruza con el rango, o `null`.
 *
 * El predicado de fechas es el mismo que usa `ausenciasEntre` —solapa, no
 * contiene—, pero es el mismo predicado dentro de una pregunta distinta:
 * aquella une con `empleados` y filtra por `e.activo`, no filtra por `tipo`, y
 * su `soloEmpleadoId` admite `null` para no acotar. Esta no mira
 * `empleados.activo` porque la pregunta ya es sobre una persona concreta, no
 * sobre a quién pintar en un calendario.
 *
 * `LIMIT 1` porque el mensaje solo puede nombrar una colisión; buscarlas todas
 * sería trabajo que nadie lee.
 *
 * Las dos condiciones de «viva» de su `WHERE` —`estado <> 'rechazada'` y
 * `tipo <> 'otorgamiento'`— son `ocupaAgenda` escrito en SQL, y su porqué está
 * allí y no aquí. Quien tenga que hacerse la misma pregunta desde TypeScript
 * llama a aquella función; aquí no se puede.
 *
 * ⚠️ Las dos definiciones tienen que decir LO MISMO, y ninguna vigila a la otra:
 * el compilador no las relaciona, y un filtro que sobre o que falte de este lado
 * sólo se nota por las puertas que pasan por el SQL. De ahí que este `WHERE` ya
 * NO lleve `tipo <> 'incapacidad'`: lo llevó hasta el 2026-08-21, cuando una
 * incapacidad ni ocupaba ni la frenaba nadie, y se quitó A LA VEZ de aquí y de
 * `ocupaAgenda` —el porqué del cambio, entero allí—. Devolverlo a un solo sitio
 * deja la regla contestando distinto según por dónde se entre: quitarlo sólo de
 * la función deja el alta pasando y la consulta sin encontrar nada, y quitarlo
 * sólo del `WHERE` deja el alta comprobando una condición que la consulta ya no
 * puede satisfacer.
 *
 * ⚠️ El filtro de estado —`estado <> 'rechazada'`— es el mismo filtro que en
 * `ausenciasEntre`; lo que se invierte no es el filtro sino la
 * CONSECUENCIA de que falle en abierto: un estado nuevo que nadie añada a la
 * lista entra igual por los dos lados, pero aquí eso cuenta como ocupado y
 * bloquea de más —lo reporta un usuario el mismo día—, mientras que allí se
 * pintaría de más y eso no lo nota nadie.
 *
 * `excluirSolicitudId` es imprescindible al mover fechas: sin él, una solicitud
 * chocaría siempre contra ella misma. El alta pasa `null` porque todavía no hay
 * fila.
 *
 * Acepta `PoolClient` además de `Pool` para poder llamarse DENTRO de la
 * transacción que aplica un cambio de fechas: por esa misma conexión la
 * comprobación ve lo que la propia transacción ya escribió sin confirmar
 * —una consulta por el `Pool` no lo vería— y se deshace con el mismo
 * `ROLLBACK`. Lo que **no** da es un snapshot compartido: `BEGIN` pelado es
 * READ COMMITTED, y ahí cada sentencia toma el suyo. La ventana de carrera
 * tampoco se cierra —este `SELECT` no lleva `FOR UPDATE`—, y dos altas
 * simultáneas la pasan las dos. Cerrarla del
 * todo pediría un candado en la BD, como el índice único parcial de la 024
 * hace con las propuestas. Se decidió no ponerlo: la restricción falla al
 * aplicarse si hay datos que ya la incumplen, y los hay: comprobado el
 * 2026-08-18 contra producción, un empleado tiene vacaciones aprobadas del 10
 * al 14 de agosto de 2026 y un permiso aprobado el 14. Y desde el 2026-08-21 hay
 * más, por construcción: toda incapacidad informada encima de otra ausencia
 * mientras la exención existía sigue en la tabla, y es justo lo que la regla
 * nueva prohíbe.
 */
export async function solapeDe(
  db: Pool | PoolClient,
  empleadoId: string,
  fechaInicio: string,
  fechaFin: string,
  excluirSolicitudId: string | null,
): Promise<Solape | null> {
  const { rows } = await db.query(
    `SELECT id, tipo, estado,
            fecha_inicio::text AS fecha_inicio,
            fecha_fin::text    AS fecha_fin
       FROM portal.solicitudes_ausencia
      WHERE empleado_id = $1
        AND estado <> 'rechazada'
        -- El otorgamiento no es una ausencia: su fecha es el dia trabajado. Sin
        -- esta linea, pedir el compensatorio por un sabado trabajado DURANTE las
        -- propias vacaciones chocaria contra esas mismas vacaciones.
        AND tipo   <> 'otorgamiento'
        AND ($4::uuid IS NULL OR id <> $4)
        AND fecha_inicio <= $3::date
        AND fecha_fin    >= $2::date
      ORDER BY fecha_inicio, id
      LIMIT 1`,
    [empleadoId, fechaInicio, fechaFin, excluirSolicitudId],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as {
    id: string;
    tipo: TipoSolicitud;
    estado: Solicitud['estado'];
    fecha_inicio: string;
    fecha_fin: string;
  };
  return { id: r.id, tipo: r.tipo, estado: r.estado, fechaInicio: r.fecha_inicio, fechaFin: r.fecha_fin };
}

/**
 * Si esta persona ya tiene VIVO un otorgamiento por ese mismo día trabajado.
 *
 * Pregunta aparte, y no una condición más dentro de `solapeDe`, porque son dos
 * reglas que no se pueden fundir sin romper una de las dos. Un otorgamiento SÍ
 * puede caer encima de unas vacaciones —su fecha es el día que se TRABAJÓ, y
 * trabajar un sábado durante las propias vacaciones es el caso más típico que
 * hay—, y por eso está exento de `ocupaAgenda`. Pero esa exención dejaba abierto
 * reclamar DOS veces la misma jornada, que concede el doble de días por un solo
 * día de trabajo. De ahí una regla propia y estrecha: solo contra otro
 * otorgamiento, solo del mismo día.
 *
 * `estado <> 'rechazada'` por lo mismo que en `solapeDe`: a quien le nieguen la
 * concesión tiene que poder volver a pedirla. Y una anulación aprobada deja la
 * fila `rechazada`, así que también libera el día.
 *
 * Compara `fecha_inicio` a secas y no un rango porque un otorgamiento es SIEMPRE
 * de un solo día: lo garantiza `otorgamiento_un_solo_dia` en el servicio, que es
 * quien valida antes de llegar aquí.
 *
 * `excluirSolicitudId` existe por lo mismo que en `solapeDe`: al corregir una
 * fila, sin él chocaría contra ella misma.
 */
export async function existeOtorgamientoDelDia(
  db: Pool | PoolClient,
  empleadoId: string,
  fecha: string,
  excluirSolicitudId: string | null,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1
       FROM portal.solicitudes_ausencia
      WHERE empleado_id = $1
        AND tipo   = 'otorgamiento'
        AND estado <> 'rechazada'
        AND fecha_inicio = $2::date
        AND ($3::uuid IS NULL OR id <> $3)
      LIMIT 1`,
    [empleadoId, fecha, excluirSolicitudId],
  );
  return rows.length > 0;
}

// ── El registro de movimientos ─────────────────────────────────────────────

/**
 * Las columnas que TODA fila del registro trae, con los mismos alias venga de
 * la tabla que venga.
 *
 * Alias comunes y no los nombres nativos de cada tabla, por lo mismo que el
 * prefijo `mod_` de `COLS_MODIFICACION`: con un solo juego de nombres un único
 * mapa sirve para las dos consultas, y la segunda no se puede desviar de la
 * primera sin que el compilador lo vea.
 *
 * `estado` NO está aquí, y es la única ausencia deliberada: es justo lo que
 * distingue a las dos clases —en una solicitud es `EstadoSolicitud`, en una
 * modificación `EstadoModificacion`— y meterlo aquí con la unión de los dos
 * anularía la garantía que `Movimiento` compra al discriminar por `clase`.
 */
interface FilaMovimientoDb {
  id: string;
  solicitud_id: string;
  empleado_nombre: string;
  empleado_cargo: string | null;
  solicitante_email: string;
  tipo: TipoSolicitud;
  fecha_inicio: string;
  fecha_fin: string;
  dias_habiles: number;
  decidida_at: string | null;
  /** Del `LEFT JOIN` con `portal.users`: null si no hubo decisor de verdad. */
  decisor_nombre: string | null;
  decisor_correo: string | null;
  /** El congelado en el alta: quién DEBÍA firmar, que no es quién firmó. */
  aprobador_correo: string | null;
  /** El SEGUNDO firmante congelado. `null` = la cadena tenía una sola firma. */
  segundo_aprobador_correo: string | null;
  /** Cuándo firmó el jefe inmediato. NULA con la solicitud ya cerrada NO es un
   *  hueco: significa que cerró el segundo. Ver `correoDelQueCerro`. */
  primera_firma_at: string | null;
  created_at: string;
  motivo: string | null;
}

/**
 * Cuál de los DOS firmantes congelados tomó la decisión final. Se llama solo
 * con `decidida_at` puesta: lo garantiza el respaldo de `quienDecidio`.
 *
 * Solo la usa ese respaldo, el `aproximado`: cuando hay decisor de verdad no
 * hay nada que deducir. Hasta el 2026-08-20 devolvía siempre `aprobador_correo`,
 * y en una solicitud con cascada cerrada en el segundo nivel eso nombraba al
 * jefe inmediato por un acto del segundo — una persona real, con nombre y
 * apellidos, que no fue. Un hueco es peor de leer que un nombre, pero mucho
 * menos grave que un nombre equivocado.
 *
 * ⚠️ **No vale `correoDelTurno` (types.ts), aunque parezca la misma pregunta.**
 * Aquella contesta a quién le toca firmar AHORA y devuelve `null` en todos los
 * estados terminales — y aquí toda fila que llega está cerrada. Con el
 * `?? aprobadorCorreo` de `decisorDeModificacion` colapsaría al primer firmante
 * SIEMPRE, que es exactamente el fallo que esto arregla. Las dos preguntas se
 * parecen y no son la misma: una mira el turno VIVO, esta un turno ya cerrado.
 *
 * La condición es «hay segundo firmante Y la primera firma NO es el mismo acto
 * que la decisión final». Los dos valores de `primera_firma_at` que la cumplen
 * llegan por caminos distintos, y ninguno de los dos se ve a simple vista:
 *
 *  - **Distinta de `decidida_at`**: dos actos, dos transacciones, dos `now()`.
 *    Firmó el jefe y cerró el segundo. Lo contrario —las dos marcas IGUALES—
 *    es una sola firma cerrándolo todo en la misma sentencia, y ahí entra el
 *    caso traicionero: el jefe inmediato RECHAZANDO una solicitud que sí
 *    llevaba cascada (`transicionAlDecidir`, rama `pendiente` + rechazo, con
 *    `esPrimeraFirma` y `esDecisionFinal` a la vez). Decidió el primero.
 *  - **NULA**: eso NO es un dato que falte, es un cierre en `pendiente_2` sin
 *    primera firma, y solo puede significar que decidió el segundo.
 *    `decidirSolicitud` es el ÚNICO escritor de `decidida_at` sobre
 *    `portal.solicitudes_ausencia` —ni `crearSolicitud`, ni
 *    `importarHistorico`, ni `actualizarSolicitud`, ni `aplicarALaSolicitud`
 *    la tocan—, y todo cierre que sale de `pendiente` lleva `esPrimeraFirma`,
 *    que sella la otra marca en el mismo UPDATE. Así que la combinación
 *    «cerrada y sin primera firma» solo la produce un camino: un admin que
 *    corrige el estado a `pendiente_2` para destrabar la solicitud
 *    —`validarEdicionSolicitud` admite la lista `ESTADOS` entera a propósito—
 *    y un segundo firmante que la cierra. Exigir aquí `primera_firma_at`
 *    no nula le colgaba esa decisión al jefe inmediato, que no la vio nunca.
 *
 * Comparar los dos `::text` es exacto y no una heurística: salen del mismo cast
 * en la misma consulta, así que o son la misma cadena o el sello ocurrió en dos
 * transacciones distintas (`now()` es `transaction_timestamp()`, constante
 * dentro de una).
 *
 * ⚠️ Los dos campos se leen con `?? null` y no directamente, y eso es una
 * trampa desarmada, no una manía. Las filas llegan aquí por un `as` desde el
 * driver, y la consulta de las modificaciones —otra clase de movimiento, otra
 * tabla, y ninguna de estas dos columnas— dejaría `undefined` en ellas. Como
 * `undefined !== null` es `true`, sin normalizar una modificación decidida sin
 * sesión entraría por la rama del segundo firmante, devolvería `undefined`, y
 * el `if (correo)` de `quienDecidio` lo convertiría en un hueco: perdería su
 * decisor EN SILENCIO. Es la misma forma de fallo contra la que avisa
 * `PayloadEvento` a cuenta de los campos ausentes.
 */
function correoDelQueCerro(r: FilaMovimientoDb): string | null {
  const segundoFirmante = r.segundo_aprobador_correo ?? null;
  const primeraFirmaAt = r.primera_firma_at ?? null;
  const cerroElSegundo = segundoFirmante !== null && primeraFirmaAt !== r.decidida_at;
  return cerroElSegundo ? segundoFirmante : r.aprobador_correo;
}

/**
 * Quién tomó la decisión, con la marca de si consta o se deduce.
 *
 * Las tres ramas son las que documenta `DecididaPor` (types.ts); aquí van sus
 * porqués operativos. Vive suelta porque es la única parte del mapeo que las
 * dos clases de movimiento comparten palabra por palabra.
 */
function quienDecidio(r: FilaMovimientoDb, estado: Solicitud['estado'] | EstadoModificacion): DecididaPor | null {
  // ⚠️ Con `retirada`, SIEMPRE null, y la guarda va la PRIMERA para que ninguna
  // rama de abajo se le adelante: una retirada la quita el propio solicitante
  // —quién fue ya consta en `solicitanteEmail`—, así que rellenar esto con el
  // `aprobador_correo` congelado en el alta atribuiría el acto a alguien que no
  // lo hizo. Desde aquí hoy es inalcanzable: una SOLICITUD nunca está
  // `retirada`, ese estado es de las modificaciones. Se deja puesta igual
  // porque esta función es la que van a compartir las dos clases, y añadir la
  // guarda después —cuando ya haya filas que la necesiten— es exactamente cómo
  // se cuela una atribución falsa sin que nada se ponga rojo.
  if (estado === 'retirada') return null;
  // Decisor REAL: `aprobador_user_id` resolvió a una fila de `portal.users`.
  // Basta con mirar el correo: `email` es NOT NULL en esa tabla, así que solo
  // llega null cuando el LEFT JOIN no encontró a nadie.
  if (r.decisor_correo) return { nombre: r.decisor_nombre, correo: r.decisor_correo, aproximado: false };
  // Sin usuario pero con la decisión sellada: sesión con token legacy. Lo único
  // que queda es el correo de quien DEBÍA firmar —un admin pudo destrabarla en
  // su lugar—, y `aproximado` es lo que impide que la pantalla lo enseñe como
  // una autoría probada.
  //
  // CUÁL de los dos firmantes lo decide `correoDelQueCerro`, y no una lectura
  // directa de `aprobador_correo`: en una cascada cerrada en el segundo nivel
  // ese campo es el jefe inmediato, que no fue. Es la misma clase de mentira
  // que evita la guarda de `retirada` de aquí arriba —nombrar a quien no fue—,
  // solo que por el otro camino.
  if (r.decidida_at) {
    const correo = correoDelQueCerro(r);
    if (correo) return { nombre: null, correo, aproximado: true };
  }
  // En trámite: no ha decidido nadie todavía, y así hay que enseñarlo.
  return null;
}

/**
 * Los campos que las dos clases rellenan igual. Sin `clase` ni `estado`: esos
 * los pone cada clase con sus propios literales, y es lo que permite construir
 * la unión discriminada sin un `as Movimiento` que anularía la garantía.
 *
 * El tipo de retorno se deja INFERIR a propósito: `MovimientoBase` no se
 * exporta (types.ts), así que anotarlo aquí obligaría a exportarla o a escribir
 * un `Omit<>` sobre la unión que se lee peor que el objeto que hay debajo.
 */
function camposComunesDelMovimiento(r: FilaMovimientoDb, estado: Solicitud['estado'] | EstadoModificacion) {
  return {
    id: r.id,
    solicitudId: r.solicitud_id,
    empleadoNombre: r.empleado_nombre,
    empleadoCargo: r.empleado_cargo,
    solicitanteEmail: r.solicitante_email,
    tipo: r.tipo,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
    diasHabiles: r.dias_habiles,
    decididaAt: r.decidida_at,
    decididaPor: quienDecidio(r, estado),
    createdAt: r.created_at,
    motivo: r.motivo,
  };
}

/**
 * Una fila de la consulta de solicitudes: lo común más SU estado, SU
 * `anulada_at` y SUS `observaciones`.
 *
 * Las dos últimas van aquí y no en `FilaMovimientoDb`: solo la consulta de
 * solicitudes las selecciona (ver `movimientosDeSolicitudes`), y la de
 * modificaciones no tiene nada parecido que mapear.
 */
interface FilaMovimientoSolicitudDb extends FilaMovimientoDb {
  estado: Solicitud['estado'];
  anulada_at: string | null;
  observaciones: string | null;
}

/**
 * Una solicitud, ya como fila del registro.
 *
 * `clase: 'solicitud'` es un literal de TypeScript y no `r.clase`: es AQUÍ
 * donde el compilador comprueba que este objeto encaja en una de las dos ramas
 * de `Movimiento` —la que lleva `EstadoSolicitud`— y por eso no hace falta
 * ningún cast. Leerlo de la fila movería esa comprobación a una promesa sobre
 * lo que devuelve Postgres, que no verifica nadie.
 *
 * `anuladaAt` y `observaciones` se mapean AQUÍ y no en
 * `camposComunesDelMovimiento`, por la misma razón que viven en esta única
 * rama de `Movimiento`: no son campos comunes, son de la solicitud.
 */
function comoMovimientoDeSolicitud(r: FilaMovimientoSolicitudDb): Movimiento {
  return {
    ...camposComunesDelMovimiento(r, r.estado),
    clase: 'solicitud',
    estado: r.estado,
    anuladaAt: r.anulada_at,
    observaciones: r.observaciones,
  };
}

/**
 * Las solicitudes como movimientos: TODAS, en cualquier estado.
 *
 * Sin filtro por estado a propósito. El registro es un registro y no un archivo
 * de cerradas: una en trámite tiene que verse, con la decisión vacía —
 * `quienDecidio` devuelve `null` y la pantalla la pinta como pendiente—.
 *
 * Tampoco lleva `ORDER BY`: el orden lo pone `movimientos`, que mezcla esta
 * lista con la de las modificaciones. Ordenar aquí sería un orden que la mezcla
 * deshace.
 */
async function movimientosDeSolicitudes(db: Pool, soloDe: string | null): Promise<Movimiento[]> {
  const { rows } = await db.query(
    // Los casts NO son estilo, y son los mismos que explica `SELECT_SOLICITUD`:
    // sin `::float8` un NUMERIC llega como STRING —y "5.0" rompe la aritmética
    // de los contadores y del CSV—, y sin `::text` un DATE o un timestamptz
    // llega como objeto Date, con lo que cualquier comparación lexicográfica
    // contra una cadena falla EN SILENCIO.
    //
    // `clase` viaja en la fila aunque el mapeo no la lea: hace que la consulta
    // se pueda ejecutar suelta en un psql y se entienda sin el TypeScript al
    // lado. Quien discrimina la unión es el literal de
    // `comoMovimientoDeSolicitud`, y está allí y no aquí a propósito: si esta
    // constante y ese literal se desviaran, mapear desde la fila daría una
    // unión mentirosa que el compilador no podría cazar.
    `SELECT s.id, 'solicitud'::text AS clase, s.id AS solicitud_id,
            e.nombre_completo AS empleado_nombre, e.cargo AS empleado_cargo,
            s.solicitante_email, s.tipo,
            s.fecha_inicio::text AS fecha_inicio, s.fecha_fin::text AS fecha_fin,
            s.dias_habiles::float8 AS dias_habiles,
            s.estado, s.decidida_at::text AS decidida_at,
            -- ::text por lo mismo que las fechas de arriba: sin el, un
            -- timestamptz llega como objeto Date y chipDeSolicitud (dominio.ts
            -- del portal) compararia contra el de una anulada en falso.
            --
            -- Sin comillas invertidas a proposito: esta linea vive DENTRO del
            -- template literal de la consulta, y una comilla invertida sin
            -- escapar lo cerraria a mitad de frase.
            s.anulada_at::text AS anulada_at,
            -- Sin cast: observaciones ya es TEXT en la tabla, no timestamptz
            -- ni NUMERIC como las columnas de arriba que si lo llevan.
            s.observaciones,
            -- full_name y email son los nombres reales de las columnas de
            -- portal.users (migracion 001). Ahi no hay ninguna columna "name".
            u.full_name AS decisor_nombre, u.email AS decisor_correo,
            -- Los tres los lee el respaldo de quienDecidio, y hacen falta los
            -- tres: con cascada, quien cerro en el segundo nivel NO es el
            -- aprobador_correo congelado en el alta. Ver correoDelQueCerro.
            s.aprobador_correo, s.segundo_aprobador_correo,
            s.primera_firma_at::text AS primera_firma_at,
            s.created_at::text AS created_at,
            s.comentarios AS motivo
       FROM portal.solicitudes_ausencia s
       JOIN portal.empleados e ON e.id = s.empleado_id
       -- LEFT: en las sesiones con token legacy aprobador_user_id es NULL, y un
       -- JOIN normal borraria del registro justo las solicitudes cuya autoria
       -- peor consta.
       LEFT JOIN portal.users u ON u.id = s.aprobador_user_id
      WHERE ${ramaDeDosNiveles()}`,
    // `soloDe` como PRIMER parámetro, siempre: es la regla que impone
    // `ramaDeDosNiveles` para no tener que sincronizar un número con una
    // posición.
    [soloDe],
  );
  return (rows as FilaMovimientoSolicitudDb[]).map(comoMovimientoDeSolicitud);
}

/** Una fila de la consulta de modificaciones: lo común, SU estado y SU clase. */
interface FilaMovimientoModificacionDb extends FilaMovimientoDb {
  clase: ClaseModificacion;
  estado: EstadoModificacion;
}

/**
 * Una modificación, ya como fila del registro.
 *
 * Aquí `clase` SÍ se lee de la fila, al revés que en
 * `comoMovimientoDeSolicitud`, y no es una incoherencia: esta consulta trae dos
 * clases —`fechas` y `anulacion`— y un literal solo puede nombrar una. Lo que
 * sostiene el tipo es que `ClaseModificacion` son exactamente esos dos
 * literales, los mismos que la rama de modificación de `Movimiento`, y que el
 * CHECK `clase IN ('fechas','anulacion')` de la 024 impide que la columna
 * contenga otra cosa. Sin ese CHECK, el `as` de abajo sería una promesa sobre
 * Postgres que no verifica nadie.
 */
function comoMovimientoDeModificacion(r: FilaMovimientoModificacionDb): Movimiento {
  return { ...camposComunesDelMovimiento(r, r.estado), clase: r.clase, estado: r.estado };
}

/**
 * Las modificaciones como movimientos: solo las YA CERRADAS.
 *
 * `m.estado <> 'pendiente'` y no una lista de estados: `retirada` entra, aunque
 * no la decidiera ningún jefe —la echó atrás el solicitante—, porque forma
 * parte del rastro de la solicitud. Su decisor va a `null`, y de eso se encarga
 * la primera guarda de `quienDecidio`.
 *
 * La viva se queda FUERA a propósito, y no por ahorrarse una fila: el `LEFT
 * JOIN` de `SELECT_SOLICITUD` ya la cuelga de su solicitud
 * (`modificacionPendiente`), así que meterla además como movimiento propio la
 * contaría dos veces en pantalla. Y esa duplicidad no rompe nada: solo suma.
 *
 * Sin `ORDER BY`, por lo mismo que la consulta de las solicitudes: el orden lo
 * pone la mezcla de `movimientos`, y ordenar aquí sería un orden que ella
 * deshace.
 */
async function movimientosDeModificaciones(db: Pool, soloDe: string | null): Promise<Movimiento[]> {
  const { rows } = await db.query(
    // Los mismos casts, y por los mismos motivos, que la consulta de las
    // solicitudes: `::float8` para que un NUMERIC no llegue como STRING, y
    // `::text` para que un DATE o un timestamptz no llegue como objeto Date.
    `SELECT m.id, m.clase::text AS clase, m.solicitud_id,
            e.nombre_completo AS empleado_nombre, e.cargo AS empleado_cargo,
            -- El congelado en la PROPUESTA: quien pidio el cambio. Puede no ser
            -- el de la solicitud si la ficha cambio de correo entre medias.
            m.solicitante_email, s.tipo,
            -- ⚠️ El COALESCE no es cosmetico. En una anulacion las tres columnas
            -- "nuevas" van a NULL -lo exige el CHECK modificaciones_campos_por_clase
            -- de la 024-, asi que sus fechas EFECTIVAS son las previas. Leyendo
            -- solo las nuevas, toda anulacion saldria sin fechas ni dias: una
            -- fila que dice que se anularon unos dias pero no cuales.
            COALESCE(m.fecha_inicio_nueva, m.fecha_inicio_previa)::text AS fecha_inicio,
            COALESCE(m.fecha_fin_nueva, m.fecha_fin_previa)::text       AS fecha_fin,
            COALESCE(m.dias_habiles_nuevos, m.dias_habiles_previos)::float8 AS dias_habiles,
            m.estado, m.decidida_at::text AS decidida_at,
            u.full_name AS decisor_nombre, u.email AS decisor_correo,
            -- ⚠️ El aprobador congelado va SOLO, sin segundo_aprobador_correo ni
            -- primera_firma_at: una modificacion la decide UNA sola persona, no
            -- hay cascada que deducir. Los dos campos ausentes los lee
            -- correoDelQueCerro con "?? null" justo para esto, y esa
            -- normalizacion es lo unico que impide que la rama del segundo
            -- firmante se dispare aqui con undefined y pierda el decisor EN
            -- SILENCIO. No anadirlos: traerlos reactivaria la regla de la
            -- cascada donde no aplica.
            m.aprobador_correo,
            m.created_at::text AS created_at,
            -- El motivo del CAMBIO, no los comentarios de la solicitud.
            m.motivo
       FROM portal.solicitud_modificaciones m
       -- La solicitud hace falta para el tipo y para llegar al empleado: la
       -- propuesta no guarda ninguno de los dos.
       JOIN portal.solicitudes_ausencia s ON s.id = m.solicitud_id
       JOIN portal.empleados e ON e.id = s.empleado_id
       -- LEFT por lo mismo que en las solicitudes: con token legacy
       -- aprobador_user_id es NULL, y un JOIN normal borraria del registro justo
       -- las filas cuya autoria peor consta.
       LEFT JOIN portal.users u ON u.id = m.aprobador_user_id
      WHERE m.estado <> 'pendiente'
        AND ${ramaDeDosNiveles()}`,
    // `soloDe` como PRIMER parámetro, igual que en la otra consulta: es la regla
    // que impone `ramaDeDosNiveles`.
    [soloDe],
  );
  return (rows as FilaMovimientoModificacionDb[]).map(comoMovimientoDeModificacion);
}

/**
 * El orden del registro: lo último decidido arriba.
 *
 * Es el mismo `decidida_at DESC NULLS LAST, created_at DESC` que escribía en SQL
 * `solicitudesDecididas`, la consulta del historial del aprobador a la que este
 * registro sustituyó, y el `NULLS LAST` sigue aquí por el mismo motivo que había
 * allí: hay dos formas de llegar a estado terminal sin `decidida_at`
 * —el PATCH de admin, que corrige la fila sin decidir nada, y aprobar una
 * ANULACIÓN sobre una solicitud aún pendiente— y encima el registro trae
 * también las que siguen en trámite, que no tienen fecha de cierre por
 * definición. Sin el `NULLS LAST` todas ellas encabezarían la lista por delante
 * de las decisiones de esta semana.
 *
 * Se exporta SOLO para poder probarla suelta. Ninguna de las dos consultas
 * lleva `ORDER BY`, así que el desempate por `createdAt` es invisible desde
 * fuera: contra Postgres, el orden en que llegan las filas sin cerrar es el que
 * elige el plan de ejecución, y para un dataset de test cabe que coincida con
 * el esperado por casualidad. Se comprobó: con el desempate sustituido por
 * `return 0`, la batería contra Postgres seguía entera en verde. La regla se
 * fija en `repo.test.ts`, con movimientos inventados y en un orden de entrada
 * distinto del de salida —`Array.prototype.sort` es estable, así que un
 * comparador que no desempata deja la entrada tal cual—.
 *
 * Se compara con `<`/`>` sobre las cadenas y no parseando fechas: los dos
 * valores salen del MISMO `::text` sobre un `timestamptz`, y el texto de un
 * `timestamptz` no lo fija la consulta sino dos GUC del SERVIDOR, `DateStyle` y
 * `TimeZone`. Mientras nadie los cambie, todas las filas comparten formato y
 * offset y el orden lexicográfico es el cronológico. Es la misma propiedad en
 * la que ya se apoya `correoDelQueCerro`.
 *
 * ⚠️ La invariante es «mismo GUC de servidor», y NO «misma sesión», que es lo
 * que parecería a simple vista. `movimientos` lanza las dos consultas con
 * `Promise.all` sobre un `Pool`, así que con concurrencia real salen por DOS
 * conexiones físicas distintas — y comparar una fila de una lista contra una de
 * la otra, que es exactamente lo que hace esta función, cruza esas dos
 * conexiones. Hoy se sostiene porque en todo el repo no hay un solo
 * `SET TimeZone`, ni un `options=-c` en la cadena de conexión, ni un `PGTZ`:
 * `createPoolFromUrl` es un `new Pool({ connectionString })` pelado y toda
 * conexión hereda el GUC del servidor. El día que alguien fije la zona por
 * sesión, esto se desordenaría EN SILENCIO.
 *
 * No se parsea a epoch a propósito, y no es pereza: el texto que devuelve
 * Postgres (`2026-08-20 18:39:20.12+00`) no es ISO 8601 —espacio en vez de `T`,
 * offset de dos dígitos—, así que `Date.parse` cae en su rama definida por la
 * implementación. Cambiaría una invariante documentada, que un `grep` basta
 * para vigilar, por otra que depende del motor de JS y que no vigila nadie.
 */
export function porFechaDeCierre(a: Movimiento, b: Movimiento): number {
  if (a.decididaAt !== b.decididaAt) {
    if (a.decididaAt === null) return 1;
    if (b.decididaAt === null) return -1;
    return a.decididaAt < b.decididaAt ? 1 : -1;
  }
  if (a.createdAt === b.createdAt) return 0;
  return a.createdAt < b.createdAt ? 1 : -1;
}

/**
 * El registro de movimientos. `soloDe = null` = la compañía entera (admin).
 *
 * Dos consultas y mezcla en TypeScript, no un `UNION ALL`: las formas de columna
 * de las dos tablas son muy distintas, la vista carga todo de una sola vez, y
 * separadas se pueden probar sin Postgres.
 *
 * `Promise.all` y no dos `await` seguidos: son independientes —ninguna necesita
 * el resultado de la otra— y encadenarlas pagaría dos veces la latencia de la
 * red por nada.
 */
export async function movimientos(db: Pool, soloDe: string | null): Promise<Movimiento[]> {
  const [deSolicitudes, deModificaciones] = await Promise.all([
    movimientosDeSolicitudes(db, soloDe),
    movimientosDeModificaciones(db, soloDe),
  ]);
  return [...deSolicitudes, ...deModificaciones].sort(porFechaDeCierre);
}
