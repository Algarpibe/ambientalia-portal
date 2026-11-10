import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import { CorridaCerrada, crearRepoEquipos, type RepoEquipos } from './repo.js';
import { CV, EST, type Foto } from './nucleo/index.js';

// La migración 071 y el repositorio contra Postgres real (Testcontainers). Todo ficticio:
// usuarios @equipos.test, seriales 18A9xxxx.
const MIGRACION = fileURLToPath(new URL('../users/migrations/071_equipos_taller.sql', import.meta.url));
const FOTO: Foto = {
  at: '2026-11-10T11:35:00.000Z',
  hoy: '2026-11-10',
  rows: [{ id: 'E1', d: '2026-11-01', c: 'CLIENTE A', sn: '18A90001', est: EST.TALLER, src: '', why: ['Entrada 2026-11-01'], x: null, z: null, zc: false, pa: [], xd: '', eq: '' }],
  ilegibles: [{ id: 'PDFabcdefghij1', n: '261020 - CLIENTE C.pdf', d: '2026-10-20', m: 'sin texto legible', q: 'x', p: [] }],
};
const EXITS = { v: CV, list: [{ id: 'S1', n: '260915 - CLIENTE B.pdf', d: '2026-09-15', t: ['1BA9000S'], it: {} }] };

let db: Pool;
let repo: RepoEquipos;
const usuario = async (email: string, o: { role?: string; status?: string; app?: boolean } = {}): Promise<string> => {
  const { rows } = await db.query(
    `INSERT INTO portal.users (full_name, email, password_hash, role, status) VALUES ($1, $2, 'x', $3, $4) RETURNING id::text AS id`,
    [email.split('@')[0], email, o.role ?? 'reader', o.status ?? 'active'],
  );
  if (o.app) await db.query(`INSERT INTO portal.user_apps (user_id, app_id) VALUES ($1, 'equipos-taller')`, [rows[0].id]);
  return rows[0].id;
};

beforeAll(() => {
  db = poolDePrueba();
  repo = crearRepoEquipos(db);
});
afterAll(async () => {
  await db.end();
});
beforeEach(async () => {
  await db.query('TRUNCATE portal.equipos_estado, portal.equipos_ajuste, portal.equipos_ejecucion, portal.equipos_incidente, portal.equipos_llaves RESTART IDENTITY');
  await db.query(`DELETE FROM portal.users WHERE email LIKE '%@equipos.test'`);
});

describe('migración 071', () => {
  it('re-ejecutarla (initDb lo hace en cada arranque) no cambia nada ni borra filas', async () => {
    const columnas = async () =>
      (await db.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'portal' AND table_name LIKE 'equipos_%' ORDER BY 1, 2`)).rows;
    const antes = await columnas();
    const id = await repo.iniciarCorrida('boton', null);
    await db.query(readFileSync(MIGRACION, 'utf8'));
    await db.query(readFileSync(MIGRACION, 'utf8'));
    expect(await columnas()).toEqual(antes);
    expect((await repo.ultimaCorrida())?.id).toBe(id);
  });

  it('no siembra ni apps ni llaves', async () => {
    await db.query(readFileSync(MIGRACION, 'utf8'));
    expect((await db.query(`SELECT count(*)::int AS n FROM portal.user_apps WHERE app_id = 'equipos-taller'`)).rows[0].n).toBe(0);
    expect((await db.query('SELECT count(*)::int AS n FROM portal.equipos_llaves')).rows[0].n).toBe(0);
  });

  it('la clave de un ajuste y su tipo los comprueba también la base', async () => {
    await expect(db.query(`INSERT INTO portal.equipos_ajuste (clave, tipo) VALUES ('x'' OR 1=1', 'in')`)).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(`INSERT INTO portal.equipos_ajuste (clave, tipo) VALUES ('pdf:Abcdefghij1', 'out')`)).rejects.toMatchObject({ code: '23514' });
  });
});

describe('corridas', () => {
  it('el candado: una a la vez; al cerrar se suelta', async () => {
    const id = await repo.iniciarCorrida('programada', null);
    expect(id).not.toBeNull();
    expect(await repo.iniciarCorrida('boton', null)).toBeNull();
    await repo.terminarMal(id!, 'desk2: sin conexión', null);
    expect(await repo.iniciarCorrida('boton', null)).not.toBeNull();
  });

  it('una corrida colgada más de 180 min se da por abandonada', async () => {
    const id = (await repo.iniciarCorrida('programada', null))!;
    await db.query(`UPDATE portal.equipos_ejecucion SET inicio = now() - interval '181 minutes' WHERE id = $1`, [id]);
    expect(await repo.iniciarCorrida('boton', null)).not.toBeNull();
    const vieja = (await db.query('SELECT ok, causa, en_curso FROM portal.equipos_ejecucion WHERE id = $1', [id])).rows[0];
    expect(vieja).toEqual({ ok: false, causa: 'abandonada', en_curso: null });
  });

  describe('una corrida abandonada no pisa a otra más nueva', () => {
    const FOTO_B: Foto = { ...FOTO, hoy: '2026-11-11' };
    const EXITS_B = { v: CV, list: [] };
    const abandonadaYNueva = async () => {
      const a = (await repo.iniciarCorrida('programada', null))!;
      await db.query(`UPDATE portal.equipos_ejecucion SET inicio = now() - interval '181 minutes' WHERE id = $1`, [a]);
      const b = (await repo.iniciarCorrida('boton', null))!;
      await repo.terminarBien(b, { foto: FOTO_B, exits: EXITS_B, ent: { N: { eq: 'B', srv: '', k: '' } }, avisos: [], conteos: {} });
      const b2 = (await repo.iniciarCorrida('boton', null))!; // B ya cerró; otra en curso
      expect(b2).not.toBeNull();
      return a;
    };
    const filaA = async (a: number) => (await db.query('SELECT ok, causa, en_curso FROM portal.equipos_ejecucion WHERE id = $1', [a])).rows[0];

    it('terminarBien lanza y no toca foto, cachés ni la fila abandonada', async () => {
      const a = await abandonadaYNueva();
      await expect(repo.terminarBien(a, { foto: FOTO, exits: EXITS, ent: {}, avisos: [], conteos: {} })).rejects.toBeInstanceOf(CorridaCerrada);
      expect(await repo.leerFoto()).toEqual(FOTO_B);
      expect(await repo.leerCaches()).toEqual({ exits: EXITS_B, ent: { N: { eq: 'B', srv: '', k: '' } } });
      expect(await filaA(a)).toEqual({ ok: false, causa: 'abandonada', en_curso: null });
    });

    it('terminarMal lanza y no pisa exits ni la fila abandonada', async () => {
      const a = await abandonadaYNueva();
      await expect(repo.terminarMal(a, 'drive: HTTP 403', EXITS)).rejects.toBeInstanceOf(CorridaCerrada);
      expect((await repo.leerCaches()).exits).toEqual(EXITS_B);
      expect(await filaA(a)).toEqual({ ok: false, causa: 'abandonada', en_curso: null });
    });
  });

  it('terminarBien escribe foto, cachés y cierre; terminarMal no toca la foto pero sí guarda exits', async () => {
    const u = await usuario('boton@equipos.test');
    const id1 = (await repo.iniciarCorrida('boton', u))!;
    await repo.terminarBien(id1, { foto: FOTO, exits: EXITS, ent: { E1: { eq: 'EDM180C', srv: '', k: '' } }, avisos: ['un aviso'], conteos: { en_taller: 1 } });
    expect(await repo.leerFoto()).toEqual(FOTO);
    expect(await repo.leerCaches()).toEqual({ exits: EXITS, ent: { E1: { eq: 'EDM180C', srv: '', k: '' } } });
    const id2 = (await repo.iniciarCorrida('programada', null))!;
    const exits2 = { v: CV, list: [...EXITS.list, { id: 'S2', n: '261001 - X.pdf', d: '2026-10-01', t: [], it: {} }] };
    await repo.terminarMal(id2, 'drive: HTTP 403', exits2);
    expect(await repo.leerFoto()).toEqual(FOTO);
    expect((await repo.leerCaches()).exits).toEqual(exits2);
    expect(await repo.ultimaCorrida()).toMatchObject({ id: id2, origen: 'programada', ok: false, causa: 'drive: HTTP 403', enCurso: false });
    expect(await repo.ultimaCorridaBuena()).toMatchObject({ id: id1, origen: 'boton', ok: true, avisos: ['un aviso'], conteos: { en_taller: 1 } });
    // Con otra en curso, `ultimaCorrida` la devuelve pero `ultimaCorridaTerminada` sigue en la última cerrada.
    const id3 = (await repo.iniciarCorrida('boton', null))!;
    expect(await repo.ultimaCorrida()).toMatchObject({ id: id3, enCurso: true });
    expect(await repo.ultimaCorridaTerminada()).toMatchObject({ id: id2, ok: false, enCurso: false });
  });

  it('ultimaCorridaTerminada es null si solo hay una en curso', async () => {
    await repo.iniciarCorrida('boton', null);
    expect(await repo.ultimaCorridaTerminada()).toBeNull();
  });

  it('las vistas de psql leen la foto y dejan fuera las ilegibles revisadas', async () => {
    const id = (await repo.iniciarCorrida('boton', null))!;
    await repo.terminarBien(id, { foto: FOTO, exits: EXITS, ent: {}, avisos: [], conteos: {} });
    expect((await db.query('SELECT serial, estado FROM portal.equipos_v_equipos')).rows).toEqual([{ serial: '18A90001', estado: EST.TALLER }]);
    expect((await db.query('SELECT archivo FROM portal.equipos_v_remisiones_ilegibles')).rows).toEqual([{ archivo: 'PDFabcdefghij1' }]);
    await repo.guardarAjuste('pdf:PDFabcdefghij1', { t: 'pdf', m: '' }, { userId: null, usuario: 'x' });
    expect((await db.query('SELECT archivo FROM portal.equipos_v_remisiones_ilegibles')).rows).toEqual([]);
  });
});

describe('ajustes', () => {
  it('se guardan firmados (usuario y fecha de Colombia), se reescriben y se borran', async () => {
    const u = await usuario('tecnico@equipos.test');
    const a = await repo.guardarAjuste('1BA90001|2026-11-01', { t: 'in', m: 'sigue' }, { userId: u, usuario: 'tecnico@equipos.test' });
    expect(a).toMatchObject({ t: 'in', m: 'sigue', usuario: 'tecnico@equipos.test', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    await repo.guardarAjuste('1BA90001|2026-11-01', { t: 'out', m: 'recogido' }, { userId: u, usuario: 'tecnico@equipos.test' });
    expect(Object.keys(await repo.leerAjustes())).toEqual(['1BA90001|2026-11-01']);
    expect((await repo.leerAjustes())['1BA90001|2026-11-01'].t).toBe('out');
    await repo.borrarAjuste('1BA90001|2026-11-01');
    expect(await repo.leerAjustes()).toEqual({});
  });
});

describe('incidentes', () => {
  it('abrir, contar, avisar y cerrar; como mucho uno abierto', async () => {
    const id = (await repo.aplicarIncidente({ accion: 'abrir', fallosProgramados: 1, enviarAlerta: false }, null))!;
    await expect(db.query('INSERT INTO portal.equipos_incidente (fallos_programados) VALUES (0)')).rejects.toMatchObject({ code: '23505' });
    expect(await repo.aplicarIncidente({ accion: 'contar', fallosProgramados: 2, enviarAlerta: true }, id)).toBe(id);
    await repo.marcarAlerta(id, { ok: false, error: 'n8n respondió 500' });
    expect(await repo.incidenteAbierto()).toMatchObject({ id, fallosProgramados: 2, alertaEnviadaEn: null, alertaUltimoError: 'n8n respondió 500' });
    await repo.marcarAlerta(id, { ok: true });
    expect(await repo.incidenteAbierto()).toMatchObject({ alertaEnviadaEn: expect.any(String), alertaUltimoError: null });
    expect(await repo.aplicarIncidente({ accion: 'cerrar', fallosProgramados: 2, enviarAlerta: false }, id)).toBeNull();
    expect(await repo.incidenteAbierto()).toBeNull();
    expect(await repo.aplicarIncidente({ accion: 'abrir', fallosProgramados: 0, enviarAlerta: false }, null)).not.toBe(id);
  });
});

describe('llaves', () => {
  it('nacen apagadas; un admin las guarda firmadas; un usuario que no existe da null', async () => {
    const u = await usuario('tecnico@equipos.test', { app: true });
    expect(await repo.llavesDe(u)).toEqual({ editaAjustes: false, recibeAlertas: false });
    expect(await repo.llavesDe(null)).toEqual({ editaAjustes: false, recibeAlertas: false });
    const g = await repo.guardarLlaves(u, { editaAjustes: true, recibeAlertas: true }, 'admin@equipos.test');
    expect(g).toMatchObject({ userId: u, editaAjustes: true, recibeAlertas: true, actualizadoPor: 'admin@equipos.test' });
    expect(await repo.llavesDe(u)).toEqual({ editaAjustes: true, recibeAlertas: true });
    expect(await repo.guardarLlaves('00000000-0000-4000-8000-00000000dead', { editaAjustes: true, recibeAlertas: true }, 'a')).toBeNull();
  });

  it('la lista: activos con la app, y los admin; no los inactivos ni los que no tienen la app', async () => {
    await usuario('con-app@equipos.test', { app: true });
    await usuario('admin@equipos.test', { role: 'admin' });
    await usuario('sin-app@equipos.test');
    await usuario('baja@equipos.test', { app: true, status: 'inactive' });
    const l = (await repo.listarLlaves()).filter((x) => x.email.endsWith('@equipos.test'));
    expect(l.map((x) => [x.email, x.esAdmin])).toEqual([['admin@equipos.test', true], ['con-app@equipos.test', false]]);
  });

  it('guardarLlaves: solo a un usuario activo que sea admin o tenga la app; si no, null', async () => {
    const llaves = { editaAjustes: true, recibeAlertas: true };
    const sinApp = await usuario('sin-app@equipos.test');
    const baja = await usuario('baja@equipos.test', { app: true, status: 'inactive' });
    const admin = await usuario('admin@equipos.test', { role: 'admin' });
    expect(await repo.guardarLlaves(sinApp, llaves, 'x')).toBeNull();
    expect(await repo.guardarLlaves(baja, llaves, 'x')).toBeNull();
    expect(await repo.guardarLlaves(admin, llaves, 'x')).toMatchObject({ userId: admin, esAdmin: true });
    expect((await db.query('SELECT count(*)::int AS n FROM portal.equipos_llaves WHERE user_id = ANY($1::uuid[])', [[sinApp, baja]])).rows[0].n).toBe(0);
  });

  it('los correos de la alerta: dejan de llegar a quien perdió la app; un admin los recibe sin tenerla', async () => {
    const a = await usuario('recibe@equipos.test', { app: true });
    const perdio = await usuario('perdio@equipos.test', { app: true });
    const admin = await usuario('admin@equipos.test', { role: 'admin' });
    for (const u of [a, perdio, admin]) await repo.guardarLlaves(u, { editaAjustes: false, recibeAlertas: true }, 'x');
    await db.query('DELETE FROM portal.user_apps WHERE user_id = $1', [perdio]);
    expect((await repo.correosAlerta()).filter((x) => x.endsWith('@equipos.test'))).toEqual(['admin@equipos.test', 'recibe@equipos.test']);
  });

  it('los correos de la alerta: activos con recibe_alertas', async () => {
    const a = await usuario('recibe@equipos.test', { app: true });
    const b = await usuario('baja@equipos.test', { app: true, status: 'inactive' });
    const c = await usuario('edita@equipos.test', { app: true });
    await repo.guardarLlaves(a, { editaAjustes: false, recibeAlertas: true }, 'x');
    await repo.guardarLlaves(b, { editaAjustes: false, recibeAlertas: true }, 'x');
    await repo.guardarLlaves(c, { editaAjustes: true, recibeAlertas: false }, 'x');
    expect((await repo.correosAlerta()).filter((x) => x.endsWith('@equipos.test'))).toEqual(['recibe@equipos.test']);
  });
});
