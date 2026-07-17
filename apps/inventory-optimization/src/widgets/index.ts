import type { WidgetDescriptor } from '../../../portal/src/widgets/types';
import SummaryWidget from './SummaryWidget';
import RiskListWidget from './RiskListWidget';

// Widgets que esta app expone al Dashboard del Portal. El Portal los descubre
// vía import dinámico (portal/src/widgets/registry.ts).

const widgets: WidgetDescriptor[] = [
  {
    id: 'inventory-optimization-summary',
    appId: 'inventory-optimization',
    name: 'Resumen de Inventario',
    description: 'SKUs analizados, en riesgo de quiebre, con exceso y capital en inventario.',
    defaultSize: { w: 4, h: 3 },
    component: SummaryWidget,
  },
  {
    id: 'inventory-optimization-risk-list',
    appId: 'inventory-optimization',
    name: 'SKUs en Riesgo de Quiebre',
    description: 'Artículos más críticos por debajo del punto de pedido, con cobertura actual.',
    defaultSize: { w: 4, h: 4 },
    component: RiskListWidget,
  },
];

export default widgets;
