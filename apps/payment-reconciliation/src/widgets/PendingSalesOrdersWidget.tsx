import SalesOrdersPending from '../SalesOrdersPending';

// Widget del dashboard: la MISMA tabla de "Órdenes por Facturar" de la app, en
// modo `bare` (sin tarjeta propia; la celda del dashboard ya la aporta). Reutiliza
// el componente de la pestaña para que ambas vistas sean idénticas.

export default function PendingSalesOrdersWidget() {
  return <SalesOrdersPending bare />;
}
