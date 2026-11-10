import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actualizar, CV, type Escaneo, type Fuentes } from './index.js';

// Suite SOLO LOCAL: las fixtures reales viven en ./fixtures-reales/, ignorada por git
// (el repo es público). Sin esos ficheros (en el CI y en cualquier otra copia) se salta
// sola. Comprueba dos cosas:
//   1. que las fixtures anonimizadas del repo son exactamente las que salen hoy del
//      script a partir de las reales (si no, hay que regenerarlas);
//   2. que anonimizar no cambia lo que hace el núcleo: misma clasificación y mismas
//      ilegibles, con los datos reales y con los anonimizados.
const REALES = fileURLToPath(new URL('./fixtures-reales/', import.meta.url));
const ANONIMAS = fileURLToPath(new URL('./fixtures/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../../scripts/equipos-anonimizar.mjs', import.meta.url));
const hay = ['remisiones.json', 'escaneos-reales.json', 'roles.local.json'].every((n) => existsSync(join(REALES, n)));
const leer = (dir: string, n: string) => JSON.parse(readFileSync(join(dir, n), 'utf8'));

async function foto(esc: { ilegibles: Escaneo[]; legibles: Escaneo[]; fechaErrada: Escaneo }) {
  const sc: Escaneo[] = [...esc.ilegibles, ...esc.legibles, esc.fechaErrada].map((x, i) => ({ ...x, id: 'p' + i }));
  const fuentes: Fuentes = {
    entradas: async () => [],
    salidasGeneradas: async () => [],
    salidasEscaneadas: async () => sc.map((x) => ({ id: x.id, title: x.n })),
    textoPdf: async () => { throw new Error('todo está en el caché'); },
    tickets: async () => [],
    comentarios: async () => [],
  };
  return (await actualizar(fuentes, { exits: { v: CV, list: sc } }, { hoy: '2026-11-09' })).snap;
}

describe.skipIf(!hay)('fixtures reales (solo local)', () => {
  it('las anonimizadas del repo están al día con el script', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'equipos-anon-'));
    try {
      execFileSync(process.execPath, [SCRIPT, 'generar', REALES, tmp]);
      // Sin los finales de línea: con core.autocrlf, la copia de trabajo puede tener CRLF.
      const texto = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
      for (const n of ['remisiones.json', 'escaneos.json', 'roles.json']) expect(texto(join(tmp, n))).toBe(texto(join(ANONIMAS, n)));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('el núcleo da lo mismo con las reales y con las anonimizadas', async () => {
    const real = await foto(leer(REALES, 'escaneos-reales.json'));
    const anonima = await foto(leer(ANONIMAS, 'escaneos.json'));
    const resumen = (f: Awaited<ReturnType<typeof foto>>) => (f.ilegibles || []).map((x) => x.d + '|' + x.m + '|' + x.p.length).sort();
    expect(resumen(anonima)).toEqual(resumen(real));
  });

  it('ningún valor real aparece en lo que va al repo', () => {
    const rutas = [ANONIMAS, fileURLToPath(new URL('../', import.meta.url)), fileURLToPath(new URL('../../../../equipos-taller/src/', import.meta.url))].filter(existsSync);
    expect(() => execFileSync(process.execPath, [SCRIPT, 'verificar', REALES, ...rutas], { stdio: 'pipe' })).not.toThrow();
  });
});
