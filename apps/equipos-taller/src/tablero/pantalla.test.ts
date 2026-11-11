// Reglas puras de la pantalla de TV: escala del lienzo, tema día/noche y fecha larga.
import { describe, expect, it } from 'vitest';
import { AJUSTES_TABLERO_POR_DEFECTO as CFG } from '../nucleo';
import { escalaLienzo, fechaLarga, resolverTema, temaAuto } from './pantalla';

const bogota = (hhmm: string) => Date.parse(`2026-11-11T${hhmm}:00-05:00`);

describe('escalaLienzo', () => {
  it('3840×2160 escala 2 y llena la ventana', () => {
    expect(escalaLienzo(3840, 2160)).toEqual({ escala: 2, x: 0, y: 0 });
  });
  it('1920×1080 escala 1', () => {
    expect(escalaLienzo(1920, 1080)).toEqual({ escala: 1, x: 0, y: 0 });
  });
  it('1280×1024 cabe entero y queda centrado en vertical', () => {
    const e = escalaLienzo(1280, 1024);
    expect(e.escala).toBeCloseTo(1280 / 1920, 6);
    expect(e.x).toBe(0);
    expect(e.y).toBeCloseTo((1024 - 1080 * e.escala) / 2, 6);
  });
  it('una ventana alta y estrecha se centra en horizontal', () => {
    const e = escalaLienzo(1080, 2160);
    expect(e.escala).toBeCloseTo(0.5625, 6);
    expect(e.x).toBe(0);
    expect(e.y).toBeCloseTo((2160 - 607.5) / 2, 6);
  });
  it('una ventana sin tamaño no revienta', () => {
    expect(escalaLienzo(0, 0).escala).toBeGreaterThan(0);
  });
});

describe('temaAuto', () => {
  it('bordes: 17:59 día, 18:00 noche, 05:59 noche, 06:00 día', () => {
    expect(temaAuto(bogota('17:59'), CFG)).toBe('dia');
    expect(temaAuto(bogota('18:00'), CFG)).toBe('noche');
    expect(temaAuto(bogota('05:59'), CFG)).toBe('noche');
    expect(temaAuto(bogota('06:00'), CFG)).toBe('dia');
  });
  it('usa las horas de los ajustes, también con ventana sin cruzar medianoche', () => {
    const a = { ...CFG, nocheDesde: 20, nocheHasta: 5 };
    expect(temaAuto(bogota('19:30'), a)).toBe('dia');
    expect(temaAuto(bogota('20:00'), a)).toBe('noche');
    const b = { ...CFG, nocheDesde: 1, nocheHasta: 4 };
    expect(temaAuto(bogota('02:00'), b)).toBe('noche');
    expect(temaAuto(bogota('12:00'), b)).toBe('dia');
  });
});

describe('resolverTema', () => {
  const madrugada = bogota('03:00');
  it('?tema=dia y ?tema=noche mandan sobre la hora', () => {
    expect(resolverTema('dia', madrugada, CFG)).toBe('dia');
    expect(resolverTema('noche', bogota('12:00'), CFG)).toBe('noche');
  });
  it('auto, ausente o inválido se comportan como auto', () => {
    for (const p of ['auto', null, '', 'otro']) expect(resolverTema(p, madrugada, CFG)).toBe('noche');
    expect(resolverTema('otro', bogota('12:00'), CFG)).toBe('dia');
  });
});

describe('fechaLarga', () => {
  it('fecha larga en español de Bogotá', () => {
    expect(fechaLarga(Date.parse('2026-11-11T20:00:00Z'))).toBe('miércoles 11 de noviembre de 2026');
  });
  it('usa el día de Bogotá, no el UTC', () => {
    expect(fechaLarga(Date.parse('2026-11-12T03:30:00Z'))).toBe('miércoles 11 de noviembre de 2026');
    expect(fechaLarga(Date.parse('2026-01-04T12:00:00Z'))).toBe('domingo 4 de enero de 2026');
  });
});
