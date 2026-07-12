// Shared type definitions for the invoice reconciliation and customer analysis application

export type DateRangeOption = 'all' | 'today' | 'thisWeek' | 'thisMonth' | 'thisQuarter' | 'thisYear' | 'yesterday' | 'lastWeek' | 'lastMonth' | 'lastQuarter' | 'lastYear' | 'custom';

export interface InvoiceDetails {
  invoiceNumber: string;
  orderNumber: string;
  clientName: string;
  invoiceDate: any;
  dueDate: any;
  status: string;
  total: number;
  balance: number;
}

export interface PaymentRecord {
  paymentNumber: string;
  clientName: string;
  invoiceNumber: string;
  paymentDate: any;
  amountFCY: number;
  unusedFCY: number;
  amountBCY: number;
  unusedBCY: number;
}

export interface ReconciledRow extends InvoiceDetails {
  paymentDates: string[];
  paymentAmounts: number[];
  totalPaid: number;
  isOverdue: boolean;
  maxDelayDays: number;
  paymentDetails: { date: string; delay: number }[];
}

export interface PaymentBand {
  count: number;
  percentage: number;
  totalValue: number;
}

export interface CustomerMetrics {
  customerName: string;
  totalInvoices: number;
  totalInvoicesWithPayments: number;
  averageDPD: number;
  onTimePercentage: number;
  latePaymentBands: {
    band1_15: PaymentBand;
    band16_30: PaymentBand;
    band31_60: PaymentBand;
    bandOver60: PaymentBand;
  };
  weightedDPD: number;
  volatility: number | null;
  volatilityMora: number | null;
  totalInvoiceValue: number;
}

export interface TrendComparison {
  period: string;
  months: number;
  metrics: CustomerMetrics | null;
  comparison?: {
    dpdChange: number;
    onTimeChange: number;
    volatilityChange: number;
  };
}

export interface CustomerAnalysisResult {
  current: CustomerMetrics;
  trends: {
    last6Months: TrendComparison;
    last12Months: TrendComparison;
    last24Months: TrendComparison;
  };
}
