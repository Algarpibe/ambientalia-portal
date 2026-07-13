// Fijar TZ a Bogotá (UTC-5) ANTES de importar: así el bug de "un día menos" se
// reproduce si se rompe el parseo (en UTC no se manifestaría).
process.env.TZ = 'America/Bogota';

import { describe, it, expect } from 'vitest';
import { parseExcelDate } from './customerAnalysisUtils';

describe('parseExcelDate', () => {
  it('parsea YYYY-MM-DD como fecha LOCAL (no corre un día en UTC-5)', () => {
    const d = parseExcelDate('2026-04-06')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // abril (0-based)
    expect(d.getDate()).toBe(6);  // clave: NO se corre a 5
  });

  it('la fecha de vencimiento tampoco se corre', () => {
    const d = parseExcelDate('2026-05-06')!;
    expect(d.getMonth()).toBe(4); // mayo
    expect(d.getDate()).toBe(6);
  });

  it('respeta el formato "DD mon YYYY" en español', () => {
    const d = parseExcelDate('6 abr 2026')!;
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(6);
  });

  it('mantiene el parseo de timestamps ISO completos (con hora/zona)', () => {
    // Con hora explícita SÍ se respeta la zona; no debe entrar al branch date-only.
    const d = parseExcelDate('2026-04-06T12:00:00Z')!;
    expect(d instanceof Date).toBe(true);
    expect(isNaN(d.getTime())).toBe(false);
  });

  it('devuelve null para vacío/nulo', () => {
    expect(parseExcelDate('')).toBeNull();
    expect(parseExcelDate(null)).toBeNull();
  });
});
