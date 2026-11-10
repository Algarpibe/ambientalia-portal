import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// El núcleo es la ÚNICA fuente de verdad de las reglas y lo importan el servidor y la
// pantalla (el `tsc -b` del portal lo comprueba sin tipos de Node). Por eso, fuera de las
// pruebas, no importa nada de fuera de su carpeta: ni Node, ni la base, ni la red.
const DIR = fileURLToPath(new URL('./', import.meta.url));
const fuentes = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('núcleo puro', () => {
  it('son los cinco ficheros del módulo', () => expect(fuentes.sort()).toEqual(['actualizar.ts', 'index.ts', 'pantalla.ts', 'reglas.ts', 'tipos.ts']));

  it.each(fuentes)('%s solo importa de su propia carpeta', (f) => {
    const imports = [...readFileSync(DIR + f, 'utf8').matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports.filter((i) => !/^\.\/[a-z]+\.js$/.test(i))).toEqual([]);
  });

  it('no usa nada de Node', () => {
    for (const f of fuentes) expect(readFileSync(DIR + f, 'utf8')).not.toMatch(/\bprocess\.|\bBuffer\b|node:/);
  });
});
