import { describe, it, expect } from 'vitest';
import { PAGE_SIZE, totalPages, pageSlice, pageRange } from './pagination';

const items = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('PAGE_SIZE', () => {
  it('es 50', () => {
    expect(PAGE_SIZE).toBe(50);
  });
});

describe('totalPages', () => {
  it('devuelve 1 con cero registros: no existe «página 0 de 0»', () => {
    expect(totalPages(0)).toBe(1);
  });

  it('devuelve 1 cuando cabe justo en una página', () => {
    expect(totalPages(1)).toBe(1);
    expect(totalPages(50)).toBe(1);
  });

  it('abre una página nueva al pasarse por uno', () => {
    expect(totalPages(51)).toBe(2);
  });

  it('calcula bien el dataset completo', () => {
    expect(totalPages(19056)).toBe(382);
  });
});

describe('pageSlice', () => {
  it('devuelve las primeras 50 en la página 1', () => {
    const res = pageSlice(items(120), 1);
    expect(res).toHaveLength(50);
    expect(res[0]).toBe(1);
    expect(res[49]).toBe(50);
  });

  it('devuelve el bloque siguiente en la página 2', () => {
    const res = pageSlice(items(120), 2);
    expect(res[0]).toBe(51);
    expect(res[49]).toBe(100);
  });

  it('la última página puede venir incompleta', () => {
    expect(pageSlice(items(120), 3)).toHaveLength(20);
    expect(pageSlice(items(120), 3)[0]).toBe(101);
  });

  it('devuelve vacío si no hay registros', () => {
    expect(pageSlice([], 1)).toEqual([]);
  });

  // Red de seguridad: quien devuelve a la página 1 al filtrar es el useEffect de
  // Buscador. Esto solo evita que un índice inválido deje la tabla en blanco.
  it('acota una página por encima del rango a la última válida', () => {
    expect(pageSlice(items(120), 99)).toEqual(pageSlice(items(120), 3));
  });

  it('acota una página por debajo del rango a la primera', () => {
    expect(pageSlice(items(120), 0)).toEqual(pageSlice(items(120), 1));
    expect(pageSlice(items(120), -5)).toEqual(pageSlice(items(120), 1));
  });
});

describe('pageRange', () => {
  it('describe el bloque visible de la página 1', () => {
    expect(pageRange(120, 1)).toEqual({ desde: 1, hasta: 50 });
  });

  it('recorta el final en la última página incompleta', () => {
    expect(pageRange(120, 3)).toEqual({ desde: 101, hasta: 120 });
  });

  it('devuelve un rango vacío sin registros', () => {
    expect(pageRange(0, 1)).toEqual({ desde: 0, hasta: 0 });
  });
});
