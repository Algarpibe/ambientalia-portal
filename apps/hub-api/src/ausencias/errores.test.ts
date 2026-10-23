import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { AusenciaError } from './errores.js';
import { AusenciaError as DesdeService } from './service.js';

// ARQ-612 — `AusenciaError` vivía en service.ts, y historico.ts lo importaba de
// allí mientras service.ts importaba historico.ts: un ciclo. Ahora vive en su
// propio fichero y service.ts lo reexporta, así que ningún importador cambia.

describe('AusenciaError (ARQ-612)', () => {
  it('es UNA sola clase: la de errores.ts y la que reexporta service.ts son la misma', () => {
    // router.ts traduce a HTTP con `instanceof AusenciaError`. Si alguien la
    // copiara en vez de reexportarla, los errores de una copia dejarían de
    // reconocerse en la otra y saldrían como 500.
    expect(DesdeService).toBe(AusenciaError);
    expect(new AusenciaError('x', 400)).toBeInstanceOf(DesdeService);
  });

  it('conserva código, estado, campo y detalle', () => {
    const e = new AusenciaError('solape', 409, 'fechaInicio', { con: 'abc' });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AusenciaError');
    expect(e.message).toBe('solape');
    expect([e.code, e.status, e.field, e.detalle]).toEqual(['solape', 409, 'fechaInicio', { con: 'abc' }]);
  });

  it('historico.ts ya no importa service.ts (el ciclo está roto)', () => {
    const fuente = readFileSync(join(__dirname, 'historico.ts'), 'utf8');
    expect(fuente).not.toMatch(/from '\.\/service\.js'/);
  });
});
