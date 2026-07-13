// Derivaciones/KPIs puros de GeneralAnalysis (ARQ-001). Se extrajeron de los
// useMemo del componente sin cambiar la lógica, para poder testearlos de forma
// aislada (varios son cálculos financieros: DSO, recovery, variación de ingreso).
import type { ReconciledRow, CustomerMetrics, DateRangeOption } from '../types';
import { parseExcelDate, getPreviousPeriodBounds, getDateRangeBounds } from '../customerAnalysisUtils';

export interface ExtraFilters {
  selectedPaymentStatus: string[];
  minAmount: string;
  maxAmount: string;
}

export interface MetricsFilters {
  selectedCustomer: string;
  searchTerm: string;
  dpdMin: string;
  dpdMax: string;
  onTimeMin: string;
  onTimeMax: string;
  sortConfig: { key: string; direction: 'asc' | 'desc' } | null;
}

export interface OverdueMetrics {
  customerCount: number;
  invoiceCount: number;
  totalAmount: number;
}

export interface RetentionMetrics {
  newCustomers: number;
  recurringCustomers: number;
  retentionRate: number;
}

/** Filtros de estado de pago + rango de monto que se aplican sobre la data ya
 * filtrada por fecha. */
export function applyExtraFilters(data: ReconciledRow[], f: ExtraFilters): ReconciledRow[] {
  let out = data;

  if (f.selectedPaymentStatus.length > 0) {
    out = out.filter((row) => {
      let status = 'pending';
      if (row.balance === 0) status = 'paid';
      else if (row.balance < row.total) status = 'partial';
      return f.selectedPaymentStatus.includes(status);
    });
  }

  if (f.minAmount || f.maxAmount) {
    out = out.filter((row) => {
      const min = f.minAmount ? parseFloat(f.minAmount) : 0;
      const max = f.maxAmount ? parseFloat(f.maxAmount) : Infinity;
      return row.total >= min && row.total <= max;
    });
  }

  return out;
}

/** Filtra por cliente/búsqueda/rangos DPD/on-time y ordena por sortConfig. */
export function filterAndSortMetrics(metrics: CustomerMetrics[], f: MetricsFilters): CustomerMetrics[] {
  let result = metrics.filter((m) => f.selectedCustomer === 'all' || m.customerName === f.selectedCustomer);

  const term = f.searchTerm.trim().toLowerCase();
  if (term) {
    result = result.filter((m) => m.customerName.toLowerCase().includes(term));
  }

  if (f.dpdMin) {
    const minVal = parseFloat(f.dpdMin);
    result = result.filter((m) => m.averageDPD !== null && m.averageDPD >= minVal);
  }
  if (f.dpdMax) {
    const maxVal = parseFloat(f.dpdMax);
    result = result.filter((m) => m.averageDPD !== null && m.averageDPD <= maxVal);
  }

  if (f.onTimeMin) {
    const minVal = parseFloat(f.onTimeMin);
    result = result.filter((m) => m.onTimePercentage !== null && m.onTimePercentage >= minVal);
  }
  if (f.onTimeMax) {
    const maxVal = parseFloat(f.onTimeMax);
    result = result.filter((m) => m.onTimePercentage !== null && m.onTimePercentage <= maxVal);
  }

  if (f.sortConfig) {
    const sc = f.sortConfig;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result.sort((a: any, b: any) => {
      let valA = a[sc.key];
      let valB = b[sc.key];
      if (valA === null) return 1;
      if (valB === null) return -1;
      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }
      if (valA < valB) return sc.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sc.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  return result;
}

/** Suma del total facturado en el conjunto. */
export function computeTotalReconciled(data: ReconciledRow[]): number {
  return data.reduce((sum, invoice) => sum + invoice.total, 0);
}

/** Total facturado del periodo anterior equivalente (0 si no aplica). */
export function computePreviousPeriodAmount(
  reconciledData: ReconciledRow[],
  dateRange: DateRangeOption,
  customStartDate: string,
  customEndDate: string,
): number {
  if (dateRange === 'all' || dateRange === 'custom') return 0;

  const prevBounds = getPreviousPeriodBounds(dateRange, customStartDate, customEndDate);
  if (!prevBounds.start || !prevBounds.end) return 0;

  return reconciledData
    .filter((invoice) => {
      const invoiceDate = invoice.invoiceDate instanceof Date ? invoice.invoiceDate : parseExcelDate(invoice.invoiceDate);
      if (!invoiceDate) return false;
      return invoiceDate >= prevBounds.start! && invoiceDate <= prevBounds.end!;
    })
    .reduce((sum, invoice) => sum + invoice.total, 0);
}

/** Variación % de ingreso vs periodo anterior (null si no hay base). */
export function computeRevenueVariation(total: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((total - previous) / previous) * 100;
}

/** % de facturas con al menos un pago registrado. */
export function computeRecoveryRate(data: ReconciledRow[]): number {
  const totalInvoices = data.length;
  if (totalInvoices === 0) return 0;
  const invoicesWithPayments = data.filter((inv) => inv.paymentDetails && inv.paymentDetails.length > 0).length;
  return (invoicesWithPayments / totalInvoices) * 100;
}

/** DSO promedio: días entre vencimiento y último pago (redondeado). */
export function computeAverageDSO(data: ReconciledRow[]): number {
  const invoicesWithPayments = data.filter((inv) => inv.paymentDetails && inv.paymentDetails.length > 0);
  if (invoicesWithPayments.length === 0) return 0;

  const totalDays = invoicesWithPayments.reduce((sum, invoice) => {
    const dueDate = invoice.dueDate instanceof Date ? invoice.dueDate : parseExcelDate(invoice.dueDate);
    if (!dueDate || !invoice.paymentDetails || invoice.paymentDetails.length === 0) return sum;

    const lastPaymentDateStr = invoice.paymentDetails[invoice.paymentDetails.length - 1].date;
    let paymentDate: Date | null = null;
    if (lastPaymentDateStr) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = parseExcelDate(lastPaymentDateStr as any);
      if (parsed instanceof Date && !isNaN(parsed.getTime())) paymentDate = parsed;
    }
    if (!paymentDate) return sum;

    const daysToPayment = Math.round((paymentDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    return sum + daysToPayment;
  }, 0);

  return Math.round(totalDays / invoicesWithPayments.length);
}

/** Clientes/facturas/monto en mora (isOverdue con saldo pendiente). */
export function computeOverdueMetrics(data: ReconciledRow[]): OverdueMetrics {
  const overdueInvoices = data.filter((invoice) => invoice.isOverdue && invoice.balance > 0);
  const overdueClientsSet = new Set(overdueInvoices.map((invoice) => invoice.clientName));
  const totalOverdueAmount = overdueInvoices.reduce((sum, invoice) => sum + invoice.balance, 0);
  return {
    customerCount: overdueClientsSet.size,
    invoiceCount: overdueInvoices.length,
    totalAmount: totalOverdueAmount,
  };
}

/** Top-N clientes por volumen facturado (descendente). */
export function computeTopCustomersByVolume(
  data: ReconciledRow[],
  limit = 10,
): { name: string; total: number }[] {
  const customerTotals = new Map<string, number>();
  data.forEach((invoice) => {
    if (!invoice.clientName || invoice.clientName.trim() === '') return;
    const current = customerTotals.get(invoice.clientName) || 0;
    customerTotals.set(invoice.clientName, current + invoice.total);
  });
  return Array.from(customerTotals.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/** Clientes nuevos vs recurrentes en el periodo y tasa de retención. */
export function computeCustomerRetention(
  reconciledData: ReconciledRow[],
  filteredData: ReconciledRow[],
  dateRange: DateRangeOption,
  customStartDate: string,
  customEndDate: string,
): RetentionMetrics {
  const { start } = getDateRangeBounds(dateRange, customStartDate, customEndDate);
  const currentPeriodCustomers = new Set(filteredData.map((invoice) => invoice.clientName));

  if (!start || currentPeriodCustomers.size === 0) {
    return { newCustomers: 0, recurringCustomers: 0, retentionRate: 0 };
  }

  const recurringCustomers = new Set<string>();
  const newCustomers = new Set<string>();

  currentPeriodCustomers.forEach((customerName) => {
    const hadPreviousInvoices = reconciledData.some((invoice) => {
      if (invoice.clientName !== customerName) return false;
      const invoiceDate = invoice.invoiceDate instanceof Date ? invoice.invoiceDate : parseExcelDate(invoice.invoiceDate);
      return invoiceDate && invoiceDate < start;
    });
    if (hadPreviousInvoices) recurringCustomers.add(customerName);
    else newCustomers.add(customerName);
  });

  const retentionRate = currentPeriodCustomers.size > 0
    ? (recurringCustomers.size / currentPeriodCustomers.size) * 100
    : 0;

  return {
    newCustomers: newCustomers.size,
    recurringCustomers: recurringCustomers.size,
    retentionRate,
  };
}
