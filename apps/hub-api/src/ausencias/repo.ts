import type { Pool } from '@algarpibe/zoho-sync';
import type { AusenciaRango } from './calendario.js';
import type { EnlaceJerarquia } from './jerarquia.js';
import type {
  Adjunto,
  ClaseModificacion,
  Empleado,
  EstadoModificacion,
  EventoModificacion,
  EventoOutbox,
  EventoPendiente,
  EventoSolicitud,
  Modificacion,
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
  aprobador_correo, copia_correo, user_id, activo, ve_adjuntos, requiere_segunda_firma`;

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

// ── Saldo de vacaciones ────────────────────────────────────────────────────

/** Un empleado con su configuración de saldo, tal como sale de la BD. */
export interface EmpleadoConSaldo {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  /** Null mientras nadie lo haya configurado. Va siempre en pareja con la fecha. */
  saldoCorte: number | null;
  fechaCorte: string | null;
}

interface FilaEmpleadoSaldoDb {
  id: string;
  nombre_completo: string;
  correo: string;
  saldo_corte: number | null;
  fecha_corte: string | null;
}

function aEmpleadoConSaldo(r: FilaEmpleadoSaldoDb): EmpleadoConSaldo {
  return {
    empleadoId: r.id,
    nombreCompleto: r.nombre_completo,
    correo: r.correo,
    saldoCorte: r.saldo_corte,
    fechaCorte: r.fecha_corte,
  };
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
    `SELECT e.id, e.nombre_completo, e.correo,
            e.saldo_corte::float8 AS saldo_corte,
            e.fecha_corte::text   AS fecha_corte
       FROM portal.empleados e
      WHERE e.activo
        AND ($1::text IS NULL
             OR lower(e.aprobador_correo) = lower($1)
             OR EXISTS (SELECT 1 FROM portal.empleados j
                         WHERE j.activo
                           AND lower(j.correo) = lower(e.aprobador_correo)
                           AND lower(j.aprobador_correo) = lower($1)))
        AND ($2::uuid IS NULL OR e.id = $2::uuid)
      ORDER BY e.nombre_completo`,
    [soloDe, empleadoId],
  );
  return (rows as FilaEmpleadoSaldoDb[]).map(aEmpleadoConSaldo);
}

/** Una solicitud reducida a lo que el cálculo del saldo necesita. */
export interface VacacionDeEmpleado {
  empleadoId: string;
  tipo: TipoSolicitud;
  fechaInicio: string;
  diasHabiles: number;
  estado: Solicitud['estado'];
}

interface FilaVacacionDb {
  empleado_id: string;
  tipo: TipoSolicitud;
  fecha_inicio: string;
  dias_habiles: number;
  estado: Solicitud['estado'];
}

function aVacacionDeEmpleado(r: FilaVacacionDb): VacacionDeEmpleado {
  return {
    empleadoId: r.empleado_id,
    tipo: r.tipo,
    fechaInicio: r.fecha_inicio,
    diasHabiles: r.dias_habiles,
    estado: r.estado,
  };
}

/**
 * Las solicitudes de esos empleados que pueden tocar el saldo.
 *
 * Se filtra por tipo aquí además de en `calcularSaldo` porque traer permisos e
 * incapacidades para descartarlos después es tráfico gratis; el filtro del módulo
 * puro se queda igualmente como red de seguridad.
 */
export async function vacacionesDeEmpleados(db: Pool, ids: string[]): Promise<VacacionDeEmpleado[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query(
    `SELECT empleado_id, tipo, fecha_inicio::text AS fecha_inicio,
            dias_habiles::float8 AS dias_habiles, estado
       FROM portal.solicitudes_ausencia
      WHERE tipo = 'vacaciones' AND empleado_id = ANY($1::uuid[])`,
    [ids],
  );
  return (rows as FilaVacacionDb[]).map(aVacacionDeEmpleado);
}

/**
 * Fija (o vacía) el punto de corte de un empleado. Devuelve false si no existía
 * (o estaba inactivo: ver más abajo).
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
  saldoCorte: number | null,
  fechaCorte: string | null,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE portal.empleados
        SET saldo_corte = $2, fecha_corte = $3::date
      WHERE id = $1 AND activo`,
    [empleadoId, saldoCorte, fechaCorte],
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
 * NO encola nada en el outbox, a propósito: esto es corregir el registro, no
 * tomar una decisión. Aprobar o rechazar se hace en la bandeja, que es donde sí
 * se avisa a la gente. Un admin arreglando una fecha mal importada no debe
 * disparar correos a nadie.
 */
export async function actualizarSolicitud(
  db: Pool,
  id: string,
  campos: EdicionSolicitud,
): Promise<Solicitud | null> {
  const { rows } = await db.query(
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
  return solicitudPorId(db, id);
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
 * El adjunto y los eventos de cola se van por clave foránea. Si quedaba algún
 * evento sin enviar, desaparece con la solicitud — que es lo correcto: no tiene
 * sentido avisar de algo que ya no existe.
 */
export async function borrarSolicitud(db: Pool, id: string): Promise<Solicitud | null> {
  const previa = await solicitudPorId(db, id);
  if (!previa) return null;
  await db.query('DELETE FROM portal.solicitudes_ausencia WHERE id = $1', [id]);
  return previa;
}

/** Todas las solicitudes de la compañía, para la vista que sustituye a la hoja. */
export async function todasLasSolicitudes(db: Pool): Promise<Solicitud[]> {
  const { rows } = await db.query(`${SELECT_SOLICITUD} ORDER BY s.fecha_inicio DESC`);
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

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
      await client.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [id, evento, JSON.stringify(construirPayload(solicitud, evento))],
      );
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

/**
 * Lo que ya se cerró y le tocaba firmar a este correo, en cualquiera de los dos
 * niveles. Es el rastro que un aprobador no tenía: al decidir, la solicitud sale
 * de su bandeja y hasta ahora no volvía a aparecer en ningún sitio.
 *
 * Filtra por el correo que quedó CONGELADO en la solicitud, no por quién pulsó
 * el botón (`aprobador_user_id`). Dos razones: ese campo es NULL en las sesiones
 * con token legacy, así que filtrar por él dejaría el historial vacío sin decir
 * por qué; y una solicitud que un admin destrabó en su lugar sigue siendo suya
 * —estuvo en su bandeja— y esconderla haría el historial incompleto.
 */
export async function solicitudesDecididas(db: Pool, aprobadorCorreo: string): Promise<Solicitud[]> {
  const { rows } = await db.query(
    `${SELECT_SOLICITUD}
      WHERE s.estado IN ('aprobada', 'rechazada')
        AND (lower(s.aprobador_correo) = lower($1) OR lower(s.segundo_aprobador_correo) = lower($1))
      -- NULLS LAST no es decorativo: el PATCH de admin puede dejar una fila en
      -- estado terminal sin tocar decidida_at, y sin esto esas filas encabezarían
      -- la lista por delante de las decisiones reales de esta semana.
      ORDER BY s.decidida_at DESC NULLS LAST, s.created_at DESC`,
    [aprobadorCorreo],
  );
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

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

export async function solicitudPorId(db: Pool, id: string): Promise<Solicitud | null> {
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
 */
export async function decidirSolicitud(
  db: Pool,
  id: string,
  estadoEsperado: Solicitud['estado'],
  transicion: Transicion,
  motivo: string | null,
  userId: string | null,
  construirPayload: (solicitud: Solicitud, evento: EventoSolicitud) => PayloadEvento,
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

    await client.query(
      `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
      [id, transicion.evento, JSON.stringify(construirPayload(solicitud, transicion.evento))],
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
 *     que hay en la tabla.
 *  2. El `AND s.estado = $8` lleva el estado que leyó el servicio. Sin él, si el
 *     jefe aprueba a la vez, la propuesta se guardaría con
 *     `estado_previo = 'pendiente'` sobre algo que ya está `aprobada` y ya está
 *     en el calendario de Google — y el correo de la decisión no avisaría de
 *     tocarlo. Con el testigo, `estado_previo` es cierto por construcción.
 *
 * Mismo aviso que en `decidirSolicitud`: NO sustituir el testigo por un
 * `IN ('pendiente','pendiente_2','aprobada')`. Sería igual de atómico y
 * destruiría justo la garantía de arriba.
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
          -- seria igual de atomico y estado_previo dejaria de ser cierto — si el
          -- jefe aprueba a la vez, la propuesta se guarda como 'pendiente' sobre
          -- algo que ya esta en el calendario de Google y el correo de la decision
          -- no avisa de tocarlo.
          -- NINGUN TEST EJECUTA ESTE SQL: el doble de router.test.ts es in-memory
          -- y los 677 siguen verdes con el IN. Lo unico que lo vigila es una
          -- asercion de FORMA en repo.test.ts que busca este texto literal, y
          -- este comentario.
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
 * Resultado de decidir. Las dos formas de fallar son un 409, pero cuentan cosas
 * distintas y el cliente tiene que poder distinguirlas: «alguien ya la decidió»
 * (o un doble clic) no es «la solicitud se movió debajo y hay que mirar».
 */
export type ResultadoDecisionModificacion =
  | { ok: true; modificacion: Modificacion; solicitud: Solicitud }
  | { ok: false; razon: 'ya_decidida' | 'solicitud_cambio_de_estado' };

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
    -- NINGUN TEST EJECUTA ESTE SQL: el doble de router.test.ts es in-memory y
    -- modela el testigo por su cuenta, asi que quitar dos de los tres campos
    -- deja toda la bateria en verde. Lo unico que lo vigila es una asercion de
    -- FORMA en repo.test.ts que busca este texto literal, y este comentario.
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
 *  3. Releer, y encolar el aviso.
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

      // Anotado y no un literal suelto: el valor viaja al CHECK de `evento` de la
      // 024, y una errata reventaría DENTRO de la transacción, deshaciendo una
      // decisión que el jefe cree tomada.
      const evento: EventoModificacion = aprueba ? 'modificacion_aprobada' : 'modificacion_rechazada';
      await client.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [modificacion.solicitudId, evento, JSON.stringify(construirPayload(solicitud, modificacion, evento))],
      );

      return { ok: true, modificacion, solicitud };
    });
  } catch (err) {
    // El choque del testigo triple ya provocó el ROLLBACK dentro de
    // `withTransaction`: aquí solo se traduce a un resultado, para que el
    // servicio no tenga que conocer esta clase ni distinguirla de un fallo real.
    if (err instanceof ChoqueConLaSolicitud) return { ok: false, razon: 'solicitud_cambio_de_estado' };
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
 * propuesta— y no contra los firmantes de la solicitud: es el mismo correo que
 * `puedeDecidirModificacion` exige, así que la bandeja no puede enseñar nada que
 * luego responda 403 al pulsar.
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
  return (rows as { id: string; evento: EventoOutbox; solicitud_id: string; intentos: number; payload: PayloadEvento }[])
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
export async function empleadosActivos(db: Pool, soloEmpleadoId: string | null): Promise<EmpleadoActivo[]> {
  const { rows } = await db.query(
    `SELECT id, nombre_completo FROM portal.empleados
      WHERE activo AND ($1::uuid IS NULL OR id = $1::uuid)
      ORDER BY nombre_completo`,
    [soloEmpleadoId],
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
  desde: string,
  hasta: string,
  soloEmpleadoId: string | null,
): Promise<AusenciaRango[]> {
  const { rows } = await db.query(
    `SELECT s.empleado_id, s.tipo, s.estado,
            s.fecha_inicio::text AS fecha_inicio,
            s.fecha_fin::text    AS fecha_fin
       FROM portal.solicitudes_ausencia s
       JOIN portal.empleados e ON e.id = s.empleado_id
      WHERE e.activo
        AND s.estado <> 'rechazada'
        AND ($3::uuid IS NULL OR s.empleado_id = $3::uuid)
        AND s.fecha_inicio <= $2::date
        AND s.fecha_fin    >= $1::date
      -- Determinismo del pintado, no estética: dos ausencias solapadas del
      -- mismo empleado producen dos marcas para el mismo (empleadoId, fecha), y
      -- el frontend arma un Map con esa clave, así que gana la última. Sin este
      -- ORDER BY, cuál de las dos "gana" podría cambiar entre peticiones.
      ORDER BY s.fecha_inicio, s.id`,
    [desde, hasta, soloEmpleadoId],
  );
  return (rows as FilaAusenciaRangoDb[]).map(aAusenciaRango);
}
