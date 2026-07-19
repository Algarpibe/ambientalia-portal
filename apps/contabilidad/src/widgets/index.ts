import type { WidgetDescriptor } from '../../../portal/src/widgets/types';
import OVPendientesWidget from './OVPendientesWidget';

// Widgets que la app Contabilidad expone al dashboard del portal. El portal los
// descubre vía apps/portal/src/widgets/registry.ts (clave 'contabilidad').
const widgets: WidgetDescriptor[] = [
  {
    id: 'contabilidad-ov-pendientes',
    appId: 'contabilidad',
    name: 'OV pendientes de facturar',
    description: 'Órdenes de venta por facturar, con indicio de despacho/paquete/ticket y su nº de ticket.',
    defaultSize: { w: 8, h: 6 },
    component: OVPendientesWidget,
  },
];

export default widgets;
