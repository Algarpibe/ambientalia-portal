import { describe, expect, it } from 'vitest';
import { FalloArchivo, fuenteN8n } from './fuente-n8n.js';
import type { RepoSync, TextoGuardado } from './repo-sync.js';
import type { Carpeta } from './sync.js';

// Las fuentes de Drive de la corrida, sobre la copia de n8n, con un repositorio falso. Qué
// filas ve cada carpeta (borrados, pendientes en vuelo): repo-sync.db.test.ts. Todo ficticio.
const PASADA = '4711';
function repoFalso(textos: Record<string, TextoGuardado> = {}) {
  const llamadas: string[] = [];
  const repo: Pick<RepoSync, 'listarCarpeta' | 'leerTexto'> = {
    listarCarpeta: async (carpeta: Carpeta, pasada: string) => {
      llamadas.push('listar ' + carpeta + ' ' + pasada);
      return [{ id: 'ARCHIVO000001', title: '261101 - CLIENTE A - 18A90001' }];
    },
    leerTexto: async (carpeta: Carpeta, id: string) => {
      llamadas.push('texto ' + carpeta + ' ' + id);
      return textos[id] ?? null;
    },
  };
  return { repo, llamadas };
}

describe('fuenteN8n', () => {
  it('cada listado es el de su carpeta, tal como lo dejó la pasada con la que corre', async () => {
    const { repo, llamadas } = repoFalso();
    const f = fuenteN8n(repo, PASADA);
    expect(await f.entradas()).toEqual([{ id: 'ARCHIVO000001', title: '261101 - CLIENTE A - 18A90001' }]);
    await f.salidasGeneradas();
    await f.salidasEscaneadas();
    expect(llamadas).toEqual(['listar entradas 4711', 'listar salidas_n8n 4711', 'listar salidas_escaneadas 4711']);
  });

  it('el texto de un PDF y el de una remisión de entrada salen de su carpeta; un texto vacío vale', async () => {
    const { repo, llamadas } = repoFalso({ PDFabcdefghij1: { texto: 'REMISIÓN …', errorStatus: null }, ENTabcdefghij1: { texto: '', errorStatus: null } });
    const f = fuenteN8n(repo, PASADA);
    expect(await f.textoPdf('PDFabcdefghij1')).toBe('REMISIÓN …');
    expect(await f.remisionEntrada('ENTabcdefghij1')).toBe('');
    expect(llamadas).toEqual(['texto salidas_escaneadas PDFabcdefghij1', 'texto entradas ENTabcdefghij1']);
  });

  it('un fallo guardado por n8n es un FalloArchivo con su código y el mensaje de siempre', async () => {
    const f = fuenteN8n(repoFalso({ PDFabcdefghij1: { texto: null, errorStatus: 403 } }).repo, PASADA);
    const e = await f.textoPdf('PDFabcdefghij1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FalloArchivo);
    expect([(e as FalloArchivo).status, (e as FalloArchivo).message]).toEqual([403, 'Drive HTTP 403']);
  });

  it('con texto y un fallo posterior (el reintento tras un cambio de nombre), vale el texto', async () => {
    const f = fuenteN8n(repoFalso({ PDFabcdefghij1: { texto: 'viejo', errorStatus: 403 } }).repo, PASADA);
    expect(await f.textoPdf('PDFabcdefghij1')).toBe('viejo');
  });

  it('sin texto todavía, o sin fila: FalloArchivo pendiente (status null)', async () => {
    const f = fuenteN8n(repoFalso({ ENTabcdefghij1: { texto: null, errorStatus: null } }).repo, PASADA);
    for (const p of [f.remisionEntrada('ENTabcdefghij1'), f.textoPdf('NOEXISTE0001')]) {
      const e = await p.catch((x: unknown) => x);
      expect(e).toBeInstanceOf(FalloArchivo);
      expect([(e as FalloArchivo).status, (e as FalloArchivo).message]).toEqual([null, 'n8n todavía no envió su texto']);
    }
  });

  it('un id con forma rara no llega a la base', async () => {
    const { repo, llamadas } = repoFalso();
    await expect(fuenteN8n(repo, PASADA).remisionEntrada("x' OR 1=1")).rejects.toThrow('id de Drive no válido');
    expect(llamadas).toEqual([]);
  });

  it('un error de la base sube tal cual: no es un FalloArchivo', async () => {
    const roto: Pick<RepoSync, 'listarCarpeta' | 'leerTexto'> = {
      listarCarpeta: async () => { throw new Error('pg caído'); },
      leerTexto: async () => { throw new Error('pg caído'); },
    };
    const f = fuenteN8n(roto, PASADA);
    await expect(f.entradas()).rejects.toThrow('pg caído');
    const e = await f.textoPdf('PDFabcdefghij1').catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(FalloArchivo);
  });
});
