import type { WidgetDescriptor } from '../../../portal/src/widgets/types';
import WidgetSaldo from './WidgetSaldo';
import WidgetPendientes from './WidgetPendientes';

// Widgets que esta app expone al Dashboard del Portal. El Portal los descubre
// vía import dinámico (portal/src/widgets/registry.ts).

const widgets: WidgetDescriptor[] = [
  {
    // ⚠️ El `id` NO se toca aunque el widget cambie de nombre. Vive en el
    // localStorage de cada usuario como `LayoutItem.widgetId`, y `WidgetGrid`
    // filtra con `byId.has(...)`: renombrarlo haría desaparecer el widget del
    // panel de todo el que ya lo tenga anclado, sin error y sin aviso.
    id: 'ausencias-mi-saldo',
    appId: 'ausencias',
    name: 'Mis saldos',
    description: 'Días de vacaciones y de compensatorios disponibles a día de hoy.',
    defaultSize: { w: 4, h: 3 },
    component: WidgetSaldo,
  },
  {
    id: 'ausencias-por-aprobar',
    appId: 'ausencias',
    name: 'Solicitudes por aprobar',
    description: 'Vacaciones y permisos que esperan tu firma.',
    // 4×3, el mismo que el hermano. El tamaño hay que acertarlo a la primera:
    // `addWidget` copia `defaultSize` al layout que se persiste en el
    // localStorage de cada usuario, así que subirlo más tarde no arregla a
    // quien ya lo tenga añadido.
    defaultSize: { w: 4, h: 3 },
    component: WidgetPendientes,
  },
];

export default widgets;
