import { describe, it, expect, beforeEach, vi } from 'vitest';
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
/** Veces que se ha pedido una conexión para una transacción (sólo la pide el registro de estados). */
const conexiones = { n: 0 };
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
    return { rows: [], rowCount: 0 };
  },
  connect: async () => {
    conexiones.n++;
    throw new Error('sin transacciones en este test');
  },
} as unknown as Pool;

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
  consultasRol.n = 0;
  usuarios.clear();
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
  ];
  const casos = ESCRITURAS.flatMap((e) => ROLES_APP.map((rol) => ({ ...e, rol, pasa: puede(rol, e.permiso) })));

  it('son las siete escrituras del router, y ninguna queda sin permiso: toda ruta que escribe pasa por escritura() o soloAdmin()', () => {
    const src = readFileSync(fileURLToPath(new URL('./router.ts', import.meta.url)), 'utf8');
    const rutas = src.split(/\n\s*router\./).slice(1);
    const escriben = rutas.filter((r) => /^(post|put|patch|delete)\(/.test(r));
    expect(escriben).toHaveLength(ESCRITURAS.length + 1); // + PUT /trazabilidad/roles/:userId
    for (const r of escriben) expect(r).toMatch(/\.\.\.gated,\s*(escritura\('[a-z.]+',|soloAdmin\()/);
    const pedidos = escriben.map((r) => /escritura\('([a-z.]+)'/.exec(r)?.[1]).filter(Boolean);
    expect(pedidos.sort()).toEqual(ESCRITURAS.map((e) => e.permiso).sort());
    for (const r of rutas.filter((x) => /^get\(/.test(x))) expect(r).not.toMatch(/escritura\(/);
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
