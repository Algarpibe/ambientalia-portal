import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import * as repo from '../repo.js';
import * as adjuntos from './adjuntos.js';
import * as calendario from './calendario.js';
import * as empleados from './empleados.js';
import * as filas from './filas.js';
import * as historico from './historico.js';
import * as kpis from './kpis.js';
import * as outbox from './outbox.js';
import * as registro from './registro.js';
import * as retiro from './retiro.js';
import * as saldos from './saldos.js';
import * as solapes from './solapes.js';
import * as visores from './visores.js';

// ARQ-612 — repo.ts se parte en trozos dentro de repo/, pero sigue siendo la
// ÚNICA puerta: reexporta todo lo de los trozos. Dos cosas lo sostienen, y las
// dos fallan en silencio si se rompen:
//
//  1. Que repo.ts exporte las MISMAS funciones que el trozo. service.ts y
//     router.ts las llaman como `repo.*`.
//  2. Que nadie más importe de repo/. router.test.ts sustituye './repo.js' por
//     un doble en memoria (vi.mock); si service.ts importara un trozo
//     directamente, esas llamadas se saltarían el doble y los tests unitarios
//     llegarían a un SQL que no existe en ellos. El compilador no lo ve.
//
// Cada PR que saque un trozo nuevo lo añade a TROZOS.
//
// Y al revés, INTERNOS: piezas que comparten dos trozos (la traducción de una
// fila, por ejemplo) pero que repo.ts NO tiene que exportar. Si se colaran por
// un `export *`, repo.ts tendría funciones públicas nuevas que el doble de
// router.test.ts no conoce.

const TROZOS: Record<string, Record<string, unknown>> = {
  adjuntos,
  calendario,
  empleados,
  historico,
  kpis,
  outbox,
  registro,
  retiro,
  saldos,
  solapes,
  visores,
};

const INTERNOS: Record<string, Record<string, unknown>> = { filas };

describe('repo.ts como barril de repo/ (ARQ-612)', () => {
  for (const [nombre, trozo] of Object.entries(TROZOS)) {
    it(`reexporta todas las funciones de repo/${nombre}.ts, y son las mismas`, () => {
      const funciones = Object.keys(trozo).filter((k) => typeof trozo[k] === 'function');
      expect(funciones.length).toBeGreaterThan(0);
      for (const f of funciones) expect((repo as Record<string, unknown>)[f], f).toBe(trozo[f]);
    });
  }

  for (const [nombre, interno] of Object.entries(INTERNOS)) {
    it(`NO reexporta las funciones de repo/${nombre}.ts, que son internas`, () => {
      const funciones = Object.keys(interno).filter((k) => typeof interno[k] === 'function');
      expect(funciones.length).toBeGreaterThan(0);
      for (const f of funciones) expect((repo as Record<string, unknown>)[f], f).toBeUndefined();
    });
  }

  it('solo repo.ts importa de repo/: el resto pasa por repo.ts', () => {
    const AUSENCIAS = join(__dirname, '..');
    const infractores = readdirSync(AUSENCIAS, { recursive: true, encoding: 'utf8' })
      .map((r) => r.replace(/\\/g, '/'))
      .filter((r) => r.endsWith('.ts') && r !== 'repo.ts' && !r.startsWith('repo/'))
      .filter((r) => /from '\.\/repo\//.test(readFileSync(join(AUSENCIAS, r), 'utf8')));
    expect(infractores).toEqual([]);
  });
});
