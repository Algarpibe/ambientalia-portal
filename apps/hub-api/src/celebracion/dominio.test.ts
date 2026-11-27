import { describe, it, expect } from 'vitest';
import { CUALIDADES, EVENTO } from './config.js';
import {
  CelebracionError,
  confirmacionesAbiertas,
  esUuid,
  parseConfirmacion,
  parseCualidades,
  top3,
  votosAbiertos,
} from './dominio.js';

/** «400:codigo» si lanza un CelebracionError; así cada caso cabe en una línea. */
function resultado(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof CelebracionError ? `${e.status}:${e.code}` : 'otro error';
  }
  return 'sin error';
}

describe('configuración', () => {
  it('es la del diseño: el evento de 2026 y 18 cualidades distintas', () => {
    expect(EVENTO.id).toBe('fin-de-ano-2026');
    expect(CUALIDADES).toHaveLength(18);
    expect(new Set(CUALIDADES).size).toBe(18);
    expect(EVENTO.mapsUrl.startsWith('https://www.google.com/maps/place/Anfitriona')).toBe(true);
  });
});

describe('cierres', () => {
  it('las confirmaciones siguen abiertas hasta el último segundo del 4 de diciembre en Bogotá', () => {
    expect(confirmacionesAbiertas(new Date('2026-12-05T04:59:59Z'))).toBe(true);
    expect(confirmacionesAbiertas(new Date('2026-12-05T05:00:00Z'))).toBe(false);
  });

  it('los votos cierran al empezar el almuerzo', () => {
    expect(votosAbiertos(new Date('2026-12-18T17:29:59Z'))).toBe(true);
    expect(votosAbiertos(new Date('2026-12-18T17:30:00Z'))).toBe(false);
  });
});

describe('CelebracionError', () => {
  it('los cierres son 409, no_invitado es 403 y lo demás 400', () => {
    expect(new CelebracionError('faltan_brindis').status).toBe(409);
    expect(new CelebracionError('confirmaciones_cerradas').status).toBe(409);
    expect(new CelebracionError('votos_cerrados').status).toBe(409);
    expect(new CelebracionError('no_invitado').status).toBe(403);
    expect(new CelebracionError('exclusion_propia').status).toBe(400);
    expect(new CelebracionError('voto_propio').status).toBe(400);
  });
});

describe('parseConfirmacion', () => {
  it('si va, exige una preferencia de la lista', () => {
    expect(parseConfirmacion({ asiste: true, preferencia: 'vegetariano' })).toEqual({
      asiste: true,
      preferencia: 'vegetariano',
      mensaje: null,
    });
    expect(resultado(() => parseConfirmacion({ asiste: true }))).toBe('400:preferencia_invalida');
    expect(resultado(() => parseConfirmacion({ asiste: true, preferencia: 'carne' }))).toBe('400:preferencia_invalida');
  });

  it('si no va, no admite preferencia', () => {
    expect(parseConfirmacion({ asiste: false })).toEqual({ asiste: false, preferencia: null, mensaje: null });
    expect(parseConfirmacion({ asiste: false, preferencia: null })).toEqual({ asiste: false, preferencia: null, mensaje: null });
    expect(resultado(() => parseConfirmacion({ asiste: false, preferencia: 'general' }))).toBe('400:preferencia_invalida');
  });

  it('asiste tiene que ser booleano', () => {
    expect(resultado(() => parseConfirmacion({ asiste: 'si', preferencia: 'general' }))).toBe('400:asiste_invalido');
    expect(resultado(() => parseConfirmacion(null))).toBe('400:asiste_invalido');
  });

  it('el mensaje es opcional, se recorta y tiene tope de 200', () => {
    expect(parseConfirmacion({ asiste: false, mensaje: '  ¡Feliz año! 🎉  ' }).mensaje).toBe('¡Feliz año! 🎉');
    expect(parseConfirmacion({ asiste: false, mensaje: '   ' }).mensaje).toBeNull();
    expect(parseConfirmacion({ asiste: false, mensaje: 'a'.repeat(200) }).mensaje).toHaveLength(200);
    expect(resultado(() => parseConfirmacion({ asiste: false, mensaje: 'a'.repeat(201) }))).toBe('400:mensaje_invalido');
    expect(resultado(() => parseConfirmacion({ asiste: false, mensaje: 42 }))).toBe('400:mensaje_invalido');
  });

  it('rechaza caracteres de control y separadores de línea dentro del mensaje', () => {
    for (const raro of ['a\nb', 'a\tb', 'a\u0085b', 'a\u2028b']) {
      expect(resultado(() => parseConfirmacion({ asiste: false, mensaje: raro }))).toBe('400:mensaje_invalido');
    }
  });
});

describe('parseCualidades', () => {
  it('acepta de 0 a 3 cualidades de la lista, sin repetir', () => {
    expect(parseCualidades({ cualidades: [] })).toEqual([]);
    expect(parseCualidades({ cualidades: ['Empatía', 'Liderazgo', 'Compromiso'] })).toEqual(['Empatía', 'Liderazgo', 'Compromiso']);
  });

  it('más de 3 es demasiadas_cualidades', () => {
    expect(
      resultado(() => parseCualidades({ cualidades: ['Empatía', 'Liderazgo', 'Compromiso', 'Creatividad'] })),
    ).toBe('400:demasiadas_cualidades');
  });

  it('una desconocida, repetida, que no es texto o sin lista es cualidad_invalida', () => {
    const cuerpos: unknown[] = [
      { cualidades: ['Puntualidad'] },
      { cualidades: ['Empatía', 'Empatía'] },
      { cualidades: [1] },
      { cualidades: 'Empatía' },
      {},
      null,
    ];
    for (const cuerpo of cuerpos) expect(resultado(() => parseCualidades(cuerpo))).toBe('400:cualidad_invalida');
  });
});

describe('esUuid', () => {
  it('distingue un UUID de cualquier otra cosa', () => {
    expect(esUuid('00000000-0000-4000-8000-00000000000a')).toBe(true);
    expect(esUuid('00000000-0000-4000-8000-00000000000A')).toBe(true);
    expect(esUuid('no-es-un-uuid')).toBe(false);
    expect(esUuid(42)).toBe(false);
  });
});

describe('top3', () => {
  it('ordena por votos y desempata por el orden de la lista', () => {
    expect(
      top3([
        { cualidad: 'Compromiso', votos: 2 },
        { cualidad: 'Empatía', votos: 2 },
        { cualidad: 'Liderazgo', votos: 5 },
        { cualidad: 'Creatividad', votos: 1 },
      ]),
    ).toEqual([
      { cualidad: 'Liderazgo', votos: 5 },
      { cualidad: 'Empatía', votos: 2 },
      { cualidad: 'Compromiso', votos: 2 },
    ]);
  });

  it('ignora las cualidades que ya no están en la lista', () => {
    expect(top3([{ cualidad: 'Puntualidad', votos: 9 }])).toEqual([]);
  });
});
