import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { correosDeAdmin } from './repo.js';
import { poolDePrueba } from '../test-db/harness.js';

// `correosDeAdmin`, contra Postgres de verdad.
//
// Es la primera consulta de este modulo que lee `portal.users` en vez de
// `portal.empleados`, y la unica cuyo resultado decide algo que solo se ve
// mirando una fila concreta del panel: si las tres casillas de permisos se
// pintan o no. Un fallo aqui no lanza ni pone rojo nada — deja al administrador
// con una casilla apagada que dice que NO tiene un permiso que si tiene.
//
// El doble en memoria de router.test.ts modela su superficie (el candado de ese
// fichero lo exige), pero el filtro `role = 'admin'` y el `lower(email)` los
// ejecuta el motor, no un `.filter()` escrito al lado del test.

// Dominio propio para poder limpiar SOLO lo que siembra este fichero:
// `portal.users` NO esta en el TRUNCATE de `limpiar()` -no lo necesitaba nadie
// hasta ahora- y meterla alli le cambiaria el suelo a los otros diez ficheros
// de BD por un caso que solo usa este.
const DOMINIO = 'prueba-admins.test';
const ADMIN = `jefa@${DOMINIO}`;
const LECTORA = `lectora@${DOMINIO}`;

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  // Se borra tambien al final: si estas filas sobrevivieran al fichero, el
  // siguiente que lea `portal.users` empezaria con dos usuarios inventados.
  await db?.query(`DELETE FROM portal.users WHERE email LIKE $1`, [`%@${DOMINIO}`]);
  await db?.end();
});
beforeEach(async () => {
  await db.query(`DELETE FROM portal.users WHERE email LIKE $1`, [`%@${DOMINIO}`]);
});

/** Un usuario del portal. El hash es literal: aqui no se autentica nadie. */
async function sembrarUsuario(email: string, role: 'admin' | 'reader', status = 'active'): Promise<void> {
  await db.query(
    `INSERT INTO portal.users (full_name, email, password_hash, role, status)
     VALUES ('Persona De Prueba', $1, 'no-es-un-hash', $2, $3)`,
    [email, role, status],
  );
}

/** Solo los correos de este fichero: la BD puede traer otros de la app real. */
const mios = (todos: Set<string>) => [...todos].filter((c) => c.endsWith(`@${DOMINIO}`)).sort();

describe('correosDeAdmin', () => {
  it('devuelve a los admin y deja fuera a los lectores', async () => {
    await sembrarUsuario(ADMIN, 'admin');
    await sembrarUsuario(LECTORA, 'reader');
    expect(mios(await correosDeAdmin(db))).toEqual([ADMIN]);
  });

  it('CANDADO: el correo sale en minusculas, pase como pase por el alta', async () => {
    // El servicio cruza este conjunto contra el correo de la ficha ya bajado a
    // minusculas. Si la consulta devolviera la caja original, un admin dado de
    // alta con mayusculas no casaria y volveria a ver sus tres casillas — sin
    // que fallara nada ni se pusiera rojo ningun otro test.
    await sembrarUsuario(`Jefa@${DOMINIO}`, 'admin');
    expect(mios(await correosDeAdmin(db))).toEqual([`jefa@${DOMINIO}`]);
  });

  it('sin ningun admin devuelve el conjunto vacio, no todos los usuarios', async () => {
    // El mutante que muere aqui es perder el `WHERE role = 'admin'`: con la
    // plantilla real detras, eso esconderia las casillas de permisos de TODA la
    // empresa y el permiso dejaria de poder concederse desde el panel.
    await sembrarUsuario(LECTORA, 'reader');
    expect(mios(await correosDeAdmin(db))).toEqual([]);
  });

  it('un admin inactivo SIGUE contando, igual que en `requireAdmin`', async () => {
    // Deliberado, y por eso queda escrito: el bypass de hub-api lo decide
    // `requireAdmin` leyendo `role` del JWT, sin mirar `status`. Filtrar aqui
    // por `status = 'active'` haria que el panel contestara una pregunta
    // distinta de la que contesta el servidor. Si algun dia se decide lo
    // contrario, este test es el que hay que cambiar — a proposito.
    await sembrarUsuario(ADMIN, 'admin', 'inactive');
    expect(mios(await correosDeAdmin(db))).toEqual([ADMIN]);
  });
});
