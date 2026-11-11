import { describe, expect, it } from 'vitest';
import { FalloArchivo, fuenteN8n } from './fuente-n8n.js';
import type { CopiaCorrida, RepoSync, TextoGuardado } from './repo-sync.js';
import type { Carpeta } from './sync.js';

// Las fuentes de Drive de la corrida, sobre la copia de n8n, con un repositorio falso. Qué
// filas ve cada carpeta (borrados, pendientes en vuelo) y la instantánea: repo-sync.db.test.ts.
// Todo ficticio.
const PASADA = '4711';
const LISTADOS: CopiaCorrida['listados'] = {
  entradas: [{ id: 'ENTRADA00001', title: '261101 - CLIENTE A - 18A90001' }],
  salidas_n8n: [{ id: 'SALIDAN8N001', title: '261102 - CLIENTE A - 18A90001' }],
  salidas_escaneadas: [{ id: 'PDFabcdefghij1', title: '261103 - CLIENTE A.pdf' }],
};
function repoFalso(o: { pdfs?: Record<string, TextoGuardado>; entradas?: Record<string, TextoGuardado> } = {}) {
  const llamadas: string[] = [];
  const repo: Pick<RepoSync, 'leerCopia' | 'leerTexto'> = {
    leerCopia: async (pasada: string) => {
      llamadas.push('copia ' + pasada);
      return { listados: LISTADOS, textosPdf: new Map(Object.entries(o.pdfs ?? {})) };
    },
    leerTexto: async (carpeta: Carpeta, id: string) => {
      llamadas.push('texto ' + carpeta + ' ' + id);
      return o.entradas?.[id] ?? null;
    },
  };
  return { repo, llamadas };
}

describe('fuenteN8n', () => {
  it('los tres listados y los textos de los PDF salen de UNA lectura de la copia, con la pasada con la que corre', async () => {
    const { repo, llamadas } = repoFalso({ pdfs: { PDFabcdefghij1: { texto: 'OCR', errorStatus: null } } });
    const f = fuenteN8n(repo, PASADA);
    expect(await f.entradas()).toEqual(LISTADOS.entradas);
    expect(await f.salidasGeneradas()).toEqual(LISTADOS.salidas_n8n);
    expect(await f.salidasEscaneadas()).toEqual(LISTADOS.salidas_escaneadas);
    expect(await f.textoPdf('PDFabcdefghij1')).toBe('OCR');
    expect(await f.textoPdf('PDFabcdefghij1')).toBe('OCR');
    expect(llamadas).toEqual(['copia 4711']);
  });

  it('la remisión de entrada se lee aparte, de su carpeta (solo se piden las que no están en la caché); un texto vacío vale', async () => {
    const { repo, llamadas } = repoFalso({ entradas: { ENTabcdefghij1: { texto: '', errorStatus: null } } });
    const f = fuenteN8n(repo, PASADA);
    expect(await f.remisionEntrada('ENTabcdefghij1')).toBe('');
    expect(llamadas).toEqual(['texto entradas ENTabcdefghij1']);
  });

  it('un fallo guardado por n8n es un FalloArchivo con su código y el mensaje de siempre', async () => {
    const f = fuenteN8n(repoFalso({ pdfs: { PDFabcdefghij1: { texto: null, errorStatus: 403 } } }).repo, PASADA);
    const e = await f.textoPdf('PDFabcdefghij1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FalloArchivo);
    expect([(e as FalloArchivo).status, (e as FalloArchivo).message]).toEqual([403, 'Drive HTTP 403']);
  });

  it('con texto y un fallo posterior (el reintento tras un cambio de nombre), vale el texto', async () => {
    const f = fuenteN8n(repoFalso({ pdfs: { PDFabcdefghij1: { texto: 'viejo', errorStatus: 403 } } }).repo, PASADA);
    expect(await f.textoPdf('PDFabcdefghij1')).toBe('viejo');
  });

  it('sin texto todavía, o sin fila: FalloArchivo pendiente (status null)', async () => {
    const f = fuenteN8n(repoFalso({ entradas: { ENTabcdefghij1: { texto: null, errorStatus: null } } }).repo, PASADA);
    for (const p of [f.remisionEntrada('ENTabcdefghij1'), f.textoPdf('NOEXISTE0001')]) {
      const e = await p.catch((x: unknown) => x);
      expect(e).toBeInstanceOf(FalloArchivo);
      expect([(e as FalloArchivo).status, (e as FalloArchivo).message]).toEqual([null, 'n8n todavía no envió su texto']);
    }
  });

  it('un id con forma rara no llega a la base', async () => {
    const { repo, llamadas } = repoFalso();
    await expect(fuenteN8n(repo, PASADA).remisionEntrada("x' OR 1=1")).rejects.toThrow('id de Drive no válido');
    await expect(fuenteN8n(repo, PASADA).textoPdf("x' OR 1=1")).rejects.toThrow('id de Drive no válido');
    expect(llamadas).toEqual([]);
  });

  it('un error de la base sube tal cual en todo lo que sale de la copia: no es un FalloArchivo', async () => {
    const roto: Pick<RepoSync, 'leerCopia' | 'leerTexto'> = {
      leerCopia: async () => { throw new Error('pg caído'); },
      leerTexto: async () => { throw new Error('pg caído'); },
    };
    const f = fuenteN8n(roto, PASADA);
    await expect(f.entradas()).rejects.toThrow('pg caído');
    await expect(f.salidasEscaneadas()).rejects.toThrow('pg caído');
    for (const p of [f.textoPdf('PDFabcdefghij1'), f.remisionEntrada('ENTabcdefghij1')]) {
      expect(await p.catch((x: unknown) => x)).not.toBeInstanceOf(FalloArchivo);
    }
  });
});
