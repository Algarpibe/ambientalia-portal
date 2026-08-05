// Lógica de negocio de la app Contabilidad (sin BD). Reproduce la aritmética del
// Excel Contabilidad_muestra. Ver relaciones confirmadas contra una factura real:
//   TOTAL($) = sub_total (sin IVA); TOTAL+IVA = total; IVA = raw.tax_total.
//   porCobrar = balance; retenciones = raw.tax_amount_withheld.
//   cobrado% = 1 - balance/total; cobrado$ = total - balance - retenciones.

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v));

/** Fila cruda tal como la devuelve el SQL (numéricos de raw llegan como texto). */
export interface FacturaRawRow {
  invoice_number: string;
  reference_number: string | null;
  customer_name: string | null;
  date: string;
  due_date: string | null;
  status: string | null;
  sub_total: number | null;   // columna sub_total (llega como número por el parser del pool)
  total: number | null;       // columna total (con IVA)
  iva: string | null;         // raw->>'tax_total' (texto)
  balance: string | null;     // raw->>'balance' (texto)
  retenciones: string | null; // raw->>'tax_amount_withheld' (texto)
  deal_name: string | null;   // crm.deals.deal_name (puede faltar)
  ticket_number: string | null; // crm.deals.numero_ticket (puede faltar)
  qt: string | null;          // crm.quotes.no_cotizacion de la última cotización del deal
  unidades_por_despachar: number | string | null; // de la OV de la factura (0 si no queda nada)
  synced_at: string | null;
}

/** Factura ya calculada que consume el frontend. */
export interface FacturaContable {
  invoiceNumber: string;
  razonSocial: string;
  qt: string;
  fechaFactura: string;
  fechaVencimiento: string;
  ov: string;
  trato: string;
  ticket: string;
  total: number;        // sin IVA (Excel TOTAL$)
  iva: number;
  totalConIva: number;  // Excel TOTAL+IVA
  cobradoPct: number;   // 0..1
  cobrado: number;
  porCobrar: number;
  retenciones: number;
  participacion: number; // 0..1 (se asigna en withParticipacion)
  cartera: string;       // override manual
  /** Unidades de la OV de esta factura que aún NO se han despachado (>0 = entrega pendiente). */
  unidadesPorDespachar: number;
}

export function mapFacturaRow(row: FacturaRawRow, overrides: Map<string, string>): FacturaContable {
  const totalConIva = num(row.total);
  const porCobrar = num(row.balance);
  const retenciones = num(row.retenciones);
  const cobradoPct = totalConIva > 0 ? (totalConIva - porCobrar) / totalConIva : 0;
  const cobrado = totalConIva - porCobrar - retenciones;
  return {
    invoiceNumber: str(row.invoice_number),
    razonSocial: str(row.customer_name),
    qt: str(row.qt), // nº de la última cotización del deal (crm.quotes.no_cotizacion)
    fechaFactura: str(row.date),
    fechaVencimiento: str(row.due_date),
    ov: str(row.reference_number),
    trato: str(row.deal_name),
    ticket: str(row.ticket_number),
    total: num(row.sub_total),
    iva: num(row.iva),
    totalConIva,
    cobradoPct,
    cobrado,
    porCobrar,
    retenciones,
    participacion: 0,
    cartera: overrides.get(str(row.invoice_number)) ?? '',
    unidadesPorDespachar: num(row.unidades_por_despachar),
  };
}

/** De-dupe por invoice_number (facturas fantasma), quedándose con el synced_at más reciente. */
export function dedupeByInvoiceNumber(rows: FacturaRawRow[]): FacturaRawRow[] {
  const best = new Map<string, FacturaRawRow>();
  for (const r of rows) {
    const prev = best.get(r.invoice_number);
    if (!prev || str(r.synced_at) > str(prev.synced_at)) best.set(r.invoice_number, r);
  }
  return [...best.values()];
}

/** Asigna %participación = totalConIva de la factura / suma de totalConIva. */
export function withParticipacion(facturas: FacturaContable[]): FacturaContable[] {
  const suma = facturas.reduce((acc, f) => acc + f.totalConIva, 0);
  return facturas.map((f) => ({ ...f, participacion: suma > 0 ? f.totalConIva / suma : 0 }));
}

export interface ResumenMes {
  mes: number; // 1..12
  facturacion: number; // subtotal sin IVA del mes
  iva: number;
  acumulado: number; // subtotal acumulado del año hasta ese mes
}

export interface Resumen {
  meses: ResumenMes[];
  totalFacturadoSinIva: number;
  totalIva: number;
  presupuesto: number | null;
  cumplimientoPct: number | null; // null si no hay presupuesto
  comparativos: { anio: number; facturado: number }[]; // años anteriores, mayor→menor
}

/**
 * Resumen mensual/anual del año `anio`. El detalle mensual usa el SUBTOTAL sin IVA
 * (f.total). `presupuesto` viene de la config por año (null si no hay). Los
 * comparativos son el facturado de años anteriores presentes en `facturadoPorAnio`.
 */
export function buildResumen(
  facturas: FacturaContable[],
  anio: number,
  presupuesto: number | null,
  facturadoPorAnio: Record<number, number>,
): Resumen {
  const meses: ResumenMes[] = Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1,
    facturacion: 0,
    iva: 0,
    acumulado: 0,
  }));
  for (const f of facturas) {
    const m = Number(f.fechaFactura.slice(5, 7));
    if (m >= 1 && m <= 12) {
      meses[m - 1].facturacion += f.total;
      meses[m - 1].iva += f.iva;
    }
  }
  let acc = 0;
  for (const mes of meses) {
    acc += mes.facturacion;
    mes.acumulado = acc;
  }
  const totalFacturadoSinIva = meses.reduce((a, m) => a + m.facturacion, 0);
  const totalIva = meses.reduce((a, m) => a + m.iva, 0);
  const comparativos = Object.entries(facturadoPorAnio)
    .map(([y, facturado]) => ({ anio: Number(y), facturado }))
    .filter((c) => c.anio < anio)
    .sort((a, b) => b.anio - a.anio);
  return {
    meses,
    totalFacturadoSinIva,
    totalIva,
    presupuesto,
    cumplimientoPct: presupuesto && presupuesto > 0 ? totalFacturadoSinIva / presupuesto : null,
    comparativos,
  };
}
