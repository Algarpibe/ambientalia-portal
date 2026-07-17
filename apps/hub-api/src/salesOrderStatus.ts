// Fuente única de verdad de "qué OV está por facturar" (estados vivos de Zoho).
// La comparten WO-sales (genera el archivo de pedidos) y el endpoint de órdenes
// por facturar del Conciliador, para que no puedan contradecirse.
//
// Verificado en la base: open 16, overdue 11, partially_invoiced 6 = 33 OV vivas.
// (invoiced 1073, void 23, draft 1, pending_approval 1 quedan fuera.)
//   - open / overdue        → sin facturar (nada facturado aún)
//   - partially_invoiced    → parcialmente facturada
export const ESTADOS_OV_POR_FACTURAR = ['open', 'overdue', 'partially_invoiced'] as const;

export type EstadoOvPorFacturar = (typeof ESTADOS_OV_POR_FACTURAR)[number];
