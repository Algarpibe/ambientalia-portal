import { describe, expect, it } from 'vitest';
import { esStatusDeArchivo, listadoSospechoso, MAX_ARCHIVOS, MAX_TEXTO, validarFin, validarListado, validarTexto } from './sync.js';

// Lo que n8n manda a hub-api (rutas /equipos-taller/sync/*), validado sin base. Ids y nombres ficticios.
const ID = (n: number) => 'ARCHIVO' + String(n).padStart(6, '0');
const LISTADO = { pasada: '4711', carpeta: 'entradas', archivos: [{ id: ID(1), titulo: '261101 - CLIENTE A - 18A90001' }] };

describe('validarListado', () => {
  it('acepta un listado y conserva el nombre tal cual, espacios incluidos', () => {
    const archivos = [{ id: ID(1), titulo: ' 261101 - CLIENTE A - 18A90001 ' }];
    expect(validarListado({ ...LISTADO, archivos })).toEqual({ ok: true, valor: { pasada: '4711', carpeta: 'entradas', archivos } });
  });

  it('las tres carpetas, y ninguna otra', () => {
    for (const carpeta of ['entradas', 'salidas_n8n', 'salidas_escaneadas']) expect(validarListado({ ...LISTADO, carpeta }).ok).toBe(true);
    expect(validarListado({ ...LISTADO, carpeta: 'temporal' })).toEqual({ ok: false, error: 'carpeta no válida' });
  });

  it('rechaza pasadas, ids o campos que no valen, sin repetir lo recibido', () => {
    const malos: unknown[] = [
      { ...LISTADO, pasada: '' }, { ...LISTADO, pasada: "1' OR 1=1" }, { ...LISTADO, pasada: 4711 },
      { ...LISTADO, archivos: [{ id: 'corto', titulo: 'x' }] },
      { ...LISTADO, archivos: [{ id: "abc' or name contains '", titulo: 'x' }] },
      { ...LISTADO, archivos: [{ id: ID(1), titulo: 'x', mimeType: 'application/pdf' }] },
      { ...LISTADO, archivos: [{ id: ID(1), titulo: 7 }] },
      { ...LISTADO, archivos: 'todos' }, { ...LISTADO, extra: true }, null, [], 'texto',
    ];
    for (const b of malos) {
      const r = validarListado(b);
      expect(r.ok, JSON.stringify(b)).toBe(false);
      expect(JSON.stringify(r)).not.toMatch(/OR 1=1|name contains|mimeType/);
    }
  });

  it('rechaza ids repetidos y nombres vacíos o de más de 300', () => {
    expect(validarListado({ ...LISTADO, archivos: [{ id: ID(1), titulo: 'a' }, { id: ID(1), titulo: 'b' }] })).toEqual({ ok: false, error: 'id repetido' });
    expect(validarListado({ ...LISTADO, archivos: [{ id: ID(1), titulo: '   ' }] }).ok).toBe(false);
    expect(validarListado({ ...LISTADO, archivos: [{ id: ID(1), titulo: 'x'.repeat(301) }] }).ok).toBe(false);
    expect(validarListado({ ...LISTADO, archivos: [{ id: ID(1), titulo: 'x'.repeat(300) }] }).ok).toBe(true);
  });

  it('quita los caracteres nulos del nombre (Postgres no los admite)', () => {
    const r = validarListado({ ...LISTADO, archivos: [{ id: ID(1), titulo: 'a\u0000b' }] });
    expect(r.ok && r.valor.archivos[0].titulo).toBe('ab');
  });

  it('un listado vacío vale aquí (lo frena el repositorio si vaciaría la carpeta)', () => {
    expect(validarListado({ ...LISTADO, archivos: [] }).ok).toBe(true);
  });

  it(`hasta ${MAX_ARCHIVOS} archivos; uno más, no`, () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => ({ id: ID(i), titulo: 'T' + i }));
    expect(validarListado({ ...LISTADO, archivos: n(MAX_ARCHIVOS) }).ok).toBe(true);
    expect(validarListado({ ...LISTADO, archivos: n(MAX_ARCHIVOS + 1) })).toEqual({ ok: false, error: 'archivos no válidos' });
  });
});

describe('validarTexto', () => {
  it('texto o error: uno de los dos', () => {
    expect(validarTexto({ id: ID(1), texto: 'REMISIÓN' })).toEqual({ ok: true, valor: { id: ID(1), resultado: { texto: 'REMISIÓN' } } });
    expect(validarTexto({ id: ID(1), error: { status: 403 } })).toEqual({ ok: true, valor: { id: ID(1), resultado: { status: 403 } } });
    expect(validarTexto({ id: ID(1) }).ok).toBe(false);
    expect(validarTexto({ id: ID(1), texto: 'x', error: { status: 403 } }).ok).toBe(false);
    expect(validarTexto({ id: 'corto', texto: 'x' }).ok).toBe(false);
    expect(validarTexto({ id: ID(1), texto: 5 }).ok).toBe(false);
    expect(validarTexto({ id: ID(1), texto: 'x', pasada: '4711' }).ok).toBe(false);
  });

  it('un texto vacío vale: la carpeta de entrada no tiene documento', () => {
    expect(validarTexto({ id: ID(1), texto: '' })).toEqual({ ok: true, valor: { id: ID(1), resultado: { texto: '' } } });
  });

  it(`el texto se recorta a ${MAX_TEXTO} caracteres y pierde los nulos`, () => {
    const r = validarTexto({ id: ID(1), texto: 'a\u0000' + 'b'.repeat(MAX_TEXTO + 10) });
    expect(r.ok && 'texto' in r.valor.resultado && r.valor.resultado.texto).toBe('a' + 'b'.repeat(MAX_TEXTO - 1));
  });

  it('el error, solo con un 4xx que sea del archivo (ni 401 ni 429)', () => {
    for (const status of [400, 403, 404, 413]) expect(validarTexto({ id: ID(1), error: { status } }).ok).toBe(true);
    for (const status of [401, 429, 500, 503, 399, 403.5, '403', null]) expect(validarTexto({ id: ID(1), error: { status } }).ok).toBe(false);
    expect(validarTexto({ id: ID(1), error: { status: 403, mensaje: 'x' } }).ok).toBe(false);
  });
});

describe('validarFin', () => {
  const CONTEOS = { entradas: 312, salidas_n8n: 40, salidas_escaneadas: 190 };
  it('pasada y un conteo por carpeta', () => {
    expect(validarFin({ pasada: '4711', conteos: CONTEOS })).toEqual({ ok: true, valor: { pasada: '4711', conteos: CONTEOS } });
  });
  it('rechaza conteos incompletos, con claves de más o que no son enteros entre 0 y 1 000 000', () => {
    const malos: unknown[] = [
      { entradas: 1, salidas_n8n: 1 }, { ...CONTEOS, textos: 1 }, { ...CONTEOS, entradas: -1 },
      { ...CONTEOS, entradas: 1.5 }, { ...CONTEOS, entradas: '3' }, { ...CONTEOS, entradas: 1_000_001 }, null, [],
    ];
    for (const conteos of malos) expect(validarFin({ pasada: '4711', conteos }).ok, JSON.stringify(conteos)).toBe(false);
    expect(validarFin({ conteos: CONTEOS }).ok).toBe(false);
    expect(validarFin({ pasada: '4711', conteos: CONTEOS, ok: true }).ok).toBe(false);
  });
});

describe('reglas', () => {
  it('esStatusDeArchivo: un 4xx entero salvo 401 y 429', () => {
    expect([400, 403, 404, 499].every(esStatusDeArchivo)).toBe(true);
    expect([401, 429, 500, 399, 403.5, '403', null].some(esStatusDeArchivo)).toBe(false);
  });
  it('listadoSospechoso: vacío con la carpeta llena, o que borraría más de 10 y más de la mitad', () => {
    expect(listadoSospechoso(5, 5, 0)).toBe(true);
    expect(listadoSospechoso(0, 0, 0)).toBe(false);
    expect(listadoSospechoso(11, 12, 1)).toBe(true);
    expect(listadoSospechoso(10, 12, 2)).toBe(false);
    expect(listadoSospechoso(11, 30, 19)).toBe(false);
    expect(listadoSospechoso(16, 30, 14)).toBe(true);
  });
});
