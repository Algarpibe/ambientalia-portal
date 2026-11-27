import { describe, it, expect } from 'vitest';
import { cuentaAtras, diaYMes, fechaHoraCorta, fechaLarga, hora } from './fechas';

describe('fechas de la invitación (hora de Bogotá)', () => {
  it('cuentaAtras reparte los segundos que faltan y no baja de cero', () => {
    const objetivo = new Date('2026-12-18T17:30:00Z');
    expect(cuentaAtras(objetivo, new Date('2026-12-17T16:29:58Z'))).toEqual({ dias: 1, horas: 1, minutos: 0, segundos: 2 });
    expect(cuentaAtras(objetivo, new Date('2026-12-19T00:00:00Z'))).toEqual({ dias: 0, horas: 0, minutos: 0, segundos: 0 });
  });

  it('fechaLarga empieza en mayúscula', () => {
    expect(fechaLarga('2026-12-18T12:30:00-05:00')).toBe('Viernes, 18 de diciembre de 2026');
  });

  it('hora y diaYMes', () => {
    expect(hora('2026-12-18T12:30:00-05:00')).toMatch(/^12:30\sp\.\s?m\.$/u);
    expect(diaYMes('2026-12-04T23:59:59-05:00')).toBe('4 de diciembre');
  });

  it('fechaHoraCorta da AAAA-MM-DD HH:MM en Bogotá', () => {
    expect(fechaHoraCorta('2026-12-01T15:00:00.000Z')).toBe('2026-12-01 10:00');
  });
});
