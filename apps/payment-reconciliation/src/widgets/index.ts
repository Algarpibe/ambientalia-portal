import type { WidgetDescriptor } from '../../../portal/src/widgets/types';
import SummaryWidget from './SummaryWidget';
import TopPendingWidget from './TopPendingWidget';

// Widgets que esta app expone al Dashboard del Portal. El Portal los descubre
// vía import dinámico (portal/src/widgets/registry.ts).

const widgets: WidgetDescriptor[] = [
  {
    id: 'payment-reconciliation-summary',
    appId: 'payment-reconciliation',
    name: 'Resumen de Conciliación',
    description: 'Facturado, conciliado, pendiente y % conciliado del periodo.',
    defaultSize: { w: 4, h: 3 },
    component: SummaryWidget,
  },
  {
    id: 'payment-reconciliation-top-pending',
    appId: 'payment-reconciliation',
    name: 'Clientes con Mayor Pendiente',
    description: 'Ranking de clientes con mayor saldo pendiente por conciliar.',
    defaultSize: { w: 5, h: 4 },
    component: TopPendingWidget,
  },
];

export default widgets;
