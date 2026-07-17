import type { WidgetDescriptor } from '../../../portal/src/widgets/types';
import SummaryWidget from './SummaryWidget';
import RiskListWidget from './RiskListWidget';
import UrgentOrdersWidget from './UrgentOrdersWidget';

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
  {
    id: 'inventory-optimization-urgent-orders',
    appId: 'inventory-optimization',
    name: 'Pedidos Urgentes',
    description: 'Tabla de artículos urgentes por fabricante (existencias, comprometido, disponible).',
    defaultSize: { w: 8, h: 5 },
    component: UrgentOrdersWidget,
  },
];

export default widgets;
