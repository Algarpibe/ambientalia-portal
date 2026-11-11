import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { RepoEquipos } from './repo.js';
import type { RepoSync } from './repo-sync.js';
import type { RepoTablero } from './repo-tablero.js';
import type { ServicioEquipos } from './servicio.js';
import { crearServicioTablero, type ServicioTablero } from './servicio-tablero.js';
import { AJUSTES_TABLERO_POR_DEFECTO } from './nucleo/index.js';

// Las amenazas T1–T8 de la llave de kiosco, con Express de verdad y el servicio de verdad sobre un
// repositorio en memoria (el SQL: repo-tablero.db.test.ts). Todo ficticio.
process.env.JWT_SECRET = 'test-secret-kiosco';
vi.mock('../db.js', () => ({ getHubPool: () => ({ query: async () => ({ rows: [], rowCount: 0 }), on: () => {} }) }));
const { createEquiposTallerRouter } = await import('./router.js');

const B = '/api/equipos-taller';
const RUTA = B + '/kiosco/tablero';
const MALAS = ['', 'tvk_corto', 'x'.repeat(5000), 'Bearer abc', 'tvk_' + '!'.repeat(43), 'TVK_' + 'A'.repeat(43), 'tvk_' + 'A'.repeat(44)];

let activas: Map<string, { id: string; nombre: string; hash: string; ultimoUsoEn: string | null }>;
let revocadas: Set<string>;
let busquedas: number;
let fallaFoto: boolean;
const tableroRepo: RepoTablero = {
  leerAjustesTablero: async () => AJUSTES_TABLERO_POR_DEFECTO,
  guardarAjustesTablero: async () => {},
  crearKiosco: async (nombre, hash, por) => {
    const id = 'k' + activas.size;
    activas.set(hash, { id, nombre, hash, ultimoUsoEn: null });
    return { id, nombre, creadoPor: por, creadoEn: '2026-11-12T00:00:00.000Z', revocadoEn: null, ultimoUsoEn: null };
  },
  listarKioscos: async () => [],
  kioscoPorHash: async (h) => {
    busquedas++;
    const k = activas.get(h);
    return k && !revocadas.has(k.id) ? k : null;
  },
  revocarKiosco: async (id) => { revocadas.add(id); return true; },
  marcarUso: async () => {},
};
const repoEquipos = {
  leerFoto: async () => {
    if (fallaFoto) throw new Error('connection to server at "db.interno" failed: password=secreto');
    return { at: '2026-11-12T03:00:00.000Z', hoy: '2026-11-11', rows: [], ilegibles: [] };
  },
  leerAjustes: async () => ({}),
  ultimaCorridaTerminada: async () => null,
  ultimaCorridaBuena: async () => null,
  incidenteAbierto: async () => null,
} as unknown as RepoEquipos;

let tablero: ServicioTablero;
let vistos: { user: unknown; kiosco: unknown }[];
const app = () => {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => {
    res.on('finish', () => vistos.push({ user: (req as { user?: unknown }).user, kiosco: res.locals.kiosco }));
    next();
  });
  a.use('/api', createEquiposTallerRouter({ repo: repoEquipos, servicio: {} as ServicioEquipos, sync: {} as RepoSync, tablero }));
  return a;
};
const secretoNuevo = async (nombre = 'TV uno'): Promise<string> => {
  const r = await tablero.crearToken(nombre, 'admin@equipos.test');
  if (!r.ok) throw new Error('debía crear');
  return r.secreto;
};
const pedir = (secreto: string | null, ruta = RUTA) => {
  const r = request(app()).get(ruta);
  return secreto === null ? r : r.set('X-Kiosk-Token', secreto);
};

beforeEach(() => {
  activas = new Map();
  revocadas = new Set();
  busquedas = 0;
  fallaFoto = false;
  vistos = [];
  tablero = crearServicioTablero({ repo: repoEquipos, tablero: tableroRepo, configurado: async () => true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('T1 fuga de la llave', () => {
  it('la llave en la URL no se acepta, ni sola ni junto a la cabecera correcta', async () => {
    const s = await secretoNuevo();
    for (const q of ['?k=', '?token=', '?x=a&kiosk_token=']) {
      expect((await pedir(null, RUTA + q + s)).status, q).toBe(401);
      expect((await pedir(s, RUTA + q + s)).status, q).toBe(401);
    }
    expect((await pedir(s)).status).toBe(200);
  });

  it('ni los logs ni ninguna respuesta (200, 401, 500) contienen la llave', async () => {
    const espías = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const s = await secretoNuevo();
    const ok = await pedir(s);
    const mala = await pedir('tvk_' + 'Z'.repeat(43));
    fallaFoto = true;
    const caida = await pedir(s);
    expect([ok.status, mala.status, caida.status]).toEqual([200, 401, 500]);
    expect(caida.body).toEqual({ error: 'internal error' });
    for (const r of [ok, mala, caida]) expect(JSON.stringify([r.body, r.headers])).not.toContain(s);
    expect(JSON.stringify(espías.flatMap((e) => e.mock.calls))).not.toContain(s);
  });

  it('todas las respuestas envían Referrer-Policy: no-referrer (200, 401 y 405)', async () => {
    const s = await secretoNuevo();
    const respuestas = [await pedir(s), await pedir(null), await request(app()).post(RUTA)];
    expect(respuestas.map((r) => r.status)).toEqual([200, 401, 405]);
    expect(respuestas.map((r) => r.headers['referrer-policy'])).toEqual(['no-referrer', 'no-referrer', 'no-referrer']);
  });
});

describe('T2 enumeración', () => {
  it('sin llave, mal formada, desconocida o revocada: el mismo 401 con el mismo cuerpo', async () => {
    const revocada = await secretoNuevo('TV vieja');
    revocadas.add('k0');
    const intentos = [null, ...MALAS, 'tvk_' + 'Q'.repeat(43), revocada];
    const rs = await Promise.all(intentos.map((t) => pedir(t)));
    expect(rs.map((r) => r.status)).toEqual(intentos.map(() => 401));
    expect(new Set(rs.map((r) => r.text))).toEqual(new Set(['{"error":"unauthorized"}']));
    expect(new Set(rs.map((r) => r.headers['www-authenticate'] ?? ''))).toEqual(new Set(['']));
  });
});

describe('T3 reuso tras revocar', () => {
  it('válida → revocar → la siguiente petición es 401 (la base se mira en cada una)', async () => {
    const s = await secretoNuevo();
    expect((await pedir(s)).status).toBe(200);
    expect((await pedir(s)).status).toBe(200);
    expect(busquedas).toBe(2);
    await tablero.revocarToken('k0', 'admin@equipos.test');
    const r = await pedir(s);
    expect([r.status, r.body]).toEqual([401, { error: 'unauthorized' }]);
    expect(busquedas).toBe(3);
  });
});

describe('T4 escalada', () => {
  it('la llave no vale en ninguna otra ruta: sigue pidiendo la sesión (JWT) o el token de máquina', async () => {
    const s = await secretoNuevo();
    const espía = vi.spyOn(tablero, 'guardarAjustes');
    const otras: [string, string][] = [
      ['get', B], ['put', B + '/ajustes/18A90001%7C2026-11-01'], ['delete', B + '/ajustes/18A90001%7C2026-11-01'],
      ['get', B + '/llaves'], ['put', B + '/llaves/00000000-0000-4000-8000-000000000001'],
      ['get', B + '/tablero/ajustes'], ['put', B + '/tablero/ajustes'],
      ['get', B + '/kiosco/tokens'], ['post', B + '/kiosco/tokens'], ['delete', B + '/kiosco/tokens/00000000-0000-4000-8000-000000000001'],
      ['post', B + '/sync/fin'],
    ];
    for (const [metodo, ruta] of otras) {
      const r = await (request(app()) as unknown as Record<string, (u: string) => request.Test>)[metodo](ruta).set('X-Kiosk-Token', s).send({ umbralAmbar: 1 });
      expect([metodo, ruta, r.status]).toEqual([metodo, ruta, 401]);
    }
    expect(espía).not.toHaveBeenCalled();
    expect(busquedas).toBe(0);
  });

  it('en la ruta del tablero solo vale GET: el resto de métodos se rechaza sin mirar la llave', async () => {
    const s = await secretoNuevo();
    for (const metodo of ['post', 'put', 'patch', 'delete'] as const) {
      const r = await request(app())[metodo](RUTA).set('X-Kiosk-Token', s).send({});
      expect([metodo, r.status, r.headers.allow]).toEqual([metodo, 405, 'GET']);
    }
    expect(busquedas).toBe(0);
  });

  it('una petición de kiosco nunca rellena req.user: la identidad va solo en res.locals.kiosco', async () => {
    const s = await secretoNuevo('TV uno');
    await pedir(s);
    expect(vistos).toEqual([{ user: undefined, kiosco: { id: 'k0', nombre: 'TV uno' } }]);
  });
});

describe('T5 sobreexposición y T6 robo de la base', () => {
  it('el cuerpo trae solo tablero, ajustes, fotoEn y aviso; nada de la llave ni de su resumen', async () => {
    const s = await secretoNuevo();
    const r = await pedir(s);
    expect(Object.keys(r.body).sort()).toEqual(['ajustes', 'aviso', 'fotoEn', 'tablero']);
    expect(r.body.fotoEn).toBe('2026-11-12T03:00:00.000Z');
    expect(r.text).not.toMatch(/tvk_|kiosco|hash|TV uno/);
  });

  it('la base solo ve el resumen SHA-256: la llave en claro nunca se busca ni se guarda', async () => {
    const s = await secretoNuevo();
    const buscar = vi.spyOn(tableroRepo, 'kioscoPorHash');
    await pedir(s);
    const hash = buscar.mock.calls[0][0];
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect([...activas.keys()]).toEqual([hash]);
    expect(JSON.stringify([...activas.values()])).not.toContain(s);
  });
});

describe('T7 caché', () => {
  it('200 y 401 llevan Cache-Control: no-store', async () => {
    const s = await secretoNuevo();
    expect([(await pedir(s)).headers['cache-control'], (await pedir(null)).headers['cache-control']]).toEqual(['no-store', 'no-store']);
  });
});

describe('T8 agotar la CPU', () => {
  it('una llave con formato imposible se rechaza sin llegar a la base ni al servicio', async () => {
    const validar = vi.spyOn(tablero, 'validarKiosco');
    for (const mala of MALAS) expect((await pedir(mala)).status).toBe(401);
    expect(validar).not.toHaveBeenCalled();
    expect(busquedas).toBe(0);
  });

  it('más de 10 peticiones por minuto desde una IP: 429, también sin mirar la llave', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const a = app();
    const estados: number[] = [];
    for (let i = 0; i < 12; i++) estados.push((await request(a).get(RUTA).set('X-Kiosk-Token', 'tvk_' + 'Q'.repeat(43))).status);
    expect(estados).toEqual([...Array(10).fill(401), 429, 429]);
    expect(busquedas).toBe(10);
    const r = await request(a).get(RUTA);
    expect([r.headers['cache-control'], r.headers['referrer-policy']]).toEqual(['no-store', 'no-referrer']);
  });

  it('el sondeo normal (3 TV, una petición por minuto cada una, 10 minutos) nunca se frena', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const s = await secretoNuevo();
    const a = app();
    const estados: number[] = [];
    for (let minuto = 0; minuto < 10; minuto++) {
      for (let tv = 0; tv < 3; tv++) estados.push((await request(a).get(RUTA).set('X-Kiosk-Token', s)).status);
      vi.setSystemTime(Date.now() + 60_001);
    }
    expect(estados).toEqual(Array(30).fill(200));
  });
});
