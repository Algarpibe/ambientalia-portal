import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import { crearRepoSync, HORAS_PASADA_ABANDONADA, HORAS_RACHA_RECIENTE, HORAS_REINTENTO_ERROR, type RepoSync } from './repo-sync.js';
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
    expect(await sync.registrarListado('p1', 'entradas', [])).toEqual({ estado: 'sospechoso', carpeta: 'entradas', bajas: 12, vivos: 12 });
    expect(await sync.registrarListado('p1', 'entradas', doce.slice(0, 1))).toEqual({ estado: 'sospechoso', carpeta: 'entradas', bajas: 11, vivos: 12 });
    expect(await borrados()).toBe(0);
    expect(await sync.registrarListado('p1', 'entradas', doce.slice(0, 6))).toMatchObject({ estado: 'ok' });
    expect(await borrados()).toBe(6);
  });

  it('exactamente la mitad de una carpeta de 22 no es sospechoso; una más, sí', async () => {
    const veintidos = Array.from({ length: 22 }, (_, i) => A('ENTRADA' + String(i).padStart(5, '0')));
    await listar('p1', 'entradas', veintidos);
    expect(await sync.registrarListado('p1', 'entradas', veintidos.slice(0, 11))).toMatchObject({ estado: 'ok' });
    await vaciar();
    await listar('p1', 'entradas', veintidos);
    expect(await sync.registrarListado('p1', 'entradas', veintidos.slice(0, 10))).toMatchObject({ estado: 'sospechoso' });
  });

  it('un listado con ids de otra carpeta no los mueve: sospechoso si vacía esa carpeta o mueve más de 10 y la mitad', async () => {
    const doce = Array.from({ length: 12 }, (_, i) => A('ESCANEO' + String(i).padStart(5, '0')));
    await listar('p1', 'salidas_escaneadas', doce);
    for (const a of doce.slice(0, 11)) await sync.guardarTexto(a.id, { texto: 'OCR ' + a.id });
    // Carpeta equivocada: los 12 de salidas_escaneadas llegan como «entradas». El resultado
    // nombra la carpeta de la que SALDRÍAN (donde hay que mirar), no la del listado.
    expect(await sync.registrarListado('p1', 'entradas', doce)).toEqual({ estado: 'sospechoso', carpeta: 'salidas_escaneadas', bajas: 12, vivos: 12 });
    expect(await sync.registrarListado('p1', 'entradas', doce.slice(0, 11))).toEqual({ estado: 'sospechoso', carpeta: 'salidas_escaneadas', bajas: 11, vivos: 12 });
    expect(await fila('ESCANEO00000')).toMatchObject({ carpeta: 'salidas_escaneadas', texto: 'OCR ESCANEO00000', borrado: false });
    expect((await db.query(`SELECT count(*)::int AS n FROM portal.equipos_drive_archivos WHERE carpeta = 'salidas_escaneadas' AND NOT borrado`)).rows[0].n).toBe(12);
    // Un movimiento aislado (1 de 12) sí pasa.
    expect(await sync.registrarListado('p1', 'entradas', doce.slice(0, 1))).toMatchObject({ estado: 'ok' });
    expect(await fila('ESCANEO00000')).toMatchObject({ carpeta: 'entradas', texto: null });
  });

  it('un archivo con texto que pasa a salidas de n8n pierde texto y fallo sin violar el CHECK', async () => {
    await listar('p1', 'salidas_escaneadas', [A('ARCHIVO00001'), A('ESCANEO00002')]);
    await sync.guardarTexto('ARCHIVO00001', { texto: 'OCR' });
    await listar('p1', 'salidas_n8n', [A('ARCHIVO00001')]);
    expect(await fila('ARCHIVO00001')).toMatchObject({ carpeta: 'salidas_n8n', texto: null, error_status: null, borrado: false });
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

  it(`un «fin» pasadas ${HORAS_PASADA_ABANDONADA} h no la da por buena: queda fallida y no cuenta como fresca`, async () => {
    for (const c of CARPETAS) await listar('p1', c, []);
    await db.query(`UPDATE portal.equipos_sincronizacion SET inicio = now() - make_interval(hours => $1, mins => 1) WHERE pasada = 'p1'`, [HORAS_PASADA_ABANDONADA]);
    expect(await sync.cerrarPasada('p1', SIN_CONTEOS)).toBe('tardia');
    expect((await db.query(`SELECT ok, motivo, fin IS NOT NULL AS cerrada FROM portal.equipos_sincronizacion WHERE pasada = 'p1'`)).rows[0]).toEqual({ ok: false, motivo: 'tardia', cerrada: true });
    expect(await sync.ultimaSincronizacion()).toBeNull();
    expect(await sync.cerrarPasada('p1', SIN_CONTEOS)).toBe('ya_cerrada');
  });

  it('dos pasadas a la vez: solo una escribe, la otra queda «en curso»', async () => {
    const r = await Promise.all([sync.registrarListado('pa', 'entradas', []), sync.registrarListado('pb', 'entradas', [])]);
    expect(r.map((x) => x.estado).sort()).toEqual(['ok', 'pasada_en_curso']);
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
    expect((await db.query(`SELECT ok, motivo, fin IS NOT NULL AS cerrada FROM portal.equipos_sincronizacion WHERE pasada = 'p1'`)).rows[0]).toEqual({ ok: false, motivo: 'abandonada', cerrada: true });
    expect(await sync.cerrarPasada('p1', SIN_CONTEOS)).toBe('ya_cerrada');
  });
});

describe('«fin» con todos los textos fallidos (OCR o exportación rotos en n8n)', () => {
  /** Lista las tres carpetas de una pasada, sin «fin». */
  const abrir = async (pasada: string, l: Partial<Record<Carpeta, ArchivoListado[]>> = {}) => {
    for (const c of CARPETAS) await listar(pasada, c, l[c] ?? []);
  };
  const estado = async (pasada: string) =>
    (await db.query('SELECT ok, motivo, fin IS NOT NULL AS cerrada, conteos FROM portal.equipos_sincronizacion WHERE pasada = $1', [pasada])).rows[0];
  const CONTEOS = { entradas: 2, salidas_n8n: 0, salidas_escaneadas: 2 };
  const DOS = [A('ARCHIVO00001'), A('ARCHIVO00002')];

  it('2 o más resultados en una carpeta y todos fallos: se cierra fallida (textos_fallidos) y no cuenta como fresca', async () => {
    for (const [mala, sana] of [['salidas_escaneadas', 'entradas'], ['entradas', 'salidas_escaneadas']] as const) {
      await vaciar();
      await pasadaCompleta('p0');
      await abrir('p1', { [mala]: DOS, [sana]: [A('SANO00000001')] });
      await sync.guardarTexto('ARCHIVO00001', { status: 403 });
      await sync.guardarTexto('ARCHIVO00002', { status: 404 });
      // La otra carpeta funciona: no tapa a la rota.
      await sync.guardarTexto('SANO00000001', { texto: 'bien' });
      expect(await sync.cerrarPasada('p1', CONTEOS), mala).toBe('textos_fallidos');
      expect(await estado('p1'), mala).toEqual({ ok: false, motivo: 'textos_fallidos', cerrada: true, conteos: CONTEOS });
      expect((await sync.ultimaSincronizacion())?.pasada, mala).toBe('p0');
      expect(await sync.cerrarPasada('p1', CONTEOS), mala).toBe('ya_cerrada');
    }
  });

  it('un texto bueno entre los fallos basta, llegue antes o después', async () => {
    await abrir('p1', { salidas_escaneadas: [...DOS, A('ESCANEO00003')] });
    await sync.guardarTexto('ARCHIVO00001', { status: 403 });
    await sync.guardarTexto('ESCANEO00003', { texto: 'OCR' });
    await sync.guardarTexto('ARCHIVO00002', { status: 403 });
    expect(await sync.cerrarPasada('p1', CONTEOS)).toBe('cerrada');
    expect((await sync.ultimaSincronizacion())?.pasada).toBe('p1');
  });

  it('con menos de 2 resultados no se juzga: un solo fallo, y la pasada vale', async () => {
    await abrir('p1', { salidas_escaneadas: DOS });
    await sync.guardarTexto('ARCHIVO00001', { status: 403 });
    expect(await sync.cerrarPasada('p1', CONTEOS)).toBe('cerrada');
    expect(await estado('p1')).toMatchObject({ ok: true, motivo: null });
  });

  it('sigue fallida mientras no llegue un texto bueno: una pasada sin resultados no la limpia, un texto bueno sí', async () => {
    await abrir('p1', { salidas_escaneadas: DOS });
    await sync.guardarTexto('ARCHIVO00001', { status: 403 });
    await sync.guardarTexto('ARCHIVO00002', { status: 403 });
    expect(await sync.cerrarPasada('p1', CONTEOS)).toBe('textos_fallidos');
    // Los fallos no se vuelven a pedir hasta pasadas 6 h: la siguiente pasada no trae resultados.
    await abrir('p2', { salidas_escaneadas: DOS });
    expect(await sync.cerrarPasada('p2', CONTEOS)).toBe('textos_fallidos');
    await abrir('p3', { salidas_escaneadas: [...DOS, A('ESCANEO00003')] });
    await sync.guardarTexto('ESCANEO00003', { texto: 'OCR' });
    expect(await sync.cerrarPasada('p3', CONTEOS)).toBe('cerrada');
  });

  it('motivoUltimaPasada: el de la última pasada cerrada (null si valió o si no hay ninguna); la abierta no cuenta', async () => {
    expect(await sync.motivoUltimaPasada()).toBeNull();
    await pasadaCompleta('p0');
    expect(await sync.motivoUltimaPasada()).toBeNull();
    await abrir('p1', { salidas_escaneadas: DOS });
    await sync.guardarTexto('ARCHIVO00001', { status: 403 });
    await sync.guardarTexto('ARCHIVO00002', { status: 403 });
    expect(await sync.cerrarPasada('p1', CONTEOS)).toBe('textos_fallidos');
    expect(await sync.motivoUltimaPasada()).toBe('textos_fallidos');
    await listar('p2', 'entradas', []);
    expect(await sync.motivoUltimaPasada()).toBe('textos_fallidos');
    await listar('p2', 'salidas_n8n', []);
    await listar('p2', 'salidas_escaneadas', DOS);
    expect(await sync.cerrarPasada('p2', CONTEOS)).toBe('textos_fallidos');
    await envejecerRachas(HORAS_RACHA_RECIENTE);
    await pasadaCompleta('p3', { salidas_escaneadas: DOS });
    expect(await sync.motivoUltimaPasada()).toBeNull();
  });

  /** Lleva el inicio de las rachas de fallos `h` horas (y un minuto) atrás, con el reloj de la base. */
  const envejecerRachas = (h: number) =>
    db.query('UPDATE portal.equipos_drive_archivos SET error_desde = now() - make_interval(hours => $1, mins => 1) WHERE error_status IS NOT NULL', [h]);

  it(`una racha solo cuenta ${HORAS_RACHA_RECIENTE} h: 2 archivos corruptos la tumban ahora, pero no ${HORAS_RACHA_RECIENTE} h después aunque no llegue ningún texto bueno`, async () => {
    await abrir('p1', { salidas_escaneadas: DOS });
    await sync.guardarTexto('ARCHIVO00001', { status: 403 });
    await sync.guardarTexto('ARCHIVO00002', { status: 403 });
    expect(await sync.cerrarPasada('p1', CONTEOS)).toBe('textos_fallidos');
    await envejecerRachas(HORAS_RACHA_RECIENTE);
    await abrir('p2', { salidas_escaneadas: DOS });
    expect(await sync.cerrarPasada('p2', CONTEOS)).toBe('cerrada');
  });

  it(`un OCR roto de verdad sigue roto pasadas ${HORAS_RACHA_RECIENTE} h, porque lo nuevo que llega sigue fallando; el primer texto bueno lo limpia`, async () => {
    await abrir('p1', { salidas_escaneadas: DOS });
    await sync.guardarTexto('ARCHIVO00001', { status: 403 });
    await sync.guardarTexto('ARCHIVO00002', { status: 403 });
    expect(await sync.cerrarPasada('p1', CONTEOS)).toBe('textos_fallidos');
    await envejecerRachas(HORAS_RACHA_RECIENTE);
    const nuevos = [...DOS, A('ESCANEO00003'), A('ESCANEO00004')];
    await abrir('p2', { salidas_escaneadas: nuevos });
    await sync.guardarTexto('ESCANEO00003', { status: 403 });
    await sync.guardarTexto('ESCANEO00004', { status: 403 });
    expect(await sync.cerrarPasada('p2', CONTEOS)).toBe('textos_fallidos');
    await abrir('p3', { salidas_escaneadas: [...nuevos, A('ESCANEO00005')] });
    await sync.guardarTexto('ESCANEO00005', { texto: 'OCR' });
    expect(await sync.cerrarPasada('p3', CONTEOS)).toBe('cerrada');
  });

  it('el reintento de una racha no la rejuvenece: sigue contando desde su primer fallo', async () => {
    await abrir('p1', { salidas_escaneadas: DOS });
    await sync.guardarTexto('ARCHIVO00001', { status: 403 });
    await sync.guardarTexto('ARCHIVO00002', { status: 403 });
    expect(await sync.cerrarPasada('p1', CONTEOS)).toBe('textos_fallidos');
    await envejecerRachas(HORAS_RACHA_RECIENTE);
    await db.query('UPDATE portal.equipos_drive_archivos SET texto_en = now() - make_interval(hours => $1, mins => 1)', [HORAS_REINTENTO_ERROR]);
    await abrir('p2', { salidas_escaneadas: DOS });
    await sync.guardarTexto('ARCHIVO00001', { status: 403 });
    await sync.guardarTexto('ARCHIVO00002', { status: 403 });
    expect(await sync.cerrarPasada('p2', CONTEOS)).toBe('cerrada');
  });

  it('el reintento de fallos que empezaron antes del último texto bueno no la tumba (archivos rotos de verdad)', async () => {
    await abrir('p1', { salidas_escaneadas: [...DOS, A('ESCANEO00003')] });
    await sync.guardarTexto('ARCHIVO00001', { status: 403 });
    await sync.guardarTexto('ARCHIVO00002', { status: 403 });
    await sync.guardarTexto('ESCANEO00003', { texto: 'OCR' });
    expect(await sync.cerrarPasada('p1', CONTEOS)).toBe('cerrada');
    await db.query('UPDATE portal.equipos_drive_archivos SET texto_en = now() - make_interval(hours => $1, mins => 1) WHERE error_status IS NOT NULL', [HORAS_REINTENTO_ERROR]);
    expect(await listar('p2', 'salidas_escaneadas', [...DOS, A('ESCANEO00003')])).toEqual(['ARCHIVO00001', 'ARCHIVO00002']);
    await listar('p2', 'entradas', []);
    await listar('p2', 'salidas_n8n', []);
    await sync.guardarTexto('ARCHIVO00001', { status: 403 });
    await sync.guardarTexto('ARCHIVO00002', { status: 403 });
    expect(await sync.cerrarPasada('p2', CONTEOS)).toBe('cerrada');
  });
});

describe('lo que ve la corrida (leerCopia y leerTexto)', () => {
  it('sin borrados, y sin los pendientes que trajo una pasada posterior a la última completa', async () => {
    await pasadaCompleta('p1', { entradas: [A('ENTRADA00001'), A('ENTRADA00002'), A('ENTRADA00004')], salidas_n8n: [A('SALIDAN8N001')] });
    await sync.guardarTexto('ENTRADA00001', { texto: 'remisión' });
    // La pasada 2, a medias: borra ENTRADA00002, trae ENTRADA00003 (sin texto aún) y una salida de n8n nueva.
    await listar('p2', 'entradas', [A('ENTRADA00001'), A('ENTRADA00003'), A('ENTRADA00004')]);
    await listar('p2', 'salidas_n8n', [A('SALIDAN8N001'), A('SALIDAN8N002')]);
    const ids = async (c: Carpeta) => (await sync.leerCopia('p1')).listados[c].map((x) => x.id);
    // ENTRADA00004 sigue pendiente DESDE la pasada 1: se ve (y fallará como archivo sin texto).
    expect(await ids('entradas')).toEqual(['ENTRADA00001', 'ENTRADA00004']);
    // Las salidas de n8n no llevan texto: se ven en cuanto llegan.
    expect((await sync.leerCopia('p1')).listados.salidas_n8n).toEqual([
      { id: 'SALIDAN8N001', title: 'SALIDAN8N001 nombre' }, { id: 'SALIDAN8N002', title: 'SALIDAN8N002 nombre' },
    ]);
    // En cuanto llega su texto, la nueva ya se ve.
    await sync.guardarTexto('ENTRADA00003', { texto: '' });
    expect(await ids('entradas')).toEqual(['ENTRADA00001', 'ENTRADA00003', 'ENTRADA00004']);
  });

  it('con una pasada que no existe no esconde nada', async () => {
    await listar('p1', 'entradas', [A('ENTRADA00001')]);
    expect((await sync.leerCopia('nada')).listados.entradas.map((x) => x.id)).toEqual(['ENTRADA00001']);
  });

  it('trae el texto guardado de cada salida escaneada viva: texto, fallo o pendiente', async () => {
    await pasadaCompleta('p1', { salidas_escaneadas: [A('ESCANEO00001'), A('ESCANEO00002'), A('ESCANEO00003'), A('ESCANEO00004')] });
    await sync.guardarTexto('ESCANEO00001', { texto: 'OCR' });
    await sync.guardarTexto('ESCANEO00002', { status: 403 });
    await listar('p2', 'salidas_escaneadas', [A('ESCANEO00001'), A('ESCANEO00002'), A('ESCANEO00003')]);
    const t = (await sync.leerCopia('p1')).textosPdf;
    expect([...t.entries()].sort()).toEqual([
      ['ESCANEO00001', { texto: 'OCR', errorStatus: null }],
      ['ESCANEO00002', { texto: null, errorStatus: 403 }],
      ['ESCANEO00003', { texto: null, errorStatus: null }],
    ]);
  });

  it('los tres listados y los textos de los PDF salen de UNA instantánea: una pasada que mueve un archivo a mitad no la parte', async () => {
    await pasadaCompleta('p1', { salidas_escaneadas: [A('ARCHIVO00001'), A('ESCANEO00002')] });
    await sync.guardarTexto('ARCHIVO00001', { texto: 'OCR' });
    // Un pool que, justo después del primer listado de la corrida (entradas), deja que la pasada 2
    // mueva ARCHIVO00001 de salidas escaneadas a entradas, por otra conexión y confirmado.
    let movido = false;
    const pool = {
      query: (...a: unknown[]) => (db.query as (...x: unknown[]) => unknown)(...a),
      connect: async () => {
        const c = await db.connect();
        let n = 0;
        return {
          query: async (...a: unknown[]) => {
            const r = await (c.query as (...x: unknown[]) => Promise<unknown>)(...a);
            if (++n === 2 && !movido) {
              movido = true;
              expect(await sync.registrarListado('p2', 'entradas', [A('ARCHIVO00001')])).toMatchObject({ estado: 'ok' });
            }
            return r;
          },
          release: () => c.release(),
        };
      },
    } as unknown as Pool;
    const copia = await crearRepoSync(pool).leerCopia('p1');
    expect(movido).toBe(true);
    expect((await fila('ARCHIVO00001')).carpeta).toBe('entradas');
    // La corrida lo ve donde estaba al empezar a leer, y con su texto: ni en ninguna carpeta ni en dos.
    expect(copia.listados.entradas).toEqual([]);
    expect(copia.listados.salidas_escaneadas.map((x) => x.id)).toEqual(['ARCHIVO00001', 'ESCANEO00002']);
    expect(copia.textosPdf.get('ARCHIVO00001')).toEqual({ texto: 'OCR', errorStatus: null });
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
