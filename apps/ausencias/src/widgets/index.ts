import type { WidgetDescriptor } from '../../../portal/src/widgets/types';
import WidgetSaldo from './WidgetSaldo';

// Widgets que esta app expone al Dashboard del Portal. El Portal los descubre
// vía import dinámico (portal/src/widgets/registry.ts).

const widgets: WidgetDescriptor[] = [
  {
    id: 'ausencias-mi-saldo',
    appId: 'ausencias',
    name: 'Mi saldo de vacaciones',
    description: 'Días de vacaciones disponibles a día de hoy.',
    defaultSize: { w: 3, h: 2 },
    component: WidgetSaldo,
  },
];

export default widgets;
