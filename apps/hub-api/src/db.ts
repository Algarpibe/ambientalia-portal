import { Pool } from '@algarpibe/zoho-sync';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedUsersFromEnv } from './users/seed-from-env.js';

/*
 * DATA-331 — topes del pool principal. Es el pool de TODO hub-api, login
 * incluido: `requireAuth` relee rol y apps de la BD en cada petición. Antes se
 * creaba con `createPoolFromUrl`, que no fija ninguno, y los valores por
 * defecto de `pg` son esperar para siempre: una consulta colgada retenía su
 * conexión sin límite, y con el pool agotado cada petición nueva se quedaba en
 * cola indefinidamente. Ahora una consulta que se pasa la corta Postgres
 * (`statement_timeout`) y una petición que no consigue conexión falla con 500
 * en vez de colgar. Mismo patrón que `crearPoolDesk2` (db-desk2.ts), con
 * valores holgados: aquí corren los informes pesados (consolidador, WO-sales),
 * no lecturas cortas.
 */

/** Las 10 de `pg` por defecto, ahora explícitas. */
export const HUB_MAX_CONEXIONES = 10;
/** Espera máxima por una conexión, sea abrirla o que el pool libere una. */
export const HUB_TIMEOUT_CONEXION_MS = 10_000;
/** Tope de cada consulta (`statement_timeout`): lo aplica el propio Postgres. */
export const HUB_TIMEOUT_CONSULTA_MS = 30_000;

/**
 * Un pool hacia la base del hub con los topes de arriba. Exportada para las
 * pruebas (la de Postgres baja `consultaMs` para no esperar 30 s); el servidor
 * usa `getHubPool`.
 */
export function crearPoolHub(url: string, topes: { consultaMs?: number } = {}): Pool {
  return new Pool({
    connectionString: url,
    max: HUB_MAX_CONEXIONES,
    connectionTimeoutMillis: HUB_TIMEOUT_CONEXION_MS,
    idleTimeoutMillis: 30_000,
    statement_timeout: topes.consultaMs ?? HUB_TIMEOUT_CONSULTA_MS,
  });
}

/**
 * El pool de un solo uso del arranque, para migraciones y seed. SIN
 * `statement_timeout`, a propósito: si una migración legítima tardara más que
 * el tope, hub-api no arrancaría nunca y se llevaría todas las apps por
 * delante, reintento tras reintento. Una sola conexión: las migraciones van en
 * serie.
 */
export function crearPoolMigraciones(url: string): Pool {
  const p = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: HUB_TIMEOUT_CONEXION_MS });
  // Mismo motivo que el listener de getHubPool: sin él, el 'error' de un
  // cliente inactivo tumba el proceso en pleno arranque.
  p.on('error', (err: Error) => console.error('hub migrations pool error', err));
  return p;
}

let pool: Pool | null = null;

/**
 * El pool compartido, creado en el primer uso. NO es de solo lectura, aunque
 * así lo decía este comentario: el mismo rol aplica las migraciones y escribe
 * en `portal.*` (DATA-332).
 */
export function getHubPool(): Pool {
  if (!pool) {
    const url = process.env.HUB_DB_URL;
    if (!url) throw new Error('HUB_DB_URL is not set');
    pool = crearPoolHub(url);
    // Without a listener, an idle-client 'error' (backend restart, network
    // blip) is an unhandled EventEmitter error and crashes the process.
    pool.on('error', (err: Error) => console.error('hub pool error', err));
  }
  return pool;
}

// Migraciones aplicadas en orden al arranque. Son idempotentes (IF NOT EXISTS),
// así que re-ejecutarlas en cada boot es seguro.
const MIGRATIONS = ['001_create_users.sql', '002_add_avatar.sql', '003_add_preferences.sql', '004_wo_sales_email.sql', '005_drop_wo_sales_recipients.sql', '006_wo_sales_email_sent.sql', '007_contabilidad_overrides.sql', '008_contabilidad_budget.sql', '013_user_state_fk_cascade.sql', '014_drop_salestracker.sql', '015_ausencias.sql', '016_ausencias_historico.sql', '017_saldo_vacaciones.sql', '018_ausencias_cascada.sql', '019_ausencias_outbox_reserva.sql', '020_ausencias_drop_drive.sql', '021_ausencias_copia.sql', '022_ausencias_visores.sql', '023_ausencias_segunda_firma.sql', '024_ausencias_modificaciones.sql', '025_ausencias_evento_ancho.sql', '026_ausencias_evento_calendario.sql', '027_ausencias_correccion_admin.sql', '028_ausencias_outbox_huerfano.sql', '029_saldo_compensatorios.sql', '030_ausencias_otorgamiento.sql', '031_registro_exportadores.sql', '032_ausencias_visor_empresa.sql', '033_ausencias_retirada_y_caducada.sql', '034_token_version.sql', '035_ausencias_baja_empleado.sql', '036_ausencias_hora_permiso.sql', '037_drop_customer_profitability.sql', '038_ausencias_ve_kpis.sql', '039_wo_sales_email_frecuencia.sql', '040_calibraciones.sql', '041_drop_product_sales.sql', '042_trazabilidad_mantenimientos.sql', '043_trazabilidad_plazos.sql', '044_trazabilidad_servicios_tipo.sql', '045_trazabilidad_tipo_combinado.sql', '046_trazabilidad_estados_desk.sql', '047_trazabilidad_estados_historial.sql', '048_trazabilidad_contactos.sql', '049_trazabilidad_roles.sql', '050_trazabilidad_estados_categoria.sql', '051_trazabilidad_agenda_config.sql', '052_trazabilidad_agenda_asignaciones.sql', '053_trazabilidad_agenda_flujo.sql', '054_trazabilidad_agenda_historial.sql', '055_trazabilidad_fst022_congelacion.sql', '056_trazabilidad_maestro_equipos.sql', '057_trazabilidad_calibraciones.sql', '058_trazabilidad_en_seguimiento.sql', '059_trazabilidad_retiros.sql', '060_trazabilidad_exportaciones.sql', '061_trazabilidad_marcas_seguimiento.sql', '062_trazabilidad_pasadas_nocturnas.sql', '063_trazabilidad_vigencia_marcas.sql', '064_trazabilidad_contratos.sql'];

function migrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'users', 'migrations');
}

/**
 * Aplica en orden las migraciones del array. Exportada —y no en linea dentro de
 * `initDb()`— porque los tests contra Postgres real siembran su contenedor con
 * ESTA funcion: asi recorren el mismo array `MIGRATIONS` y el esquema de test no
 * puede divergir del de produccion. Lo que eso NO detecta es una migracion que
 * nadie apunto en el array: produccion tampoco la aplicaria, asi que los dos
 * esquemas coinciden en no tenerla y nadie se queja. Eso solo se delata de
 * rebote, cuando algun test de BD toca el esquema que esa migracion traia.
 */
export async function aplicarMigraciones(db: Pool): Promise<void> {
  const dir = migrationsDir();
  for (const file of MIGRATIONS) {
    const sql = readFileSync(join(dir, file), 'utf8');
    await db.query(sql);
    console.log(`migration applied: ${file}`);
  }
}

/**
 * Inicialización de BD en el arranque (Requirements 6.3, 6.5):
 *  - Si HUB_DB_URL no está definida → termina el proceso (< 5 s).
 *  - Si la BD no es alcanzable → termina el proceso con mensaje de error.
 *  - Ejecuta las migraciones pendientes y el seed desde AUTH_USERS.
 *
 * Debe llamarse (y esperarse) antes de `app.listen`.
 */
export async function initDb(): Promise<void> {
  if (!process.env.HUB_DB_URL) {
    console.error('FATAL: HUB_DB_URL no está definida. No es posible arrancar hub-api.');
    process.exit(1);
  }

  try {
    await getHubPool().query('SELECT 1');
  } catch (err) {
    console.error('FATAL: no se pudo conectar a la base de datos del hub.', err);
    process.exit(1);
  }

  // Migraciones y seed por su propio pool, sin el tope de consulta del
  // principal (ver crearPoolMigraciones). Se cierra al acabar, falle o no.
  const migraciones = crearPoolMigraciones(process.env.HUB_DB_URL);
  try {
    await aplicarMigraciones(migraciones);
    await seedUsersFromEnv(migraciones);
  } finally {
    await migraciones.end();
  }
}
