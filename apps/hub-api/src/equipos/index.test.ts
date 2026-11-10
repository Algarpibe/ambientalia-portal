import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { crearEquiposTaller } from './index.js';
import { detenerProgramadorEquipos } from './programador.js';
import { leerConfig } from './config.js';

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
