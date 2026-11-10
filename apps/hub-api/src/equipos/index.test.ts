import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { crearEquiposTaller } from './index.js';
import { detenerProgramadorEquipos } from './programador.js';
import { leerConfig } from './config.js';

// El montaje: sin Drive queda «sin configurar» y no enciende el programador. La base no
// se toca al montar (el pool es un doble que falla si alguien lo usa).
const pool = { query: async () => { throw new Error('no se debe consultar al montar'); }, connect: async () => { throw new Error('no'); } } as unknown as Pool;

afterEach(() => {
  detenerProgramadorEquipos();
  vi.restoreAllMocks();
});

describe('crearEquiposTaller', () => {
  it('sin la configuración de Drive: sin configurar, sin programador, y lo dice nombrando solo variables', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = crearEquiposTaller(pool, () => null, leerConfig({}));
    expect(m.servicio.configurado()).toBe(false);
    expect(m.iniciarProgramador()).toBe(false);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/sin configurar \(faltan o no valen: EQUIPOS_GOOGLE_CUENTA_SERVICIO, EQUIPOS_DRIVE_ENTRADAS/);
  });

  it('con Drive configurado, el programador se enciende una vez', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const cfg = leerConfig({
      EQUIPOS_GOOGLE_CUENTA_SERVICIO: JSON.stringify({ client_email: 'sa@ficticio.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nA\n-----END PRIVATE KEY-----' }),
      EQUIPOS_DRIVE_ENTRADAS: 'carpetaEntradas01', EQUIPOS_DRIVE_SALIDAS_N8N: 'carpetaSalidasN8n1', EQUIPOS_DRIVE_SALIDAS_ESCANEADAS: 'carpetaEscaneos01', EQUIPOS_DRIVE_TEMPORAL: 'carpetaTemporal01',
    });
    const m = crearEquiposTaller(pool, () => null, cfg);
    expect(m.servicio.configurado()).toBe(true);
    expect(m.iniciarProgramador()).toBe(true);
    expect(m.iniciarProgramador()).toBe(false);
  });
});
