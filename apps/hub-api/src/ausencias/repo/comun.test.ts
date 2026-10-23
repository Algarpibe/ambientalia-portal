import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import * as comun from './comun.js';
import * as repo from '../repo.js';

// ARQ-612 — al partir repo.ts, la tentación es copiar a cada trozo nuevo la
// transacción, el candado o el recorte por rama. Dos de esas piezas solo
// funcionan si existen UNA vez:
//  - la llave del candado de DATA-336: el alta y las tres puertas que mueven
//    fechas solo se esperan entre sí si piden exactamente la misma;
//  - `ramaDeDosNiveles`: una copia que divergiera no lanza ni se pone roja,
//    enseña ausencias de gente que no es de quien mira.

const AUSENCIAS = join(__dirname, '..');

/** Fuentes de ausencias (con sus subcarpetas), sin los tests. */
function fuentes(): { ruta: string; texto: string }[] {
  return readdirSync(AUSENCIAS, { recursive: true, encoding: 'utf8' })
    .filter((r) => r.endsWith('.ts') && !r.endsWith('.test.ts'))
    .map((r) => ({ ruta: r.replace(/\\/g, '/'), texto: readFileSync(join(AUSENCIAS, r), 'utf8') }));
}

const dondeAparece = (re: RegExp) => fuentes().filter((f) => re.test(f.texto)).map((f) => f.ruta);

describe('las piezas comunes del repositorio de ausencias (ARQ-612)', () => {
  it('la llave del candado por empleado (DATA-336) está escrita en un solo sitio', () => {
    expect(dondeAparece(/'ausencias:empleado:'/)).toEqual(['repo/comun.ts']);
  });

  it('el recorte por rama se define en un solo sitio', () => {
    expect(dondeAparece(/function ramaDeDosNiveles\b/)).toEqual(['repo/comun.ts']);
  });

  it('repo.ts sigue exportando lo mismo: son las mismas funciones, no copias', () => {
    // service.ts y router.ts usan `repo.conCandadoDelEmpleado` y
    // `repo.ramaDeDosNiveles`, y el doble de router.test.ts compara las
    // exportaciones de repo.ts con las suyas.
    expect(repo.conCandadoDelEmpleado).toBe(comun.conCandadoDelEmpleado);
    expect(repo.ramaDeDosNiveles).toBe(comun.ramaDeDosNiveles);
  });
});
