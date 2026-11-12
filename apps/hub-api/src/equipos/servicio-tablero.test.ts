import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { armarRespuestaTablero, type AjusteFirmado, type Kiosco } from './contrato.js';
import { aplicarAjustes, construirTablero, AJUSTES_TABLERO_POR_DEFECTO, EST, type Foto } from './nucleo/index.js';
import { crearServicioTablero, formatoToken, hashToken, type ServicioTablero } from './servicio-tablero.js';
import type { KioscoActivo, RepoTablero } from './repo-tablero.js';

// El servicio del tablero con dobles de repositorio (el SQL: repo-tablero.db.test.ts). Todo ficticio.
const AHORA = Date.parse('2026-11-12T03:30:00Z');
const MIN = 60_000;
const FOTO: Foto = {
  at: '2026-11-12T03:00:00.000Z',
  hoy: '2026-11-11',
  rows: [
    { id: 'DRIVEID-CARPETA-SECRETA', d: '2026-11-01', c: 'CLIENTE A', sn: '18A90001', est: EST.TALLER, src: '', why: ['MOTIVO-INTERNO'], x: { n: 'SALIDA-INTERNA' }, z: null, zc: false, pa: [], xd: '', eq: 'Equipo X' },
    { id: 'DRIVEID-OTRA', d: '2026-10-01', c: 'CLIENTE B', sn: '18A90002', est: EST.EXTERNO, src: '', why: [], x: null, z: null, zc: false, pa: [], xd: '', eq: '' },
  ] as unknown as Foto['rows'],
  ilegibles: [],
};
const AJUSTES: Record<string, AjusteFirmado> = { '18A90001|2026-11-01': { t: 'in', m: 'NOTA-PRIVADA', at: '2026-11-02', usuario: 'quien@equipos.test', creadoEn: '2026-11-02T10:00:00.000Z' } };

let kioscos: KioscoActivo[];
let usos: string[];
let guardados: { hash: string; nombre: string }[];
let hashesBuscados: string[];
let ajustesGuardados: unknown[];
let ahora: number;
const tablero: RepoTablero = {
  leerAjustesTablero: async () => ({ ...AJUSTES_TABLERO_POR_DEFECTO, umbralAmbar: 10, umbralRojo: 20 }),
  guardarAjustesTablero: async (a) => { ajustesGuardados.push(a); },
  crearKiosco: async (nombre, hash, por) => {
    if (nombre === 'Repetida') return null;
    guardados.push({ hash, nombre });
    return { id: 'k1', nombre, creadoPor: por, creadoEn: '2026-11-12T00:00:00.000Z', revocadoEn: null, ultimoUsoEn: null } satisfies Kiosco;
  },
  listarKioscos: async () => [],
  kioscoPorHash: async (h) => { hashesBuscados.push(h); return kioscos.find((k) => k.hash === h) ?? null; },
  revocarKiosco: async () => true,
  marcarUso: async (id) => { usos.push(id); },
};
const repo = {
  leerFoto: async () => FOTO,
  leerAjustes: async () => AJUSTES,
  ultimaCorridaTerminada: async () => null,
  ultimaCorridaBuena: async () => null,
  incidenteAbierto: async () => null,
};
let s: ServicioTablero;
beforeEach(() => {
  kioscos = [];
  usos = [];
  guardados = [];
  hashesBuscados = [];
  ajustesGuardados = [];
  ahora = AHORA;
  s = crearServicioTablero({ repo, tablero, configurado: async () => true, ahora: () => ahora });
});

describe('secreto de la llave', () => {
  it('tvk_ + 32 bytes aleatorios en base64url (256 bits), distinto cada vez', async () => {
    const a = await s.crearToken('TV uno', 'admin@equipos.test');
    const b = await s.crearToken('TV dos', 'admin@equipos.test');
    if (!a.ok || !b.ok) throw new Error('debía crear');
    expect(a.secreto).toMatch(/^tvk_[A-Za-z0-9_-]{43}$/);
    expect(formatoToken.test(a.secreto)).toBe(true);
    expect(a.secreto).not.toBe(b.secreto);
  });

  it('solo se guarda el SHA-256 hex del secreto, y la respuesta no lleva el resumen', async () => {
    const r = await s.crearToken('  TV uno  ', 'admin@equipos.test');
    if (!r.ok) throw new Error('debía crear');
    expect(guardados).toEqual([{ nombre: 'TV uno', hash: createHash('sha256').update(r.secreto).digest('hex') }]);
    expect(hashToken(r.secreto)).toBe(guardados[0].hash);
    expect(JSON.stringify(r.kiosco)).not.toContain(guardados[0].hash);
    expect(guardados[0].hash).not.toContain(r.secreto);
  });

  it('nombre vacío o de más de 60 caracteres: motivo «nombre» sin tocar la base; repetido: motivo «repetido»', async () => {
    expect(await s.crearToken('   ', 'a')).toEqual({ ok: false, motivo: 'nombre' });
    expect(await s.crearToken('x'.repeat(61), 'a')).toEqual({ ok: false, motivo: 'nombre' });
    expect(await s.crearToken(42 as unknown as string, 'a')).toEqual({ ok: false, motivo: 'nombre' });
    expect(guardados).toEqual([]);
    expect(await s.crearToken('Repetida', 'a')).toEqual({ ok: false, motivo: 'repetido' });
  });
});

describe('validarKiosco', () => {
  const secreto = 'tvk_' + 'A'.repeat(43);
  const activa = (o: Partial<KioscoActivo> = {}): KioscoActivo => ({ id: 'k1', nombre: 'TV uno', hash: hashToken(secreto), ultimoUsoEn: null, ...o });

  it('busca por el resumen (nunca por el texto) y devuelve solo id y nombre', async () => {
    kioscos = [activa()];
    expect(await s.validarKiosco(secreto)).toEqual({ id: 'k1', nombre: 'TV uno' });
    expect(hashesBuscados).toEqual([hashToken(secreto)]);
  });

  it('una llave desconocida o revocada (la base no la devuelve) es null', async () => {
    expect(await s.validarKiosco(secreto)).toBeNull();
  });

  it('si la base devolviera un resumen distinto del calculado, null (comparación en tiempo constante)', async () => {
    const otro = { ...tablero, kioscoPorHash: async () => activa({ hash: hashToken('tvk_' + 'B'.repeat(43)) }) };
    expect(await crearServicioTablero({ repo, tablero: otro, configurado: async () => true }).validarKiosco(secreto)).toBeNull();
    expect(usos).toEqual([]);
  });

  it('«último uso» se escribe a lo sumo cada 5 minutos', async () => {
    kioscos = [activa()];
    await s.validarKiosco(secreto);
    expect(usos).toEqual(['k1']);
    kioscos = [activa({ ultimoUsoEn: new Date(ahora - 2 * MIN).toISOString() })];
    await s.validarKiosco(secreto);
    expect(usos).toEqual(['k1']);
    kioscos = [activa({ ultimoUsoEn: new Date(ahora - 6 * MIN).toISOString() })];
    await s.validarKiosco(secreto);
    expect(usos).toEqual(['k1', 'k1']);
  });
});

describe('tableroKiosco', () => {
  it('el mismo resultado que armar el tablero en el cliente con la misma foto y el mismo reloj', async () => {
    const r = await s.tableroKiosco(AHORA);
    const cfg = { ...AJUSTES_TABLERO_POR_DEFECTO, umbralAmbar: 10, umbralRojo: 20 };
    expect(r.tablero).toEqual(construirTablero(aplicarAjustes(FOTO.rows, AJUSTES), cfg, AHORA));
    expect(r.tablero.columnas.flatMap((c) => c.tarjetas)).toHaveLength(2);
    expect(r).toEqual(armarRespuestaTablero({ snap: FOTO, ajustes: AJUSTES, cfg, aviso: null }, AHORA));
    expect(r.ajustes).toEqual(cfg);
    expect(r.fotoEn).toBe(FOTO.at);
  });

  it('lista blanca (T5): sin motivos, salidas, ids o URLs de Drive, notas, firmas ni permisos', async () => {
    const r = await s.tableroKiosco(AHORA);
    expect(Object.keys(r).sort()).toEqual(['ajustes', 'aviso', 'fotoEn', 'tablero']);
    const tarjetas = r.tablero.columnas.flatMap((c) => c.tarjetas);
    for (const t of tarjetas) {
      expect(Object.keys(t).sort()).toEqual(['clave', 'dias', 'entrada', 'equipo', 'etiquetas', 'cliente', 'pie', 'sn', 'tecnico', 'ticket', 'tono'].sort());
    }
    const texto = JSON.stringify(r);
    for (const prohibido of ['MOTIVO-INTERNO', 'SALIDA-INTERNA', 'DRIVEID', 'NOTA-PRIVADA', 'quien@equipos.test', '"why"', '"x"', 'permisos', 'llaves']) {
      expect(texto, prohibido).not.toContain(prohibido);
    }
  });

  it('la TV con llave recibe el tema elegido en Ajustes dentro de «ajustes»', async () => {
    const noche = crearServicioTablero({
      repo, configurado: async () => true,
      tablero: { ...tablero, leerAjustesTablero: async () => ({ ...AJUSTES_TABLERO_POR_DEFECTO, temaTv: 'noche' }) },
    });
    expect((await noche.tableroKiosco(AHORA)).ajustes.temaTv).toBe('noche');
    expect((await s.tableroKiosco(AHORA)).ajustes.temaTv).toBe('dia');
  });

  it('sin foto, un tablero vacío y fotoEn null (no revienta)', async () => {
    const vacio = crearServicioTablero({ repo: { ...repo, leerFoto: async () => null }, tablero, configurado: async () => true });
    const r = await vacio.tableroKiosco(AHORA);
    expect([r.fotoEn, r.tablero.columnas.flatMap((c) => c.tarjetas)]).toEqual([null, []]);
  });
});

describe('guardarAjustes', () => {
  it('acepta un cambio parcial validado contra el resultado combinado y firma con el admin', async () => {
    const r = await s.guardarAjustes({ umbralAmbar: 15 }, 'admin@equipos.test');
    expect(r).toEqual({ ok: true, ajustes: { ...AJUSTES_TABLERO_POR_DEFECTO, umbralAmbar: 15, umbralRojo: 20 } });
    expect(ajustesGuardados).toHaveLength(1);
  });

  it('guarda solo el tema de la TV y conserva el resto', async () => {
    const r = await s.guardarAjustes({ temaTv: 'auto' }, 'admin@equipos.test');
    expect(r).toEqual({ ok: true, ajustes: { ...AJUSTES_TABLERO_POR_DEFECTO, umbralAmbar: 10, umbralRojo: 20, temaTv: 'auto' } });
    expect(ajustesGuardados).toEqual([{ ...AJUSTES_TABLERO_POR_DEFECTO, umbralAmbar: 10, umbralRojo: 20, temaTv: 'auto' }]);
  });

  it.each([
    [{ temaTv: 'claro' }, /tema de la TV/i],
    [{ temaTv: null }, /tema de la TV/i],
    [{ umbralRojo: 10 }, /rojo/i],
    [{ umbralAmbar: 0 }, /ámbar/i],
    [{ nocheDesde: 24 }, /hora/i],
    [{ kpis: ['en_taller', 'revisar', 'externo', 'entregado'] }, /5/],
    [{ kpis: ['en_taller', 'revisar', 'externo', 'entregado', 'inventado'] }, /KPI/],
    [{ kpis: ['en_taller', 'en_taller', 'externo', 'entregado', 'revisar'] }, /distint/i],
    [null, /objeto/i],
  ])('rechaza %j con el motivo y deja lo guardado igual', async (malo, motivo) => {
    const r = await s.guardarAjustes(malo, 'admin@equipos.test');
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.motivo).toMatch(motivo);
    expect(ajustesGuardados).toEqual([]);
  });
});
