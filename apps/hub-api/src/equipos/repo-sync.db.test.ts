import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import { crearRepoSync, HORAS_PASADA_ABANDONADA, HORAS_REINTENTO_ERROR, type RepoSync } from './repo-sync.js';
import { CARPETAS, MAX_ARCHIVOS, type ArchivoListado, type Carpeta } from './sync.js';

// La copia de Drive que manda n8n (migración 072) contra Postgres real: qué texto se pide,
// qué se borra, las pasadas y lo que ve la corrida. Ids y nombres ficticios.
let db: Pool;
let sync: RepoSync;
const A = (id: string, titulo = id + ' nombre'): ArchivoListado => ({ id, titulo });
const fila = async (id: string) =>
  (await db.query('SELECT carpeta, titulo, texto, titulo_texto, error_status, borrado FROM portal.equipos_drive_archivos WHERE id = $1', [id])).rows[0];
const borrados = async () => (await db.query('SELECT count(*)::int AS n FROM portal.equipos_drive_archivos WHERE borrado')).rows[0].n;
const vaciar = () => db.query('TRUNCATE portal.equipos_drive_archivos, portal.equipos_sincronizacion RESTART IDENTITY');
const listar = async (pasada: string, carpeta: Carpeta, archivos: ArchivoListado[]) => {
  const r = await sync.registrarListado(pasada, carpeta, archivos);
  if (r.estado !== 'ok') throw new Error('listado no aplicado: ' + r.estado);
  return r.faltaTexto;
};
/** Una pasada con las tres carpetas listadas y su «fin». */
const pasadaCompleta = async (pasada: string, l: Partial<Record<Carpeta, ArchivoListado[]>> = {}) => {
  for (const c of CARPETAS) await listar(pasada, c, l[c] ?? []);
  const conteos = { entradas: l.entradas?.length ?? 0, salidas_n8n: l.salidas_n8n?.length ?? 0, salidas_escaneadas: l.salidas_escaneadas?.length ?? 0 };
  expect(await sync.cerrarPasada(pasada, conteos)).toBe('cerrada');
};
const SIN_CONTEOS = { entradas: 0, salidas_n8n: 0, salidas_escaneadas: 0 };

beforeAll(() => {
  db = poolDePrueba();
  sync = crearRepoSync(db);
});
afterAll(async () => {
  await vaciar();
  await db.end();
});
beforeEach(vaciar);

describe('registrarListado', () => {
  it('las altas de entradas y de salidas escaneadas piden texto; las de salidas de n8n, no', async () => {
    expect(await listar('p1', 'entradas', [A('ENTRADA00002'), A('ENTRADA00001')])).toEqual(['ENTRADA00001', 'ENTRADA00002']);
    expect(await listar('p1', 'salidas_n8n', [A('SALIDAN8N001')])).toEqual([]);
    expect(await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001')])).toEqual(['ESCANEO00001']);
  });

  it('con su texto deja de pedirlo; si cambia de nombre lo vuelve a pedir y, mientras, vale el viejo', async () => {
    await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001', '261020 - CLIENTE C.pdf')]);
    expect(await sync.guardarTexto('ESCANEO00001', { texto: 'OCR uno' })).toBe(true);
    expect(await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001', '261020 - CLIENTE C.pdf')])).toEqual([]);
    expect(await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001', '261021 - CLIENTE C.pdf')])).toEqual(['ESCANEO00001']);
    expect(await sync.leerTexto('salidas_escaneadas', 'ESCANEO00001')).toEqual({ texto: 'OCR uno', errorStatus: null });
    await sync.guardarTexto('ESCANEO00001', { texto: 'OCR dos' });
    expect(await fila('ESCANEO00001')).toMatchObject({ titulo: '261021 - CLIENTE C.pdf', titulo_texto: '261021 - CLIENTE C.pdf', texto: 'OCR dos' });
    expect(await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001', '261021 - CLIENTE C.pdf')])).toEqual([]);
  });

  it('un texto vacío cuenta como texto (carpeta de entrada sin documento): no se vuelve a pedir', async () => {
    await listar('p1', 'entradas', [A('ENTRADA00001')]);
    await sync.guardarTexto('ENTRADA00001', { texto: '' });
    expect(await listar('p1', 'entradas', [A('ENTRADA00001')])).toEqual([]);
    expect(await sync.leerTexto('entradas', 'ENTRADA00001')).toEqual({ texto: '', errorStatus: null });
  });

  it('lo que falta del listado queda borrado; si vuelve, recupera su texto', async () => {
    await listar('p1', 'entradas', [A('ENTRADA00001'), A('ENTRADA00002')]);
    await sync.guardarTexto('ENTRADA00001', { texto: 'remisión' });
    await listar('p1', 'entradas', [A('ENTRADA00002')]);
    expect((await fila('ENTRADA00001')).borrado).toBe(true);
    expect(await sync.leerTexto('entradas', 'ENTRADA00001')).toBeNull();
    expect(await sync.guardarTexto('ENTRADA00001', { texto: 'otra' })).toBe(false);
    expect(await listar('p1', 'entradas', [A('ENTRADA00001'), A('ENTRADA00002')])).toEqual(['ENTRADA00002']);
    expect(await fila('ENTRADA00001')).toMatchObject({ borrado: false, texto: 'remisión' });
  });

  it(`un fallo del archivo no se vuelve a pedir hasta pasadas ${HORAS_REINTENTO_ERROR} h; con texto, el fallo se borra`, async () => {
    await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001')]);
    await sync.guardarTexto('ESCANEO00001', { status: 403 });
    expect(await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001')])).toEqual([]);
    expect(await sync.leerTexto('salidas_escaneadas', 'ESCANEO00001')).toEqual({ texto: null, errorStatus: 403 });
    await db.query('UPDATE portal.equipos_drive_archivos SET texto_en = now() - make_interval(hours => $1, mins => 1)', [HORAS_REINTENTO_ERROR]);
    expect(await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001')])).toEqual(['ESCANEO00001']);
    await sync.guardarTexto('ESCANEO00001', { texto: 'por fin' });
    expect(await sync.leerTexto('salidas_escaneadas', 'ESCANEO00001')).toEqual({ texto: 'por fin', errorStatus: null });
  });

  it('un archivo que pasa a otra carpeta pierde el texto de la anterior y lo pide de nuevo', async () => {
    await listar('p1', 'salidas_escaneadas', [A('ARCHIVO00001'), A('ESCANEO00002')]);
    await sync.guardarTexto('ARCHIVO00001', { texto: 'OCR' });
    expect(await listar('p1', 'entradas', [A('ARCHIVO00001')])).toEqual(['ARCHIVO00001']);
    expect(await fila('ARCHIVO00001')).toMatchObject({ carpeta: 'entradas', texto: null, borrado: false });
  });

  it('no aplica un listado sospechoso: vacío con la carpeta llena, o que borraría más de 10 y más de la mitad', async () => {
    const doce = Array.from({ length: 12 }, (_, i) => A('ENTRADA' + String(i).padStart(5, '0')));
    await listar('p1', 'entradas', doce);
    expect(await sync.registrarListado('p1', 'entradas', [])).toEqual({ estado: 'sospechoso', bajas: 12, vivos: 12 });
    expect(await sync.registrarListado('p1', 'entradas', doce.slice(0, 1))).toEqual({ estado: 'sospechoso', bajas: 11, vivos: 12 });
    expect(await borrados()).toBe(0);
    expect(await sync.registrarListado('p1', 'entradas', doce.slice(0, 6))).toMatchObject({ estado: 'ok' });
    expect(await borrados()).toBe(6);
  });

  it('un listado sospechoso tampoco cuenta para la pasada: su «fin» queda incompleto', async () => {
    await pasadaCompleta('p1', { entradas: [A('ENTRADA00001')] });
    expect(await sync.registrarListado('p2', 'entradas', [])).toMatchObject({ estado: 'sospechoso' });
    await listar('p2', 'salidas_n8n', []);
    await listar('p2', 'salidas_escaneadas', []);
    expect(await sync.cerrarPasada('p2', SIN_CONTEOS)).toBe('incompleta');
  });

  it(`${MAX_ARCHIVOS} archivos en un solo listado`, async () => {
    const muchos = Array.from({ length: MAX_ARCHIVOS }, (_, i) => A('ESCANEO' + String(i).padStart(6, '0')));
    expect(await listar('p1', 'salidas_escaneadas', muchos)).toHaveLength(MAX_ARCHIVOS);
  });
});

describe('guardarTexto', () => {
  it('false si el archivo no existe o es de salidas de n8n (que no llevan texto)', async () => {
    expect(await sync.guardarTexto('NOEXISTE0001', { texto: 'x' })).toBe(false);
    await listar('p1', 'salidas_n8n', [A('SALIDAN8N001')]);
    expect(await sync.guardarTexto('SALIDAN8N001', { texto: 'x' })).toBe(false);
    expect(await sync.guardarTexto('SALIDAN8N001', { status: 403 })).toBe(false);
  });
});

describe('pasadas', () => {
  it('fin: desconocida, incompleta sin las tres carpetas, cerrada, y no se cierra ni se lista dos veces', async () => {
    expect(await sync.cerrarPasada('p1', SIN_CONTEOS)).toBe('desconocida');
    await listar('p1', 'entradas', []);
    expect(await sync.cerrarPasada('p1', SIN_CONTEOS)).toBe('incompleta');
    await listar('p1', 'salidas_n8n', []);
    await listar('p1', 'salidas_escaneadas', []);
    expect(await sync.cerrarPasada('p1', SIN_CONTEOS)).toBe('cerrada');
    expect(await sync.cerrarPasada('p1', SIN_CONTEOS)).toBe('ya_cerrada');
    expect(await sync.registrarListado('p1', 'entradas', [])).toEqual({ estado: 'pasada_cerrada' });
    const p = (await db.query('SELECT ok, listados, conteos FROM portal.equipos_sincronizacion WHERE pasada = $1', ['p1'])).rows[0];
    expect(p).toEqual({ ok: true, listados: { entradas: 0, salidas_n8n: 0, salidas_escaneadas: 0 }, conteos: SIN_CONTEOS });
  });

  it('ultimaSincronizacion: null sin ninguna completa; si no, la de «fin» más reciente', async () => {
    expect(await sync.ultimaSincronizacion()).toBeNull();
    await listar('p1', 'entradas', []);
    expect(await sync.ultimaSincronizacion()).toBeNull();
    await listar('p1', 'salidas_n8n', []);
    await listar('p1', 'salidas_escaneadas', []);
    await sync.cerrarPasada('p1', SIN_CONTEOS);
    await pasadaCompleta('p2');
    expect(await sync.ultimaSincronizacion()).toMatchObject({
      pasada: 'p2', inicio: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), fin: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it(`una a la vez: con otra abierta, «en curso»; pasadas ${HORAS_PASADA_ABANDONADA} h, la vieja se cierra como fallida`, async () => {
    await listar('p1', 'entradas', []);
    expect(await sync.registrarListado('p2', 'entradas', [])).toEqual({ estado: 'pasada_en_curso' });
    await db.query(`UPDATE portal.equipos_sincronizacion SET inicio = now() - make_interval(hours => $1, mins => 1) WHERE pasada = 'p1'`, [HORAS_PASADA_ABANDONADA]);
    expect(await sync.registrarListado('p2', 'entradas', [])).toMatchObject({ estado: 'ok' });
    expect((await db.query(`SELECT ok, fin IS NOT NULL AS cerrada FROM portal.equipos_sincronizacion WHERE pasada = 'p1'`)).rows[0]).toEqual({ ok: false, cerrada: true });
    expect(await sync.cerrarPasada('p1', SIN_CONTEOS)).toBe('ya_cerrada');
  });
});

describe('lo que ve la corrida (listarCarpeta y leerTexto)', () => {
  it('sin borrados, y sin los pendientes que trajo una pasada posterior a la última completa', async () => {
    await pasadaCompleta('p1', { entradas: [A('ENTRADA00001'), A('ENTRADA00002'), A('ENTRADA00004')], salidas_n8n: [A('SALIDAN8N001')] });
    await sync.guardarTexto('ENTRADA00001', { texto: 'remisión' });
    // La pasada 2, a medias: borra ENTRADA00002, trae ENTRADA00003 (sin texto aún) y una salida de n8n nueva.
    await listar('p2', 'entradas', [A('ENTRADA00001'), A('ENTRADA00003'), A('ENTRADA00004')]);
    await listar('p2', 'salidas_n8n', [A('SALIDAN8N001'), A('SALIDAN8N002')]);
    const ids = async (c: Carpeta) => (await sync.listarCarpeta(c, 'p1')).map((x) => x.id);
    // ENTRADA00004 sigue pendiente DESDE la pasada 1: se ve (y fallará como archivo sin texto).
    expect(await ids('entradas')).toEqual(['ENTRADA00001', 'ENTRADA00004']);
    // Las salidas de n8n no llevan texto: se ven en cuanto llegan.
    expect(await sync.listarCarpeta('salidas_n8n', 'p1')).toEqual([
      { id: 'SALIDAN8N001', title: 'SALIDAN8N001 nombre' }, { id: 'SALIDAN8N002', title: 'SALIDAN8N002 nombre' },
    ]);
    // En cuanto llega su texto, la nueva ya se ve.
    await sync.guardarTexto('ENTRADA00003', { texto: '' });
    expect(await ids('entradas')).toEqual(['ENTRADA00001', 'ENTRADA00003', 'ENTRADA00004']);
  });

  it('con una pasada que no existe no esconde nada', async () => {
    await listar('p1', 'entradas', [A('ENTRADA00001')]);
    expect((await sync.listarCarpeta('entradas', 'nada')).map((x) => x.id)).toEqual(['ENTRADA00001']);
  });

  it('leerTexto: texto, fallo, o null si es de otra carpeta', async () => {
    await listar('p1', 'entradas', [A('ENTRADA00001'), A('ENTRADA00002')]);
    await sync.guardarTexto('ENTRADA00001', { texto: 'remisión' });
    await sync.guardarTexto('ENTRADA00002', { status: 404 });
    expect(await sync.leerTexto('entradas', 'ENTRADA00001')).toEqual({ texto: 'remisión', errorStatus: null });
    expect(await sync.leerTexto('entradas', 'ENTRADA00002')).toEqual({ texto: null, errorStatus: 404 });
    expect(await sync.leerTexto('salidas_escaneadas', 'ENTRADA00001')).toBeNull();
  });
});
