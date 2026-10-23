import type { Pool } from '@algarpibe/zoho-sync';

// ARQ-612 — lo que comparten casi todos los trozos del repositorio de ausencias:
// la transacción, el candado por empleado (DATA-336) y el recorte por rama. Vivía
// al principio de repo.ts; sale aquí para que cada trozo que se extraiga después
// lo IMPORTE en vez de copiarlo. repo.ts reexporta lo que ya exportaba, así que
// para service.ts, router.ts y el doble de router.test.ts nada cambia.
//
// Dos piezas solo funcionan si existen UNA vez —la llave del candado y
// `ramaDeDosNiveles`—, y comun.test.ts falla si aparecen en otro fichero.

// El tipo del cliente transaccional se deriva del Pool para no depender de un
// import directo de 'pg' (mismo truco que users.repository.ts).
export type PoolClient = Awaited<ReturnType<Pool['connect']>>;
/** El pool o el cliente de una transacción: lo que hace falta para leer. */
export type Consultable = Pool | PoolClient;

/** Ejecuta `fn` dentro de BEGIN/COMMIT; hace ROLLBACK ante cualquier error. */
export async function withTransaction<T>(db: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
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

/**
 * DATA-336 — una transacción en la que nadie más puede dar de alta una
 * solicitud de ESTE empleado hasta el COMMIT.
 *
 * Las comprobaciones del alta (solape, otorgamiento duplicado, saldo) son
 * lecturas: si corren fuera de la transacción del INSERT, dos peticiones
 * simultáneas miran las dos antes de que ninguna escriba, las dos ven el
 * camino libre y las dos se crean — un doble clic concedía dos veces el mismo
 * otorgamiento o dejaba la bolsa en negativo. Con este candado la segunda
 * espera en la primera línea, y cuando entra ya ve la fila de la primera.
 *
 * Candado consultivo y no `SELECT ... FOR UPDATE`: lo que hay que bloquear es
 * una fila que todavía NO existe (la nueva solicitud). Y no un índice único:
 * hay datos previos que lo incumplen (ver `existeOtorgamientoDelDia`). Es por
 * empleado, así que dos personas distintas no se esperan entre sí. Se suelta
 * solo al terminar la transacción, con COMMIT o con ROLLBACK.
 *
 * ⚠️ `fn` tiene que hacer TODAS sus lecturas con el `client` que recibe: una
 * lectura por el pool va por otra conexión y no garantiza ver lo mismo que el
 * INSERT.
 */
export async function conCandadoDelEmpleado<T>(
  db: Pool,
  empleadoId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTransaction(db, async (client) => {
    await bloquearEmpleado(client, empleadoId);
    return fn(client);
  });
}

/**
 * El candado de DATA-336, dentro de una transacción que ya abrió otro. La llave
 * es UNA y vive solo aquí: el alta y las tres puertas que mueven fechas
 * (proponer, firmar y el PATCH de admin) tienen que esperarse entre sí, y eso
 * solo ocurre si piden exactamente la misma. Se suelta con el COMMIT o el
 * ROLLBACK de esa transacción.
 */
export async function bloquearEmpleado(client: PoolClient, empleadoId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('ausencias:empleado:' || $1::text))`, [empleadoId]);
}

/** El empleado al que pertenece hoy la solicitud, o null si no existe. */
export async function duenoDe(client: PoolClient, solicitudId: string): Promise<string | null> {
  const { rows } = await client.query(`SELECT empleado_id FROM portal.solicitudes_ausencia WHERE id = $1`, [
    solicitudId,
  ]);
  return rows.length === 0 ? null : (rows[0] as { empleado_id: string }).empleado_id;
}

/**
 * DATA-336 — el candado del DUEÑO de una solicitud, para las puertas que solo
 * conocen su id (proponer y firmar un cambio de fechas).
 *
 * El dueño se lee ANTES de tener el candado, y eso deja una rendija: un PATCH de
 * admin que reasigne la solicitud a otra persona puede confirmar mientras se
 * espera. Por eso se relee después; si cambió, devuelve `false` y quien llama
 * aborta con su 409 de «la solicitud cambió debajo». Basta con releer una vez
 * porque el PATCH toma también el candado del dueño de ORIGEN
 * (`actualizarSolicitud`): con este candado en la mano nadie más puede cambiar
 * el dueño hasta el COMMIT.
 *
 * Devuelve `true` también si la solicitud no existe: no hay nada que bloquear, y
 * la escritura de detrás ya contesta que no la encuentra.
 */
export async function bloquearDuenoDe(client: PoolClient, solicitudId: string): Promise<boolean> {
  const dueno = await duenoDe(client, solicitudId);
  if (dueno === null) return true;
  await bloquearEmpleado(client, dueno);
  return (await duenoDe(client, solicitudId)) === dueno;
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
