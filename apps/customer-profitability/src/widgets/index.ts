import type { WidgetDescriptor } from '../../../portal/src/widgets/types';
import SummaryWidget from './SummaryWidget';
import TopBrandsWidget from './TopBrandsWidget';

// Widgets que esta app expone al Dashboard del Portal. El Portal los descubre
// vía import dinámico (portal/src/widgets/registry.ts).

const widgets: WidgetDescriptor[] = [
  {
    id: 'customer-profitability-summary',
    appId: 'customer-profitability',
    name: 'Resumen de Rentabilidad',
    description: 'Facturación, margen y % de margen consolidados del periodo.',
    defaultSize: { w: 4, h: 3 },
    component: SummaryWidget,
  },
  {
    id: 'customer-profitability-top-brands',
    appId: 'customer-profitability',
    name: 'Top Marcas por Ventas',
    description: 'Ranking de las marcas con mayor facturación.',
    defaultSize: { w: 5, h: 4 },
    component: TopBrandsWidget,
  },
];

export default widgets;
