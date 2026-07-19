import OVPendientes from '../OVPendientes';

// Widget del dashboard: reutiliza la tabla de OV pendientes de facturar (con las
// luces de indicio y la columna Ticket) en modo `bare` — el marco/cabecera los
// pone el WidgetCell del portal. Sin props (contrato de widget); se auto-carga.
export default function OVPendientesWidget() {
  return <OVPendientes bare />;
}
