import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortableColumnList } from './SortableColumnList';
import type { ColumnConfig } from './SortableColumnItem';

const columns: ColumnConfig[] = [
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: 'Nombre' },
  { key: 'cost', label: 'Costo' },
];

describe('SortableColumnList', () => {
  it('renderiza un ítem por columna', () => {
    render(
      <SortableColumnList
        columns={columns}
        visibleKeys={new Set(['sku', 'name', 'cost'])}
        onToggle={() => {}}
        onDragEnd={() => {}}
        sensors={[]}
      />,
    );
    expect(screen.getByText('SKU')).toBeInTheDocument();
    expect(screen.getByText('Nombre')).toBeInTheDocument();
    expect(screen.getByText('Costo')).toBeInTheDocument();
  });

  it('propaga onToggle con la key correcta al pulsar un ítem', () => {
    const onToggle = vi.fn();
    render(
      <SortableColumnList
        columns={columns}
        visibleKeys={new Set(['sku'])}
        onToggle={onToggle}
        onDragEnd={() => {}}
        sensors={[]}
      />,
    );
    // el toggle real es un <button> (dnd-kit añade role="button" a los handles)
    const toggles = screen.getAllByRole('button').filter((b) => b.tagName === 'BUTTON');
    fireEvent.click(toggles[1]); // segundo ítem → 'name'
    expect(onToggle).toHaveBeenCalledWith('name');
  });
});
