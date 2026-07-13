import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { SortableColumnItem, type ColumnConfig } from './SortableColumnItem';

// useSortable requiere estar dentro de DndContext + SortableContext.
function renderItem(col: ColumnConfig, isVisible: boolean, onToggle: (k: string) => void) {
  return render(
    <DndContext>
      <SortableContext items={[col.key]}>
        <SortableColumnItem id={col.key} col={col} isVisible={isVisible} onToggle={onToggle} />
      </SortableContext>
    </DndContext>,
  );
}

describe('SortableColumnItem', () => {
  const col: ColumnConfig = { key: 'sku', label: 'SKU' };

  it('muestra la etiqueta de la columna', () => {
    renderItem(col, true, () => {});
    expect(screen.getByText('SKU')).toBeInTheDocument();
  });

  it('al hacer click en el toggle llama onToggle con la key de la columna', () => {
    const onToggle = vi.fn();
    renderItem(col, true, onToggle);
    // dnd-kit pone role="button" también en el handle (un <div>); el toggle real
    // es el elemento <button>.
    const toggle = screen.getAllByRole('button').find((b) => b.tagName === 'BUTTON')!;
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('sku');
  });

  it('atenúa la etiqueta cuando la columna está oculta', () => {
    renderItem(col, false, () => {});
    // oculta → clase de texto gris (text-gray-400) en la etiqueta
    expect(screen.getByText('SKU').className).toContain('text-gray-400');
  });
});
