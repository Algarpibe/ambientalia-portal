import { describe, it, expect } from 'vitest';
import { mergeColumnOrder, pruneColumnVisibility } from './columnConfig';
import type { ColumnConfig } from '../components/SortableColumnItem';

const defaults: Record<string, ColumnConfig[]> = {
  main: [
    { key: 'sku', label: 'SKU' },
    { key: 'reorderPoint', label: 'PdP Propuesto' },
    { key: 'coverageDays', label: 'Cobertura (Días)' },
  ],
  urgent: [{ key: 'sku', label: 'SKU' }],
};

describe('mergeColumnOrder', () => {
  it('purga una columna retirada del código', () => {
    // Regresión real: el "# OC" (leadTimeN) se borró del código y seguía saliendo,
    // porque la migración solo sabía añadir.
    const saved = {
      main: [
        { key: 'sku', label: 'SKU' },
        { key: 'leadTimeN', label: '# OC' },
        { key: 'reorderPoint', label: 'PdP Propuesto' },
        { key: 'coverageDays', label: 'Cobertura (Días)' },
      ],
      urgent: [{ key: 'sku', label: 'SKU' }],
    };
    expect(mergeColumnOrder(saved, defaults).main.map((c) => c.key))
      .toEqual(['sku', 'reorderPoint', 'coverageDays']);
  });

  it('la etiqueta manda desde el código, no desde lo guardado', () => {
    // Regresión real: el usuario no puede renombrar columnas (solo mostrar/ocultar y
    // reordenar), así que conservar la etiqueta guardada dejaba el renombrado fuera
    // del alcance de quien ya tenía config — se veía "Existencias" tras renombrarla.
    const saved = { main: [{ key: 'reorderPoint', label: 'Nombre viejo' }] };
    expect(mergeColumnOrder(saved, defaults).main[0].label).toBe('PdP Propuesto');
  });

  it('respeta el orden que el usuario guardó', () => {
    const saved = {
      main: [
        { key: 'coverageDays', label: 'Cobertura (Días)' },
        { key: 'sku', label: 'SKU' },
        { key: 'reorderPoint', label: 'PdP Propuesto' },
      ],
    };
    expect(mergeColumnOrder(saved, defaults).main.map((c) => c.key))
      .toEqual(['coverageDays', 'sku', 'reorderPoint']);
  });

  it('añade al final las columnas nuevas del código', () => {
    const saved = { main: [{ key: 'sku', label: 'SKU' }] };
    expect(mergeColumnOrder(saved, defaults).main.map((c) => c.key))
      .toEqual(['sku', 'reorderPoint', 'coverageDays']);
  });

  it('una pestaña sin config guardada usa los defaults', () => {
    expect(mergeColumnOrder({ main: [] }, defaults).urgent.map((c) => c.key)).toEqual(['sku']);
  });

  it('descarta pestañas que ya no existen', () => {
    const saved = { main: [{ key: 'sku', label: 'SKU' }], obsoleta: [{ key: 'x', label: 'X' }] };
    expect(Object.keys(mergeColumnOrder(saved, defaults))).toEqual(['main', 'urgent']);
  });
});

describe('pruneColumnVisibility', () => {
  it('descarta las columnas que ya no existen', () => {
    const saved = { main: ['sku', 'leadTimeN', 'reorderPoint'], urgent: ['sku'] };
    expect([...pruneColumnVisibility(saved, defaults).main]).toEqual(['sku', 'reorderPoint']);
  });

  it('respeta las columnas que el usuario ocultó', () => {
    // 'coverageDays' no está en la lista de visibles → sigue oculta.
    const saved = { main: ['sku', 'reorderPoint'] };
    expect(pruneColumnVisibility(saved, defaults).main.has('coverageDays')).toBe(false);
  });

  it('una pestaña sin config guardada arranca con todo visible', () => {
    expect([...pruneColumnVisibility({}, defaults).main]).toEqual(['sku', 'reorderPoint', 'coverageDays']);
  });

  it('descarta pestañas que ya no existen', () => {
    const saved = { main: ['sku'], obsoleta: ['x'] };
    expect(Object.keys(pruneColumnVisibility(saved, defaults))).toEqual(['main', 'urgent']);
  });
});
