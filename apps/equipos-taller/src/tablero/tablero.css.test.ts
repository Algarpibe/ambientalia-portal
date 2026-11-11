// El CSS y los componentes del tablero no llevan colores fijos: todo sale de los tokens `--tt-*`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEMAS } from './temas';

const leer = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const LITERAL_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/;

describe('tablero.css y Tablero.tsx', () => {
  const css = leer('./tablero.css');
  it('tablero.css no tiene literales de color (hex, rgb, hsl…)', () => {
    expect(css.length).toBeGreaterThan(500);
    expect(css).not.toMatch(LITERAL_COLOR);
  });
  it('Tablero.tsx no tiene literales de color', () => {
    const tsx = leer('./Tablero.tsx');
    expect(tsx.length).toBeGreaterThan(500);
    expect(tsx).not.toMatch(LITERAL_COLOR);
  });
  it('cada variable --tt-* que usa existe en la tabla de tokens', () => {
    const usadas = [...css.matchAll(/var\(--tt-([a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(usadas.length).toBeGreaterThan(20);
    for (const u of usadas) expect(Object.keys(TEMAS.dia), 'token ' + u).toContain(u);
  });
  it('tv.css y TvEquipos.tsx tampoco, y sus variables --tt-* existen', () => {
    const tv = leer('./tv.css');
    expect(tv.length).toBeGreaterThan(500);
    expect(tv).not.toMatch(LITERAL_COLOR);
    expect(leer('../TvEquipos.tsx')).not.toMatch(LITERAL_COLOR);
    const usadas = [...tv.matchAll(/var\(--tt-([a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(usadas.length).toBeGreaterThan(0);
    for (const u of usadas) expect(Object.keys(TEMAS.dia), 'token ' + u).toContain(u);
  });
  it('mis-equipos.css, MisEquipos.tsx y tecnico.ts tampoco, y sus variables --tt-* existen', () => {
    const mis = leer('./mis-equipos.css');
    expect(mis.length).toBeGreaterThan(500);
    for (const f of ['./mis-equipos.css', '../MisEquipos.tsx', '../tecnico.ts', '../EscanearSerial.tsx']) expect(leer(f)).not.toMatch(LITERAL_COLOR);
    const usadas = [...mis.matchAll(/var\(--tt-([a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(usadas.length).toBeGreaterThan(10);
    for (const u of usadas) expect(Object.keys(TEMAS.dia), 'token ' + u).toContain(u);
  });
  it('el detector de literales sí ve un hex y un rgba', () => {
    expect('color:#fff').toMatch(LITERAL_COLOR);
    expect('box-shadow:0 0 rgba(0,0,0,.1)').toMatch(LITERAL_COLOR);
    expect('color:var(--tt-tx1)').not.toMatch(LITERAL_COLOR);
  });
});
