import { inject } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { crearSolicitud } from '../ausencias/repo.js';
import type { PayloadEvento, Solicitud, TipoSolicitud } from '../ausencias/types.js';

/** El pool REAL de produccion, apuntando al contenedor. Ningun doble. */
export function poolDePrueba(): Pool {
  const db = createPoolFromUrl(inject('urlBd'));
  // El mismo listener que instala `getHubPool()` en db.ts, y por lo mismo que
  // explica alli: sin el, un 'error' de cliente inactivo es un error de
  // EventEmitter sin manejar. Aqui se llevaria por delante el proceso de vitest
  // entero —error opaco, ningun test rojo— en vez de fallar el test que corre.
  db.on('error', (err: Error) => console.error('pool de prueba', err));
  return db;
}

/**
 * `desk.tickets` NO la crea ninguna migracion de hub-api: es la replica de Zoho
 * Desk que escribe el worker de zoho-hub, y aqui solo se lee. El contenedor de
 * prueba nace sin ella, asi que el fichero que la consulte la pide en su
 * `beforeAll`. Solo las columnas que hub-api lee de verdad (tipos copiados de
 * produccion); es idempotente, y vaciarla entre tests es cosa de cada fichero.
 */
export async function asegurarDeskTickets(db: Pool): Promise<void> {
  await db.query(`
    CREATE SCHEMA IF NOT EXISTS desk;
    CREATE TABLE IF NOT EXISTS desk.tickets (
      number                integer UNIQUE,
      subject               text,
      status                text NOT NULL,
      status_type           text,
      serial                text,
      codigo_servicio       text,
      tipo_servicio         text,
      created_time          timestamptz,
      fecha_creacion_ticket date,
      synced_at             timestamptz,
      raw                   jsonb
    )`);
}

/** Las columnas de `desk.equipos` que el rol lector de produccion puede leer (ni `raw` ni el resto). */
export const COLUMNAS_EQUIPOS_LECTOR = 'id, serial, marca, modelo, tipo, cliente_nombre, client_id, modelo_id, codigo_interno, active, pendiente_validar, source, created_at, updated_at';

/**
 * Una imitacion de la base `desk` de Desk 2.0 (la fuente principal de la agenda
 * del taller) dentro del MISMO contenedor, pero en OTRA base de datos
 * (`desk2_prueba`): en produccion tambien es otra base, en otro servicio. Solo
 * las tablas y columnas que hub-api lee (nombres y tipos copiados de
 * `packages/zoho-sync/src/db/schema.sql` de Desk 2.0), y un rol de solo lectura
 * como el `portal_agenda_reader` de produccion: `SELECT` tabla a tabla y
 * `default_transaction_read_only = on`.
 *
 * `desk.equipos` (el maestro de equipos, lote 9b) va con el permiso POR
 * COLUMNAS de produccion: el lector solo puede leer `COLUMNAS_EQUIPOS_LECTOR`;
 * `raw` existe y no se le concede, asi que un SELECT que la nombre (o un `*`)
 * falla aqui igual que fallaria alli.
 *
 * Devuelve dos URLs: la del rol lector (la que imita a `DESK2_DB_URL`) y la del
 * superusuario del contenedor sobre esa base, para sembrar. La contrasena del
 * lector se genera en cada llamada: no hay ninguna escrita en el repo.
 * Idempotente; vaciar las tablas entre tests es cosa de cada fichero.
 */
export async function asegurarDesk2(db: Pool): Promise<{ urlLector: string; urlAdmin: string }> {
  const BASE = 'desk2_prueba';
  const ROL = 'agenda_lector_prueba';
  const clave = randomBytes(12).toString('hex');

  const { rows } = await db.query('SELECT 1 FROM pg_database WHERE datname = $1', [BASE]);
  if (rows.length === 0) await db.query(`CREATE DATABASE ${BASE}`);
  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROL}') THEN CREATE ROLE ${ROL} LOGIN; END IF;
    END $$;
    ALTER ROLE ${ROL} PASSWORD '${clave}';
    ALTER ROLE ${ROL} SET default_transaction_read_only = on;
    GRANT CONNECT ON DATABASE ${BASE} TO ${ROL}`);

  const admin = new URL(inject('urlBd'));
  admin.pathname = `/${BASE}`;
  const lector = new URL(admin);
  lector.username = ROL;
  lector.password = clave;

  const db2 = createPoolFromUrl(admin.toString());
  try {
    await db2.query(`
      CREATE SCHEMA IF NOT EXISTS desk;
      CREATE TABLE IF NOT EXISTS desk.tickets (
        id                     text PRIMARY KEY,
        number                 integer UNIQUE NOT NULL,
        status                 text NOT NULL,
        status_type            text,
        priority               text,
        classification         text,
        created_time           timestamptz,
        tipo_servicio          text,
        fecha_creacion_ticket  date,
        fecha_remision_entrada date,
        prioridad_en_app_at    timestamptz,
        synced_at              timestamptz
      );
      ALTER TABLE desk.tickets ADD COLUMN IF NOT EXISTS subject text;
      CREATE TABLE IF NOT EXISTS desk.ticket_transitions (
        id           bigserial PRIMARY KEY,
        ticket_id    text NOT NULL,
        to_status    text,
        performed_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS public.calendario_cierres (
        fecha date PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS desk.equipos (
        id                text PRIMARY KEY,
        serial            text NOT NULL,
        marca             text,
        modelo            text,
        tipo              text,
        cliente_nombre    text,
        source            text NOT NULL DEFAULT 'seed',
        active            boolean NOT NULL DEFAULT true,
        raw               jsonb,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz,
        client_id         text,
        modelo_id         text,
        codigo_interno    text,
        pendiente_validar boolean
      );
      GRANT USAGE ON SCHEMA desk, public TO ${ROL};
      GRANT SELECT ON desk.tickets, desk.ticket_transitions, public.calendario_cierres TO ${ROL};
      REVOKE ALL ON desk.equipos FROM ${ROL};
      GRANT SELECT (${COLUMNAS_EQUIPOS_LECTOR}) ON desk.equipos TO ${ROL}`);
  } finally {
    await db2.end();
  }
  return { urlLector: lector.toString(), urlAdmin: admin.toString() };
}

/**
 * Vacia las tablas entre tests.
 *
 * `portal.solicitud_adjuntos` no esta en la lista y se vacia igual: cuelga de
 * `solicitudes_ausencia` por FK y el CASCADE se la lleva. Se dice aqui porque
 * no vale de regla general — este esquema tiene auditoria SIN FK a proposito
 * (`visores_adjuntos_log`, ver la 022), y esa habria que anadirla a mano el dia
 * que un test la toque.
 *
 * `portal.exportadores_registro_log` (022 → 031, mismo patron) SI esta en la
 * lista: `repo.exportadores.db.test.ts` es el primer fichero que la toca, y sin
 * el TRUNCATE las filas de un test se cuelan en el conteo del siguiente. Ese
 * dia le llego tambien a `visores_adjuntos_log`, y sigue sin haberle llegado.
 *
 * `portal.visores_empresa_log` (032, el tercero del mismo patron) entra por lo
 * mismo y con el mismo sintoma: `repo.visor-empresa.db.test.ts` cuenta las filas
 * del log, y sin el TRUNCATE su `toHaveLength(1)` empieza a ver las del test
 * anterior. Es la trampa que este parrafo lleva anunciando desde la 031 — la
 * auditoria de este esquema no tiene FK a proposito, asi que el CASCADE de
 * `empleados` no se la lleva y hay que anadirla A MANO.
 *
 * No sirve envolver cada test en una transaccion: el codigo bajo prueba abre las
 * suyas con `withTransaction`, y anidarlas exigiria savepoints — justo lo que no
 * se quiere simular, porque el ROLLBACK real es una de las cosas que se prueban.
 */
export async function limpiar(db: Pool): Promise<void> {
  await db.query(
    `TRUNCATE portal.solicitud_modificaciones, portal.solicitudes_ausencia,
              portal.ausencias_outbox, portal.empleados, portal.exportadores_registro_log,
              portal.visores_empresa_log, portal.visores_kpis_log
     RESTART IDENTITY CASCADE`,
  );
}

/** El payload no se ejercita aqui: lo cubre entero notificaciones.test.ts. */
export const payloadStub = () => ({ correo: { para: '', asunto: '', cuerpo: '' } }) as unknown as PayloadEvento;

/**
 * Un empleado por INSERT directo y no por `asegurarEmpleado`: esa funcion exige
 * una fila en `portal.users` con su hash de contrasena, y estos tests no van de
 * altas de usuario. La SOLICITUD si se crea con la funcion real del repo, que es
 * la que importa.
 *
 * `aprobadorCorreo` es opcional, con el valor de siempre por defecto: hace
 * falta poder elegirlo para sembrar una jerarquia de varios niveles (el
 * recorte por rama), y el default retrocompatible evita tocar a los ficheros
 * que ya llaman a esta funcion con un solo argumento.
 */
export async function sembrarEmpleado(
  db: Pool,
  correo: string,
  aprobadorCorreo = 'jefe1@ambientalia.com.co',
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO portal.empleados (nombre_completo, correo, cargo, aprobador_correo)
     VALUES ('Ana Ruiz', $1, 'Analista', $2)
     RETURNING id`,
    [correo, aprobadorCorreo],
  );
  return (rows[0] as { id: string }).id;
}

export interface DatosSiembra {
  empleadoId: string;
  correo: string;
  estado: Solicitud['estado'];
  fechaInicio: string;
  fechaFin: string;
  /** Con correo, la solicitud lleva cascada de dos firmas; con null, una sola. */
  segundoAprobadorCorreo: string | null;
  /** Opcionales porque a casi ningun test le importan. Solo en permisos de un dia. */
  horaInicio?: string | null;
  horaFin?: string | null;
  /**
   * Opcional porque a casi ningun test le importa. Hace falta en cuanto uno
   * siembre una `registrada`: ese estado es el terminal de las INCAPACIDADES, y
   * dejarlo con el `vacaciones` por defecto crearia una fila que produccion no
   * puede producir, y un fixture imposible prueba menos de lo que aparenta.
   */
  tipo?: TipoSolicitud;
}

/** Una solicitud creada por `crearSolicitud`, sin adjunto y sin eventos. */
export async function sembrarSolicitud(db: Pool, d: DatosSiembra): Promise<Solicitud> {
  return crearSolicitud(
    db,
    {
      tipo: d.tipo ?? 'vacaciones',
      empleadoId: d.empleadoId,
      solicitanteEmail: d.correo,
      fechaInicio: d.fechaInicio,
      fechaFin: d.fechaFin,
      diasHabiles: 5,
      horaInicio: d.horaInicio ?? null,
      horaFin: d.horaFin ?? null,
      comentarios: null,
      estado: d.estado,
      aprobadorCorreo: 'jefe1@ambientalia.com.co',
      segundoAprobadorCorreo: d.segundoAprobadorCorreo,
      informadoCorreo: null,
    },
    null,
    // Sin eventos de alta: asi el outbox de cada test cuenta SOLO lo que el
    // propio test provoca.
    [],
    payloadStub,
  );
}

/** Los eventos del outbox, en el orden en que se sirven (por `id`). */
export async function eventosDelOutbox(db: Pool): Promise<string[]> {
  const { rows } = await db.query('SELECT evento FROM portal.ausencias_outbox ORDER BY id');
  return (rows as { evento: string }[]).map((r) => r.evento);
}
