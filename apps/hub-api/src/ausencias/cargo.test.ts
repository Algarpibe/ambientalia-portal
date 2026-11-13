import { describe, it, expect } from 'vitest';
import { normalizarCargo } from './service.js';

// La regla del cargo, aislada y pura: qué llega del cuerpo de la petición y qué
// acaba en la columna `cargo VARCHAR(255)`.

/** El error que lanza, o null si no lanza. */
function fallo(bruto: unknown): unknown {
  try {
    normalizarCargo(bruto);
  } catch (e) {
    return e;
  }
  return null;
}

const INVALIDO = { code: 'cargo_invalido', status: 400, field: 'cargo' };

describe('normalizarCargo', () => {
  it('null es «sin cargo»', () => {
    expect(normalizarCargo(null)).toBeNull();
  });

  it('recorta los espacios de los extremos', () => {
    expect(normalizarCargo('  Jefa de taller  ')).toBe('Jefa de taller');
  });

  it('vacío o solo espacios también es «sin cargo»', () => {
    expect(normalizarCargo('')).toBeNull();
    expect(normalizarCargo('    ')).toBeNull();
  });

  it('conserva las tildes y la caja tal cual', () => {
    expect(normalizarCargo('Técnica de Calibración')).toBe('Técnica de Calibración');
  });

  it('400 cargo_invalido si no es ni texto ni null, incluida la clave ausente', () => {
    for (const bruto of [42, true, {}, [], undefined]) {
      expect(fallo(bruto), String(bruto)).toMatchObject(INVALIDO);
    }
  });

  it('400 con un carácter de control en medio: NUL, salto de línea, tabulador, DEL', () => {
    for (const bruto of ['Jefa\u0000', 'Jefa\nde taller', 'Jefa\tde taller', 'Jefa\u007Fde taller']) {
      expect(fallo(bruto), JSON.stringify(bruto)).toMatchObject(INVALIDO);
    }
  });

  it('los de los extremos no cuentan: se van con el recorte', () => {
    expect(normalizarCargo('\tJefa de taller\n')).toBe('Jefa de taller');
  });

  it('255 caracteres pasan y 256 no', () => {
    expect(normalizarCargo('a'.repeat(255))).toBe('a'.repeat(255));
    expect(fallo('a'.repeat(256))).toMatchObject(INVALIDO);
  });

  it('la longitud se mide después del recorte', () => {
    expect(normalizarCargo(` ${'a'.repeat(255)} `)).toBe('a'.repeat(255));
  });

  it('un emoji cuenta como UN carácter, igual que en VARCHAR(255)', () => {
    // 255 emojis son 510 unidades UTF-16: con `.length` se rechazarían aunque
    // PostgreSQL los guarda sin problema (lo prueba repo.cargo.db.test.ts).
    const emoji = '\u{1F600}';
    expect(normalizarCargo(emoji.repeat(255))).toBe(emoji.repeat(255));
    expect(fallo(emoji.repeat(256))).toMatchObject(INVALIDO);
  });
});
