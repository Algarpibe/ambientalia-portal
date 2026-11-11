// Fuentes locales (@fontsource-variable): nada se pide a un host externo.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { FUENTE_MONO, FUENTE_SANS } from './fuentes';

const leer = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const HOST_EXTERNO = /https?:\/\/|\/\/fonts\.|googleapis|gstatic/i;

describe('fuentes locales', () => {
  it('fuentes.ts importa solo los paquetes @fontsource-variable', () => {
    const imports = [...leer('./fuentes.ts').matchAll(/^import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports).toEqual(['@fontsource-variable/inter', '@fontsource-variable/jetbrains-mono']);
  });
  it('el CSS de los dos paquetes declara las familias y solo apunta a archivos propios', () => {
    const req = createRequire(import.meta.url);
    const inter = readFileSync(req.resolve('@fontsource-variable/inter/index.css'), 'utf8');
    const mono = readFileSync(req.resolve('@fontsource-variable/jetbrains-mono/index.css'), 'utf8');
    expect(inter).toContain(`font-family: '${FUENTE_SANS}'`);
    expect(mono).toContain(`font-family: '${FUENTE_MONO}'`);
    expect(inter).not.toMatch(HOST_EXTERNO);
    expect(mono).not.toMatch(HOST_EXTERNO);
  });
  it('tablero.css usa esas familias y no referencia ningún host de fuentes', () => {
    const css = leer('./tablero.css');
    expect(css).toContain(FUENTE_SANS);
    expect(css).toContain(FUENTE_MONO);
    expect(css).not.toMatch(HOST_EXTERNO);
    expect(leer('./fuentes.ts')).not.toMatch(HOST_EXTERNO);
  });
});
