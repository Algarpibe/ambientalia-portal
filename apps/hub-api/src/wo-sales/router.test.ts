import { describe, it, expect } from 'vitest';
import { rangoPorDefecto } from './router.js';

describe('rangoPorDefecto', () => {
  it('por defecto incluye TODAS las OV abiertas sin importar el año (piso histórico)', () => {
    const { desde, hasta } = rangoPorDefecto('2026-09-25');
    // El estado "vivo" (estadosVivos) es lo que restringe a las abiertas; la fecha no
    // debe excluir por año. El piso cubre cualquier OV histórica del hub (la más antigua
    // es de 2021), no solo el año en curso.
    expect(desde <= '2021-01-01').toBe(true);
    // El techo sigue siendo el fin del año en curso: cubre todo lo pasado y presente.
    expect(hasta).toBe('2026-12-31');
  });
});
