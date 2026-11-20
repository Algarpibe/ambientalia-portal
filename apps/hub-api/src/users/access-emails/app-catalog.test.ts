import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACCESS_APPS, knownApps } from './app-catalog.js';

// CANDADO: ACCESS_APPS es una copia del catálogo del portal, que es la fuente de
// verdad. El fichero del portal se lee como TEXTO, no se importa: queda fuera de
// src/ y tsc no lo compilaría (ni el build de Docker, que solo copia
// apps/hub-api). Se comparan id, nombre y ruta, en el mismo orden.

const PORTAL_APPS = fileURLToPath(new URL('../../../../portal/src/lib/apps.ts', import.meta.url));

/** Las entradas de `APPS` del portal y cuántos `id:` hay en el bloque (para cazar un formato nuevo). */
function catalogoDelPortal() {
  const fuente = readFileSync(PORTAL_APPS, 'utf8');
  const inicio = fuente.indexOf('export const APPS');
  const bloque = fuente.slice(inicio, fuente.indexOf('];', inicio));
  const entradas = [...bloque.matchAll(/\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)',\s*route:\s*'([^']+)'/g)].map(
    ([, id, label, route]) => ({ id, label, route }),
  );
  return { entradas, total: (bloque.match(/\bid:/g) ?? []).length };
}

describe('CANDADO: ACCESS_APPS es la copia de apps/portal/src/lib/apps.ts', () => {
  it('el lector entiende el fichero del portal: todas sus entradas, ninguna a medias', () => {
    const { entradas, total } = catalogoDelPortal();
    expect(entradas.length).toBeGreaterThan(0);
    expect(entradas).toHaveLength(total);
  });

  it('mismos ids, nombres y rutas, en el mismo orden', () => {
    const copia = Object.entries(ACCESS_APPS).map(([id, { label, route }]) => ({ id, label, route }));
    expect(copia).toEqual(catalogoDelPortal().entradas);
  });
});

describe('knownApps', () => {
  it('devuelve las conocidas en el orden del catálogo, sin repetir', () => {
    expect(knownApps(['contabilidad', 'payment-reconciliation', 'contabilidad'])).toEqual([
      { label: 'Conciliador de Pagos', route: '/conciliador-pagos' },
      { label: 'Contabilidad', route: '/contabilidad' },
    ]);
  });

  it('omite los ids que no están en el catálogo', () => {
    expect(knownApps(['app-que-no-existe', 'ausencias'])).toEqual([{ label: 'Vacaciones y Permisos', route: '/ausencias' }]);
  });

  it('sin ids conocidos, lista vacía', () => {
    expect(knownApps([])).toEqual([]);
    expect(knownApps(['app-que-no-existe'])).toEqual([]);
  });
});
