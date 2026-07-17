import type { WidgetDescriptor } from '../../../portal/src/widgets/types';
import SummaryWidget from './SummaryWidget';
import SegmentDistributionWidget from './SegmentDistributionWidget';

// Widgets que esta app expone al Dashboard del Portal. El Portal los descubre
// vía import dinámico (portal/src/widgets/registry.ts).

const widgets: WidgetDescriptor[] = [
  {
    id: 'customer-valuation-summary',
    appId: 'customer-valuation',
    name: 'Resumen de Valoración',
    description: 'Clientes totales, cartera Premium, clientes de alto riesgo y valor total.',
    defaultSize: { w: 4, h: 3 },
    component: SummaryWidget,
  },
  {
    id: 'customer-valuation-segments',
    appId: 'customer-valuation',
    name: 'Distribución por Segmento',
    description: 'Reparto de la cartera entre Premium, Condicionado, Estándar y Restringido.',
    defaultSize: { w: 4, h: 4 },
    component: SegmentDistributionWidget,
  },
];

export default widgets;
