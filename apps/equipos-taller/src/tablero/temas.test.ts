// Tokens de color del tablero: contraste de cada par texto/fondo en día y noche, y el CSS que se emite.
import { describe, expect, it } from 'vitest';
import { PARES_TEXTO, TEMAS, contraste, cssTemas, violaciones, type Tema, type Token } from './temas';

describe('contraste()', () => {
  it('negro sobre blanco es 21:1 y un color sobre sí mismo es 1:1', () => {
    expect(contraste('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contraste('#475569', '#475569')).toBeCloseTo(1, 5);
  });
});

describe('contraste de los pares de texto', () => {
  it.each(['dia', 'noche'] as Tema[])('tema %s: todos los pares cumplen su umbral', (tema) => {
    expect(violaciones(TEMAS[tema])).toEqual([]);
  });

  it('un par por debajo del umbral falla nombrando el par', () => {
    const malo = { ...TEMAS.dia, 'dias-verde': '#86EFAC' };
    const v = violaciones(malo);
    expect(v.map((x) => x.par)).toContain('tx-dias-verde sobre dias-verde');
    expect(v.find((x) => x.par === 'tx-dias-verde sobre dias-verde')!.razon).toBeLessThan(4.5);
  });

  it('desde 24 px basta 3:1: el mismo par pasa en un texto grande y falla en uno pequeño', () => {
    const pares = [
      { fg: 'kpi-rojo', bg: 'kpi', px: 48 },
      { fg: 'kpi-rojo', bg: 'kpi', px: 20 },
    ] as const;
    const v = violaciones({ ...TEMAS.dia, kpi: '#F3F5F8', 'kpi-rojo': '#DC2626' }, pares);
    expect(v).toHaveLength(1);
    expect(v[0].minimo).toBe(4.5);
  });

  it('enumera las seis columnas, los seis avatares y las etiquetas en los dos temas', () => {
    const nombres = PARES_TEXTO.map((p) => p.fg + ' sobre ' + p.bg);
    for (const e of ['entrada', 'diagnostico', 'notificacion', 'proceso', 'externo', 'entregar']) expect(nombres).toContain('tx-estado sobre est-' + e);
    for (let i = 0; i < 6; i++) expect(nombres).toContain('tx-av sobre av-' + i);
    expect(nombres).toContain('tx-etiqueta sobre etiqueta');
    expect(new Set(Object.keys(TEMAS.dia))).toEqual(new Set(Object.keys(TEMAS.noche)));
  });

  it('fija los colores añadidos por el diseño (sexta columna, avatares extra y gris de los huecos del día)', () => {
    expect(TEMAS.noche['est-entrada']).toBe('#CBD5E1');
    expect(TEMAS.dia['est-entrada']).toBe('#475569');
    expect([2, 3, 4, 5].map((i) => TEMAS.noche[('av-' + i) as Token])).toEqual(['#F9A8D4', '#FDBA74', '#5EEAD4', '#BEF264']);
    expect([2, 3, 4, 5].map((i) => TEMAS.dia[('av-' + i) as Token])).toEqual(['#BE185D', '#C2410C', '#0F766E', '#4D7C0F']);
    expect(TEMAS.dia['tx-vacio']).toBe('#4B5563');
  });
});

describe('cssTemas()', () => {
  const css = cssTemas();
  it('emite los tres temas acotados a la raíz del tablero, sin tocar :root', () => {
    expect(css).toContain('.tt-tablero[data-tema="dia"]');
    expect(css).toContain('.tt-tablero[data-tema="noche"]');
    expect(css).toContain('.tt-tablero[data-tema="sistema"]');
    expect(css).not.toContain(':root');
    expect(css).toContain('--tt-fondo:' + TEMAS.noche.fondo);
    expect(css).toContain('--tt-fondo:' + TEMAS.dia.fondo);
  });
  it('el tema del sistema pasa a noche dentro de prefers-color-scheme: dark', () => {
    const i = css.indexOf('@media (prefers-color-scheme: dark)');
    expect(i).toBeGreaterThan(-1);
    expect(css.slice(i)).toContain('.tt-tablero[data-tema="sistema"]{');
    expect(css.slice(i)).toContain('--tt-fondo:' + TEMAS.noche.fondo);
  });
  it('el cambio de tema se desvanece en 400 ms y se apaga con prefers-reduced-motion', () => {
    expect(css).toMatch(/transition:[^;}]*400ms/);
    const i = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(i).toBeGreaterThan(-1);
    expect(css.slice(i)).toContain('transition:none');
  });
});
