// apps/hub-api/src/salestracker/types.ts
// Fila de ventas agregada por (categoría Zoho, tipo, mes, año). Contrato del
// endpoint GET /api/salestracker/sales. Espejado en apps/salestracker/src/api.ts.
export type RecordType = 'SALES_ORDER' | 'INVOICE' | 'BACKLOG';

export interface SalesRow {
  categoryName: string;
  recordType: RecordType;
  month: number; // 1-12
  year: number;
  amountUsd: number;
}

// Tipo de registro para las vistas OV/FAC (BACKLOG no aplica a item-sales).
export type RecordTypeIO = 'SALES_ORDER' | 'INVOICE';

// Fila de ventas por artículo. Contrato de GET /api/salestracker/item-sales.
export interface ItemSalesRow {
  itemId: string;
  sku: string | null;
  nombre: string;
  categoria: string | null;
  cantidad: number;
  importe: number;
}
