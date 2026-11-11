import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createEquiposSyncRouter } from './router-sync.js';
import type { CierrePasada, RepoSync, ResultadoListado } from './repo-sync.js';
import type { ArchivoListado, Carpeta, ConteosFin, ResultadoTexto } from './sync.js';

// Las rutas de n8n con Express de verdad: el token de máquina, la validación y los códigos.
// El SQL (qué se pide, qué se borra): repo-sync.db.test.ts. Todo ficticio.
const TOKEN = 'token-sync-ficticio';
process.env.EQUIPOS_SYNC_TOKEN = TOKEN;

let listado: ResultadoListado;
let guardado: boolean;
let cierre: CierrePasada;
let falla: boolean;
const llamadas: unknown[][] = [];
const sync = {
  registrarListado: async (pasada: string, carpeta: Carpeta, archivos: ArchivoListado[]) => {
    if (falla) throw new Error('connection to server at "db.interno" failed: password=secreto');
    llamadas.push(['listado', pasada, carpeta, archivos]);
    return listado;
  },
  guardarTexto: async (id: string, r: ResultadoTexto) => {
    llamadas.push(['texto', id, r]);
    return guardado;
  },
  cerrarPasada: async (pasada: string, conteos: ConteosFin) => {
    llamadas.push(['fin', pasada, conteos]);
    return cierre;
  },
} as unknown as RepoSync;

const app = () => {
  const a = express();
  a.use(express.json({ limit: '2mb' })); // el mismo límite que hub-api (src/index.ts)
  a.use('/api', createEquiposSyncRouter(sync));
  return a;
};
const B = '/api/equipos-taller/sync';
const post = (ruta: string, cuerpo: object, token: string | null = TOKEN) => {
  const r = request(app()).post(B + ruta);
  return (token === null ? r : r.set('X-Equipos-Sync-Token', token)).send(cuerpo);
};
const ID = 'ARCHIVO000001';
const LISTADO = { pasada: '4711', carpeta: 'entradas', archivos: [{ id: ID, titulo: '261101 - CLIENTE A - 18A90001' }] };
const FIN = { pasada: '4711', conteos: { entradas: 1, salidas_n8n: 0, salidas_escaneadas: 0 } };

beforeEach(() => {
  listado = { estado: 'ok', faltaTexto: [] };
  guardado = true;
  cierre = 'cerrada';
  falla = false;
  llamadas.length = 0;
});

describe('token de máquina', () => {
  it('401 sin el token o con otro, en las tres rutas, sin tocar nada', async () => {
    for (const t of [null, 'otro']) {
      for (const [ruta, cuerpo] of [['/listado', LISTADO], ['/texto', { id: ID, texto: 'x' }], ['/fin', FIN]] as const) {
        const r = await post(ruta, cuerpo, t);
        expect([r.status, r.body]).toEqual([401, { error: 'unauthorized' }]);
      }
    }
    expect(llamadas).toEqual([]);
  });

  it('sin EQUIPOS_SYNC_TOKEN en hub-api no pasa nadie', async () => {
    delete process.env.EQUIPOS_SYNC_TOKEN;
    try {
      expect((await post('/fin', FIN)).status).toBe(401);
    } finally {
      process.env.EQUIPOS_SYNC_TOKEN = TOKEN;
    }
  });
});

describe('POST /listado', () => {
  it('pasa el listado validado y devuelve faltaTexto', async () => {
    listado = { estado: 'ok', faltaTexto: [ID] };
    const r = await post('/listado', LISTADO);
    expect([r.status, r.body]).toEqual([200, { faltaTexto: [ID] }]);
    expect(llamadas).toEqual([['listado', '4711', 'entradas', LISTADO.archivos]]);
  });

  it('400 con un mensaje fijo si no vale, sin llamar al repositorio', async () => {
    const r = await post('/listado', { ...LISTADO, carpeta: "x' OR 1=1" });
    expect([r.status, r.body]).toEqual([400, { error: 'invalid_input', message: 'carpeta no válida' }]);
    expect(llamadas).toEqual([]);
  });

  it('409 si la pasada ya terminó, si hay otra en curso o si el listado es sospechoso', async () => {
    listado = { estado: 'pasada_cerrada' };
    expect([(await post('/listado', LISTADO)).status, (await post('/listado', LISTADO)).body.error]).toEqual([409, 'pasada_cerrada']);
    listado = { estado: 'pasada_en_curso' };
    expect((await post('/listado', LISTADO)).body.error).toBe('pasada_en_curso');
    listado = { estado: 'sospechoso', carpeta: 'entradas', bajas: 40, vivos: 41 };
    const r = await post('/listado', LISTADO);
    expect([r.status, r.body.error, r.body.bajas, r.body.vivos, r.body.carpeta]).toEqual([409, 'listado_sospechoso', 40, 41, 'entradas']);
    expect(r.body.message).toBe('El listado borraría 40 de 41 archivos de la carpeta entradas: no se aplica');
  });

  it('409 sospechoso por archivos de OTRA carpeta: nombra la carpeta de la que saldrían', async () => {
    listado = { estado: 'sospechoso', carpeta: 'salidas_escaneadas', bajas: 12, vivos: 12 };
    const r = await post('/listado', LISTADO);
    expect([r.status, r.body.error, r.body.carpeta]).toEqual([409, 'listado_sospechoso', 'salidas_escaneadas']);
    expect(r.body.message).toBe('El listado de entradas sacaría 12 de 12 archivos de la carpeta salidas_escaneadas: no se aplica');
  });

  it('un listado de 10 000 archivos cabe en el límite de 2 MB', async () => {
    const archivos = Array.from({ length: 10_000 }, (_, i) => ({
      id: 'ARCHIVO' + String(i).padStart(6, '0'),
      titulo: '261101 - CLIENTE DE PRUEBA CON NOMBRE LARGO - 18A9' + String(i).padStart(4, '0'),
    }));
    const r = await post('/listado', { pasada: '4711', carpeta: 'entradas', archivos });
    expect(r.status).toBe(200);
  });

  it('un fallo nuestro es un 500 genérico, sin detalles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    falla = true;
    const r = await post('/listado', LISTADO);
    expect([r.status, r.body]).toEqual([500, { error: 'internal error' }]);
    expect(r.text).not.toMatch(/secreto|db\.interno/);
  });
});

describe('POST /texto', () => {
  it('204 con el texto o con el fallo del archivo', async () => {
    expect((await post('/texto', { id: ID, texto: 'REMISIÓN' })).status).toBe(204);
    expect((await post('/texto', { id: ID, error: { status: 403 } })).status).toBe(204);
    expect(llamadas).toEqual([['texto', ID, { texto: 'REMISIÓN' }], ['texto', ID, { status: 403 }]]);
  });

  it('404 si el archivo no está en la copia', async () => {
    guardado = false;
    const r = await post('/texto', { id: ID, texto: 'x' });
    expect([r.status, r.body.error]).toEqual([404, 'desconocido']);
  });

  it('400 con texto y error a la vez, o con un status que no es del archivo', async () => {
    expect((await post('/texto', { id: ID, texto: 'x', error: { status: 403 } })).status).toBe(400);
    expect((await post('/texto', { id: ID, error: { status: 429 } })).status).toBe(400);
    expect(llamadas).toEqual([]);
  });
});

describe('POST /fin', () => {
  it('200 al cerrar; 404 si no existe; 409 si ya terminó o le falta alguna carpeta', async () => {
    const ok = await post('/fin', FIN);
    expect([ok.status, ok.body, llamadas]).toEqual([200, { ok: true, completa: true }, [['fin', '4711', FIN.conteos]]]);
    cierre = 'desconocida';
    expect([(await post('/fin', FIN)).status, (await post('/fin', FIN)).body.error]).toEqual([404, 'pasada_desconocida']);
    cierre = 'ya_cerrada';
    expect((await post('/fin', FIN)).body.error).toBe('pasada_cerrada');
    cierre = 'incompleta';
    const r = await post('/fin', FIN);
    expect([r.status, r.body.error]).toEqual([409, 'pasada_incompleta']);
    cierre = 'tardia';
    const t = await post('/fin', FIN);
    expect([t.status, t.body.error]).toEqual([409, 'pasada_tardia']);
  });

  it('con todos los textos fallidos: 200 igual (la pasada se cerró), pero no cuenta como completa', async () => {
    cierre = 'textos_fallidos';
    const r = await post('/fin', FIN);
    expect([r.status, r.body]).toEqual([200, { ok: true, completa: false, motivo: 'textos_fallidos' }]);
  });

  it('400 sin un conteo por carpeta', async () => {
    expect((await post('/fin', { pasada: '4711', conteos: { entradas: 1 } })).status).toBe(400);
  });
});
