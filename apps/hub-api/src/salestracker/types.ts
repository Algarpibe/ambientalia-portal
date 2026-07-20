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

// Fila de ventas por cliente y año. Contrato de GET /api/salestracker/customer-sales.
export interface CustomerYearRow {
  customer: string;
  year: number;
  ventas: number;
}

// Ventas por (cliente, artículo) en un año. GET /api/salestracker/customer-item-sales.
export interface CustomerItemRow {
  customer: string;
  sku: string | null;
  marca: string | null;
  nombre: string;
  categoria: string | null;
  cantidad: number;
  importe: number;
}

// Ventas por (cliente, mes) en un año. GET /api/salestracker/customer-month-sales.
export interface CustomerMonthRow {
  customer: string;
  mes: number; // 1-12
  importe: number;
}

// Ventas y costo estándar por cliente en un año. GET /api/salestracker/margin-by-customer.
export interface MarginCustomerRow {
  customer: string;
  ventas: number;
  costo: number;
}

// Ventas y costo estándar agregados por año (toda la historia). GET /api/salestracker/margin-by-year.
export interface MarginYearRow {
  year: number;
  ventas: number;
  costo: number;
}

// Ventas y costo estándar por artículo en un año. GET /api/salestracker/margin-by-item.
export interface MarginItemRow {
  itemId: string;
  sku: string | null;
  nombre: string;
  ventas: number;
  costo: number;
}

// Ventas por (mes, categoría) en un año. GET /api/salestracker/category-month-sales.
export interface CategoryMonthRow {
  mes: number; // 1-12
  categoria: string | null;
  importe: number;
}
