import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  asignarClaves,
  claveSerial,
  diasEntre,
  esFechaIso,
  estadoCalibracion,
  modeloEdm180,
  sumarDias,
} from './dominio.js';

describe('fechas', () => {
  it('valida fechas de calendario reales', () => {
    expect(esFechaIso('2026-10-06')).toBe(true);
    expect(esFechaIso('2026-02-30')).toBe(false);
    expect(esFechaIso('06/10/2026')).toBe(false);
    expect(esFechaIso(null)).toBe(false);
  });

  it('suma y resta días cruzando años bisiestos', () => {
    expect(sumarDias('2024-02-28', 1)).toBe('2024-02-29');
    expect(sumarDias('2025-10-17', 365)).toBe('2026-10-17');
    expect(diasEntre('2026-10-06', '2026-10-17')).toBe(11);
    expect(diasEntre('2026-10-06', '2026-09-03')).toBe(-33);
  });
});

describe('estadoCalibracion (regla de la F-ST-022: vigencia = última calibración − hoy + 365)', () => {
  const hoy = '2026-10-06';

  it('reproduce la columna «Vigencia de Calibración (Días)» de la hoja', () => {
    // 18A00006 (Cliente Cuatro), calibrado el 17/10/2025: la hoja da 12 días el 05/10;
    // hoy 06/10 son 11.
    expect(estadoCalibracion('2025-10-17', hoy)).toEqual({ vence: '2026-10-17', vigenciaDias: 11, estado: 'VENCE_30' });
  });

  it('clasifica en las franjas 30/60/90', () => {
    expect(estadoCalibracion(sumarDias(hoy, -365 + 30), hoy).estado).toBe('VENCE_30');
    expect(estadoCalibracion(sumarDias(hoy, -365 + 31), hoy).estado).toBe('VENCE_60');
    expect(estadoCalibracion(sumarDias(hoy, -365 + 60), hoy).estado).toBe('VENCE_60');
    expect(estadoCalibracion(sumarDias(hoy, -365 + 61), hoy).estado).toBe('VENCE_90');
    expect(estadoCalibracion(sumarDias(hoy, -365 + 90), hoy).estado).toBe('VENCE_90');
    expect(estadoCalibracion(sumarDias(hoy, -365 + 91), hoy).estado).toBe('AL_DIA');
  });

  it('vence hoy cuenta como «vence ≤ 30», no como vencida', () => {
    expect(estadoCalibracion(sumarDias(hoy, -365), hoy)).toMatchObject({ vigenciaDias: 0, estado: 'VENCE_30' });
    expect(estadoCalibracion(sumarDias(hoy, -366), hoy)).toMatchObject({ vigenciaDias: -1, estado: 'VENCIDA' });
  });

  it('vencida hace más de un año pasa a FUERA_CICLO (Estado = 1 en la hoja)', () => {
    expect(estadoCalibracion(sumarDias(hoy, -730), hoy)).toMatchObject({ vigenciaDias: -365, estado: 'VENCIDA' });
    expect(estadoCalibracion(sumarDias(hoy, -731), hoy)).toMatchObject({ vigenciaDias: -366, estado: 'FUERA_CICLO' });
  });

  it('sin fecha o con fecha inválida es SIN_FECHA', () => {
    expect(estadoCalibracion(null, hoy)).toEqual({ vence: null, vigenciaDias: null, estado: 'SIN_FECHA' });
    expect(estadoCalibracion('2026-13-01', hoy).estado).toBe('SIN_FECHA');
  });
});

describe('modelos y claves', () => {
  it('reconoce los EDM 180 tal como se escriben en la hoja', () => {
    expect(modeloEdm180('EDM 180C')).toBe('EDM 180C');
    expect(modeloEdm180('EDM180C')).toBe('EDM 180C');
    expect(modeloEdm180('edm 180 d')).toBe('EDM 180D');
    expect(modeloEdm180('EDM 280')).toBeNull();
    expect(modeloEdm180(1109)).toBeNull();
    expect(modeloEdm180(null)).toBeNull();
  });

  it('los seriales repetidos reciben sufijo en orden de aparición', () => {
    expect(asignarClaves(['18A00004', '18A00005', '18A00004', '18A00004'])).toEqual([
      '18A00004',
      '18A00005',
      '18A00004-2',
      '18A00004-3',
    ]);
    expect(claveSerial(' 18A 20/1 ')).toBe('18A_20_1');
  });
});

describe('pureza', () => {
  it('dominio.ts no importa nada (lo consume también la app del portal)', () => {
    const src = readFileSync(fileURLToPath(new URL('./dominio.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
