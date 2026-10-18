import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLAVE_EDM180, VIGENCIA_MAX_DIAS, VIGENCIA_MIN_DIAS, VIGENCIA_POR_DEFECTO, esVigenciaValida, grupoMarca, vigenciaDeEquipo, vigenciaDeMarca } from './marcas.js';

// La vigencia de calibración POR MARCA (lote 11, decisión de Alfonso del 18/10/2026): GRIMM, cada 12 meses (365 días, como siempre);
// Horiba y las demás, SIN VENCIMIENTO hasta que alguien les ponga un plazo en «Marcas en seguimiento». Lo guardado (063) manda; sin
// fila, el valor por defecto lo da el código. GRIMM EDM 180 es fijo: para él nada cambia, ni un número.

const nada = new Map<string, number | null>();

describe('vigenciaDeMarca: la regla, en un solo sitio', () => {
  it('por defecto: GRIMM EDM 180 y los GRIMM de otros modelos, 365 días; cualquier otra marca (y sin marca), sin vencimiento', () => {
    expect(VIGENCIA_POR_DEFECTO).toEqual({ [CLAVE_EDM180]: 365, grimm: 365 });
    expect([CLAVE_EDM180, 'grimm', 'horiba', 'environics', 'kunak', ''].map((k) => vigenciaDeMarca(k, nada))).toEqual([365, 365, null, null, null, null]);
  });

  it('lo guardado manda sobre el valor por defecto, también para dejar a GRIMM (otros modelos) sin vencimiento', () => {
    const g = new Map<string, number | null>([['horiba', 365], ['grimm', null], ['kunak', 730]]);
    expect(['horiba', 'grimm', 'kunak', 'environics'].map((k) => vigenciaDeMarca(k, g))).toEqual([365, null, 730, null]);
  });

  it('GRIMM EDM 180 es fijo: 365 aunque hubiera algo guardado con su clave', () => {
    expect(vigenciaDeMarca(CLAVE_EDM180, new Map([[CLAVE_EDM180, null]]))).toBe(365);
    expect(vigenciaDeMarca(CLAVE_EDM180, new Map([[CLAVE_EDM180, 30]]))).toBe(365);
  });
});

describe('vigenciaDeEquipo: la de la marca de su grupo', () => {
  const g = new Map<string, number | null>([['horiba', 730]]);
  it('un equipo en seguimiento es de GRIMM EDM 180 (fijo), escriba como escriba su marca', () => {
    expect(grupoMarca({ marca: 'Horiba' })).toBe(CLAVE_EDM180);
    expect(vigenciaDeEquipo({ marca: 'Horiba', enSeguimiento: true }, new Map([['horiba', null]]))).toBe(365);
  });
  it('uno fuera de seguimiento, el de la clave de su marca («HORIBA » = «horiba»)', () => {
    expect(vigenciaDeEquipo({ marca: ' HORIBA ', enSeguimiento: false }, g)).toBe(730);
    expect(vigenciaDeEquipo({ marca: 'Horiba', enSeguimiento: false }, nada)).toBeNull();
    expect(vigenciaDeEquipo({ marca: 'GRIMM', enSeguimiento: false }, nada)).toBe(365);
  });
});

describe('qué valores se pueden guardar', () => {
  it('null (sin vencimiento) o un número entero de días entre 30 y 1095 (de un mes a tres años)', () => {
    expect([VIGENCIA_MIN_DIAS, VIGENCIA_MAX_DIAS]).toEqual([30, 1095]);
    for (const v of [null, 30, 180, 365, 730, 1095]) expect(esVigenciaValida(v), String(v)).toBe(true);
    for (const v of [29, 1096, 0, -365, 365.5, '365', undefined, Number.NaN, true]) expect(esVigenciaValida(v), String(v)).toBe(false);
  });
});

describe('pureza', () => {
  it('la regla vive en marcas.ts, que sólo importa el dominio (y tipos de la pestaña): la usan el servidor y la app, sin ciclos', () => {
    const src = readFileSync(fileURLToPath(new URL('./marcas.ts', import.meta.url)), 'utf8');
    const imports = [...src.matchAll(/^import (type )?.* from '([^']+)';$/gm)].map((m) => `${m[1] ?? ''}${m[2]}`);
    expect(imports).toEqual(['./dominio.js', 'type ./hoja.js']);
    expect(src).not.toMatch(/Date\.now|new Date\(|process\.env|\bfetch\(/);
    // Nadie más decide una vigencia: el 365 de GRIMM es VIGENCIA_DIAS (dominio.ts) y sólo se aplica a través de esta regla.
    for (const f of ['./repo.ts', './hoja.ts', './hoja-repo.ts', './calibraciones.ts', './calibraciones-repo.ts', './exportacion.ts', './marcas-repo.ts', './vigencia-repo.ts']) {
      expect(readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8'), f).not.toMatch(/VIGENCIA_DIAS|\+\s*365\b|\b365\s*\)/);
    }
  });
});
