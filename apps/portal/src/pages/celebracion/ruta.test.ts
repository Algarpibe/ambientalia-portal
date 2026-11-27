import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RUTA_CELEBRACION } from './ruta';

const app = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8');

describe('ruta de la invitación', () => {
  it('es la del mensaje de WhatsApp', () => {
    expect(RUTA_CELEBRACION).toBe('/celebracion-navidad-2026');
  });

  it('está fuera del shell, con sesión y sin AppGuard', () => {
    const inicio = app.indexOf('path={RUTA_CELEBRACION}');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = app.slice(inicio, app.indexOf('path="/*"'));
    expect(bloque).toContain('<RequireAuth>');
    expect(bloque).toContain('<CelebracionNavidad />');
    expect(bloque).not.toContain('AppGuard');
  });
});
