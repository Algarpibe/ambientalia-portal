import React from 'react';
import { Eye, EyeOff, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from './ui';

export interface ColumnConfig {
    key: string;
    label: string;
}

interface SortableColumnItemProps {
    id: string;
    col: ColumnConfig;
    isVisible: boolean;
    onToggle: (key: string) => void;
}

// Ítem arrastrable del panel de configuración de columnas (ARQ-001 C):
// alterna visibilidad y sirve de handle de reordenamiento (dnd-kit).
export const SortableColumnItem: React.FC<SortableColumnItemProps> = ({ id, col, isVisible, onToggle }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : undefined,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "flex items-center justify-between p-1.5 hover:bg-gray-50 rounded-md group",
                isDragging && "bg-indigo-50 shadow-md ring-1 ring-indigo-200"
            )}
        >
            <div className="flex items-center gap-2 overflow-hidden">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggle(col.key);
                    }}
                    className={cn(
                        "p-0.5 rounded transition-colors",
                        isVisible
                            ? "text-indigo-600 hover:bg-indigo-50"
                            : "text-gray-300 hover:bg-gray-100"
                    )}
                >
                    {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
                <span className={cn(
                    "text-[11px] truncate select-none",
                    isVisible ? "text-gray-900 font-medium" : "text-gray-400"
                )}>
                    {col.label}
                </span>
            </div>
            <div
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"
            >
                <GripVertical className="w-3.5 h-3.5" />
            </div>
        </div>
    );
};
