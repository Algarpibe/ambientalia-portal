import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CURRENT_TERMS_VERSION } from './terms.js';

// CANDADO: la versión que hub-api da por vigente es la del texto que publica el
// portal. Si no coinciden, la pantalla de aceptación mandaría una versión que
// hub-api rechaza (400) y nadie podría pasar; o hub-api pediría aceptar un texto
// que el portal no enseña. El fichero del portal se lee como TEXTO, no se importa:
// queda fuera de src/ y tsc no lo compilaría (ni el build de Docker, que solo
// copia apps/hub-api). Mismo patrón que access-emails/app-catalog.test.ts.

const PORTAL_TERMINOS = fileURLToPath(new URL('../../../portal/src/legal/terminos.ts', import.meta.url));

/** Las versiones que declara el portal con `export const TERMS_VERSION = '…';`. */
function versionesDelPortal(): string[] {
  const fuente = readFileSync(PORTAL_TERMINOS, 'utf8');
  // Anclado al inicio de línea (`^` con `m`): un comentario que cite la declaración
  // no cuenta como otra versión. Sin `$`: con CRLF fallaría antes del `\r`.
  return [...fuente.matchAll(/^export const TERMS_VERSION = '([^']+)';/gm)].map(([, version]) => version);
}

describe('CANDADO: CURRENT_TERMS_VERSION es la TERMS_VERSION de apps/portal/src/legal/terminos.ts', () => {
  it('el lector encuentra UNA declaración de la versión en el fichero del portal', () => {
    expect(versionesDelPortal()).toHaveLength(1);
  });

  it('las dos versiones coinciden', () => {
    expect(versionesDelPortal()).toEqual([CURRENT_TERMS_VERSION]);
  });
});
