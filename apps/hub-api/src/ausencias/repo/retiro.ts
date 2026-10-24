import type { Pool } from '@algarpibe/zoho-sync';
import { aEmpleadoConSaldo, type EmpleadoConSaldo, type FilaEmpleadoSaldoDb } from './filas.js';

// ARQ-612 — la baja de empleados, sacada de repo.ts tal cual: apagar las bajas
// vencidas, lo que bloquea una baja, registrarla y deshacerla, y la vista de
// retirados con su saldo congelado. Esa última traduce la fila igual que
// `empleadosConSaldo` (saldos.ts), y por eso las dos usan la misma traducción de
// filas.ts. repo.ts lo reexporta: el resto del código lo sigue llamando como
// `repo.*` (lo vigila barril.test.ts).

/**
 * Apaga las fichas cuya baja programada ya venció. Devuelve cuántas.
 *
 * Es lo que hace que una fecha futura signifique algo. Este router YA tiene un
 * cron —`/ausencias/n8n/pendiente`, que n8n sondea cada diez minutos—, así que
 * enganchar el barrido ahí también era una opción; se descartó a propósito.
 * Colgarlo de la carga del contexto en vez de eso hace que lo aplique el
 * primero que abra la app ese día, y esa es la garantía que importa: si no la
 * abre nadie, tampoco hay nadie mirando las listas que esta baja debería
 * limpiar, así que no hace falta que corra sola de fondo.
 *
 * Idempotente: el `AND activo` hace que la segunda pasada no encuentre filas, y
 * por eso dos peticiones concurrentes pueden ejecutarla a la vez sin estorbarse.
 *
 * ⚠️ `<` y no `<=`: `fecha_retiro` es el último día que TRABAJA. Con `<=` se le
 * apagaría el acceso en su último día y perdería un día de devengo. Su candado
 * vive en `repo.baja.db.test.ts` y su gemelo en `hoyCongelado`.
 */
export async function aplicarRetirosVencidos(db: Pool, hoy: string): Promise<number> {
  const res = await db.query(
    `UPDATE portal.empleados
        SET activo = false
      WHERE activo AND fecha_retiro IS NOT NULL AND fecha_retiro < $1::date`,
    [hoy],
  );
  return res.rowCount ?? 0;
}

/** Una solicitud que estorba a una baja, reducida a lo que el mensaje necesita. */
export interface DiaPosterior {
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  estado: string;
}

/**
 * Las solicitudes de alguien que TERMINAN después de una fecha y que consumen
 * días: las vivas y las ya aprobadas.
 *
 * Es lo que bloquea una baja. Las anteriores a la fecha no se miran a propósito:
 * quien se va el 30 de septiembre puede tener vacaciones pendientes de firma
 * para la semana que viene, y son perfectamente legítimas.
 *
 * `fecha_fin > $2` y no `>=`: la fecha de retiro es su último día trabajado, así
 * que unas vacaciones que acaban justo ese día caben.
 *
 * Las rechazadas quedan fuera: no consumen nada, y bloquear por ellas obligaría
 * a limpiar historia para poder dar de baja a alguien. `pendiente_2` entra junto
 * a `pendiente`: es el mismo trámite en su segundo nivel de firma, no un estado
 * distinto que vaya a dejar de consumir agenda.
 */
export async function diasPosterioresA(db: Pool, empleadoId: string, fecha: string): Promise<DiaPosterior[]> {
  const { rows } = await db.query(
    `SELECT tipo, fecha_inicio::text AS fecha_inicio, fecha_fin::text AS fecha_fin, estado
       FROM portal.solicitudes_ausencia
      WHERE empleado_id = $1
        AND fecha_fin > $2::date
        AND estado IN ('pendiente', 'pendiente_2', 'aprobada', 'registrada')
      ORDER BY fecha_inicio`,
    [empleadoId, fecha],
  );
  return (rows as { tipo: string; fecha_inicio: string; fecha_fin: string; estado: string }[]).map((r) => ({
    tipo: r.tipo,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
    estado: r.estado,
  }));
}

/** Una persona a cargo de alguien, reducida a lo que el mensaje al admin necesita. */
export interface PersonaACargo {
  nombre: string;
  correo: string;
}

/**
 * Quienes tienen a este correo como jefe o en copia.
 *
 * `WHERE activo` porque una ficha ya inactiva no necesita que nadie le firme
 * nada: sin eso, no se podría dar de baja a un jefe cuyo equipo ya se fue.
 *
 * Devuelve el correo junto al nombre, y no solo el nombre: `nombre_completo` NO
 * tiene restricción de unicidad (solo `correo` la tiene, ver la 015), así que
 * dos personas homónimas darían un mensaje al admin —«lo tienen de jefe: Ana
 * Ruiz, Ana Ruiz»— indistinguible de un fallo que hubiera duplicado una fila.
 * El correo es lo único de esta fila que sí identifica a alguien sin ambigüedad.
 */
export async function personasACargoDe(db: Pool, correo: string): Promise<PersonaACargo[]> {
  const { rows } = await db.query(
    `SELECT nombre_completo, correo
       FROM portal.empleados
      WHERE activo
        AND (lower(aprobador_correo) = lower($1) OR lower(copia_correo) = lower($1))
      ORDER BY nombre_completo`,
    [correo],
  );
  return (rows as { nombre_completo: string; correo: string }[]).map((r) => ({
    nombre: r.nombre_completo,
    correo: r.correo,
  }));
}

/**
 * Registra la baja: la fecha y quién la puso. Devuelve false si no existía.
 *
 * ⚠️ SIN `AND activo`, al revés que `fijarSaldo` y `fijarJefe`. Aquí ese filtro
 * sería un error: una ficha desactivada a mano —como las dos cuentas de prueba
 * del 2026-08-24— tiene que poder recibir su fecha después, y con el `AND
 * activo` se quedaría para siempre sin vía de arreglo desde la app.
 *
 * NO toca `activo`. Una baja con fecha futura deja a la persona trabajando; de
 * apagarla se encarga `aplicarRetirosVencidos` cuando llegue el día. Separarlo
 * es lo que permite que una baja programada sea solo un dato hasta que vence.
 */
export async function fijarRetiro(
  db: Pool,
  empleadoId: string,
  fechaRetiro: string,
  adminEmail: string,
): Promise<boolean> {
  const res = await db.query(
    `UPDATE portal.empleados
        SET fecha_retiro = $2::date, retirado_por = $3, retirado_at = NOW()
      WHERE id = $1`,
    [empleadoId, fechaRetiro, adminEmail.toLowerCase()],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Deshace una baja: limpia las tres columnas y reactiva. False si no existía. */
export async function limpiarRetiro(db: Pool, empleadoId: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE portal.empleados
        SET fecha_retiro = NULL, retirado_por = NULL, retirado_at = NULL, activo = true
      WHERE id = $1`,
    [empleadoId],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Las fichas INACTIVAS con su configuración de saldo.
 *
 * Hermana de `empleadosConSaldo`, que lleva `WHERE e.activo` y por eso no puede
 * servir a esta pantalla: un retirado no sale de aquella consulta, así que la
 * vista de Retirados no tendría de dónde sacar el saldo congelado — que es justo
 * a lo que se viene.
 *
 * No se unificaron con una bandera: aquella la comparten el panel de Saldos y
 * `ramaDeDosNiveles()`, y un parámetro mal pasado colaría retirados en la
 * pantalla de todo el mundo. Dos consultas separadas no pueden equivocarse de
 * público.
 *
 * `NOT e.activo` y no `fecha_retiro IS NOT NULL`: las fichas que se desactivaron
 * a mano antes de esta funcionalidad —las dos cuentas de prueba del 2026-08-24—
 * no tienen fecha, y filtrar por ella las dejaría fuera de las DOS vistas, sin
 * ningún sitio donde aparecer. Es la misma razón por la que `activo` sigue
 * siendo la única bandera que apagan las consultas y la fecha solo decide
 * cuándo se apaga.
 *
 * Sin `ramaDeDosNiveles()`: esto solo lo sirve un endpoint de admin. Los casts
 * `::float8` y `::text` son los mismos de `empleadosConSaldo` y por lo mismo.
 */
export async function retiradosConSaldo(db: Pool): Promise<EmpleadoConSaldo[]> {
  const { rows } = await db.query(
    `SELECT e.id, e.nombre_completo, e.correo,
            e.saldo_corte::float8 AS saldo_corte,
            e.fecha_corte::text   AS fecha_corte,
            e.compensatorios_saldo_corte::float8 AS compensatorios_saldo_corte,
            e.compensatorios_fecha_corte::text   AS compensatorios_fecha_corte,
            e.fecha_retiro::text  AS fecha_retiro,
            e.retirado_por
       FROM portal.empleados e
      WHERE NOT e.activo
      ORDER BY e.fecha_retiro DESC NULLS LAST, e.nombre_completo`,
  );
  return (rows as FilaEmpleadoSaldoDb[]).map(aEmpleadoConSaldo);
}

/**
 * Cuántas solicitudes vivas tiene cada uno de estos empleados.
 *
 * «Vivas» es esperando firma, no «posteriores a una fecha»: mientras quede una,
 * su saldo todavía puede moverse, porque la bandeja del jefe NO filtra por
 * `activo` y puede firmarla después del retiro. Es la diferencia entre un número
 * provisional y el que se paga en la liquidación.
 *
 * `pendiente_2` entra junto a `pendiente` por lo mismo que en `diasPosterioresA`:
 * es el mismo trámite en su segundo nivel de firma. Las aprobadas quedan fuera
 * porque ya están descontadas, y las rechazadas porque no consumen nada.
 *
 * ⚠️ De las dos condiciones, SOLO el filtro de estados lo vigila un test. El
 * `= ANY($1)` no lo caza ninguno y no puede cazarlo: con el `GROUP BY` los
 * conteos salen separados por empleado, así que quitarlo solo hace que la
 * consulta lea filas de más. Es un recorte de ALCANCE —no traer a la memoria de
 * hub-api las solicitudes de toda la plantilla—, no de corrección, y quien lo
 * borre no verá ningún rojo. Comprobado mutándolo (tarea 12 del plan).
 */
export async function solicitudesVivasDe(db: Pool, ids: string[]): Promise<Map<string, number>> {
  // Sin esto, `= ANY('{}')` haría un escaneo para no devolver nada.
  if (ids.length === 0) return new Map();
  const { rows } = await db.query(
    `SELECT empleado_id, COUNT(*)::int AS vivas
       FROM portal.solicitudes_ausencia
      WHERE empleado_id = ANY($1::uuid[])
        AND estado IN ('pendiente', 'pendiente_2')
      GROUP BY empleado_id`,
    [ids],
  );
  return new Map(
    (rows as { empleado_id: string; vivas: number }[]).map((r) => [r.empleado_id, r.vivas]),
  );
}
