import { useMemo, useRef } from 'react';
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { LayoutItem, WidgetDescriptor } from '../widgets/types';
import WidgetCell from './WidgetCell';

// Grid configurable (react-grid-layout). 12 columnas en escritorio; en <768px
// las columnas caen a 1 y los widgets se apilan a ancho completo (Req 3.10).
// El drag/resize solo está activo en modo edición.

const ResponsiveGridLayout = WidthProvider(Responsive);

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const COLS = { lg: 12, md: 12, sm: 12, xs: 1, xxs: 1 };
// Breakpoints donde el layout guardado (12 col) es el vigente y debe persistirse.
const FULL_COL_BREAKPOINTS = new Set(['lg', 'md', 'sm']);

interface Props {
  layoutItems: LayoutItem[];
  widgets: WidgetDescriptor[]; // descriptores de los widgets anclados
  editMode: boolean;
  onLayoutChange: (newLayout: Layout[]) => void;
  onRemoveWidget: (widgetId: string) => void;
}

export default function WidgetGrid({ layoutItems, widgets, editMode, onLayoutChange, onRemoveWidget }: Props) {
  const byId = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets]);
  const breakpointRef = useRef<string>('lg');

  const rglLayout: Layout[] = useMemo(
    () =>
      layoutItems
        .filter((it) => byId.has(it.widgetId))
        .map((it) => ({ i: it.widgetId, x: it.x, y: it.y, w: it.w, h: it.h, minW: 2, minH: 2, maxW: 12, maxH: 10 })),
    [layoutItems, byId],
  );

  const handleLayoutChange = (current: Layout[]) => {
    // Ignora los cambios generados en breakpoints móviles (cols=1) para no
    // machacar el layout de escritorio que el usuario configuró.
    if (!FULL_COL_BREAKPOINTS.has(breakpointRef.current)) return;
    onLayoutChange(current);
  };

  return (
    <ResponsiveGridLayout
      className="layout"
      layouts={{ lg: rglLayout, md: rglLayout, sm: rglLayout }}
      breakpoints={BREAKPOINTS}
      cols={COLS}
      rowHeight={80}
      margin={[24, 24]}
      isDraggable={editMode}
      isResizable={editMode}
      draggableCancel=".widget-no-drag"
      onBreakpointChange={(bp) => {
        breakpointRef.current = bp;
      }}
      onLayoutChange={handleLayoutChange}
    >
      {rglLayout.map((l) => {
        const descriptor = byId.get(l.i);
        if (!descriptor) return null;
        return (
          <div key={l.i} className={editMode ? 'ring-2 ring-blue-400 rounded-2xl' : ''}>
            <WidgetCell descriptor={descriptor} editMode={editMode} onRemove={() => onRemoveWidget(l.i)} />
          </div>
        );
      })}
    </ResponsiveGridLayout>
  );
}
