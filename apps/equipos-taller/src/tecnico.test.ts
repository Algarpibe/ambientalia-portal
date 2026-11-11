// Identidad del técnico: coincidencia de nombres normalizados. Nombres ficticios.
import { describe, expect, it } from 'vitest';
import { coincideTecnico } from './tecnico';

describe('coincideTecnico', () => {
  it('ignora mayúsculas, tildes y espacios', () => {
    expect(coincideTecnico('María Pérez Gómez', ' maria   perez gomez ')).toBe(true);
  });
  it('acepta que el conjunto menor (2 o más palabras) esté dentro del mayor', () => {
    expect(coincideTecnico('María Pérez Gómez', 'Maria Perez')).toBe(true);
    expect(coincideTecnico('Maria Perez', 'María Pérez Gómez')).toBe(true);
  });
  it('rechaza una sola palabra, nombres distintos y vacíos', () => {
    expect(coincideTecnico('María Pérez Gómez', 'Maria')).toBe(false);
    expect(coincideTecnico('María Pérez Gómez', 'Carlos Ruiz')).toBe(false);
    expect(coincideTecnico('', '')).toBe(false);
  });
});
