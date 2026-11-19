import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { MINUTOS_ABANDONO, type RepoEquipos } from './repo.js';
import type { ServicioEquipos } from './servicio.js';
import type { AjusteFirmado, Corrida, Incidente, LlavesUsuario, OrigenCorrida, ResponsableAsignado, UsuarioConLlaves } from './contrato.js';
import type { CierrePasada, RepoSync } from './repo-sync.js';
import type { ResultadoAjustes, ResultadoToken, ServicioTablero } from './servicio-tablero.js';
import { AJUSTES_TABLERO_POR_DEFECTO } from './nucleo/index.js';

// Las rutas con Express de verdad: guardas de sesión y de app, llaves, 403/400/404, y la
// corrida que lanza cada «fin» de n8n. El SQL lo cubre repo.db.test.ts; aquí el repositorio
// y el servicio son dobles. La sesión: requireAuth real con la consulta de usuario simulada
// (mismo patrón que calibraciones/router.test.ts). Todo ficticio.
const SECRET = 'test-secret-equipos-taller';
process.env.JWT_SECRET = SECRET;
const TOKEN_SYNC = 'token-sync-ficticio';
process.env.EQUIPOS_SYNC_TOKEN = TOKEN_SYNC;

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
function token(o: { role?: string; apps?: string[] } = {}): { auth: string; userId: string; email: string } {
  const userId = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  usuarios.set(userId, { role: o.role ?? 'reader', apps: o.apps ?? ['equipos-taller'] });
  const email = `u${seq}@ambientalia.com.co`;
  return { email, auth: 'Bearer ' + jwt.sign({ sub: email, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' }), userId };
}

const llaves = new Map<string, LlavesUsuario>();
const guardados: { clave: string; t: string; m: string; userId: string | null; usuario: string }[] = [];
let lanzar: ServicioEquipos['lanzar'] = async () => 'iniciada';
let configurado = true;
let servicioOcupado = false;
let fallaLeer = false;
let incidente: Incidente | null = null;
const borrados: string[] = [];
let enCurso: Corrida | null = null;
let terminada: Corrida | null = null;
// Responsables: dos técnicos con la app; cualquier otro uuid «no está activo o no tiene la app».
const TEC_UNO = '00000000-0000-4000-8000-0000000000c1';
const TEC_DOS = '00000000-0000-4000-8000-0000000000c2';
const asignados = new Map<string, ResponsableAsignado>();
const firmas: { clave: string; userId: string; quien: { userId: string | null; email: string } }[] = [];
const borradosResp: string[] = [];
const repo = {
  leerFoto: async () => null,
  leerAjustes: async () => {
    if (fallaLeer) throw new Error('connection to server at "db.interno" failed: password=secreto');
    return {};
  },
  ultimaCorrida: async () => enCurso ?? terminada,
  ultimaCorridaTerminada: async () => terminada,
  ultimaCorridaBuena: async () => null,
  incidenteAbierto: async () => incidente,
  llavesDe: async (userId: string | null) => llaves.get(String(userId)) ?? { editaAjustes: false, recibeAlertas: false },
  guardarAjuste: async (clave: string, a: { t: AjusteFirmado['t']; m: string }, f: { userId: string | null; usuario: string }): Promise<AjusteFirmado> => {
    guardados.push({ clave, ...a, ...f });
    return { ...a, at: '2026-11-10', usuario: f.usuario, creadoEn: '2026-11-10T15:00:00.000Z' };
  },
  borrarAjuste: async (clave: string) => {
    borrados.push(clave);
  },
  listarLlaves: async (): Promise<UsuarioConLlaves[]> => [{ userId: 'u', nombre: 'Persona Ficticia', email: 'p@ambientalia.com.co', esAdmin: false, editaAjustes: true, recibeAlertas: false, actualizadoPor: null, actualizadoEn: null }],
  guardarLlaves: async (userId: string, l: LlavesUsuario, por: string): Promise<UsuarioConLlaves | null> =>
    userId.endsWith('999999999999') ? null : { userId, nombre: 'X', email: 'x@ambientalia.com.co', esAdmin: false, ...l, actualizadoPor: por, actualizadoEn: '2026-11-10T15:00:00.000Z' },
  listarResponsables: async () => Object.fromEntries(asignados),
  listarTecnicos: async () => [{ userId: TEC_UNO, nombre: 'Técnico Uno' }, { userId: TEC_DOS, nombre: 'Técnico Dos' }],
  esTecnicoValido: async (userId: string) => userId === TEC_UNO || userId === TEC_DOS,
  guardarResponsable: async (clave: string, userId: string, quien: { userId: string | null; email: string }): Promise<ResponsableAsignado> => {
    firmas.push({ clave, userId, quien });
    const r = { userId, nombre: userId === TEC_UNO ? 'Técnico Uno' : 'Técnico Dos', por: quien.email, en: '2026-11-19T15:00:00.000Z' };
    asignados.set(clave, r);
    return r;
  },
  borrarResponsable: async (clave: string) => {
    borradosResp.push(clave);
    asignados.delete(clave);
  },
} as unknown as RepoEquipos;
const servicio = {
  configurado: async () => configurado,
  actualizando: () => servicioOcupado,
  lanzar: (o: OrigenCorrida, u: string | null) => lanzar(o, u),
} as unknown as ServicioEquipos;
let cierre: CierrePasada = 'cerrada';
const sync = { cerrarPasada: async () => cierre } as unknown as RepoSync;
// El servicio del tablero (su lógica: servicio-tablero.test.ts): aquí solo se mira quién puede llamarlo y cómo se responde.
const KIOSCO = { id: '00000000-0000-4000-8000-0000000000aa', nombre: 'TV uno', creadoPor: 'admin@ambientalia.com.co', creadoEn: '2026-11-12T00:00:00.000Z', revocadoEn: null, ultimoUsoEn: null };
const aTablero: unknown[][] = [];
let guardaAjustes: ResultadoAjustes;
let creaToken: ResultadoToken;
let revoca = true;
const tablero = {
  ajustes: async () => { aTablero.push(['ajustes']); return AJUSTES_TABLERO_POR_DEFECTO; },
  guardarAjustes: async (p: unknown, por: string) => { aTablero.push(['guardar', p, por]); return guardaAjustes; },
  crearToken: async (n: unknown, por: string) => { aTablero.push(['crear', n, por]); return creaToken; },
  listarTokens: async () => { aTablero.push(['listar']); return [KIOSCO]; },
  revocarToken: async (id: string, por: string) => { aTablero.push(['revocar', id, por]); return revoca; },
} as unknown as ServicioTablero;

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api', createEquiposTallerRouter({ repo, servicio, sync, tablero }));
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
  servicioOcupado = false;
  fallaLeer = false;
  incidente = null;
  borrados.length = 0;
  cierre = 'cerrada';
  aTablero.length = 0;
  guardaAjustes = { ok: true, ajustes: { ...AJUSTES_TABLERO_POR_DEFECTO, umbralAmbar: 45 } };
  creaToken = { ok: true, kiosco: KIOSCO, secreto: 'tvk_' + 'A'.repeat(43) };
  revoca = true;
  asignados.clear();
  firmas.length = 0;
  borradosResp.length = 0;
  vi.restoreAllMocks();
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
  it('lleva las asignaciones vigentes en «responsables», también a quien no tiene la llave', async () => {
    const r1 = { userId: TEC_UNO, nombre: 'Técnico Uno', por: 'Admin Uno', en: '2026-11-19T15:00:00.000Z' };
    asignados.set('1BA9041T|2026-11-01', r1);
    const r = await request(app()).get(B).set('Authorization', token().auth);
    expect(r.body.responsables).toEqual({ '1BA9041T|2026-11-01': r1 });
  });
});

describe('GET: otros caminos', () => {
  it('sin configurar, lo dice', async () => {
    configurado = false;
    expect((await request(app()).get(B).set('Authorization', token().auth)).body.configurado).toBe(false);
  });
  it('actualizando si el servicio de este proceso está corriendo', async () => {
    servicioOcupado = true;
    expect((await request(app()).get(B).set('Authorization', token().auth)).body.actualizando).toBe(true);
  });
  it('un fallo del repositorio es un 500 genérico, sin detalles', async () => {
    fallaLeer = true;
    const r = await request(app()).get(B).set('Authorization', token().auth);
    expect([r.status, r.body]).toEqual([500, { error: 'internal error' }]);
    expect(r.text).not.toMatch(/secreto|db.interno/);
  });
  it('el error de la alerta solo lo ve un admin', async () => {
    incidente = { id: 1, abiertoEn: '2026-11-10T11:30:00.000Z', fallosProgramados: 2, alertaEnviadaEn: null, alertaUltimoError: 'n8n: HTTP 500' };
    const normal = await request(app()).get(B).set('Authorization', token().auth);
    const admin = await request(app()).get(B).set('Authorization', token({ role: 'admin' }).auth);
    expect(normal.body.incidente).toMatchObject({ id: 1, fallosProgramados: 2, alertaUltimoError: null });
    expect(admin.body.incidente.alertaUltimoError).toBe('n8n: HTTP 500');
  });
});

describe('aviso de foto vieja con una corrida en curso', () => {
  const corrida = (o: Partial<Corrida>): Corrida => ({ id: 1, origen: 'programada', inicio: new Date().toISOString(), fin: null, enCurso: false, ok: null, causa: null, avisos: [], conteos: null, ...o });
  it('ultima es la última TERMINADA (fallida) aunque haya otra en curso, y actualizando sigue siendo true', async () => {
    terminada = corrida({ id: 1, fin: '2026-11-10T11:35:00.000Z', ok: false, causa: 'drive: HTTP 403' });
    enCurso = corrida({ id: 2, enCurso: true });
    const r = await request(app()).get(B).set('Authorization', token().auth);
    expect(r.body.actualizando).toBe(true);
    expect(r.body.ultima).toMatchObject({ id: 1, ok: false, causa: 'drive: HTTP 403', enCurso: false });
  });
  it('una corrida en curso abandonada (más vieja que el plazo) ya no cuenta como «actualizando»', async () => {
    enCurso = corrida({ id: 2, enCurso: true, inicio: new Date(Date.now() - (MINUTOS_ABANDONO + 1) * 60_000).toISOString() });
    expect((await request(app()).get(B).set('Authorization', token().auth)).body.actualizando).toBe(false);
    enCurso = corrida({ id: 2, enCurso: true, inicio: new Date(Date.now() - (MINUTOS_ABANDONO - 5) * 60_000).toISOString() });
    expect((await request(app()).get(B).set('Authorization', token().auth)).body.actualizando).toBe(true);
  });
});

describe('sin botón: la pantalla se actualiza sola', () => {
  it('POST /equipos-taller/actualizar ya no existe (404), tampoco para un admin', async () => {
    let lanzada = false;
    lanzar = async () => { lanzada = true; return 'iniciada'; };
    expect((await request(app()).post(B + '/actualizar').set('Authorization', token().auth)).status).toBe(404);
    expect((await request(app()).post(B + '/actualizar').set('Authorization', token({ role: 'admin' }).auth)).status).toBe(404);
    expect(lanzada).toBe(false);
  });
});

describe('POST /equipos-taller/sync/fin lanza la corrida «sincronizacion»', () => {
  const FIN = { pasada: '4711', conteos: { entradas: 1, salidas_n8n: 0, salidas_escaneadas: 0 } };
  const fin = () => request(app()).post(B + '/sync/fin').set('X-Equipos-Sync-Token', TOKEN_SYNC).send(FIN);

  it('al cerrar la pasada, sin usuario', async () => {
    const vistos: unknown[][] = [];
    lanzar = async (...a) => { vistos.push(a); return 'iniciada'; };
    expect((await fin()).body).toEqual({ ok: true, completa: true });
    cierre = 'textos_fallidos';
    expect((await fin()).body).toEqual({ ok: true, completa: false, motivo: 'textos_fallidos' });
    await vi.waitFor(() => expect(vistos).toEqual([['sincronizacion', null], ['sincronizacion', null]]));
  });

  it('si ya hay una en curso (la de las 06:30) o falta configurar, se omite y lo dice el log', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    lanzar = async () => 'ocupado';
    await fin();
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith('equipos-taller: corrida tras la sincronización omitida (ya hay una en curso)'));
    lanzar = async () => 'sin_configurar';
    await fin();
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith('equipos-taller: corrida tras la sincronización omitida (falta configurar)'));
  });

  it('una pasada que no se cerró no lanza nada', async () => {
    let lanzada = false;
    lanzar = async () => { lanzada = true; return 'iniciada'; };
    cierre = 'ya_cerrada';
    expect((await fin()).status).toBe(409);
    await new Promise((r) => setTimeout(r, 30));
    expect(lanzada).toBe(false);
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
  it('400 si m no es texto', async () => {
    const a = token({ role: 'admin' }).auth;
    expect((await put(a, '1BA90417|2026-11-01', { t: 'in', m: 5 })).status).toBe(400);
    expect((await put(a, '1BA90417|2026-11-01', { t: 'in', m: { x: 1 } })).status).toBe(400);
    expect(guardados).toEqual([]);
  });
  it('ignora el usuario o userId que mande el cliente: firma con el del token', async () => {
    const t = token({ role: 'admin' });
    await put(t.auth, '1BA90417|2026-11-01', { t: 'in', usuario: 'otro@ambientalia.com.co', userId: 'otro' });
    expect(guardados[0]).toMatchObject({ userId: t.userId, usuario: t.email });
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
  it('DELETE pasa la clave ya decodificada, y un admin puede sin la llave', async () => {
    const r = await request(app()).delete(B + '/ajustes/' + encodeURIComponent('1BA90417|2026-11-01')).set('Authorization', token({ role: 'admin' }).auth);
    expect(r.status).toBe(204);
    expect(borrados).toEqual(['1BA90417|2026-11-01']);
  });
  it('DELETE con la llave: 204', async () => {
    const t = token();
    llaves.set(t.userId, { editaAjustes: true, recibeAlertas: false });
    expect((await request(app()).delete(B + '/ajustes/' + encodeURIComponent('*1BA90417')).set('Authorization', t.auth)).status).toBe(204);
  });
});

describe('responsable asignado desde la tabla', () => {
  const K = '1BA9041T|2026-11-01';
  const R = (k: string) => B + '/responsables/' + encodeURIComponent(k);
  const put = (auth: string, k: string, b: object) => request(app()).put(R(k)).set('Authorization', auth).send(b);
  const conLlave = () => {
    const t = token();
    llaves.set(t.userId, { editaAjustes: true, recibeAlertas: false });
    return t;
  };

  it('403 sin_llave en las tres rutas, sin tocar nada; 401 sin sesión', async () => {
    const a = token().auth;
    const rs = [await request(app()).get(B + '/tecnicos').set('Authorization', a), await put(a, K, { userId: TEC_UNO }), await request(app()).delete(R(K)).set('Authorization', a)];
    expect(rs.map((r) => [r.status, r.body.error])).toEqual([[403, 'sin_llave'], [403, 'sin_llave'], [403, 'sin_llave']]);
    expect([firmas, borradosResp]).toEqual([[], []]);
    expect((await request(app()).get(B + '/tecnicos')).status).toBe(401);
  });

  it('GET /tecnicos con la llave: los usuarios con la app, sin caché', async () => {
    const r = await request(app()).get(B + '/tecnicos').set('Authorization', conLlave().auth);
    expect([r.status, r.headers['cache-control'], r.body]).toEqual([200, 'no-store', { tecnicos: [{ userId: TEC_UNO, nombre: 'Técnico Uno' }, { userId: TEC_DOS, nombre: 'Técnico Dos' }] }]);
  });

  it('asignar, reasignar y quitar (dos veces: 200 también si ya no había asignación)', async () => {
    const t = conLlave();
    const a = await put(t.auth, K, { userId: TEC_UNO });
    expect([a.status, a.body]).toEqual([200, { responsable: { userId: TEC_UNO, nombre: 'Técnico Uno', por: t.email, en: '2026-11-19T15:00:00.000Z' } }]);
    expect((await put(t.auth, K, { userId: TEC_DOS })).body.responsable.userId).toBe(TEC_DOS);
    expect(asignados.get(K)?.userId).toBe(TEC_DOS);
    for (let i = 0; i < 2; i++) {
      const d = await request(app()).delete(R(K)).set('Authorization', t.auth);
      expect([d.status, d.body]).toEqual([200, { ok: true }]);
    }
    expect(borradosResp).toEqual([K, K]);
    expect(asignados.size).toBe(0);
  });

  it('un admin puede sin la llave, y firma el token, no lo que mande el cliente', async () => {
    const adm = token({ role: 'admin' });
    expect((await put(adm.auth, K, { userId: TEC_UNO, por: 'otro@ambientalia.com.co', quien: 'otro' })).status).toBe(200);
    expect(firmas).toEqual([{ clave: K, userId: TEC_UNO, quien: { userId: adm.userId, email: adm.email } }]);
  });

  it('422 usuario_sin_app si el usuario no está activo o no tiene la app', async () => {
    const r = await put(conLlave().auth, K, { userId: '00000000-0000-4000-8000-0000000000ff' });
    expect([r.status, r.body.error]).toEqual([422, 'usuario_sin_app']);
    expect(firmas).toEqual([]);
  });

  it('401 sin sesión también en PUT y DELETE de responsables', async () => {
    const rs = [await request(app()).put(R(K)).send({ userId: TEC_UNO }), await request(app()).delete(R(K))];
    expect(rs.map((r) => r.status)).toEqual([401, 401]);
    expect([firmas, borradosResp]).toEqual([[], []]);
  });

  it('sin la llave, una clave o un userId inválidos dan 403 sin_llave, no 400 (el permiso va antes que la validación)', async () => {
    const a = token().auth;
    const rs = [
      await put(a, '*1BA9041T', { userId: TEC_UNO }),
      await put(a, K, { userId: 'no-es-uuid' }),
      await put(a, '*1BA9041T', {}),
      await request(app()).delete(R('*1BA9041T')).set('Authorization', a),
    ];
    expect(rs.map((r) => [r.status, r.body.error])).toEqual([[403, 'sin_llave'], [403, 'sin_llave'], [403, 'sin_llave'], [403, 'sin_llave']]);
    expect([firmas, borradosResp]).toEqual([[], []]);
  });

  it('acepta un uuid en mayúsculas y lo pasa tal cual a esTecnicoValido y a guardarResponsable', async () => {
    const MAYUS = TEC_UNO.toUpperCase();
    const valido = vi.spyOn(repo, 'esTecnicoValido').mockResolvedValue(true);
    const r = await put(conLlave().auth, K, { userId: MAYUS });
    expect(r.status).toBe(200);
    expect(valido).toHaveBeenCalledWith(MAYUS);
    expect(firmas.map((f) => f.userId)).toEqual([MAYUS]);
  });

  it('400 si la clave no es de una visita o falta el userId', async () => {
    const a = conLlave().auth;
    for (const mala of ['*1BA9041T', 'pdf:Abcdefghij_-12', "x' OR 1=1", '1BA9041T|2026-02-30']) {
      const r = await put(a, mala, { userId: TEC_UNO });
      expect([mala, r.status, r.body.error]).toEqual([mala, 400, 'invalid_input']);
      expect((await request(app()).delete(R(mala)).set('Authorization', a)).status, mala).toBe(400);
    }
    for (const b of [{}, { userId: 5 }, { userId: 'no-es-uuid' }]) expect((await put(a, K, b)).status, JSON.stringify(b)).toBe(400);
    expect([firmas, borradosResp]).toEqual([[], []]);
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
    const adm = token({ role: 'admin' });
    const a = adm.auth;
    const r = await request(app()).put(B + '/llaves/00000000-0000-4000-8000-000000000001').set('Authorization', a).send({ editaAjustes: true, recibeAlertas: false });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ editaAjustes: true, recibeAlertas: false, actualizadoPor: adm.email });
    expect((await request(app()).put(B + '/llaves/00000000-0000-4000-8000-000000000001').set('Authorization', a).send({ editaAjustes: 'sí', recibeAlertas: false })).status).toBe(400);
    const mala = await request(app()).put(B + '/llaves/no-es-uuid').set('Authorization', a).send({ editaAjustes: true, recibeAlertas: true });
    expect([mala.status, mala.body.message]).toEqual([400, 'Llaves no válidas']);
    expect((await request(app()).put(B + '/llaves/00000000-0000-4000-8000-999999999999').set('Authorization', a).send({ editaAjustes: true, recibeAlertas: true })).status).toBe(404);
  });
});

describe('rutas de n8n', () => {
  it('están montadas y las guarda su token, no la sesión', async () => {
    delete process.env.EQUIPOS_SYNC_TOKEN;
    const r = await request(app()).post(B + '/sync/fin').set('Authorization', token({ role: 'admin' }).auth).send({ pasada: '1', conteos: {} });
    expect([r.status, r.body]).toEqual([401, { error: 'unauthorized' }]);
  });

  it('con su token entran SIN sesión: llegan a la validación (400), no al 401 de requireAuth', async () => {
    process.env.EQUIPOS_SYNC_TOKEN = 'token-sync-ficticio';
    try {
      const r = await request(app()).post(B + '/sync/fin').set('X-Equipos-Sync-Token', 'token-sync-ficticio').send({ pasada: '1', conteos: {} });
      expect([r.status, r.body.error]).toEqual([400, 'invalid_input']);
    } finally {
      delete process.env.EQUIPOS_SYNC_TOKEN;
    }
  });
});

describe('ajustes del tablero', () => {
  const R = B + '/tablero/ajustes';
  it('GET y PUT solo para un admin (también con la app y la llave), 401 sin sesión', async () => {
    const lector = token();
    llaves.set(lector.userId, { editaAjustes: true, recibeAlertas: true });
    expect((await request(app()).get(R)).status).toBe(401);
    expect((await request(app()).get(R).set('Authorization', lector.auth)).status).toBe(403);
    expect((await request(app()).put(R).set('Authorization', lector.auth).send({ umbralAmbar: 45 })).status).toBe(403);
    expect(aTablero).toEqual([]);
  });

  it('un admin los lee, y los guarda firmados con su correo', async () => {
    const adm = token({ role: 'admin' });
    const g = await request(app()).get(R).set('Authorization', adm.auth);
    expect([g.status, g.body, g.headers['cache-control']]).toEqual([200, AJUSTES_TABLERO_POR_DEFECTO, 'no-store']);
    const p = await request(app()).put(R).set('Authorization', adm.auth).send({ umbralAmbar: 45 });
    expect([p.status, p.body.umbralAmbar]).toEqual([200, 45]);
    expect(aTablero).toContainEqual(['guardar', { umbralAmbar: 45 }, adm.email]);
  });

  it('si no valen, 400 con el motivo', async () => {
    guardaAjustes = { ok: false, motivo: 'El umbral rojo debe ser un entero mayor que el ámbar' };
    const r = await request(app()).put(R).set('Authorization', token({ role: 'admin' }).auth).send({ umbralRojo: 1 });
    expect([r.status, r.body]).toEqual([400, { error: 'invalid_input', message: 'El umbral rojo debe ser un entero mayor que el ámbar' }]);
  });

  it('GET /equipos-taller lleva los efectivos en «tablero»: solo ellos, con una consulta más', async () => {
    const r = await request(app()).get(B).set('Authorization', token().auth);
    expect(r.body.tablero).toEqual(AJUSTES_TABLERO_POR_DEFECTO);
    expect(Object.keys(r.body.tablero).sort()).toEqual(['kpis', 'nocheDesde', 'nocheHasta', 'temaTv', 'umbralAmbar', 'umbralRojo']);
    expect(aTablero).toEqual([['ajustes']]);
  });
});

describe('llaves de kiosco (administración)', () => {
  const T = B + '/kiosco/tokens';
  const ID = KIOSCO.id;
  it('un no admin no puede crear, listar ni revocar (403), ni sin sesión (401)', async () => {
    const a = token({ apps: ['equipos-taller'] }).auth;
    for (const [m, u] of [['get', T], ['post', T], ['delete', T + '/' + ID]] as const) {
      expect((await request(app())[m](u).set('Authorization', a).send({ nombre: 'TV' })).status, m).toBe(403);
      expect((await request(app())[m](u).send({ nombre: 'TV' })).status, m).toBe(401);
    }
    expect(aTablero).toEqual([]);
  });

  it('crear: 201 con el secreto una vez y sin caché, firmado con el admin', async () => {
    const adm = token({ role: 'admin' });
    const r = await request(app()).post(T).set('Authorization', adm.auth).send({ nombre: 'TV uno' });
    expect([r.status, r.headers['cache-control']]).toEqual([201, 'no-store']);
    expect(r.body).toEqual({ kiosco: KIOSCO, secreto: 'tvk_' + 'A'.repeat(43) });
    expect(aTablero).toEqual([['crear', 'TV uno', adm.email]]);
  });

  it('crear: 400 si el nombre no vale y 409 si ya hay una activa con él', async () => {
    const a = token({ role: 'admin' }).auth;
    creaToken = { ok: false, motivo: 'nombre' };
    expect((await request(app()).post(T).set('Authorization', a).send({ nombre: '' })).status).toBe(400);
    creaToken = { ok: false, motivo: 'repetido' };
    expect((await request(app()).post(T).set('Authorization', a).send({ nombre: 'TV uno' })).status).toBe(409);
  });

  it('listar: solo metadatos, sin resumen ni secreto', async () => {
    const r = await request(app()).get(T).set('Authorization', token({ role: 'admin' }).auth);
    expect(r.body).toEqual([KIOSCO]);
    expect(r.text).not.toMatch(/hash|secreto|tvk_/);
  });

  it('revocar: 204; 404 si no existe o ya estaba revocada; 400 si el id no es un uuid', async () => {
    const adm = token({ role: 'admin' });
    expect((await request(app()).delete(T + '/' + ID).set('Authorization', adm.auth)).status).toBe(204);
    expect(aTablero).toEqual([['revocar', ID, adm.email]]);
    revoca = false;
    expect((await request(app()).delete(T + '/' + ID).set('Authorization', adm.auth)).status).toBe(404);
    expect((await request(app()).delete(T + '/no-es-uuid').set('Authorization', adm.auth)).status).toBe(400);
  });
});
