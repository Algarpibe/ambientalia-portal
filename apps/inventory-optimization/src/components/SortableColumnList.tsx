import { DndContext, closestCenter, type DragEndEvent, type SensorDescriptor } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableColumnItem, type ColumnConfig } from './SortableColumnItem';

// Lista arrastrable de columnas (ARQ-001 C): núcleo compartido de los dos
// popovers de configuración (principal e historial), que antes estaba duplicado.
interface SortableColumnListProps {
    columns: ColumnConfig[];
    visibleKeys: Set<string>;
    onToggle: (key: string) => void;
    onDragEnd: (e: DragEndEvent) => void;
    sensors: SensorDescriptor<object>[];
}

export function SortableColumnList({ columns, visibleKeys, onToggle, onDragEnd, sensors }: SortableColumnListProps) {
    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={columns.map((c) => c.key)} strategy={verticalListSortingStrategy}>
                {columns.map((col) => (
                    <SortableColumnItem
                        key={col.key}
                        id={col.key}
                        col={col}
                        isVisible={visibleKeys.has(col.key)}
                        onToggle={onToggle}
                    />
                ))}
            </SortableContext>
        </DndContext>
    );
}
