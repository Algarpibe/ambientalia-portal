import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';

// Cableado HTTP del router: guardas de auth/app y validación 400 antes de
// cualquier escritura. El SQL lo cubre trazabilidad.db.test.ts; aquí el pool
// es un doble que registra las consultas para comprobar que no se escribió nada.

const SECRET = 'test-secret-trazabilidad';
process.env.JWT_SECRET = SECRET;

const authState = vi.hoisted(() => ({ byUser: new Map<string, { role: string; apps: string[] }>() }));
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async (_sql: string, params: unknown[] = []) => {
      const row = authState.byUser.get(String(params[0] ?? '')) ?? { role: 'reader', apps: ['trazabilidad-mantenimientos'] };
      return { rows: [{ role: row.role, status: 'active', apps: row.apps, token_version: 0 }], rowCount: 1 };
    },
    on: () => {},
  }),
}));

const { createTrazabilidadRouter } = await import('./router.js');
const { reiniciarRegistroEstados } = await import('./registro-estados.js');
const { crearFuenteAgenda } = await import('./fuente.js');
type DbLectura = import('./fuente.js').DbLectura;

const { PERMISOS, ROLES_APP, permisosDe, puede } = await import('./roles.js');
type Permiso = (typeof PERMISOS)[number];
type RolApp = (typeof ROLES_APP)[number];

/** El rol guardado de cada usuario (portal.tmc_user_roles). Sin entrada = sin fila = LECTOR. */
const rolesApp = new Map<string, string>();
/** Usuarios que «existen» en portal.users para el PUT de roles, con su rol en el portal. */
const usuariosPortal = new Map<string, 'admin' | 'reader'>();
const usuarios = { add: (id: string, role: 'admin' | 'reader' = 'reader') => usuariosPortal.set(id, role), clear: () => usuariosPortal.clear() };
/** Las consultas de negocio. La del rol de quien pide NO entra aquí: va antes y no es de negocio. */
const queries: string[] = [];
/** Veces que se ha mirado el rol de alguien. */
const consultasRol = { n: 0 };
/**
 * Veces que se ha pedido una conexión para una transacción (las piden el registro de estados, la pasada
 * de la agenda y el alta de asignaciones). Sólo se da si `cliente` es true: por defecto revienta.
 */
const conexiones = { n: 0, cliente: false };
type Filas = Record<string, unknown>[];
/** Lo que el doble contesta a las consultas que casan (filas, o un número = filas afectadas). La primera que casa gana. */
let respuestas: [RegExp, Filas | number][] = [];
/** La configuración de la agenda tal como la siembra la 051: 3 / 4 / 2 puestos y sólo las «*». */
const CONFIG_AGENDA: [RegExp, Filas][] = [
  [/^SELECT[^]*FROM portal\.tmc_agenda_etapas/, [['diagnostico', 'Diagnóstico', 3], ['proceso', 'Proceso', 4], ['verificacion', 'Verificación', 2]].map(([etapa, etiqueta, puestos], i) => ({ etapa, etiqueta, orden: i + 1, puestos, actualizado_por: null, actualizado_en: null }))],
  [/^SELECT[^]*FROM portal\.tmc_agenda_duraciones/, [['diagnostico', 3], ['proceso', 4], ['verificacion', 1]].map(([etapa, dias_habiles]) => ({ etapa, tipo: '*', dias_habiles, actualizado_por: null, actualizado_en: null }))],
];
const fakePool = {
  query: async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM portal.tmc_user_roles') && sql.includes('WHERE user_id')) {
      consultasRol.n++;
      const role = rolesApp.get(String(params[0]));
      return { rows: role ? [{ role }] : [], rowCount: role ? 1 : 0 };
    }
    queries.push(sql);
    if (sql.includes('FROM portal.users WHERE id')) {
      const role = usuariosPortal.get(String(params[0]));
      return { rows: role ? [{ role }] : [], rowCount: role ? 1 : 0 };
    }
    const r = respuestas.find(([patron]) => patron.test(sql))?.[1] ?? [];
    return typeof r === 'number' ? { rows: [], rowCount: r } : { rows: r, rowCount: r.length };
  },
  connect: async () => {
    conexiones.n++;
    if (!conexiones.cliente) throw new Error('sin transacciones en este test');
    return { query: fakePool.query, release: () => {} };
  },
} as unknown as Pool;

// La fuente de la agenda de estas pruebas: sin Desk 2.0, es decir, la réplica (respaldo), con tres
// tickets abiertos. Su asunto y su código (que suelen llevar cliente y serial) no deben salir nunca.
const SINC = Date.UTC(2026, 9, 6, 12, 0, 0);
const filaTicket = (numero: number, estado: string, extra: Filas[number] = {}) => ({ numero, estado, tipo_estado: 'Open', clasificacion: null, tipo_servicio: null, remision_entrada: null, fecha_creacion: '2026-10-01', prioridad: null, llegada_ms: null, asunto: `Asunto reservado ${numero}`, codigo_servicio: `MT_18A0${numero}_EDM180C`, ...extra });
let ticketsFuente: Filas = [];
const baseTickets: DbLectura = { query: async (sql) => ({ rows: sql.includes('max(synced_at)') ? [{ ms: SINC }] : sql.includes('calendario_cierres') ? [] : ticketsFuente }) };
/** La app con esa fuente; `desk2` le pone delante una «Desk 2.0» (la misma base, o una rota). Da conexiones al doble (transacciones). */
function appAgenda(desk2: DbLectura | null = null) {
  conexiones.cliente = true;
  const a = express();
  a.use(express.json());
  a.use('/api', createTrazabilidadRouter(fakePool, crearFuenteAgenda({ hub: baseTickets, desk2: () => desk2, ahora: () => SINC + 60_000 })));
  return a;
}
const HOY = '2026-10-06';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api', createTrazabilidadRouter(fakePool));
  return a;
}

let seq = 0;
/**
 * Un usuario nuevo y su token. Por defecto tiene la app y es Director Técnico,
 * para que las pruebas de validación lleguen a la validación; `rol: null` lo
 * deja sin fila (LECTOR) y `portal: 'admin'` lo hace administrador del portal.
 */
function tokenFor(apps: string[] = ['trazabilidad-mantenimientos'], opts: { rol?: string | null; portal?: string } = {}): string {
  const userId = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  authState.byUser.set(userId, { role: opts.portal ?? 'reader', apps });
  const rol = opts.rol === undefined ? 'DIRECTOR_TECNICO' : opts.rol;
  if (rol) rolesApp.set(userId, rol);
  return jwt.sign({ sub: `u${seq}@ambientalia.com.co`, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' });
}
const auth = (t = tokenFor()) => ({ Authorization: `Bearer ${t}` });
/** Cabecera de alguien con la app y ese rol (`null` = sin fila). */
const conRol = (rol: string | null) => auth(tokenFor(undefined, { rol }));
/** Cabecera de un administrador del portal: sin la app asignada y sin fila de rol. */
const comoAdmin = () => auth(tokenFor([], { rol: null, portal: 'admin' }));

beforeEach(() => {
  queries.length = 0;
  conexiones.n = 0;
  conexiones.cliente = false;
  consultasRol.n = 0;
  usuarios.clear();
  respuestas = [...CONFIG_AGENDA];
  ticketsFuente = [filaTicket(880, 'Ingresado'), filaTicket(984, 'En Proceso'), filaTicket(990, 'En Proceso')];
  reiniciarRegistroEstados();
});

describe('guardas', () => {
  it('401 sin token', async () => {
    expect((await request(app()).get('/api/trazabilidad/equipos')).status).toBe(401);
  });

  it('403 sin la app asignada', async () => {
    const res = await request(app()).get('/api/trazabilidad/equipos').set(auth(tokenFor(['ausencias'])));
    expect(res.status).toBe(403);
  });

  it('200 con la app: devuelve hoy, equipos, la última importación y los contactos puestos a mano', async () => {
    const res = await request(app()).get('/api/trazabilidad/equipos?hoy=2026-10-06').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hoy: '2026-10-06', equipos: [], ultimaImportacion: null, contactos: [] });
  });

  it('400 con un «hoy» mal formado', async () => {
    const res = await request(app()).get('/api/trazabilidad/equipos?hoy=06-10-2026').set(auth());
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('hoy');
  });
});

// Roles de la app: cada escritura comprueba el permiso EN EL SERVIDOR, antes de
// validar y antes de cualquier consulta de negocio. Las lecturas siguen abiertas
// a quien tenga la app. La matriz (qué puede cada rol) la recorre roles.test.ts;
// aquí se comprueba que cada ruta pide el permiso que le toca.
describe('permisos por rol', () => {
  type Pedir = (cabecera: { Authorization: string }) => request.Test;
  const fila = { serial: '18A00001', cliente: 'Cliente Uno', marca: 'Grimm', modelo: 'EDM 180C' };
  const ESCRITURAS: { ruta: string; permiso: Permiso; pedir: Pedir }[] = [
    { ruta: 'PUT /trazabilidad/contactos', permiso: 'contactos.write', pedir: (c) => request(app()).put('/api/trazabilidad/contactos').set(c).send({ cliente: 'Cliente Uno', emails: ['compras@cliente-uno.example'] }) },
    { ruta: 'POST /trazabilidad/importaciones?simular=1', permiso: 'importar', pedir: (c) => request(app()).post('/api/trazabilidad/importaciones?simular=1').set(c).send({ archivo: 'x.xlsx', filas: [fila] }) },
    { ruta: 'PUT /trazabilidad/seguimiento/:clave', permiso: 'seguimiento.write', pedir: (c) => request(app()).put('/api/trazabilidad/seguimiento/18A00001').set(c).send({ enAmbientalia: true }) },
    { ruta: 'POST /trazabilidad/avisos', permiso: 'avisos.write', pedir: (c) => request(app()).post('/api/trazabilidad/avisos').set(c).send({ claves: ['18A00001'], fecha: '2026-10-06' }) },
    { ruta: 'PUT /trazabilidad/servicios/:numero/tipo', permiso: 'servicios.tipo.write', pedir: (c) => request(app()).put('/api/trazabilidad/servicios/962/tipo').set(c).send({ tipo: 'Diagnóstico' }) },
    { ruta: 'PUT /trazabilidad/plazos', permiso: 'config.write', pedir: (c) => request(app()).put('/api/trazabilidad/plazos').set(c).send({ tipo: 'Diagnóstico', dias: 3 }) },
    { ruta: 'PUT /trazabilidad/estados', permiso: 'config.write', pedir: (c) => request(app()).put('/api/trazabilidad/estados').set(c).send({ estado: 'Servicio externo', rol: 'standby' }) },
    // La agenda del taller (lote 5): sus cuatro escrituras y las tres de su configuración.
    { ruta: 'POST /trazabilidad/agenda/reparto', permiso: 'agenda.reparto', pedir: (c) => request(appAgenda()).post('/api/trazabilidad/agenda/reparto').set(c).send({ reparto: [{ numero: 984, etapa: 'proceso', puesto: 1 }] }) },
    { ruta: 'POST /trazabilidad/agenda/asignaciones', permiso: 'agenda.asignar', pedir: (c) => request(appAgenda()).post('/api/trazabilidad/agenda/asignaciones').set(c).send({ numero: 984, etapa: 'proceso', puesto: 1 }) },
    { ruta: 'POST /trazabilidad/agenda/liberar', permiso: 'agenda.liberar', pedir: (c) => request(appAgenda()).post('/api/trazabilidad/agenda/liberar').set(c).send({ numero: 984, motivo: 'El equipo ya salió' }) },
    { ruta: 'PUT /trazabilidad/agenda/flujo/:numero', permiso: 'agenda.flujo', pedir: (c) => request(appAgenda()).put('/api/trazabilidad/agenda/flujo/880').set(c).send({ flujo: 'equipo_nuevo' }) },
    { ruta: 'PUT /trazabilidad/agenda/configuracion/puestos', permiso: 'config.write', pedir: (c) => request(appAgenda()).put('/api/trazabilidad/agenda/configuracion/puestos').set(c).send({ etapa: 'proceso', puestos: 5 }) },
    { ruta: 'PUT /trazabilidad/agenda/configuracion/duraciones', permiso: 'config.write', pedir: (c) => request(appAgenda()).put('/api/trazabilidad/agenda/configuracion/duraciones').set(c).send({ etapa: 'proceso', tipo: '*', dias: 4 }) },
    { ruta: 'PUT /trazabilidad/agenda/configuracion/estados', permiso: 'config.write', pedir: (c) => request(appAgenda()).put('/api/trazabilidad/agenda/configuracion/estados').set(c).send({ estado: 'Ingresado', categoria: 'entrada' }) },
  ];
  const casos = ESCRITURAS.flatMap((e) => ROLES_APP.map((rol) => ({ ...e, rol, pasa: puede(rol, e.permiso) })));

  it('son las catorce escrituras del router, cada una con SU permiso, y ninguna queda sin guarda: toda ruta que escribe pasa por escritura() o soloAdmin()', () => {
    const src = readFileSync(fileURLToPath(new URL('./router.ts', import.meta.url)), 'utf8');
    const rutas = src.split(/\n\s*router\./).slice(1);
    const escriben = rutas.filter((r) => /^(post|put|patch|delete)\(/.test(r));
    expect(escriben).toHaveLength(ESCRITURAS.length + 1); // + PUT /trazabilidad/roles/:userId
    for (const r of escriben) expect(r).toMatch(/\.\.\.gated,\s*(escritura\('[a-z.]+',|soloAdmin\()/);
    // Ruta a ruta: el permiso que pide el código es el de la lista (y el de la tabla de permisos del CLAUDE.md).
    const pedidos = escriben.flatMap((r) => {
      const [, metodo, ruta] = /^(\w+)\(\s*'([^']+)'/.exec(r)!;
      const permiso = /escritura\('([a-z.]+)'/.exec(r)?.[1];
      return permiso ? [`${metodo.toUpperCase()} ${ruta} → ${permiso}`] : [];
    });
    expect(pedidos.sort()).toEqual(ESCRITURAS.map((e) => `${e.ruta.split('?')[0]} → ${e.permiso}`).sort());
    // Las de la agenda, además, sólo con permisos de la agenda o el de configuración.
    const deAgenda = escriben.filter((r) => /^\w+\(\s*'\/trazabilidad\/agenda\//.test(r));
    expect(deAgenda).toHaveLength(7);
    for (const r of deAgenda) expect(r).toMatch(/escritura\('(agenda\.(reparto|asignar|liberar|flujo)|config\.write)',/);
    // Ninguna lectura lleva guarda de escritura; la única que pide permiso es la propuesta de reparto.
    const lecturas = rutas.filter((x) => /^get\(/.test(x));
    for (const r of lecturas) expect(r).not.toMatch(/escritura\(/);
    expect(lecturas.filter((r) => /conPermiso\(/.test(r)).map((r) => /^get\(\s*'([^']+)'[^]*?conPermiso\('([a-z.]+)'/.exec(r)!.slice(1))).toEqual([['/trazabilidad/agenda/reparto', 'agenda.reparto']]);
  });

  it.each(casos.filter((c) => !c.pasa))('$rol no puede $ruta → 403 en español y ninguna consulta de negocio', async ({ rol, pedir }) => {
    const res = await pedir(conRol(rol === 'LECTOR' ? null : rol));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
    expect(res.body.message).toMatch(/^Tu rol en Trazabilidad \(.+\) no permite /);
    expect(queries).toEqual([]);
    expect(conexiones.n).toBe(0);
  });

  it.each(casos.filter((c) => c.pasa))('$rol sí puede $ruta', async ({ pedir, rol }) => {
    const res = await pedir(conRol(rol));
    expect([200, 404]).toContain(res.status); // 404 = pasó el permiso y no encontró el equipo o el ticket en el doble
    expect(queries.length).toBeGreaterThan(0);
  });

  it.each(ESCRITURAS)('sin fila de rol se es LECTOR: $ruta → 403', async ({ pedir }) => {
    const res = await pedir(conRol(null));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/\(Lector\)/);
    expect(queries).toEqual([]);
  });

  it.each(ESCRITURAS)('un rol guardado que no se conoce vale lo que LECTOR: $ruta → 403', async ({ pedir }) => {
    expect((await pedir(conRol('JEFE'))).status).toBe(403);
    expect(queries).toEqual([]);
  });

  it.each(ESCRITURAS)('un administrador del portal puede $ruta sin la app asignada ni fila de rol, y sin que se mire su rol', async ({ pedir }) => {
    const res = await pedir(comoAdmin());
    expect([200, 404]).toContain(res.status);
    expect(consultasRol.n).toBe(0);
  });

  it('el permiso va antes que la validación: un cuerpo no válido de un LECTOR es 403, no 400', async () => {
    const c = conRol(null);
    expect((await request(app()).put('/api/trazabilidad/plazos').set(c).send({ tipo: '', dias: 'tres' })).status).toBe(403);
    expect((await request(app()).put('/api/trazabilidad/seguimiento/a%20b').set(c).send({})).status).toBe(403);
    expect((await request(app()).put('/api/trazabilidad/servicios/abc/tipo').set(c).send({})).status).toBe(403);
    expect((await request(app()).put('/api/trazabilidad/contactos?hoy=ayer').set(c).send([])).status).toBe(403);
    expect(queries).toEqual([]);
  });

  it('importar de verdad (sin simular) tampoco: 403 y ni se abre la transacción', async () => {
    for (const rol of [null, 'COMERCIAL', 'TECNICO']) {
      const res = await request(app()).post('/api/trazabilidad/importaciones').set(conRol(rol)).send({ archivo: 'x.xlsx', filas: [fila] });
      expect(res.status).toBe(403);
    }
    expect(queries).toEqual([]);
    expect(conexiones.n).toBe(0);
  });

  it('sin la app asignada manda el 403 de la app, tenga el rol que tenga, y no se mira el rol', async () => {
    for (const { pedir } of ESCRITURAS) {
      const res = await pedir(auth(tokenFor(['ausencias'], { rol: 'DIRECTOR_TECNICO' })));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden');
    }
    expect(consultasRol.n).toBe(0);
    expect(queries).toEqual([]);
  });

  it('401 sin token en todas las escrituras', async () => {
    for (const { pedir } of ESCRITURAS) expect((await pedir({ Authorization: '' })).status).toBe(401);
    expect(queries).toEqual([]);
  });

  it.each(['/equipos', '/servicios', '/plazos', '/estados'])('leer sigue abierto a un LECTOR, y no hace falta mirar su rol: GET %s → 200', async (ruta) => {
    const res = await request(app()).get(`/api/trazabilidad${ruta}`).set(conRol(null));
    expect(res.status).toBe(200);
    expect(consultasRol.n).toBe(0);
  });
});

describe('roles: quién soy', () => {
  const me = (c?: { Authorization: string }) => {
    const r = request(app()).get('/api/trazabilidad/roles/me');
    return c ? r.set(c) : r;
  };

  it('401 sin token y 403 sin la app', async () => {
    expect((await me()).status).toBe(401);
    expect((await me(auth(tokenFor(['ausencias'])))).status).toBe(403);
    expect(queries).toEqual([]);
  });

  it('con la app y sin fila de rol se es LECTOR: ningún permiso', async () => {
    const res = await me(conRol(null));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'LECTOR', admin: false, permissions: [], canManageRoles: false });
    expect(res.body.email).toMatch(/@ambientalia\.com\.co$/);
    expect(res.body.userId).toMatch(/^00000000-0000-4000-8000-/);
    expect(queries).toEqual([]);
  });

  it.each([...ROLES_APP])('con el rol %s guardado devuelve ese rol y sus permisos de la matriz', async (rol) => {
    const res = await me(conRol(rol));
    expect(res.body).toMatchObject({ role: rol, admin: false, canManageRoles: false });
    expect(res.body.permissions).toEqual(permisosDe(rol as RolApp));
    expect(res.body.permissions).not.toContain('roles.manage');
  });

  it('un rol guardado que no se conoce cae a LECTOR', async () => {
    expect((await me(conRol('JEFE'))).body).toMatchObject({ role: 'LECTOR', permissions: [] });
  });

  it('un administrador del portal tiene todos los permisos y gestiona roles, sin la app y sin fila', async () => {
    const res = await me(comoAdmin());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'LECTOR', admin: true, canManageRoles: true });
    expect(res.body.permissions).toEqual([...PERMISOS]);
  });

  it('un administrador con rol guardado conserva el rol a la vista, y sigue pudiendo todo', async () => {
    const res = await me(auth(tokenFor([], { rol: 'COMERCIAL', portal: 'admin' })));
    expect(res.body).toMatchObject({ role: 'COMERCIAL', admin: true });
    expect(res.body.permissions).toEqual([...PERMISOS]);
  });
});

describe('roles: repartirlos (sólo administradores del portal)', () => {
  const ID = '00000000-0000-4000-8000-999999999999';
  const lista = (c?: { Authorization: string }) => {
    const r = request(app()).get('/api/trazabilidad/roles');
    return c ? r.set(c) : r;
  };
  const put = (userId: string, body: unknown, c?: { Authorization: string }) => {
    const r = request(app()).put(`/api/trazabilidad/roles/${userId}`);
    return (c ? r.set(c) : r).send(body as object);
  };

  it('401 sin token y 403 sin la app, en la lista y en el cambio', async () => {
    expect((await lista()).status).toBe(401);
    expect((await put(ID, { role: 'TECNICO' })).status).toBe(401);
    expect((await lista(auth(tokenFor(['ausencias'])))).status).toBe(403);
    expect((await put(ID, { role: 'TECNICO' }, auth(tokenFor(['ausencias'])))).status).toBe(403);
    expect(queries).toEqual([]);
  });

  it.each([...ROLES_APP])('ni siquiera un %s que no sea administrador: 403 en español, en la lista y en el cambio, sin tocar nada', async (rol) => {
    usuarios.add(ID);
    for (const res of [await lista(conRol(rol)), await put(ID, { role: 'DIRECTOR_TECNICO' }, conRol(rol))]) {
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden_admin');
      expect(res.body.message).toMatch(/administrador del portal/);
    }
    expect(queries).toEqual([]);
  });

  it('nadie se sube el rol a sí mismo', async () => {
    const t = tokenFor(undefined, { rol: 'COMERCIAL' });
    const yo = (jwt.decode(t) as { user_id: string }).user_id;
    usuarios.add(yo);
    expect((await put(yo, { role: 'DIRECTOR_TECNICO' }, auth(t))).status).toBe(403);
    expect(rolesApp.get(yo)).toBe('COMERCIAL');
    expect(queries).toEqual([]);
  });

  it('un administrador ve la lista', async () => {
    const res = await lista(comoAdmin());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ usuarios: [] });
    expect(queries.some((q) => /portal\.user_apps/.test(q) && /portal\.tmc_user_roles/.test(q))).toBe(true);
  });

  it.each(['abc', '123', `${ID}x`, '00000000-0000-4000-8000-99999999999g'])('un usuario que no es un UUID (%s) → 400 en «userId» y ninguna consulta', async (userId) => {
    const res = await put(userId, { role: 'TECNICO' }, comoAdmin());
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('userId');
    expect(queries).toEqual([]);
  });

  it.each([undefined, null, '', 'ADMIN', 'admin', 'tecnico', ' TECNICO', 3, true, ['TECNICO'], { a: 1 }, 'constructor'])('un rol que no es de la matriz (%j) → 400 en «role» y ninguna consulta', async (role) => {
    usuarios.add(ID);
    const res = await put(ID, { role }, comoAdmin());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_input');
    expect(res.body.field).toBe('role');
    expect(res.body.message).toMatch(/LECTOR, COMERCIAL, TECNICO, DIRECTOR_TECNICO/);
    expect(queries).toEqual([]);
  });

  it('un cuerpo que no es un objeto → 400', async () => {
    expect((await put(ID, [], comoAdmin())).status).toBe(400);
    expect(queries).toEqual([]);
  });

  it('un usuario que no existe → 404 y no se escribe nada', async () => {
    const res = await put(ID, { role: 'TECNICO' }, comoAdmin());
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/usuario/i);
    expect(queries.some((q) => /INSERT|UPDATE|DELETE/.test(q))).toBe(false);
  });

  it.each([...ROLES_APP])('un administrador pone el rol %s: 200 con {userId, role} y lo escribe', async (role) => {
    usuarios.add(ID);
    const res = await put(ID.toUpperCase(), { role }, comoAdmin());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: ID, role });
    expect(queries.some((q) => /INSERT INTO portal\.tmc_user_roles/.test(q))).toBe(true);
  });

  // Un administrador del portal lo puede todo sin rol: ponerle uno no cambiaría
  // nada y dejaría un dato que engaña. La lista lo enseña en sólo lectura y el
  // servidor lo rechaza igual, lo pida quien lo pida.
  it.each([...ROLES_APP])('a un administrador del portal no se le pone rol (%s): 409 en español y no se escribe nada', async (role) => {
    usuarios.add(ID, 'admin');
    const res = await put(ID, { role }, comoAdmin());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('usuario_admin');
    expect(res.body.message).toMatch(/administrador del portal/);
    expect(queries.some((q) => /INSERT|UPDATE|DELETE/.test(q))).toBe(false);
  });
});

describe('servicios y plazos', () => {
  it('servicios: 401 sin token y 403 sin la app', async () => {
    expect((await request(app()).get('/api/trazabilidad/servicios')).status).toBe(401);
    expect((await request(app()).get('/api/trazabilidad/servicios').set(auth(tokenFor(['ausencias'])))).status).toBe(403);
    expect((await request(app()).get('/api/trazabilidad/plazos').set(auth(tokenFor(['ausencias'])))).status).toBe(403);
    expect((await request(app()).put('/api/trazabilidad/plazos').set(auth(tokenFor(['ausencias']))).send({ tipo: 'Otro', dias: 2 })).status).toBe(403);
  });

  it('servicios: 200 con hoy, la lista y los festivos del eje', async () => {
    const res = await request(app()).get('/api/trazabilidad/servicios?hoy=2026-10-06').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hoy: '2026-10-06', servicios: [] });
    expect(res.body.festivos).toContain('2026-10-12');
  });

  it('servicios: 400 con un «hoy» mal formado', async () => {
    const res = await request(app()).get('/api/trazabilidad/servicios?hoy=ayer').set(auth());
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('hoy');
  });

  it('plazos: 200 con la lista', async () => {
    const res = await request(app()).get('/api/trazabilidad/plazos').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ plazos: [] });
  });

  it.each([0, 366, -1, 1.5, '3', 'tres', true])('plazo no válido (%j) → 400 en «dias» y ninguna consulta', async (dias) => {
    const res = await request(app()).put('/api/trazabilidad/plazos').set(auth()).send({ tipo: 'Diagnóstico', dias });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('dias');
    expect(res.body.message).toMatch(/entre 1 y 365/);
    expect(queries).toEqual([]);
  });

  it('plazo sin tipo de servicio → 400 en «tipo»', async () => {
    const res = await request(app()).put('/api/trazabilidad/plazos').set(auth()).send({ tipo: '  ', dias: 3 });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('tipo');
    expect(queries).toEqual([]);
  });

  it.each(['Diagnóstico + Calibración', ' diagnostico  +  CALIBRACION '])('el plazo del tipo compuesto (%j) no se edita → 400 en «tipo» y ninguna consulta', async (tipo) => {
    for (const dias of [7, null]) {
      const res = await request(app()).put('/api/trazabilidad/plazos').set(auth()).send({ tipo, dias });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_input');
      expect(res.body.field).toBe('tipo');
      expect(res.body.message).toMatch(/se calcula sumando/);
    }
    expect(queries).toEqual([]);
  });

  it('plazo válido, o vacío para dejarlo «sin plazo» → 200', async () => {
    for (const dias of [1, 365, null]) {
      const res = await request(app()).put('/api/trazabilidad/plazos').set(auth()).send({ tipo: 'Diagnóstico', dias });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ plazos: [] });
    }
    expect(queries.some((q) => /INSERT INTO portal\.tmc_plazos/.test(q))).toBe(true);
  });

  it('servicios: la respuesta trae también los tipos que se pueden elegir a mano', async () => {
    const res = await request(app()).get('/api/trazabilidad/servicios?hoy=2026-10-06').set(auth());
    expect(res.body.tipos).toEqual([]);
  });
});

describe('tipo de servicio puesto a mano', () => {
  const put = (numero: string, body: unknown, t = auth()) => request(app()).put(`/api/trazabilidad/servicios/${numero}/tipo`).set(t).send(body as object);

  it('401 sin token y 403 sin la app', async () => {
    expect((await request(app()).put('/api/trazabilidad/servicios/962/tipo').send({ tipo: 'Diagnóstico' })).status).toBe(401);
    expect((await put('962', { tipo: 'Diagnóstico' }, auth(tokenFor(['ausencias'])))).status).toBe(403);
    expect(queries).toEqual([]);
  });

  it.each(['0', '-3', '1.5', 'abc', '12a', '9999999999', '%20'])('número de ticket no válido (%s) → 400 en «numero» y ninguna consulta', async (numero) => {
    const res = await put(numero, { tipo: 'Diagnóstico' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('numero');
    expect(res.body.message).toMatch(/número de ticket/i);
    expect(queries).toEqual([]);
  });

  it.each([3, true, ['Diagnóstico'], { a: 1 }])('tipo que no es texto (%j) → 400 en «tipo» y ninguna consulta', async (tipo) => {
    const res = await put('962', { tipo });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('tipo');
    expect(queries).toEqual([]);
  });

  it('sin el campo «tipo», o con un cuerpo que no es un objeto → 400', async () => {
    expect((await put('962', {})).body.field).toBe('tipo');
    expect((await put('962', [])).status).toBe(400);
    expect(queries).toEqual([]);
  });

  it('un tipo demasiado largo → 400 en «tipo»', async () => {
    const res = await put('962', { tipo: 'x'.repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('tipo');
    expect(queries).toEqual([]);
  });

  it('un ticket que no está en Desk → 404 y no se escribe nada', async () => {
    for (const tipo of ['Diagnóstico', null, '']) {
      const res = await put('962', { tipo });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/ticket/i);
    }
    expect(queries.some((q) => /INSERT|DELETE|UPDATE/.test(q))).toBe(false);
  });
});

describe('estados de Desk (rol en el reloj)', () => {
  const put = (body: unknown, t = auth()) => request(app()).put('/api/trazabilidad/estados').set(t).send(body as object);

  it('401 sin token y 403 sin la app, en el GET y en el PUT', async () => {
    expect((await request(app()).get('/api/trazabilidad/estados')).status).toBe(401);
    expect((await request(app()).put('/api/trazabilidad/estados').send({ estado: 'Servicio externo', rol: 'standby' })).status).toBe(401);
    expect((await request(app()).get('/api/trazabilidad/estados').set(auth(tokenFor(['ausencias'])))).status).toBe(403);
    expect((await put({ estado: 'Servicio externo', rol: 'standby' }, auth(tokenFor(['ausencias'])))).status).toBe(403);
    expect(queries).toEqual([]);
  });

  it('GET: 200 con la lista', async () => {
    const res = await request(app()).get('/api/trazabilidad/estados').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estados: [] });
  });

  it.each([undefined, null, '', '   ', 3, true, ['Servicio externo'], { a: 1 }])('estado no válido (%j) → 400 en «estado» y ninguna consulta', async (estado) => {
    const res = await put({ estado, rol: 'standby' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_input');
    expect(res.body.field).toBe('estado');
    expect(queries).toEqual([]);
  });

  it('un estado de más de 80 caracteres → 400 en «estado»; con 80 justos vale', async () => {
    const largo = await put({ estado: 'x'.repeat(81), rol: 'standby' });
    expect(largo.status).toBe(400);
    expect(largo.body.field).toBe('estado');
    expect(largo.body.message).toMatch(/80 caracteres/);
    expect(queries).toEqual([]);
    expect((await put({ estado: 'x'.repeat(80), rol: 'standby' })).status).toBe(200);
  });

  it.each([undefined, null, true, false, 1, 0, '', 'Standby', ' standby', 'STANDBY', 'pausa', 'trabajo terminado', 'constructor', ['standby'], { rol: 'standby' }])(
    'rol que no es uno de los tres (%j) → 400 en «rol» y ninguna consulta',
    async (rol) => {
      const res = await put({ estado: 'Servicio externo', rol });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_input');
      expect(res.body.field).toBe('rol');
      expect(res.body.message).toMatch(/«cuenta», «standby» o «terminado»/);
      expect(queries).toEqual([]);
    },
  );

  it('el booleano de antes ya no vale: {estado, standby} → 400 en «rol»', async () => {
    const res = await put({ estado: 'Servicio externo', standby: true });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('rol');
    expect(queries).toEqual([]);
  });

  it('un cuerpo que no es un objeto → 400', async () => {
    expect((await put([])).status).toBe(400);
    expect(queries).toEqual([]);
  });

  it.each(['cuenta', 'standby', 'terminado'])('rol «%s» → 200 con la lista entera; vale un estado que ningún ticket usa todavía', async (rol) => {
    const res = await put({ estado: 'Estado que aún no existe', rol });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estados: [] });
    expect(queries.some((q) => /INSERT INTO portal\.tmc_estados_desk/.test(q))).toBe(true);
  });

  // Lo aplazado del lote 2: la pantalla de hoy envía {estado, rol} y así debe seguir valiendo.
  it('el cuerpo que envía hoy la pantalla ({estado, rol}) basta, y guardar el rol no nombra la categoría ni su firma, venga lo que venga de más', async () => {
    for (const cuerpo of [{ estado: 'Por Facturar', rol: 'terminado' }, { estado: 'Por Facturar', rol: 'terminado', categoria: 'fuera', etapa: 'proceso' }]) {
      queries.length = 0;
      expect((await put(cuerpo)).status).toBe(200);
      const escrituras = queries.filter((q) => /\b(INSERT|UPDATE|DELETE)\b/.test(q));
      expect(escrituras).toHaveLength(1);
      expect(escrituras[0]).toMatch(/INSERT INTO portal\.tmc_estados_desk \(clave, etiqueta, rol, actualizado_por_id, actualizado_por, actualizado_en\)/);
      expect(escrituras[0]).not.toMatch(/categoria|etapa/);
    }
  });

  it('GET: cada estado lleva además su categoría en la agenda y la firma de la categoría, sin quitar ni renombrar lo que ya había', async () => {
    respuestas.unshift([
      /^SELECT clave, etiqueta, rol[^]*FROM portal\.tmc_estados_desk/,
      [
        { clave: 'por facturar', etiqueta: 'Por Facturar', rol: 'terminado', actualizado_por: 'gerencia@ambientalia.com.co', actualizado_en: '2026-10-06 10:00:00+00', categoria: 'fin', etapa: null, categoria_por: 'semilla (migracion 050)', categoria_en: '2026-10-05 09:00:00+00' },
        { clave: 'notificado', etiqueta: 'Notificado', rol: 'cuenta', actualizado_por: null, actualizado_en: null, categoria: 'activa', etapa: 'diagnostico', categoria_por: 'director@ambientalia.com.co', categoria_en: '2026-10-06 11:00:00+00' },
        { clave: 'estado raro', etiqueta: 'Estado raro', rol: 'standby', actualizado_por: 'gerencia@ambientalia.com.co', actualizado_en: '2026-10-06 10:00:00+00', categoria: null, etapa: null, categoria_por: null, categoria_en: null },
      ],
    ]);
    const res = await request(app()).get('/api/trazabilidad/estados').set(conRol(null));
    expect(res.status).toBe(200);
    const porClave = Object.fromEntries((res.body.estados as { clave: string }[]).map((e) => [e.clave, e]));
    expect(porClave['por facturar']).toEqual({
      clave: 'por facturar', etiqueta: 'Por Facturar', tipoDesk: null, ticketsAbiertos: 0, rol: 'terminado', actualizadoPor: 'gerencia@ambientalia.com.co', actualizadoEn: '2026-10-06 10:00:00+00',
      categoria: 'fin', etapa: null, categoriaPor: 'semilla (migracion 050)', categoriaEn: '2026-10-05 09:00:00+00',
    });
    expect(porClave.notificado).toMatchObject({ rol: 'cuenta', actualizadoPor: null, categoria: 'activa', etapa: 'diagnostico', categoriaPor: 'director@ambientalia.com.co' });
    // Sin categoría guardada ni en la propuesta: sin categoría y sin firma.
    expect(porClave['estado raro']).toMatchObject({ rol: 'standby', categoria: null, etapa: null, categoriaPor: null, categoriaEn: null });
  });

  it('servicios: sigue respondiendo 200 al leer también los roles de los estados y el historial', async () => {
    const res = await request(app()).get('/api/trazabilidad/servicios?hoy=2026-10-06').set(auth());
    expect(res.status).toBe(200);
    expect(queries.some((q) => /portal\.tmc_estados_desk/.test(q))).toBe(true);
    expect(queries.some((q) => /portal\.tmc_estados_historial/.test(q))).toBe(true);
  });
});

// Al pedir los servicios se apuntan antes los cambios de estado, para que la
// vista esté al día. Es «si se puede»: si falla, la petición sigue.
describe('servicios: apuntar los estados al leer', () => {
  beforeEach(() => {
    reiniciarRegistroEstados();
  });

  it('lo intenta antes de leer y, si falla, responde igual y lo deja en el registro de errores', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // El doble no da conexiones: el registro (que va en una transacción) revienta.
      const res = await request(app()).get('/api/trazabilidad/servicios?hoy=2026-10-06').set(auth());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ hoy: '2026-10-06', servicios: [], tipos: [] });
      expect(conexiones.n).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringMatching(/tmc_registrar_estados/), expect.any(Error));
    } finally {
      error.mockRestore();
    }
  });

  it('un «hoy» mal formado corta antes: 400 y ni se intenta', async () => {
    const res = await request(app()).get('/api/trazabilidad/servicios?hoy=ayer').set(auth());
    expect(res.status).toBe(400);
    expect(conexiones.n).toBe(0);
  });

  it('sólo el GET lo hace: poner un tipo a mano no apunta nada', async () => {
    await request(app()).put('/api/trazabilidad/servicios/962/tipo').set(auth()).send({ tipo: 'Diagnóstico' });
    await request(app()).get('/api/trazabilidad/estados').set(auth());
    await request(app()).get('/api/trazabilidad/equipos').set(auth());
    expect(conexiones.n).toBe(0);
  });
});

// Contacto puesto a mano a un cliente (portal.tmc_contactos): a quién iría el
// aviso. Es parte de una SIMULACIÓN: el router sólo guarda y lee, no envía nada.
describe('contacto puesto a mano a un cliente', () => {
  const put = (body: unknown, t = auth()) => request(app()).put('/api/trazabilidad/contactos').set(t).send(body as object);
  const valido = { cliente: 'Cliente Uno', emails: ['compras@cliente-uno.example'] };

  it('401 sin token y 403 sin la app', async () => {
    expect((await request(app()).put('/api/trazabilidad/contactos').send(valido)).status).toBe(401);
    expect((await put(valido, auth(tokenFor(['ausencias'])))).status).toBe(403);
    expect(queries).toEqual([]);
  });

  it.each([undefined, null, '', '   ', ['Cliente Uno'], { a: 1 }, true])('cliente no válido (%j) → 400 en «cliente» y ninguna consulta', async (cliente) => {
    const res = await put({ ...valido, cliente });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_input');
    expect(res.body.field).toBe('cliente');
    expect(queries).toEqual([]);
  });

  it('un cliente de más de 200 caracteres → 400 en «cliente»; con 200 justos vale', async () => {
    const largo = await put({ ...valido, cliente: 'x'.repeat(201) });
    expect(largo.status).toBe(400);
    expect(largo.body.field).toBe('cliente');
    expect(largo.body.message).toMatch(/200 caracteres/);
    expect(queries).toEqual([]);
    expect((await put({ ...valido, cliente: 'x'.repeat(200) })).status).toBe(200);
  });

  it.each([undefined, null, 'compras@cliente-uno.example', 3, { a: 1 }])('«emails» que no es una lista (%j) → 400 en «emails» y ninguna consulta', async (emails) => {
    const res = await put({ cliente: 'Cliente Uno', emails });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('emails');
    expect(queries).toEqual([]);
  });

  it.each([
    { emails: ['no-es-un-correo'], campo: 'emails[0]' },
    { emails: ['compras@cliente-uno.example', 'a@b'], campo: 'emails[1]' },
    { emails: [3], campo: 'emails[0]' },
    { emails: [null], campo: 'emails[0]' },
    { emails: [''], campo: 'emails[0]' },
    { emails: [`${'x'.repeat(250)}@example.com`], campo: 'emails[0]' },
  ])('un correo que no vale ($emails) → 400 en su posición y ninguna consulta', async ({ emails, campo }) => {
    const res = await put({ cliente: 'Cliente Uno', emails });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe(campo);
    expect(res.body.message).toMatch(/correo/i);
    expect(queries).toEqual([]);
  });

  it('más de cinco correos distintos → 400 en «emails»; los repetidos no cuentan', async () => {
    const seis = Array.from({ length: 6 }, (_, i) => `c${i}@example.com`);
    const res = await put({ cliente: 'Cliente Uno', emails: seis });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('emails');
    expect(res.body.message).toMatch(/5/);
    expect(queries).toEqual([]);
    const repetidos = [...seis.slice(0, 5), ' C0@Example.com '];
    expect((await put({ cliente: 'Cliente Uno', emails: repetidos })).status).toBe(200);
  });

  it.each([3, true, ['Ana'], { a: 1 }])('nombre que no es texto (%j) → 400 en «nombre»', async (nombre) => {
    const res = await put({ ...valido, nombre });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('nombre');
    expect(queries).toEqual([]);
  });

  it('un nombre de más de 200 caracteres → 400 en «nombre»', async () => {
    const res = await put({ ...valido, nombre: 'x'.repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('nombre');
    expect(queries).toEqual([]);
  });

  it('un cuerpo que no es un objeto → 400', async () => {
    expect((await put([])).status).toBe(400);
    expect(queries).toEqual([]);
  });

  it('válido → 200 con el inventario entero ya actualizado; un correo interno se admite a mano', async () => {
    const res = await request(app())
      .put('/api/trazabilidad/contactos?hoy=2026-10-06')
      .set(auth())
      .send({ cliente: 'Cliente Uno', emails: ['compras@cliente-uno.example', 'alguien@ambientalia.com.co'], nombre: 'Ana Pérez' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hoy: '2026-10-06', equipos: [], ultimaImportacion: null, contactos: [] });
    expect(queries.some((q) => /INSERT INTO portal\.tmc_contactos/.test(q))).toBe(true);
  });

  it('con la lista vacía se quita el contacto puesto a mano: borra y no inserta', async () => {
    const res = await put({ cliente: 'Cliente Uno', emails: [] });
    expect(res.status).toBe(200);
    expect(queries.some((q) => /DELETE FROM portal\.tmc_contactos/.test(q))).toBe(true);
    expect(queries.some((q) => /INSERT INTO portal\.tmc_contactos/.test(q))).toBe(false);
  });

  it('400 con un «hoy» mal formado, antes de escribir', async () => {
    const res = await request(app()).put('/api/trazabilidad/contactos?hoy=ayer').set(auth()).send(valido);
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('hoy');
    expect(queries).toEqual([]);
  });

  // Simulación: ni este router ni lo que cuelga de él tienen por dónde enviar un correo.
  it('nada de esto envía: ni el router ni el repo ni el dominio ni la validación llaman a la red', () => {
    for (const f of ['./router.ts', './repo.ts', './dominio.ts', './types.ts']) {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
      expect(src).not.toMatch(/\bfetch\s*\(|n8n|webhook|nodemailer|smtp|sendMail|outbox/i);
    }
  });
});

describe('validación antes de escribir', () => {
  it('importación sin filas → 400 y ninguna consulta', async () => {
    const res = await request(app()).post('/api/trazabilidad/importaciones').set(auth()).send({ archivo: 'x.xlsx', filas: [] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ningún GRIMM EDM 180/);
    expect(queries).toEqual([]);
  });

  it('importación con un modelo que no es EDM 180 → 400 con el campo', async () => {
    const res = await request(app())
      .post('/api/trazabilidad/importaciones')
      .set(auth())
      .send({ archivo: 'x.xlsx', filas: [{ serial: '1', cliente: 'C', marca: 'Grimm', modelo: 'EDM 280' }] });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('filas[0].modelo');
    expect(queries).toEqual([]);
  });

  it('seguimiento con clave no válida → 400', async () => {
    const res = await request(app()).put('/api/trazabilidad/seguimiento/a%20b').set(auth()).send({ enAmbientalia: true });
    expect(res.status).toBe(400);
    expect(queries).toEqual([]);
  });

  it('seguimiento con fecha imposible → 400', async () => {
    const res = await request(app())
      .put('/api/trazabilidad/seguimiento/18A00006')
      .set(auth())
      .send({ enAmbientalia: false, avisoEnviado: '2026-02-30' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('avisoEnviado');
    expect(queries).toEqual([]);
  });

  it('seguimiento de un equipo que no está en el inventario → 404', async () => {
    const res = await request(app()).put('/api/trazabilidad/seguimiento/NOEXISTE').set(auth()).send({ enAmbientalia: true });
    expect(res.status).toBe(404);
  });

  it('avisos sin claves → 400', async () => {
    const res = await request(app()).post('/api/trazabilidad/avisos').set(auth()).send({ claves: [], fecha: '2026-10-06' });
    expect(res.status).toBe(400);
    expect(queries).toEqual([]);
  });
});

// Diagnóstico de la fuente de la agenda (lote 1): de dónde se leen los tickets
// y cuántos hay abiertos por estado. Lectura, abierta a quien tenga la app.
describe('agenda: diagnóstico de la fuente', () => {
  const RUTA = '/api/trazabilidad/agenda/fuente';
  const URL_FICTICIA = 'postgres://lector_ficticio:clave-ficticia@desk-ficticio.invalid:5432/desk';
  const SINC = Date.UTC(2026, 9, 6, 12, 0, 0);
  const fila = (numero: number, estado: string) => ({ numero, estado, tipo_estado: 'Open', clasificacion: null, tipo_servicio: null, remision_entrada: null, fecha_creacion: '2026-10-01', prioridad: null, llegada_ms: null, asunto: `Asunto reservado ${numero}`, codigo_servicio: `MT_18A0${numero}_EDM180C` });
  /** La réplica con tres tickets abiertos (con su asunto y su código, que no deben salir), sincronizada hace un minuto. */
  const replica: DbLectura = {
    query: async (sql) => ({ rows: sql.includes('max(synced_at)') ? [{ ms: SINC }] : [fila(880, 'Ingresado'), fila(984, 'En Proceso'), fila(990, 'En Proceso')] }),
  };
  const appCon = (desk2: () => DbLectura | null) => {
    const a = express();
    a.use(express.json());
    a.use('/api', createTrazabilidadRouter(fakePool, crearFuenteAgenda({ hub: replica, desk2, ahora: () => SINC + 60_000 })));
    return a;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('401 sin token', async () => {
    expect((await request(appCon(() => null)).get(RUTA)).status).toBe(401);
  });

  it('403 sin la app asignada', async () => {
    expect((await request(appCon(() => null)).get(RUTA).set(auth(tokenFor(['ausencias'])))).status).toBe(403);
  });

  it('200 con la app, también para un Lector: el estado de la fuente y el recuento por estado, y nada más', async () => {
    const res = await request(appCon(() => null)).get(RUTA).set(conRol(null));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      fuente: 'respaldo',
      motivo: 'sin_variable',
      mensaje: expect.stringContaining('DESK2_DB_URL'),
      ultimaSincronizacion: '2026-10-06T12:00:00.000Z',
      sincronizacionParada: false,
      umbralSincronizacionMs: 3_600_000,
      ultimoFalloPrincipal: null,
      cortacircuitosHasta: null,
      abiertos: {
        total: 3,
        porEstado: [
          { estado: 'En Proceso', tickets: 2 },
          { estado: 'Ingresado', tickets: 1 },
        ],
      },
    });
    // La fuente ya lee el asunto y el código de cada ticket (para deducir el flujo): de aquí no salen.
    expect(JSON.stringify(res.body)).not.toMatch(/Asunto reservado|MT_18A0|asunto|codigo/i);
  });

  it('tal como lo monta el servidor, sin DESK2_DB_URL responde con el respaldo y sin error', async () => {
    vi.stubEnv('DESK2_DB_URL', '');
    const res = await request(app()).get(RUTA).set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fuente: 'respaldo', motivo: 'sin_variable', abiertos: { total: 0, porEstado: [] } });
  });

  it('si Desk 2.0 no contesta responde igual, con el motivo, y no filtra la URL ni el error crudo (ni en la respuesta ni en el registro)', async () => {
    vi.stubEnv('DESK2_DB_URL', URL_FICTICIA);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const caida: DbLectura = { query: async () => Promise.reject(Object.assign(new Error(`connect ECONNREFUSED ${URL_FICTICIA}`), { code: 'ECONNREFUSED' })) };
    const res = await request(appCon(() => caida)).get(RUTA).set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fuente: 'respaldo', motivo: 'error_conexion', abiertos: { total: 3 } });
    expect(res.body.ultimoFalloPrincipal.motivo).toBe('error_conexion');
    const visto = JSON.stringify([res.body, res.headers, warn.mock.calls, error.mock.calls]);
    for (const secreto of ['postgres://', 'lector_ficticio', 'clave-ficticia', 'desk-ficticio']) expect(visto).not.toContain(secreto);
  });

  it('no lleva clientes, seriales ni correos: sólo las claves del diagnóstico', async () => {
    const res = await request(appCon(() => null)).get(RUTA).set(auth());
    expect(Object.keys(res.body).sort()).toEqual(['abiertos', 'cortacircuitosHasta', 'fuente', 'mensaje', 'motivo', 'sincronizacionParada', 'ultimaSincronizacion', 'ultimoFalloPrincipal', 'umbralSincronizacionMs']);
    expect(Object.keys(res.body.abiertos).sort()).toEqual(['porEstado', 'total']);
    expect(JSON.stringify(res.body)).not.toMatch(/@|serial|cliente|email|subject/i);
  });

  it('no escribe nada', async () => {
    vi.stubEnv('DESK2_DB_URL', '');
    await request(app()).get(RUTA).set(auth());
    expect(queries.length).toBeGreaterThan(0);
    for (const sql of queries) expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });
});

// ── Lote 5: los endpoints de la agenda y de su configuración ────────────────
// Sin base: el doble contesta la configuración sembrada (3 / 4 / 2 puestos) y la
// fuente trae tres tickets (880 «Ingresado», 984 y 990 «En Proceso»). El SQL y
// el recorrido entero, en agenda-api.db.test.ts.

const A = '/api/trazabilidad/agenda';
const escriben = (sqls: string[]) => sqls.filter((q) => /\b(INSERT|UPDATE|DELETE)\b/.test(q));
/** Una asignación vigente en el doble: ese ticket ocupa ese puesto. */
const ocupar = (numero: number, etapa: string, puesto: number) => respuestas.unshift([/inicio::text AS desde FROM portal\.tmc_agenda_asignaciones/, [{ numero, etapa, puesto, desde: HOY }]]);
const SIN_DATOS_DE_CLIENTE = /Asunto reservado|MT_18A0|asunto|codigo_?servicio|serial|cliente|email|@/i;

describe('agenda: lecturas', () => {
  const LECTURAS = [`${A}?hoy=${HOY}`, `${A}/configuracion`, `${A}/huecos?etapa=proceso&hoy=${HOY}`];

  it.each([...LECTURAS, `${A}/reparto`])('GET %s: 401 sin token y 403 sin la app, sin consultar nada', async (ruta) => {
    expect((await request(appAgenda()).get(ruta)).status).toBe(401);
    const res = await request(appAgenda()).get(ruta).set(auth(tokenFor(['ausencias'], { rol: 'DIRECTOR_TECNICO' })));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
    expect([queries, conexiones.n, consultasRol.n]).toEqual([[], 0, 0]);
  });

  it.each(LECTURAS)('GET %s: abierta a un Lector, sin mirar su rol, sin escribir y sin datos de cliente', async (ruta) => {
    const res = await request(appAgenda()).get(ruta).set(conRol(null));
    expect(res.status).toBe(200);
    expect(consultasRol.n).toBe(0);
    expect(escriben(queries)).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(SIN_DATOS_DE_CLIENTE);
  });

  it('GET /agenda: la agenda proyectada a «hoy», con el estado de la fuente y los avisos', async () => {
    const res = await request(appAgenda()).get(`${A}?hoy=${HOY}`).set(conRol(null));
    expect(Object.keys(res.body).sort()).toEqual(['avisos', 'estadoFuente', 'etapas', 'finTaller', 'fuente', 'fueraAgenda', 'hoy', 'porLlegar', 'sinCategoria', 'standby', 'totalAbiertos']);
    expect(res.body).toMatchObject({
      hoy: HOY,
      totalAbiertos: 3,
      fuente: { fuente: 'respaldo', motivo: 'sin_variable' },
      estadoFuente: { fuente: 'respaldo', motivo: 'sin_variable', sincronizacionParada: false, cortacircuitosHasta: null, ultimaSincronizacion: '2026-10-06T12:00:00.000Z' },
      avisos: [{ codigo: 'fuente_respaldo', mensaje: expect.stringContaining('DESK2_DB_URL') }],
    });
    const etapas = res.body.etapas as { etapa: string; fila: { numero: number }[]; saturacion: unknown; primerHueco: string }[];
    expect(etapas.map((e) => [e.etapa, e.fila.map((t) => t.numero), e.saturacion])).toEqual([
      ['diagnostico', [880], { ocupados: 0, puestos: 3 }],
      ['proceso', [984, 990], { ocupados: 0, puestos: 4 }],
      ['verificacion', [], { ocupados: 0, puestos: 2 }],
    ]);
  });

  it.each(['ayer', '06-10-2026', '2026-02-30', '2026-13-01'])('GET /agenda?hoy=%s → 400 en «hoy», antes de la pasada y de leer', async (hoy) => {
    for (const ruta of [A, `${A}/huecos?etapa=proceso`, `${A}/reparto`]) {
      const res = await request(appAgenda()).get(`${ruta}${ruta.includes('?') ? '&' : '?'}hoy=${hoy}`).set(auth());
      expect(res.status).toBe(400);
      expect(res.body.field).toBe('hoy');
    }
    expect([queries, conexiones.n]).toEqual([[], 0]);
  });

  it('tal como lo monta el servidor, sin DESK2_DB_URL, responde con el respaldo', async () => {
    vi.stubEnv('DESK2_DB_URL', '');
    conexiones.cliente = true;
    const res = await request(app()).get(A).set(auth());
    vi.unstubAllEnvs();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalAbiertos: 0, fuente: { fuente: 'respaldo', motivo: 'sin_variable' } });
    expect(res.body.hoy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('si Desk 2.0 no contesta responde igual, con el respaldo, el motivo y el cortacircuitos abierto, y no filtra la URL ni el error', async () => {
    const URL_FICTICIA = 'postgres://lector_ficticio:clave-ficticia@desk-ficticio.invalid:5432/desk';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const veces = { n: 0 };
    const caida: DbLectura = { query: async () => (veces.n++, Promise.reject(Object.assign(new Error(`connect ECONNREFUSED ${URL_FICTICIA}`), { code: 'ECONNREFUSED' }))) };
    const servidor = appAgenda(caida);
    const res = await request(servidor).get(`${A}?hoy=${HOY}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalAbiertos: 3, fuente: { fuente: 'respaldo', motivo: 'error_conexion' }, estadoFuente: { cortacircuitosHasta: new Date(SINC + 120_000).toISOString() } });
    expect((res.body.avisos as { codigo: string }[]).map((a) => a.codigo)).toEqual(['fuente_respaldo']);
    // La pasada lo intentó una vez; con el cortacircuitos abierto, ni la lectura ni la petición siguiente vuelven a esperar a la principal.
    expect(veces.n).toBe(1);
    await request(servidor).get(`${A}?hoy=${HOY}`).set(auth());
    expect(veces.n).toBe(1);
    // En respaldo la pasada no apunta historial ni cierra nada.
    expect(escriben(queries)).toEqual([]);
    const visto = JSON.stringify([res.body, res.headers, warn.mock.calls, error.mock.calls]);
    for (const secreto of ['postgres://', 'lector_ficticio', 'clave-ficticia', 'desk-ficticio']) expect(visto).not.toContain(secreto);
    vi.restoreAllMocks();
  });

  it('GET /agenda/huecos: las próximas entradas de un equipo que llegara hoy a esa etapa', async () => {
    const res = await request(appAgenda()).get(`${A}/huecos?etapa=proceso&hoy=${HOY}`).set(conRol(null));
    expect(res.body).toEqual({
      hoy: HOY,
      etapa: 'proceso',
      tipo: null,
      duracionDias: 4,
      sinTipo: true,
      fuente: 'respaldo',
      huecos: [
        { puesto: 3, entrada: '2026-10-06', fin: '2026-10-13' },
        { puesto: 4, entrada: '2026-10-06', fin: '2026-10-13' },
        { puesto: 1, entrada: '2026-10-13', fin: '2026-10-19' },
        { puesto: 2, entrada: '2026-10-13', fin: '2026-10-19' },
        { puesto: 3, entrada: '2026-10-13', fin: '2026-10-19' },
      ],
    });
    expect((await request(appAgenda()).get(`${A}/huecos?etapa=diagnostico&tipo=Calibraci%C3%B3n&hoy=${HOY}`).set(auth())).body).toMatchObject({ tipo: 'Calibración', duracionDias: 3, sinTipo: false });
    // Es una lectura sin más: no lanza la pasada.
    expect(conexiones.n).toBe(0);
  });

  it.each([
    ['', 'etapa'],
    ['etapa=taller', 'etapa'],
    ['etapa=proceso&etapa=diagnostico', 'etapa'],
    [`etapa=proceso&tipo=${'x'.repeat(81)}`, 'tipo'],
    ['etapa=proceso&tipo=a&tipo=b', 'tipo'],
  ])('GET /agenda/huecos?%s → 400 en «%s» y ninguna consulta', async (consulta, campo) => {
    const res = await request(appAgenda()).get(`${A}/huecos?${consulta}`).set(auth());
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_input', field: campo });
    expect(queries).toEqual([]);
  });

  it('GET /agenda/configuracion: puestos, duraciones y cada estado con su categoría, sus dos firmas y sus tickets abiertos según la fuente de la agenda', async () => {
    respuestas.unshift([
      /^SELECT clave, etiqueta, rol[^]*FROM portal\.tmc_estados_desk/,
      [{ clave: 'en proceso', etiqueta: 'En Proceso', rol: 'standby', actualizado_por: 'gerencia@ambientalia.com.co', actualizado_en: '2026-10-06 10:00:00+00', categoria: 'activa', etapa: 'proceso', categoria_por: 'director@ambientalia.com.co', categoria_en: '2026-10-06 11:00:00+00' }],
    ]);
    const res = await request(appAgenda()).get(`${A}/configuracion`).set(conRol(null));
    expect(Object.keys(res.body).sort()).toEqual(['duraciones', 'estados', 'etapas', 'tiposAbiertos']);
    expect(res.body.etapas).toEqual([
      { etapa: 'diagnostico', etiqueta: 'Diagnóstico', orden: 1, puestos: 3, actualizadoPor: null, actualizadoEn: null },
      { etapa: 'proceso', etiqueta: 'Proceso', orden: 2, puestos: 4, actualizadoPor: null, actualizadoEn: null },
      { etapa: 'verificacion', etiqueta: 'Verificación', orden: 3, puestos: 2, actualizadoPor: null, actualizadoEn: null },
    ]);
    expect(res.body.duraciones).toContainEqual({ etapa: 'proceso', tipo: '*', dias: 4, actualizadoPor: null, actualizadoEn: null });
    const estados = Object.fromEntries((res.body.estados as { clave: string }[]).map((e) => [e.clave, e]));
    // Guardado: la firma de la categoría y la del rol del reloj, cada una la suya. Los abiertos, los de la fuente.
    expect(estados['en proceso']).toEqual({
      clave: 'en proceso', etiqueta: 'En Proceso', tipoDesk: null, ticketsAbiertos: 2,
      rol: 'standby', actualizadoPor: 'gerencia@ambientalia.com.co', actualizadoEn: '2026-10-06 10:00:00+00',
      categoria: 'activa', etapa: 'proceso', categoriaPor: 'director@ambientalia.com.co', categoriaEn: '2026-10-06 11:00:00+00',
    });
    // Sin fila: sale igual porque la fuente lo trae, con la categoría de la propuesta y sin firmas.
    expect(estados.ingresado).toMatchObject({ etiqueta: 'Ingresado', ticketsAbiertos: 1, rol: 'cuenta', actualizadoPor: null, categoria: 'entrada', etapa: null, categoriaPor: null, categoriaEn: null });
    // Los tipos de servicio que traen esos mismos tickets: sólo el tipo y cuántos (ni clientes, ni seriales, ni correos).
    expect(Array.isArray(res.body.tiposAbiertos)).toBe(true);
    for (const t of res.body.tiposAbiertos as object[]) expect(Object.keys(t).sort()).toEqual(['clave', 'etiqueta', 'tickets']);
    expect(conexiones.n).toBe(0);
  });
});

// D20: antes de servir la agenda se lanza su pasada (historial y cierre de asignaciones), si se puede.
describe('agenda: la pasada a demanda', () => {
  const reloj: [RegExp, Filas] = [/clock_timestamp/, [{ ahora: '2026-10-06 12:01:00+00' }]];
  const posicion = (patron: RegExp) => queries.findIndex((q) => patron.test(q));

  it('GET /agenda la lanza ANTES de leer, y con la principal apunta el historial', async () => {
    respuestas.unshift(reloj);
    const res = await request(appAgenda(baseTickets)).get(`${A}?hoy=${HOY}`).set(auth());
    expect(res.body).toMatchObject({ fuente: { fuente: 'principal', motivo: null }, avisos: [] });
    expect(conexiones.n).toBe(1);
    expect(posicion(/INSERT INTO portal\.tmc_agenda_historial/)).toBeGreaterThan(posicion(/pg_advisory_xact_lock/));
    expect(posicion(/COMMIT/)).toBeLessThan(posicion(/FROM portal\.tmc_servicios_tipo/));
  });

  it('no repite una buena de hace menos de 30 s', async () => {
    const servidor = appAgenda();
    await request(servidor).get(A).set(auth());
    await request(servidor).get(A).set(auth());
    await request(servidor).get(`${A}?hoy=${HOY}`).set(auth());
    expect(conexiones.n).toBe(1);
  });

  it('si la pasada falla la petición responde igual, con lo que haya, y lo avisa', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const servidor = appAgenda();
    conexiones.cliente = false; // el doble no da conexiones: la pasada revienta
    const res = await request(servidor).get(`${A}?hoy=${HOY}`).set(conRol(null));
    expect(res.status).toBe(200);
    expect(res.body.totalAbiertos).toBe(3);
    expect(res.body.avisos).toContainEqual({ codigo: 'pasada_fallida', mensaje: expect.stringMatching(/no se pudo.*puede no estar al día/i) });
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/tmc_registrar_agenda/), expect.any(Error));
    expect(JSON.stringify(res.body)).not.toMatch(/sin transacciones/);
    error.mockRestore();
  });

  it('también va antes de asignar, de confirmar el reparto y de liberar; no antes de marcar el flujo ni de configurar', async () => {
    const pedir: [string, object][] = [
      ['/asignaciones', { numero: 984, etapa: 'proceso', puesto: 1 }],
      ['/reparto', { reparto: [{ numero: 984, etapa: 'proceso', puesto: 1 }] }],
      ['/liberar', { numero: 984, motivo: 'El equipo ya salió' }],
    ];
    for (const [ruta, cuerpo] of pedir) {
      reiniciarRegistroEstados();
      queries.length = 0;
      conexiones.n = 0;
      await request(appAgenda()).post(`${A}${ruta}`).set(auth()).send(cuerpo);
      expect(posicion(/pg_advisory_xact_lock/), ruta).toBeGreaterThanOrEqual(0);
      expect(posicion(/pg_advisory_xact_lock/), ruta).toBeLessThan(posicion(/(INSERT INTO|UPDATE) portal\.tmc_agenda_asignaciones/));
    }
    reiniciarRegistroEstados();
    queries.length = 0;
    conexiones.n = 0;
    await request(appAgenda()).put(`${A}/flujo/880`).set(auth()).send({ flujo: 'equipo_nuevo' });
    await request(appAgenda()).put(`${A}/configuracion/puestos`).set(auth()).send({ etapa: 'proceso', puestos: 5 });
    expect([conexiones.n, posicion(/pg_advisory_xact_lock/)]).toEqual([0, -1]);
  });

  it('una escritura con la pasada fallida sigue adelante: no es motivo para no asignar', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    respuestas.unshift([/pg_advisory_xact_lock/, 0]);
    const servidor = appAgenda();
    const original = fakePool.query;
    fakePool.query = (async (sql: string, params: unknown[]) => (/pg_advisory_xact_lock/.test(sql) ? Promise.reject(new Error('la base no contesta')) : original(sql, params))) as typeof fakePool.query;
    try {
      const res = await request(servidor).post(`${A}/asignaciones`).set(auth()).send({ numero: 984, etapa: 'proceso', puesto: 1 });
      expect(res.status).toBe(200);
      expect(res.body.avisos).toContainEqual(expect.objectContaining({ codigo: 'pasada_fallida' }));
    } finally {
      fakePool.query = original;
      error.mockRestore();
    }
  });
});

describe('agenda: reparto inicial', () => {
  const proponer = (c = auth()) => request(appAgenda()).get(`${A}/reparto?hoy=${HOY}`).set(c);
  const confirmar = (cuerpo: unknown, c = auth()) => request(appAgenda()).post(`${A}/reparto`).set(c).send(cuerpo as object);

  it.each(ROLES_APP.filter((r) => !puede(r, 'agenda.reparto')))('la propuesta es una lectura, pero pide el permiso del reparto: %s → 403 sin consultar nada', async (rol) => {
    const res = await proponer(conRol(rol === 'LECTOR' ? null : rol));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
    expect([queries, conexiones.n]).toEqual([[], 0]);
  });

  it('con el permiso (o siendo administrador del portal): los puestos libres para quien ya está en la etapa, sin escribir', async () => {
    for (const c of [conRol('DIRECTOR_TECNICO'), comoAdmin()]) {
      const res = await proponer(c);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hoy: HOY, reparto: [{ numero: 984, etapa: 'proceso', puesto: 1, desde: HOY }, { numero: 990, etapa: 'proceso', puesto: 2, desde: HOY }] });
    }
    expect(escriben(queries)).toEqual([]);
  });

  it.each([
    [[], 'body'],
    [{}, 'reparto'],
    [{ reparto: 'todo' }, 'reparto'],
    [{ reparto: [null] }, 'numero'],
    [{ reparto: [{ numero: '984', etapa: 'proceso', puesto: 1 }] }, 'numero'],
    [{ reparto: [{ numero: 984, etapa: 'taller', puesto: 1 }] }, 'etapa'],
    [{ reparto: [{ numero: 984, etapa: 'proceso', puesto: 0 }] }, 'puesto'],
    [{ reparto: [{ numero: 984, etapa: 'proceso', puesto: 1 }, { numero: 984, etapa: 'proceso', puesto: 2 }] }, 'reparto'],
    [{ reparto: [{ numero: 984, etapa: 'proceso', puesto: 1 }, { numero: 990, etapa: 'proceso', puesto: 1 }] }, 'reparto'],
  ])('confirmar %j → 400 en «%s», sin pasada ni consultas', async (cuerpo, campo) => {
    const res = await confirmar(cuerpo);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_input', field: campo });
    expect([queries, conexiones.n]).toEqual([[], 0]);
  });

  it('un puesto que ya no está libre → 409 que dice cuál, y no se guarda ninguna línea (D19: el reparto no reemplaza)', async () => {
    ocupar(990, 'proceso', 2);
    const res = await confirmar({ reparto: [{ numero: 984, etapa: 'proceso', puesto: 2 }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('puesto_ocupado');
    expect(res.body.message).toMatch(/puesto 2 de Proceso/);
    expect(escriben(queries)).toEqual([]);
  });

  it('un ticket que no está en esa etapa → 409; un puesto que la etapa no tiene → 400', async () => {
    expect((await confirmar({ reparto: [{ numero: 880, etapa: 'diagnostico', puesto: 1 }] })).body.error).toBe('ticket_fuera_de_etapa');
    const res = await confirmar({ reparto: [{ numero: 984, etapa: 'proceso', puesto: 5 }] });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('puesto');
    expect(escriben(queries)).toEqual([]);
  });

  it('válido (la propuesta tal cual, o ajustada) → 200 con la agenda, y guarda cada línea como «arranque»', async () => {
    const res = await confirmar({ reparto: [{ numero: 990, etapa: 'proceso', puesto: 1 }, { numero: 984, etapa: 'proceso', puesto: 4 }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalAbiertos: 3, estadoFuente: { fuente: 'respaldo' } });
    expect(escriben(queries)).toHaveLength(2);
    for (const q of escriben(queries)) expect(q).toMatch(/INSERT INTO portal\.tmc_agenda_asignaciones/);
  });
});

describe('agenda: asignar, liberar y marcar el flujo', () => {
  const asignar = (cuerpo: unknown) => request(appAgenda()).post(`${A}/asignaciones`).set(auth()).send(cuerpo as object);
  const liberar = (cuerpo: unknown) => request(appAgenda()).post(`${A}/liberar`).set(auth()).send(cuerpo as object);
  const flujo = (numero: string, cuerpo: unknown) => request(appAgenda()).put(`${A}/flujo/${numero}`).set(auth()).send(cuerpo as object);
  const linea = { numero: 984, etapa: 'proceso', puesto: 1 };

  it.each([
    [[], 'body'],
    [{ ...linea, numero: undefined }, 'numero'],
    [{ ...linea, numero: 1.5 }, 'numero'],
    [{ ...linea, etapa: 'Proceso' }, 'etapa'],
    [{ ...linea, puesto: 51 }, 'puesto'],
    [{ ...linea, puesto: '1' }, 'puesto'],
    [{ ...linea, motivo: 3 }, 'motivo'],
    [{ ...linea, motivo: 'x'.repeat(501) }, 'motivo'],
  ])('asignar %j → 400 en «%s», sin pasada ni consultas', async (cuerpo, campo) => {
    const res = await asignar(cuerpo);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_input', field: campo });
    expect([queries, conexiones.n]).toEqual([[], 0]);
  });

  it('asignar a quien no es el primero de la fila sin decir el motivo → 400 en «motivo»; con motivo, 200', async () => {
    const sin = await asignar({ numero: 990, etapa: 'proceso', puesto: 1 });
    expect(sin.status).toBe(400);
    expect(sin.body.field).toBe('motivo');
    expect(sin.body.message).toMatch(/#984/);
    expect(escriben(queries)).toEqual([]);
    expect((await asignar({ numero: 990, etapa: 'proceso', puesto: 1, motivo: 'Urgencia acordada con el cliente' })).status).toBe(200);
  });

  it('asignar un puesto ocupado → 409 que dice cuál; un ticket que no está en esa etapa → 409; un puesto que no existe → 400', async () => {
    ocupar(990, 'proceso', 1);
    const ocupado = await asignar(linea);
    expect(ocupado.status).toBe(409);
    expect(ocupado.body.error).toBe('puesto_ocupado');
    expect(ocupado.body.message).toMatch(/puesto 1 de Proceso/);
    const fuera = await asignar({ numero: 880, etapa: 'diagnostico', puesto: 1 });
    expect(fuera.status).toBe(409);
    expect(fuera.body.error).toBe('ticket_fuera_de_etapa');
    expect((await asignar({ numero: 990, etapa: 'proceso', puesto: 2 })).body.error).toBe('ticket_con_puesto');
    expect((await asignar({ ...linea, puesto: 5 })).body).toMatchObject({ error: 'invalid_input', field: 'puesto' });
    expect(escriben(queries)).toEqual([]);
  });

  it('asignar al primero de la fila → 200 con la agenda ya leída otra vez, y lo guarda', async () => {
    const res = await asignar(linea);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toContain('etapas');
    expect(escriben(queries)).toHaveLength(1);
    expect(escriben(queries)[0]).toMatch(/INSERT INTO portal\.tmc_agenda_asignaciones/);
  });

  // D18: se libera por número de ticket (como mucho hay una asignación vigente por ticket).
  it.each([
    [[], 'body'],
    [{ motivo: 'El equipo ya salió' }, 'numero'],
    [{ numero: '984', motivo: 'El equipo ya salió' }, 'numero'],
    [{ numero: 984 }, 'motivo'],
    [{ numero: 984, motivo: '   ' }, 'motivo'],
    [{ numero: 984, motivo: ['x'] }, 'motivo'],
  ])('liberar %j → 400 en «%s», sin pasada ni consultas', async (cuerpo, campo) => {
    const res = await liberar(cuerpo);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_input', field: campo });
    expect([queries, conexiones.n]).toEqual([[], 0]);
  });

  it('liberar un ticket sin puesto → 404; con puesto → 200 con la agenda, cerrándola a mano con el motivo y la firma', async () => {
    const sin = await liberar({ numero: 984, motivo: 'El equipo ya salió' });
    expect(sin.status).toBe(404);
    expect(sin.body.message).toMatch(/#984 no tiene ningún puesto/);
    respuestas.unshift([/UPDATE portal\.tmc_agenda_asignaciones/, 1]);
    const res = await liberar({ numero: 984, motivo: 'El equipo ya salió' });
    expect(res.status).toBe(200);
    expect(res.body.totalAbiertos).toBe(3);
    expect(escriben(queries).at(-1)).toMatch(/cierre = 'manual'/);
  });

  it.each(['0', 'abc', '1.5', '-3'])('flujo de un ticket con número no válido (%s) → 400 en «numero»', async (numero) => {
    const res = await flujo(numero, { flujo: 'equipo_nuevo' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('numero');
    expect(queries).toEqual([]);
  });

  it.each([[[]], [{}], [{ flujo: 'nuevo' }], [{ flujo: 3 }], [{ flujo: ['servicio'] }]])('flujo %j → 400 y ninguna consulta', async (cuerpo) => {
    const res = await flujo('880', cuerpo);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_input');
    expect(queries).toEqual([]);
  });

  it('flujo: 404 si la fuente no trae abierto el ticket; 409 si la fuente ya trae su clasificación', async () => {
    const noEsta = await flujo('999', { flujo: 'equipo_nuevo' });
    expect(noEsta.status).toBe(404);
    ticketsFuente = [filaTicket(880, 'Ingresado', { clasificacion: 'Equipo Para Servicio' })];
    const clasificado = await flujo('880', { flujo: 'equipo_nuevo' });
    expect(clasificado.status).toBe(409);
    expect(clasificado.body.error).toBe('flujo_de_la_fuente');
    expect(escriben(queries)).toEqual([]);
  });

  it('flujo: marcarlo → 200 con la agenda y el ticket en la fila de su nueva primera etapa; con null se quita la marca', async () => {
    respuestas.unshift([/SELECT numero, flujo FROM portal\.tmc_agenda_flujo/, [{ numero: 880, flujo: 'equipo_nuevo' }]]);
    const res = await flujo('880', { flujo: 'equipo_nuevo' });
    expect(res.status).toBe(200);
    expect(escriben(queries)[0]).toMatch(/INSERT INTO portal\.tmc_agenda_flujo/);
    const proceso = (res.body.etapas as { etapa: string; fila: { numero: number }[] }[]).find((e) => e.etapa === 'proceso')!;
    expect(proceso.fila.map((t) => t.numero)).toContain(880);
    queries.length = 0;
    expect((await flujo('999', { flujo: null })).status).toBe(200);
    expect(escriben(queries)).toEqual([expect.stringMatching(/DELETE FROM portal\.tmc_agenda_flujo/)]);
  });

  it('el permiso va antes que la validación y que la pasada: un cuerpo no válido de un Lector es 403, no 400', async () => {
    const c = conRol(null);
    for (const ruta of ['/asignaciones', '/liberar', '/reparto']) expect((await request(appAgenda()).post(`${A}${ruta}`).set(c).send([])).status).toBe(403);
    for (const ruta of ['/flujo/abc', '/configuracion/puestos', '/configuracion/duraciones', '/configuracion/estados']) expect((await request(appAgenda()).put(`${A}${ruta}`).set(c).send([])).status).toBe(403);
    expect([queries, conexiones.n]).toEqual([[], 0]);
  });
});

describe('agenda: configuración (config.write)', () => {
  const put = (ruta: string, cuerpo: unknown) => request(appAgenda()).put(`${A}/configuracion/${ruta}`).set(auth()).send(cuerpo as object);

  it.each([
    ['puestos', [], 'body'],
    ['puestos', { puestos: 3 }, 'etapa'],
    ['puestos', { etapa: 'taller', puestos: 3 }, 'etapa'],
    ['puestos', { etapa: 'proceso' }, 'puestos'],
    ['puestos', { etapa: 'proceso', puestos: -1 }, 'puestos'],
    ['puestos', { etapa: 'proceso', puestos: 51 }, 'puestos'],
    ['puestos', { etapa: 'proceso', puestos: 1.5 }, 'puestos'],
    ['puestos', { etapa: 'proceso', puestos: '3' }, 'puestos'],
    ['duraciones', [], 'body'],
    ['duraciones', { etapa: 'taller', tipo: '*', dias: 3 }, 'etapa'],
    ['duraciones', { etapa: 'proceso', dias: 3 }, 'tipo'],
    ['duraciones', { etapa: 'proceso', tipo: 3, dias: 3 }, 'tipo'],
    ['duraciones', { etapa: 'proceso', tipo: '  ', dias: 3 }, 'tipo'],
    ['duraciones', { etapa: 'proceso', tipo: 'x'.repeat(81), dias: 3 }, 'tipo'],
    ['duraciones', { etapa: 'proceso', tipo: '*' }, 'dias'],
    ['duraciones', { etapa: 'proceso', tipo: '*', dias: 0 }, 'dias'],
    ['duraciones', { etapa: 'proceso', tipo: '*', dias: 366 }, 'dias'],
    ['duraciones', { etapa: 'proceso', tipo: '*', dias: '3' }, 'dias'],
    ['estados', [], 'body'],
    ['estados', { categoria: 'fin' }, 'estado'],
    ['estados', { estado: 3, categoria: 'fin' }, 'estado'],
    ['estados', { estado: 'x'.repeat(81), categoria: 'fin' }, 'estado'],
    ['estados', { estado: 'Por Facturar' }, 'categoria'],
    ['estados', { estado: 'Por Facturar', categoria: 'terminado' }, 'categoria'],
    ['estados', { estado: 'Por Facturar', categoria: 'activa' }, 'etapa'],
    ['estados', { estado: 'Por Facturar', categoria: 'activa', etapa: 'taller' }, 'etapa'],
    ['estados', { estado: 'Por Facturar', categoria: 'fin', etapa: 'proceso' }, 'etapa'],
  ])('PUT /agenda/configuracion/%s %j → 400 en «%s» y ninguna consulta', async (ruta, cuerpo, campo) => {
    const res = await put(ruta, cuerpo);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_input', field: campo });
    expect(queries).toEqual([]);
  });

  it('puestos: 0 y 50 valen → 200 con la configuración entera ya leída', async () => {
    for (const puestos of [0, 50]) {
      const res = await put('puestos', { etapa: 'verificacion', puestos });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['duraciones', 'estados', 'etapas', 'tiposAbiertos']);
    }
    expect(escriben(queries)).toHaveLength(2);
    expect(escriben(queries)[0]).toMatch(/INSERT INTO portal\.tmc_agenda_etapas/);
  });

  it('duraciones: guardar la de un tipo o la «*»; con dias null se quita la fila del tipo; la «*» no se puede quitar → 400', async () => {
    expect((await put('duraciones', { etapa: 'proceso', tipo: '*', dias: 5 })).status).toBe(200);
    expect((await put('duraciones', { etapa: 'proceso', tipo: 'Calibración', dias: 2 })).status).toBe(200);
    expect(escriben(queries)).toEqual([expect.stringMatching(/INSERT INTO portal\.tmc_agenda_duraciones/), expect.stringMatching(/INSERT INTO portal\.tmc_agenda_duraciones/)]);
    queries.length = 0;
    expect((await put('duraciones', { etapa: 'proceso', tipo: 'Calibración', dias: null })).status).toBe(200);
    expect(escriben(queries)).toEqual([expect.stringMatching(/DELETE FROM portal\.tmc_agenda_duraciones/)]);
    queries.length = 0;
    const res = await put('duraciones', { etapa: 'proceso', tipo: ' * ', dias: null });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('dias');
    expect(res.body.message).toMatch(/no se puede quitar/);
    expect(queries).toEqual([]);
  });

  it('estados: guarda la categoría (y la etapa, si es activa) con SU firma, y no nombra el rol del reloj ni su firma', async () => {
    for (const cuerpo of [{ estado: 'Notificado', categoria: 'activa', etapa: 'diagnostico' }, { estado: 'Estado nuevo', categoria: 'standby' }, { estado: 'Por Entregar', categoria: 'fin', etapa: null, rol: 'cuenta' }]) {
      queries.length = 0;
      const res = await put('estados', cuerpo);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['duraciones', 'estados', 'etapas', 'tiposAbiertos']);
      expect(escriben(queries)).toHaveLength(1);
      expect(escriben(queries)[0]).toMatch(/INSERT INTO portal\.tmc_estados_desk \(clave, etiqueta, categoria, etapa, categoria_por_id, categoria_por, categoria_en, actualizado_en\)/);
      expect(escriben(queries)[0]).not.toMatch(/\brol\b|actualizado_por|actualizado_en = /);
    }
  });
});
