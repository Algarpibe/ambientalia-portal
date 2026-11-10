import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { RepoEquipos } from './repo.js';
import type { ServicioEquipos } from './servicio.js';
import type { AjusteFirmado, Corrida, LlavesUsuario, UsuarioConLlaves } from './contrato.js';

// Las rutas con Express de verdad: guardas de sesión y de app, llaves, 403/400/404/409/503.
// El SQL lo cubre repo.db.test.ts; aquí el repositorio y el servicio son dobles. La
// sesión: requireAuth real con la consulta de usuario simulada (mismo patrón que
// calibraciones/router.test.ts). Todo ficticio.
const SECRET = 'test-secret-equipos-taller';
process.env.JWT_SECRET = SECRET;

const usuarios = vi.hoisted(() => new Map<string, { role: string; apps: string[] }>());
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async (_sql: string, params: unknown[] = []) => {
      const u = usuarios.get(String(params[0] ?? '')) ?? { role: 'reader', apps: [] };
      return { rows: [{ role: u.role, status: 'active', apps: u.apps, token_version: 0 }], rowCount: 1 };
    },
    on: () => {},
  }),
}));
const { createEquiposTallerRouter } = await import('./router.js');

let seq = 0;
function token(o: { role?: string; apps?: string[] } = {}): { auth: string; userId: string } {
  const userId = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  usuarios.set(userId, { role: o.role ?? 'reader', apps: o.apps ?? ['equipos-taller'] });
  return { auth: 'Bearer ' + jwt.sign({ sub: `u${seq}@ambientalia.com.co`, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' }), userId };
}

const llaves = new Map<string, LlavesUsuario>();
const guardados: { clave: string; t: string; m: string; userId: string | null; usuario: string }[] = [];
let lanzar: ServicioEquipos['lanzar'] = async () => 'iniciada';
let configurado = true;
let enCurso: Corrida | null = null;
let terminada: Corrida | null = null;
const repo = {
  leerFoto: async () => null,
  leerAjustes: async () => ({}),
  ultimaCorrida: async () => enCurso ?? terminada,
  ultimaCorridaTerminada: async () => terminada,
  ultimaCorridaBuena: async () => null,
  incidenteAbierto: async () => null,
  llavesDe: async (userId: string | null) => llaves.get(String(userId)) ?? { editaAjustes: false, recibeAlertas: false },
  guardarAjuste: async (clave: string, a: { t: AjusteFirmado['t']; m: string }, f: { userId: string | null; usuario: string }): Promise<AjusteFirmado> => {
    guardados.push({ clave, ...a, ...f });
    return { ...a, at: '2026-11-10', usuario: f.usuario, creadoEn: '2026-11-10T15:00:00.000Z' };
  },
  borrarAjuste: async () => {},
  listarLlaves: async (): Promise<UsuarioConLlaves[]> => [{ userId: 'u', nombre: 'Persona Ficticia', email: 'p@ambientalia.com.co', esAdmin: false, editaAjustes: true, recibeAlertas: false, actualizadoPor: null, actualizadoEn: null }],
  guardarLlaves: async (userId: string, l: LlavesUsuario, por: string): Promise<UsuarioConLlaves | null> =>
    userId.endsWith('999999999999') ? null : { userId, nombre: 'X', email: 'x@ambientalia.com.co', esAdmin: false, ...l, actualizadoPor: por, actualizadoEn: '2026-11-10T15:00:00.000Z' },
} as unknown as RepoEquipos;
const servicio = {
  configurado: () => configurado,
  actualizando: () => false,
  lanzar: (o: 'programada' | 'boton', u: string | null) => lanzar(o, u),
} as unknown as ServicioEquipos;

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api', createEquiposTallerRouter({ repo, servicio }));
  return a;
};
const B = '/api/equipos-taller';

beforeEach(() => {
  llaves.clear();
  guardados.length = 0;
  lanzar = async () => 'iniciada';
  configurado = true;
  enCurso = null;
  terminada = null;
});

describe('guardas', () => {
  it('401 sin sesión', async () => expect((await request(app()).get(B)).status).toBe(401));
  it('403 sin la app', async () => expect((await request(app()).get(B).set('Authorization', token({ apps: ['ausencias'] }).auth)).status).toBe(403));
  it('un admin entra sin tener la app asignada', async () => expect((await request(app()).get(B).set('Authorization', token({ role: 'admin', apps: [] }).auth)).status).toBe(200));
});

describe('GET /equipos-taller', () => {
  it('devuelve la configuración y los permisos del usuario, sin caché', async () => {
    const t = token();
    llaves.set(t.userId, { editaAjustes: true, recibeAlertas: false });
    const r = await request(app()).get(B).set('Authorization', t.auth);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toMatchObject({ snap: null, configurado: true, actualizando: false, permisos: { editaAjustes: true, recibeAlertas: false, esAdmin: false, puedeEditar: true } });
  });
  it('sin la llave, puedeEditar es false (salvo admin)', async () => {
    expect((await request(app()).get(B).set('Authorization', token().auth)).body.permisos.puedeEditar).toBe(false);
    expect((await request(app()).get(B).set('Authorization', token({ role: 'admin' }).auth)).body.permisos.puedeEditar).toBe(true);
  });
});

describe('aviso de foto vieja con una corrida en curso', () => {
  const corrida = (o: Partial<Corrida>): Corrida => ({ id: 1, origen: 'programada', inicio: '2026-11-10T11:30:00.000Z', fin: null, enCurso: false, ok: null, causa: null, avisos: [], conteos: null, ...o });
  it('ultima es la última TERMINADA (fallida) aunque haya otra en curso, y actualizando sigue siendo true', async () => {
    terminada = corrida({ id: 1, fin: '2026-11-10T11:35:00.000Z', ok: false, causa: 'drive: HTTP 403' });
    enCurso = corrida({ id: 2, enCurso: true });
    const r = await request(app()).get(B).set('Authorization', token().auth);
    expect(r.body.actualizando).toBe(true);
    expect(r.body.ultima).toMatchObject({ id: 1, ok: false, causa: 'drive: HTTP 403', enCurso: false });
  });
});

describe('POST /equipos-taller/actualizar', () => {
  it('202 al empezar, como corrida del botón y con el usuario', async () => {
    const t = token();
    let visto: unknown[] = [];
    lanzar = async (...a) => { visto = a; return 'iniciada'; };
    const r = await request(app()).post(B + '/actualizar').set('Authorization', t.auth);
    expect([r.status, r.body]).toEqual([202, { estado: 'iniciada' }]);
    expect(visto).toEqual(['boton', t.userId]);
  });
  it('409 si ya hay una en curso', async () => {
    lanzar = async () => 'ocupado';
    expect((await request(app()).post(B + '/actualizar').set('Authorization', token().auth)).status).toBe(409);
  });
  it('503 sin configurar', async () => {
    lanzar = async () => 'sin_configurar';
    const r = await request(app()).post(B + '/actualizar').set('Authorization', token().auth);
    expect([r.status, r.body.message]).toEqual([503, 'Falta configurar Google Drive']);
  });
});

describe('ajustes', () => {
  const put = (auth: string, clave: string, b: unknown) => request(app()).put(B + '/ajustes/' + encodeURIComponent(clave)).set('Authorization', auth).send(b as object);
  it('403 sin la llave edita_ajustes', async () => {
    expect((await put(token().auth, '1BA90417|2026-11-01', { t: 'in' })).status).toBe(403);
    expect((await request(app()).delete(B + '/ajustes/' + encodeURIComponent('1BA90417|2026-11-01')).set('Authorization', token().auth)).status).toBe(403);
    expect(guardados).toEqual([]);
  });
  it('con la llave, guarda firmado con el usuario', async () => {
    const t = token();
    llaves.set(t.userId, { editaAjustes: true, recibeAlertas: false });
    const r = await put(t.auth, '1BA90417|2026-11-01', { t: 'out', m: 'recogido el 10 nov' });
    expect(r.status).toBe(200);
    expect(r.body.ajuste).toMatchObject({ t: 'out', m: 'recogido el 10 nov', usuario: expect.stringMatching(/@ambientalia\.com\.co$/) });
    expect(guardados[0]).toMatchObject({ clave: '1BA90417|2026-11-01', userId: t.userId });
  });
  it('un admin puede sin la llave', async () => expect((await put(token({ role: 'admin' }).auth, 'pdf:Abcdefghij_-12', { t: 'pdf' })).status).toBe(200));
  it('400 si la clave o el tipo no valen', async () => {
    const a = token({ role: 'admin' }).auth;
    expect((await put(a, "x' OR 1=1", { t: 'in' })).status).toBe(400);
    expect((await put(a, 'pdf:Abcdefghij_-12', { t: 'out' })).status).toBe(400);
    expect((await put(a, '1BA90417|2026-11-01', { t: 'borrar' })).status).toBe(400);
  });
  it('400 si la clave del DELETE no vale', async () => {
    const t = token();
    llaves.set(t.userId, { editaAjustes: true, recibeAlertas: false });
    expect((await request(app()).delete(B + '/ajustes/' + encodeURIComponent("x' OR 1=1")).set('Authorization', t.auth)).status).toBe(400);
  });
  it('DELETE con la llave: 204', async () => {
    const t = token();
    llaves.set(t.userId, { editaAjustes: true, recibeAlertas: false });
    expect((await request(app()).delete(B + '/ajustes/' + encodeURIComponent('*1BA90417')).set('Authorization', t.auth)).status).toBe(204);
  });
});

describe('llaves', () => {
  it('solo los admin las ven y las cambian', async () => {
    const t = token();
    llaves.set(t.userId, { editaAjustes: true, recibeAlertas: true });
    expect((await request(app()).get(B + '/llaves').set('Authorization', t.auth)).status).toBe(403);
    expect((await request(app()).put(B + '/llaves/00000000-0000-4000-8000-000000000001').set('Authorization', t.auth).send({ editaAjustes: true, recibeAlertas: true })).status).toBe(403);
    const r = await request(app()).get(B + '/llaves').set('Authorization', token({ role: 'admin' }).auth);
    expect([r.status, r.body[0].nombre]).toEqual([200, 'Persona Ficticia']);
  });
  it('PUT firma con el admin; 400 si no son booleanos; 404 si el usuario no existe', async () => {
    const a = token({ role: 'admin' }).auth;
    const r = await request(app()).put(B + '/llaves/00000000-0000-4000-8000-000000000001').set('Authorization', a).send({ editaAjustes: true, recibeAlertas: false });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ editaAjustes: true, recibeAlertas: false, actualizadoPor: expect.stringMatching(/@ambientalia\.com\.co$/) });
    expect((await request(app()).put(B + '/llaves/00000000-0000-4000-8000-000000000001').set('Authorization', a).send({ editaAjustes: 'sí', recibeAlertas: false })).status).toBe(400);
    const mala = await request(app()).put(B + '/llaves/no-es-uuid').set('Authorization', a).send({ editaAjustes: true, recibeAlertas: true });
    expect([mala.status, mala.body.message]).toEqual([400, 'Llaves no válidas']);
    expect((await request(app()).put(B + '/llaves/no-es-uuid').set('Authorization', a).send({ editaAjustes: true, recibeAlertas: true })).status).toBe(400);
    expect((await request(app()).put(B + '/llaves/00000000-0000-4000-8000-999999999999').set('Authorization', a).send({ editaAjustes: true, recibeAlertas: true })).status).toBe(404);
  });
});
