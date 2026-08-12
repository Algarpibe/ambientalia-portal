import { describe, it, expect } from 'vitest';
import { contarDiasHabiles, esFechaValida } from './dias-habiles.js';

describe('esFechaValida', () => {
  it('acepta fechas de calendario reales', () => {
    expect(esFechaValida('2026-02-28')).toBe(true);
    expect(esFechaValida('2028-02-29')).toBe(true); // bisiesto
  });

  it('rechaza lo que tiene forma de fecha pero no existe', () => {
    // Sin esto llegarían al `$1::date` del SQL y reventarían la consulta,
    // devolviendo un 500 por lo que en realidad es un error del que llama.
    expect(esFechaValida('2026-02-30')).toBe(false);
    expect(esFechaValida('2026-13-01')).toBe(false);
    expect(esFechaValida('2027-02-29')).toBe(false); // no bisiesto
    expect(esFechaValida('26-01-01')).toBe(false);
    expect(esFechaValida('')).toBe(false);
  });
});

describe('contarDiasHabiles', () => {
  it('cuenta un solo día laborable', () => {
    // Martes 6 de enero de 2026 es festivo (Reyes trasladado al 12), pero el 7 no.
    expect(contarDiasHabiles('2026-01-07', '2026-01-07')).toBe(1);
  });

  it('no cuenta un solo día si cae en sábado, domingo o festivo', () => {
    expect(contarDiasHabiles('2026-01-03', '2026-01-03')).toBe(0); // sábado
    expect(contarDiasHabiles('2026-01-04', '2026-01-04')).toBe(0); // domingo
    expect(contarDiasHabiles('2026-01-01', '2026-01-01')).toBe(0); // Año Nuevo
  });

  it('descuenta el festivo de un puente', () => {
    // Semana del 12 al 16 de enero de 2026: el lunes 12 es Reyes trasladado.
    expect(contarDiasHabiles('2026-01-12', '2026-01-16')).toBe(4);
  });

  it('descuenta Jueves y Viernes Santo', () => {
    // Semana Santa de 2026: lunes 30-mar a viernes 3-abr; jue 2 y vie 3 festivos.
    expect(contarDiasHabiles('2026-03-30', '2026-04-03')).toBe(3);
  });

  it('cuenta una semana natural completa como 5 días', () => {
    expect(contarDiasHabiles('2026-02-02', '2026-02-08')).toBe(5);
  });

  it('atraviesa el cambio de año', () => {
    // 28-dic-2026 (lun) a 4-ene-2027 (lun). Festivos: 1-ene-2027 (vie).
    // Laborables: 28, 29, 30, 31 dic + 4 ene = 5.
    expect(contarDiasHabiles('2026-12-28', '2027-01-04')).toBe(5);
  });

  it('funciona en 2027, donde la lista hardcodeada de n8n ya no llegaba', () => {
    // Semana del 22 al 26 de marzo de 2027: lunes 22 (San José trasladado),
    // jueves 25 y viernes 26 (Semana Santa) son festivos → quedan 2.
    expect(contarDiasHabiles('2027-03-22', '2027-03-26')).toBe(2);
  });

  it('cuenta un mes con dos festivos', () => {
    // Junio de 2026: 22 días de lunes a viernes, menos el 8 (Corpus), el 15
    // (Sagrado Corazón) y el 29 (San Pedro y San Pablo) → 19.
    expect(contarDiasHabiles('2026-06-01', '2026-06-30')).toBe(19);
  });

  it('rechaza el rango invertido', () => {
    expect(() => contarDiasHabiles('2026-05-10', '2026-05-01')).toThrow(/invertido/i);
  });

  it('rechaza fechas inválidas', () => {
    expect(() => contarDiasHabiles('2026-02-30', '2026-03-01')).toThrow();
  });

  it('rechaza rangos absurdamente largos', () => {
    // Cortafuegos: un rango de años haría un bucle largo y no es una ausencia real.
    expect(() => contarDiasHabiles('2026-01-01', '2029-01-01')).toThrow(/demasiado largo/i);
  });

  it('da el mismo resultado en UTC que en America/Bogota', () => {
    // Regresión del bug original: n8n usaba new Date(str) + toISOString(), que en
    // un proceso en UTC desplaza un día respecto de la fecha que el usuario tecleó.
    const tzOriginal = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const enUtc = contarDiasHabiles('2026-06-01', '2026-06-30');
      process.env.TZ = 'America/Bogota';
      const enBogota = contarDiasHabiles('2026-06-01', '2026-06-30');
      expect(enUtc).toBe(enBogota);
      expect(enUtc).toBe(19);
    } finally {
      process.env.TZ = tzOriginal;
    }
  });
});
