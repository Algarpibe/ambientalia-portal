import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { aplicarMigraciones, crearPoolMigraciones } from './db.js';
import { sembrarEmpleado, sembrarSolicitud, eventosDelOutbox } from './test-db/harness.js';

// DATA-332 — un solo rol aplicaba el DDL de las migraciones Y atendía todas las
// peticiones: una inyección SQL, si apareciera, tendría `DROP TABLE`. La
// separación es un rol de migración (el dueño de `portal`, con DDL, solo al
// arrancar) y `portal_app` para las peticiones, que solo lee y escribe filas.
// Los permisos de `portal_app` sobre `portal` los da la migración 068 en cada
// arranque.
//
// Por qué una base PROPIA y no la del contenedor: allí las migraciones corren
// como superusuario, y un superusuario puede dar cualquier permiso. En
// producción el rol de migración NO lo es; con superusuario este test pasaría
// aunque el GRANT de la 068 fallara de verdad. Aquí migra un rol corriente,
// dueño de su base, que es lo que hay en EasyPanel.

const BASE = 'roles_prueba';
const MIGRADOR = 'migrador_prueba';
const APP = 'portal_app';

let admin: Pool;
let migrador: Pool;
let app: Pool;
let urlMigrador: string;

/** La URL del contenedor, apuntando a la base propia y con otro usuario. */
function urlCon(usuario: string, clave: string): string {
  const u = new URL(inject('urlBd'));
  u.pathname = `/${BASE}`;
  u.username = usuario;
  u.password = clave;
  return u.toString();
}

function pool(url: string, nombre: string): Pool {
  const p = createPoolFromUrl(url);
  p.on('error', (err: Error) => console.error(nombre, err));
  return p;
}

/** Un arranque de hub-api visto desde la base: todas las migraciones, con el rol de migración. */
async function arrancar(): Promise<void> {
  const p = crearPoolMigraciones(urlMigrador);
  try {
    await aplicarMigraciones(p);
  } finally {
    await p.end();
  }
}

beforeAll(async () => {
  admin = pool(inject('urlBd'), 'admin');
  // Contraseñas generadas en cada ejecución: ninguna escrita en el repo.
  const claveMigrador = randomBytes(12).toString('hex');
  const claveApp = randomBytes(12).toString('hex');
  await admin.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${MIGRADOR}') THEN CREATE ROLE ${MIGRADOR} LOGIN NOSUPERUSER; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP}') THEN CREATE ROLE ${APP} LOGIN NOSUPERUSER; END IF;
    END $$;
    ALTER ROLE ${MIGRADOR} PASSWORD '${claveMigrador}';
    ALTER ROLE ${APP} PASSWORD '${claveApp}'`);
  const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [BASE]);
  if (rows.length === 0) await admin.query(`CREATE DATABASE ${BASE} OWNER ${MIGRADOR}`);

  urlMigrador = urlCon(MIGRADOR, claveMigrador);
  await arrancar();
  migrador = pool(urlMigrador, 'migrador');
  app = pool(urlCon(APP, claveApp), 'app');
});

afterAll(async () => {
  await app?.end();
  await migrador?.end();
  await admin?.end();
});

describe('el rol de las peticiones (portal_app)', () => {
  it('el rol de migración del test NO es superusuario (si lo fuera, este fichero no probaría nada)', async () => {
    const { rows } = await migrador.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
    expect(rows[0]).toEqual({ rolsuper: false });
  });

  it('lee, inserta, actualiza y borra filas en portal, secuencias incluidas', async () => {
    // Con las funciones REALES del repositorio, no con INSERT a mano: así se
    // ejercitan sus transacciones, sus candados y el BIGSERIAL del outbox.
    const empleadoId = await sembrarEmpleado(app, 'roles.ana@ambientalia.com.co');
    const s = await sembrarSolicitud(app, {
      empleadoId,
      correo: 'roles.ana@ambientalia.com.co',
      estado: 'aprobada',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-10',
      segundoAprobadorCorreo: null,
    });
    await app.query(
      `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, 'creada', '{}'::jsonb)`,
      [s.id],
    );
    expect(await eventosDelOutbox(app)).toEqual(['creada']);

    await app.query(`UPDATE portal.empleados SET cargo = 'Jefa' WHERE id = $1`, [empleadoId]);
    await app.query('DELETE FROM portal.ausencias_outbox WHERE solicitud_id = $1', [s.id]);
    expect(await eventosDelOutbox(app)).toEqual([]);
  });

  it('NO puede tocar el esquema: ni crear, ni alterar, ni borrar, ni vaciar tablas', async () => {
    // 42501 = insufficient_privilege. Es lo que DATA-332 quería quitarle a una
    // inyección SQL.
    const sinPermiso = { code: '42501' };
    await expect(app.query('CREATE TABLE portal.intrusa (id int)')).rejects.toMatchObject(sinPermiso);
    await expect(app.query('ALTER TABLE portal.users ADD COLUMN intrusa int')).rejects.toMatchObject(sinPermiso);
    await expect(app.query('DROP TABLE portal.users')).rejects.toMatchObject(sinPermiso);
    await expect(app.query('TRUNCATE portal.ausencias_outbox')).rejects.toMatchObject(sinPermiso);
  });

  it('una tabla que traiga una migración futura le llega sola en el siguiente arranque', async () => {
    // Lo que hace una migración nueva: el rol de migración crea una tabla. Sin
    // nada más, `portal_app` no puede usarla, y la primera petición fallaría.
    await migrador.query('CREATE TABLE IF NOT EXISTS portal.tabla_futura (id BIGSERIAL PRIMARY KEY, nota text)');
    await expect(app.query('SELECT * FROM portal.tabla_futura')).rejects.toMatchObject({ code: '42501' });

    // El arranque re-ejecuta las migraciones, la 068 entre ellas: nadie tiene que
    // acordarse de dar permisos a mano.
    await arrancar();
    await app.query(`INSERT INTO portal.tabla_futura (nota) VALUES ('ya puedo')`);
    const { rows } = await app.query('SELECT nota FROM portal.tabla_futura');
    expect(rows).toEqual([{ nota: 'ya puedo' }]);
  });

  it('dar los permisos en cada arranque no espera a las peticiones que están en curso', async () => {
    // La 068 corre en CADA arranque, y en un despliegue el contenedor viejo sigue
    // atendiendo mientras arranca el nuevo (DATA-340). Si el GRANT esperara a una
    // transacción abierta, el arranque se colgaría hasta el lock_timeout y
    // EasyPanel lo reintentaría en bucle.
    const enCurso = await app.connect();
    const p = crearPoolMigraciones(urlMigrador, { esperaCandadoMs: 500 });
    try {
      await enCurso.query('BEGIN');
      await enCurso.query(`INSERT INTO portal.tabla_futura (nota) VALUES ('a medias')`);
      await expect(aplicarMigraciones(p)).resolves.toBeUndefined();
    } finally {
      await enCurso.query('ROLLBACK');
      enCurso.release();
      await p.end();
    }
  });
});
