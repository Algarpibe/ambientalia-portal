import { Suspense } from 'react';
import { X } from 'lucide-react';
import type { WidgetDescriptor } from '../widgets/types';
import WidgetErrorBoundary from './WidgetErrorBoundary';
import WidgetSkeleton from './WidgetSkeleton';

// Celda del grid: encapsula un widget con su cabecera, el botón de eliminar (en
// modo edición), un Suspense para su carga y un ErrorBoundary para aislar fallos.

interface Props {
  descriptor: WidgetDescriptor;
  editMode: boolean;
  onRemove: () => void;
}

export default function WidgetCell({ descriptor, editMode, onRemove }: Props) {
  const Widget = descriptor.component;
  return (
    <div className="h-full w-full bg-white rounded-2xl border border-gray-200 shadow-soft flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 shrink-0">
        <h3 className="text-sm font-semibold text-gray-700 truncate">{descriptor.name}</h3>
        {editMode && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Eliminar ${descriptor.name}`}
            className="widget-no-drag p-1 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3">
        <WidgetErrorBoundary widgetId={descriptor.id} appId={descriptor.appId} widgetName={descriptor.name}>
          <Suspense fallback={<WidgetSkeleton />}>
            <Widget />
          </Suspense>
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}
