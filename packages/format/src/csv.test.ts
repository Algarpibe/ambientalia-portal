import { describe, it, expect } from 'vitest';
import { escaparCeldaCsv } from './index';

// AI-913 / SEC-231 / SEC-232 — inyección de fórmulas en CSV. Excel y LibreOffice
// ejecutan como fórmula una celda que empieza por = + - @ (y, según versión, por
// tabulador o retorno de carro). Un motivo de ausencia que escribe cualquier
// empleado, `=HYPERLINK("http://…";"Ver")`, se convertía en un enlace activo en
// el Excel de quien exportaba el Registro General.

describe('escaparCeldaCsv', () => {
  it.each([
    ['=HYPERLINK("http://x";"Ver")', `"'=HYPERLINK(""http://x"";""Ver"")"`],
    ['+1', "'+1"],
    ['-2', "'-2"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tTAB', "'\tTAB"],
  ])('neutraliza un texto que Excel leería como fórmula: %j', (entrada, salida) => {
    expect(escaparCeldaCsv(entrada)).toBe(salida);
  });

  it('el retorno de carro inicial también se neutraliza, y además obliga a entrecomillar', () => {
    expect(escaparCeldaCsv('\r=1+1')).toBe(`"'\r=1+1"`);
  });

  it('un NÚMERO negativo no se toca: es un dato, no una fórmula', () => {
    // Calibraciones exporta interceptos negativos: con la comilla delante Excel
    // los leería como texto y la columna dejaría de sumar.
    expect(escaparCeldaCsv(-0.00123)).toBe('-0.00123');
    expect(escaparCeldaCsv(-5)).toBe('-5');
  });

  it('entrecomilla según RFC 4180 si hay comillas, separador o saltos de línea', () => {
    expect(escaparCeldaCsv('dice "hola"')).toBe('"dice ""hola"""');
    expect(escaparCeldaCsv('uno;dos')).toBe('"uno;dos"');
    expect(escaparCeldaCsv('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"');
  });

  it('el separador es configurable: con coma, el punto y coma ya no obliga a comillas', () => {
    expect(escaparCeldaCsv('uno;dos', ',')).toBe('uno;dos');
    expect(escaparCeldaCsv('uno,dos', ',')).toBe('"uno,dos"');
  });

  it('null y undefined son celda vacía; un texto normal sale igual', () => {
    expect(escaparCeldaCsv(null)).toBe('');
    expect(escaparCeldaCsv(undefined)).toBe('');
    expect(escaparCeldaCsv('Vacaciones de agosto')).toBe('Vacaciones de agosto');
    expect(escaparCeldaCsv('2026-10-19')).toBe('2026-10-19');
  });
});
