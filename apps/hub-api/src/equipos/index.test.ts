import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import type { DbLectura } from '../trazabilidad/fuente.js';
import { crearEquiposTaller } from './index.js';
import { detenerProgramadorEquipos } from './programador.js';
import { leerConfig } from './config.js';
import { CAUSA_SYNC_ATRASADA } from './contrato.js';

// El montaje: el programador se enciende siempre (sin sincronización de n8n, cada corrida
// programada se omite) y montar no toca la base (el pool es un doble que falla si alguien lo usa).
const pool = { query: async () => { throw new Error('no se debe consultar al montar'); }, connect: async () => { throw new Error('no'); } } as unknown as Pool;

afterEach(() => {
  detenerProgramadorEquipos();
  vi.restoreAllMocks();
});

describe('crearEquiposTaller', () => {
  it('sin EQUIPOS_SYNC_TOKEN lo dice nombrando solo la variable, y el programador se enciende igual, una vez', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = crearEquiposTaller(pool, () => null, leerConfig({}));
    expect(warn.mock.calls.flat().join(' ')).toMatch(/falta o no vale EQUIPOS_SYNC_TOKEN/);
    expect(m.iniciarProgramador()).toBe(true);
    expect(m.iniciarProgramador()).toBe(false);
  });

  it('con el token no avisa de él y nunca enseña su valor', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = crearEquiposTaller(pool, () => null, leerConfig({ EQUIPOS_SYNC_TOKEN: 'token-ficticio-123' }));
    const t = warn.mock.calls.flat().join(' ');
    expect(t).not.toMatch(/EQUIPOS_SYNC_TOKEN/);
    expect(t).not.toMatch(/token-ficticio-123/);
    expect(typeof m.sync.registrarListado).toBe('function');
  });

  it('«configurado» lo decide la base: sin ninguna pasada completa de n8n, false', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vacia = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => { throw new Error('no'); } } as unknown as Pool;
    expect(await crearEquiposTaller(vacia, () => null, leerConfig({})).servicio.configurado()).toBe(false);
  });
});

describe('crearEquiposTaller: lo que conecta con la corrida', () => {
  // Una corrida entera sobre una base falsa que responde por el SQL: la última pasada
  // completa es la «4711»; lo demás, vacío. Desk 2.0 responde a la sonda.
  function hubFalso(finSync: Date) {
    const consultas: { sql: string; params: unknown[] }[] = [];
    const responder = async (sql: string, params: unknown[] = []) => {
      consultas.push({ sql, params });
      if (/FROM portal\.equipos_sincronizacion WHERE ok/.test(sql)) return { rows: [{ pasada: '4711', inicio: finSync, fin: finSync }], rowCount: 1 };
      if (/INSERT INTO portal\.equipos_ejecucion/.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    const pool = { query: responder, connect: async () => ({ query: responder, release: () => {} }) } as unknown as Pool;
    return { pool, consultas };
  }
  const desk2 = (): DbLectura => ({ query: async () => ({ rows: [{ total: 0, con_cf: 0 }] }) }) as unknown as DbLectura;
  const callar = () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  };
  const haceHoras = (h: number) => new Date(Date.now() - h * 3_600_000);

  it('la frescura usa EQUIPOS_SYNC_MAX_HORAS: una copia de hace 2 h vale con el máximo por defecto y falla con 1', async () => {
    callar();
    const conDefecto = crearEquiposTaller(hubFalso(haceHoras(2)).pool, desk2, leerConfig({}));
    expect((await conDefecto.servicio.ejecutar('boton', null)).estado).toBe('ok');
    const conUna = crearEquiposTaller(hubFalso(haceHoras(2)).pool, desk2, leerConfig({ EQUIPOS_SYNC_MAX_HORAS: '1' }));
    expect(await conUna.servicio.ejecutar('boton', null)).toEqual({ estado: 'error', causa: CAUSA_SYNC_ATRASADA });
  });

  it('la copia de Drive se lee con la pasada de la última sincronización completa', async () => {
    callar();
    const { pool, consultas } = hubFalso(haceHoras(0));
    expect((await crearEquiposTaller(pool, desk2, leerConfig({})).servicio.ejecutar('boton', null)).estado).toBe('ok');
    const deLaCopia = consultas.filter((c) => /FROM portal\.equipos_drive_archivos/.test(c.sql) && /equipos_sincronizacion WHERE pasada/.test(c.sql));
    expect(deLaCopia.map((c) => c.params)).toEqual([['entradas', '4711'], ['salidas_n8n', '4711'], ['salidas_escaneadas', '4711']]);
  });
});
