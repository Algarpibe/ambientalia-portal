import { describe, it, expect } from 'vitest';
import { semanaDelMes, rangoDeSemana } from './pagos.js';

// Regla aprobada (2026-10-01): la semana empieza en lunes; la semana 1 va del día 1 al
// primer domingo, aunque quede corta; puede haber hasta 6 semanas.
describe('semanaDelMes', () => {
  it.each([
    // septiembre 2026: empieza en martes, 30 días
    ['2026-09-01', 1], ['2026-09-06', 1], ['2026-09-07', 2], ['2026-09-13', 2],
    ['2026-09-14', 3], ['2026-09-27', 4], ['2026-09-28', 5], ['2026-09-30', 5],
    // febrero 2027: empieza en lunes, 28 días → exactamente 4 semanas
    ['2027-02-01', 1], ['2027-02-07', 1], ['2027-02-08', 2], ['2027-02-28', 4],
    // marzo 2026: empieza en domingo → semana 1 de un solo día, y semana 6
    ['2026-03-01', 1], ['2026-03-02', 2], ['2026-03-29', 5], ['2026-03-30', 6], ['2026-03-31', 6],
  ])('%s → semana %i', (fecha, semana) => {
    const [anio, mes] = fecha.split('-').map(Number);
    expect(semanaDelMes(fecha)).toEqual({ anio, mes, semana });
  });
});

describe('rangoDeSemana', () => {
  it.each([
    [2026, 9, 1, '2026-09-01', '2026-09-06', '1-6 sep 2026'],
    [2026, 9, 2, '2026-09-07', '2026-09-13', '7-13 sep 2026'],
    [2026, 9, 5, '2026-09-28', '2026-09-30', '28-30 sep 2026'],
    [2026, 3, 1, '2026-03-01', '2026-03-01', '1 mar 2026'],
    [2026, 3, 6, '2026-03-30', '2026-03-31', '30-31 mar 2026'],
    [2027, 2, 4, '2027-02-22', '2027-02-28', '22-28 feb 2027'],
  ])('%i-%i semana %i → %s a %s', (anio, mes, semana, desde, hasta, etiqueta) => {
    expect(rangoDeSemana(anio, mes, semana)).toEqual({ desde, hasta, etiqueta });
  });
});
