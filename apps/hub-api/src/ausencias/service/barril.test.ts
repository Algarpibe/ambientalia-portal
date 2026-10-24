import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import micromatch from 'micromatch';
import { describe, it, expect } from 'vitest';
import * as service from '../service.js';
import * as calendario from './calendario.js';
import * as historico from './historico.js';
import * as sesion from './sesion.js';

// ARQ-612 — service.ts se parte en trozos dentro de service/, con el mismo
// patrón que repo.ts: sigue siendo la ÚNICA puerta y reexporta todo lo de los
// trozos. router.ts lo llama como `service.*` y los tests importan de
// '../service.js'; si un trozo se quedara sin reexportar, esas llamadas
// romperían en tiempo de ejecución, no al compilar.
//
// A diferencia de repo/, aquí no hay piezas INTERNAS: nadie sustituye
// service.js por un doble (vi.mock), así que lo que dos trozos comparten se
// exporta desde el suyo y el barril lo reexporta. Es una decisión, no un olvido.
//
// Y una tercera cosa que solo pasa aquí: el umbral de cobertura de ausencias
// (TEST-712) se escribió para los ficheros sueltos de ausencias/, y un glob
// que no alcance service/ dejaría fuera del 95 % todo lo que se mueva, sin
// que nada lo dijera. El último test lo comprueba con el mismo emparejador que
// usa Vitest (micromatch).
//
// Cada PR que saque un trozo nuevo lo añade a TROZOS.

const TROZOS: Record<string, Record<string, unknown>> = {
  calendario,
  historico,
  sesion,
};

const SERVICE = __dirname;
const AUSENCIAS = join(SERVICE, '..');
const HUB_API = join(AUSENCIAS, '..', '..');

/** Los .ts (sin tests) que hay debajo de `dir`, con su ruta absoluta. */
function fuentes(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((r) => r.endsWith('.ts') && !r.endsWith('.test.ts'))
    .map((r) => join(dir, r));
}

describe('service.ts como barril de service/ (ARQ-612)', () => {
  for (const [nombre, trozo] of Object.entries(TROZOS)) {
    it(`reexporta todas las funciones de service/${nombre}.ts, y son las mismas`, () => {
      const funciones = Object.keys(trozo).filter((k) => typeof trozo[k] === 'function');
      expect(funciones.length).toBeGreaterThan(0);
      for (const f of funciones) expect((service as Record<string, unknown>)[f], f).toBe(trozo[f]);
    });
  }

  it('solo service.ts importa de service/: el resto pasa por service.ts', () => {
    // Por la ruta RESUELTA y no por el texto del import: desde otra carpeta el
    // mismo trozo se escribe '../service/x.js', y una expresión regular sobre
    // './service/' no lo vería.
    const infractores = readdirSync(AUSENCIAS, { recursive: true, encoding: 'utf8' })
      .filter((r) => r.endsWith('.ts'))
      .map((r) => join(AUSENCIAS, r))
      .filter((f) => f !== join(AUSENCIAS, 'service.ts') && !f.startsWith(SERVICE + sep))
      .filter((f) =>
        [...readFileSync(f, 'utf8').matchAll(/from '(\.[^']+)'/g)].some((m) =>
          resolve(dirname(f), m[1]).startsWith(SERVICE + sep),
        ),
      )
      .map((f) => relative(AUSENCIAS, f));
    expect(infractores).toEqual([]);
  });

  it('cada trozo de service/ entra en el umbral de cobertura de ausencias (TEST-712)', async () => {
    // Import dinámico con la ruta en una variable: uno literal metería
    // vitest.config.ts en el build de tsc, y está fuera de `rootDir`.
    const config = pathToFileURL(join(HUB_API, 'vitest.config.ts')).href;
    const { default: vitest } = (await import(config)) as {
      default: { test: { coverage: { thresholds: Record<string, unknown> } } };
    };
    const globs = Object.keys(vitest.test.coverage.thresholds);

    const trozos = fuentes(SERVICE);
    expect(trozos.length).toBeGreaterThan(0);
    // Vitest compara cada glob con la ruta relativa a la raíz del proyecto y con
    // barras normales (`pathe`); aquí igual, para que el resultado sea el suyo.
    const fuera = trozos
      .map((f) => relative(HUB_API, f).split(sep).join('/'))
      .filter((r) => !micromatch.isMatch(r, globs));
    expect(fuera).toEqual([]);
  });
});
