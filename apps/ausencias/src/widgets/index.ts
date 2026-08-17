import type { WidgetDescriptor } from '../../../portal/src/widgets/types';
import WidgetSaldo from './WidgetSaldo';
import WidgetPendientes from './WidgetPendientes';

// Widgets que esta app expone al Dashboard del Portal. El Portal los descubre
// vía import dinámico (portal/src/widgets/registry.ts).

const widgets: WidgetDescriptor[] = [
  {
    id: 'ausencias-mi-saldo',
    appId: 'ausencias',
    name: 'Mi saldo de vacaciones',
    description: 'Días de vacaciones disponibles a día de hoy.',
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
