import type { ReconciledRow, CustomerMetrics, CustomerAnalysisResult, DateRangeOption } from './types';

/**
 * Parse Excel date to Date object
 */
export const parseExcelDate = (val: any): Date | null => {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'number') {
        return new Date((val - 25569) * 86400 * 1000);
    }
    if (typeof val === 'string') {
        const parts = val.split(' ');
        if (parts.length === 3) {
            const months: any = {
                'ene': 0, 'feb': 1, 'mar': 2, 'abr': 3, 'may': 4, 'jun': 5,
                'jul': 6, 'ago': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dic': 11
            };
            const day = parseInt(parts[0]);
            const month = months[parts[1].toLowerCase().substring(0, 3)];
            const year = parseInt(parts[2]);
            if (!isNaN(day) && month !== undefined && !isNaN(year)) {
                return new Date(year, month, day);
            }
        }
        const parsed = new Date(val);
        return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
};

/**
 * Get date range bounds based on selected option
 */
export const getDateRangeBounds = (
    option: DateRangeOption,
    customStartDate: string = '',
    customEndDate: string = ''
): { start: Date | null; end: Date | null } => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (option) {
        case 'today':
            return { start: today, end: new Date(today.getTime() + 86400000 - 1) };

        case 'yesterday':
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            return { start: yesterday, end: new Date(yesterday.getTime() + 86400000 - 1) };

        case 'thisWeek':
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay());
            return { start: weekStart, end: now };

        case 'lastWeek':
            const lastWeekEnd = new Date(today);
            lastWeekEnd.setDate(today.getDate() - today.getDay() - 1);
            const lastWeekStart = new Date(lastWeekEnd);
            lastWeekStart.setDate(lastWeekEnd.getDate() - 6);
            return { start: lastWeekStart, end: lastWeekEnd };

        case 'thisMonth':
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            return { start: monthStart, end: now };

        case 'lastMonth':
            const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
            return { start: lastMonthStart, end: lastMonthEnd };

        case 'thisQuarter':
            const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
            return { start: quarterStart, end: now };

        case 'lastQuarter':
            const lastQuarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 - 3, 1);
            const lastQuarterEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 0);
            return { start: lastQuarterStart, end: lastQuarterEnd };

        case 'thisYear':
            const yearStart = new Date(now.getFullYear(), 0, 1);
            return { start: yearStart, end: now };

        case 'lastYear':
            const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
            const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31);
            return { start: lastYearStart, end: lastYearEnd };

        case 'custom':
            if (customStartDate && customEndDate) {
                return {
                    start: new Date(customStartDate),
                    end: new Date(customEndDate + 'T23:59:59')
                };
            }
            return { start: null, end: null };

        case 'all':
        default:
            return { start: null, end: null };
    }
};

/**
 * Get the previous period's date range based on selected option
 */
export const getPreviousPeriodBounds = (
    option: DateRangeOption,
    customStartDate: string = '',
    customEndDate: string = ''
): { start: Date | null; end: Date | null } => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (option) {
        case 'today':
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            return { start: yesterday, end: new Date(yesterday.getTime() + 86400000 - 1) };

        case 'yesterday':
            const dayBefore = new Date(today);
            dayBefore.setDate(today.getDate() - 2);
            return { start: dayBefore, end: new Date(dayBefore.getTime() + 86400000 - 1) };

        case 'thisWeek':
            const currentWeekStart = new Date(today);
            currentWeekStart.setDate(today.getDate() - today.getDay());
            const lastWeekEnd = new Date(currentWeekStart);
            lastWeekEnd.setDate(currentWeekStart.getDate() - 1);
            const lastWeekStart = new Date(lastWeekEnd);
            lastWeekStart.setDate(lastWeekEnd.getDate() - 6);
            return { start: lastWeekStart, end: lastWeekEnd };

        case 'lastWeek':
            const prevLastWeekEnd = new Date(today);
            prevLastWeekEnd.setDate(today.getDate() - today.getDay() - 8);
            const prevLastWeekStart = new Date(prevLastWeekEnd);
            prevLastWeekStart.setDate(prevLastWeekEnd.getDate() - 6);
            return { start: prevLastWeekStart, end: prevLastWeekEnd };

        case 'thisMonth':
            const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
            return { start: prevMonthStart, end: prevMonthEnd };

        case 'lastMonth':
            const twoMonthsAgoStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
            const twoMonthsAgoEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0);
            return { start: twoMonthsAgoStart, end: twoMonthsAgoEnd };

        case 'thisQuarter':
            const currentQuarterMonth = Math.floor(now.getMonth() / 3) * 3;
            const prevQuarterStart = new Date(now.getFullYear(), currentQuarterMonth - 3, 1);
            const prevQuarterEnd = new Date(now.getFullYear(), currentQuarterMonth, 0);
            return { start: prevQuarterStart, end: prevQuarterEnd };

        case 'lastQuarter':
            const twoQuartersAgoStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 - 6, 1);
            const twoQuartersAgoEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 - 3, 0);
            return { start: twoQuartersAgoStart, end: twoQuartersAgoEnd };

        case 'thisYear':
            const prevYearStart = new Date(now.getFullYear() - 1, 0, 1);
            const prevYearEnd = new Date(now.getFullYear() - 1, 11, 31);
            return { start: prevYearStart, end: prevYearEnd };

        case 'lastYear':
            const twoYearsAgoStart = new Date(now.getFullYear() - 2, 0, 1);
            const twoYearsAgoEnd = new Date(now.getFullYear() - 2, 11, 31);
            return { start: twoYearsAgoStart, end: twoYearsAgoEnd };

        case 'custom':
            if (customStartDate && customEndDate) {
                const start = new Date(customStartDate);
                const end = new Date(customEndDate);
                const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
                const prevEnd = new Date(start);
                prevEnd.setDate(prevEnd.getDate() - 1);
                const prevStart = new Date(prevEnd);
                prevStart.setDate(prevEnd.getDate() - daysDiff);
                return { start: prevStart, end: prevEnd };
            }
            return { start: null, end: null };

        case 'all':
        default:
            return { start: null, end: null };
    }
};

/**
 * Filter reconciled data by a specific date range option
 */
export const getFilteredDataByDate = (
    data: ReconciledRow[],
    option: DateRangeOption,
    customStartDate: string = '',
    customEndDate: string = ''
): ReconciledRow[] => {
    const { start, end } = getDateRangeBounds(option, customStartDate, customEndDate);

    if (!start || !end) {
        return data;
    }

    return data.filter(row => {
        const invoiceDate = row.invoiceDate instanceof Date ? row.invoiceDate : parseExcelDate(row.invoiceDate);
        if (!invoiceDate) return false;
        return invoiceDate >= start && invoiceDate <= end;
    });
};

/**
 * Get color class for DPD Promedio
 */
export const getDPDColor = (dpd: number, isText: boolean = false): string => {
    if (dpd > 40) return isText ? 'text-red-600' : 'bg-red-100 text-red-700 border-red-200';
    if (dpd > 20) return isText ? 'text-orange-600' : 'bg-orange-100 text-orange-700 border-orange-200';
    if (dpd > 5) return isText ? 'text-yellow-600' : 'bg-yellow-100 text-yellow-700 border-yellow-200';
    return isText ? 'text-green-600' : 'bg-green-100 text-green-700 border-green-200';
};

/**
 * Get color class for % On-Time
 */
export const getOnTimeColor = (percentage: number, isText: boolean = false): string => {
    if (percentage > 80) return isText ? 'text-green-600' : 'bg-green-100 text-green-700 border-green-200';
    if (percentage >= 60) return isText ? 'text-yellow-600' : 'bg-yellow-100 text-yellow-700 border-yellow-200';
    if (percentage >= 40) return isText ? 'text-orange-600' : 'bg-orange-100 text-orange-700 border-orange-200';
    return isText ? 'text-red-600' : 'bg-red-100 text-red-700 border-red-200';
};

/**
 * Get color class for Severity
 */
export const getSeverityColor = (severity: number, isText: boolean = false): string => {
    if (severity > 45) return isText ? 'text-red-600' : 'bg-red-100 text-red-700 border-red-200';
    if (severity >= 31) return isText ? 'text-orange-600' : 'bg-orange-100 text-orange-700 border-orange-200';
    if (severity >= 15) return isText ? 'text-yellow-600' : 'bg-yellow-100 text-yellow-700 border-yellow-200';
    return isText ? 'text-green-600' : 'bg-green-100 text-green-700 border-green-200';
};

/**
 * Get color class for Volatility
 */
export const getVolatilityColor = (volatility: number | null, isText: boolean = false): string => {
    if (volatility === null) return isText ? 'text-slate-400' : 'bg-white text-slate-900 border-slate-200';
    if (volatility > 30) return isText ? 'text-red-600' : 'bg-red-100 text-red-700 border-red-200';
    if (volatility >= 21) return isText ? 'text-orange-600' : 'bg-orange-100 text-orange-700 border-orange-200';
    if (volatility >= 10) return isText ? 'text-yellow-600' : 'bg-yellow-100 text-yellow-700 border-yellow-200';
    return isText ? 'text-green-600' : 'bg-green-100 text-green-700 border-green-200';
};

/**
 * Calculate Days Past Due (DPD) for a single payment
 * Returns:
 * - Negative value: payment made before due date (early)
 * - 0: payment made on due date (on time)
 * - Positive value: payment made after due date (late)
 */
export const calculateDPD = (dueDate: Date | null, paymentDate: Date | null): number => {
    if (!dueDate || !paymentDate) return 0;

    const diffTime = paymentDate.getTime() - dueDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
};

/**
 * Calculate DPD for an invoice (considering all payments or current date if unpaid)
 */
export const calculateInvoiceDPD = (invoice: ReconciledRow): number => {
    const dueDate = parseExcelDate(invoice.dueDate);
    if (!dueDate) return 0;

    // If invoice has payments, use the latest payment date
    if (invoice.paymentDetails && invoice.paymentDetails.length > 0) {
        // Find the maximum delay from all payments
        const maxDelay = Math.max(...invoice.paymentDetails.map(pd => pd.delay));
        return maxDelay;
    }

    // If no payments and there's a balance, calculate DPD from current date
    if (invoice.balance > 0) {
        const now = new Date();
        return calculateDPD(dueDate, now);
    }

    return 0;
};

/**
 * Filter reconciled data by date range (in months from now)
 */
export const filterByDateRange = (data: ReconciledRow[], months: number): ReconciledRow[] => {
    const now = new Date();
    const cutoffDate = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());

    return data.filter(invoice => {
        const invoiceDate = parseExcelDate(invoice.invoiceDate);
        return invoiceDate && invoiceDate >= cutoffDate;
    });
};

/**
 * Calculate standard deviation of an array of numbers
 */
const calculateStandardDeviation = (values: number[]): number | null => {
    if (values.length < 2) return null;

    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));

    // Sample variance uses n - 1
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / (values.length - 1);

    return Math.sqrt(variance);
};

/**
 * Analyze customer payment behavior
 */
export const analyzeCustomerPayments = (
    reconciledData: ReconciledRow[],
    customerName: string
): CustomerMetrics => {
    // Filter data for specific customer
    const customerInvoices = reconciledData.filter(
        invoice => invoice.clientName === customerName
    );

    if (customerInvoices.length === 0) {
        return {
            customerName,
            totalInvoices: 0,
            totalInvoicesWithPayments: 0,
            averageDPD: 0,
            onTimePercentage: 0,
            latePaymentBands: {
                band1_15: { count: 0, percentage: 0, totalValue: 0 },
                band16_30: { count: 0, percentage: 0, totalValue: 0 },
                band31_60: { count: 0, percentage: 0, totalValue: 0 },
                bandOver60: { count: 0, percentage: 0, totalValue: 0 },
            },
            weightedDPD: 0,
            volatility: null,
            volatilityMora: null,
            totalInvoiceValue: 0,
        };
    }

    // Calculate DPD for each invoice
    const GlobalDPDValues: number[] = [];
    const MoraDPDValues: number[] = [];
    const weightedDPDValues: { dpd: number; value: number }[] = [];
    let onTimeCount = 0;
    let totalInvoiceValue = 0;
    let invoicesWithPayments = 0;

    // Initialize band counters
    const bands = {
        band1_15: { count: 0, totalValue: 0 },
        band16_30: { count: 0, totalValue: 0 },
        band31_60: { count: 0, totalValue: 0 },
        bandOver60: { count: 0, totalValue: 0 },
    };

    customerInvoices.forEach(invoice => {
        const dpd = calculateInvoiceDPD(invoice);

        // Track global DPD (max 0, dpd)
        GlobalDPDValues.push(Math.max(0, dpd));

        // Track Mora DPD (only dpd > 0)
        if (dpd > 0) {
            MoraDPDValues.push(dpd);
        }

        totalInvoiceValue += invoice.total;

        if (invoice.paymentDetails && invoice.paymentDetails.length > 0) {
            invoicesWithPayments++;
        }

        // Track weighted DPD (severity) - only for invoices in arrears (DPD > 0)
        if (dpd > 0) {
            weightedDPDValues.push({ dpd, value: invoice.total });
        }

        // Count on-time payments (DPD <= 0)
        if (dpd <= 0) {
            onTimeCount++;
        } else {
            // Categorize into bands
            if (dpd >= 1 && dpd <= 15) {
                bands.band1_15.count++;
                bands.band1_15.totalValue += invoice.total;
            } else if (dpd >= 16 && dpd <= 30) {
                bands.band16_30.count++;
                bands.band16_30.totalValue += invoice.total;
            } else if (dpd >= 31 && dpd <= 60) {
                bands.band31_60.count++;
                bands.band31_60.totalValue += invoice.total;
            } else if (dpd > 60) {
                bands.bandOver60.count++;
                bands.bandOver60.totalValue += invoice.total;
            }
        }
    });

    // Calculate average DPD
    const averageDPD = GlobalDPDValues.length > 0
        ? GlobalDPDValues.reduce((sum, val) => sum + val, 0) / GlobalDPDValues.length
        : 0;

    // Calculate on-time percentage
    const onTimePercentage = (onTimeCount / customerInvoices.length) * 100;

    // Calculate weighted DPD (severity)
    const totalWeight = weightedDPDValues.reduce((sum, item) => sum + item.value, 0);
    const weightedDPD = totalWeight > 0
        ? weightedDPDValues.reduce((sum, item) => sum + (item.dpd * item.value), 0) / totalWeight
        : 0;

    // Calculate volatilies
    const volatility = calculateStandardDeviation(GlobalDPDValues);
    const volatilityMora = calculateStandardDeviation(MoraDPDValues);

    // Calculate band percentages
    const totalInvoices = customerInvoices.length;
    const latePaymentBands = {
        band1_15: {
            count: bands.band1_15.count,
            percentage: (bands.band1_15.count / totalInvoices) * 100,
            totalValue: bands.band1_15.totalValue,
        },
        band16_30: {
            count: bands.band16_30.count,
            percentage: (bands.band16_30.count / totalInvoices) * 100,
            totalValue: bands.band16_30.totalValue,
        },
        band31_60: {
            count: bands.band31_60.count,
            percentage: (bands.band31_60.count / totalInvoices) * 100,
            totalValue: bands.band31_60.totalValue,
        },
        bandOver60: {
            count: bands.bandOver60.count,
            percentage: (bands.bandOver60.count / totalInvoices) * 100,
            totalValue: bands.bandOver60.totalValue,
        },
    };

    return {
        customerName,
        totalInvoices: customerInvoices.length,
        totalInvoicesWithPayments: invoicesWithPayments,
        averageDPD,
        onTimePercentage,
        latePaymentBands,
        weightedDPD,
        volatility,
        volatilityMora,
        totalInvoiceValue,
    };
};

/**
 * Perform comprehensive customer analysis with trend comparison
 */
export const performCustomerAnalysis = (
    reconciledData: ReconciledRow[],
    customerName: string
): CustomerAnalysisResult => {
    // Current (all-time) analysis
    const current = analyzeCustomerPayments(reconciledData, customerName);

    // 6-month analysis
    const data6Months = filterByDateRange(reconciledData, 6);
    const metrics6Months = analyzeCustomerPayments(data6Months, customerName);

    // 12-month analysis
    const data12Months = filterByDateRange(reconciledData, 12);
    const metrics12Months = analyzeCustomerPayments(data12Months, customerName);

    // 24-month analysis
    const data24Months = filterByDateRange(reconciledData, 24);
    const metrics24Months = analyzeCustomerPayments(data24Months, customerName);

    // Calculate comparisons (6 months vs 12 months)
    const comparison6vs12 = metrics12Months.totalInvoices > 0 ? {
        dpdChange: metrics6Months.averageDPD - metrics12Months.averageDPD,
        onTimeChange: metrics6Months.onTimePercentage - metrics12Months.onTimePercentage,
        volatilityChange: (metrics6Months.volatility || 0) - (metrics12Months.volatility || 0),
    } : undefined;

    // Calculate comparisons (12 months vs 24 months)
    const comparison12vs24 = metrics24Months.totalInvoices > 0 ? {
        dpdChange: metrics12Months.averageDPD - metrics24Months.averageDPD,
        onTimeChange: metrics12Months.onTimePercentage - metrics24Months.onTimePercentage,
        volatilityChange: (metrics12Months.volatility || 0) - (metrics24Months.volatility || 0),
    } : undefined;

    return {
        current,
        trends: {
            last6Months: {
                period: 'Últimos 6 meses',
                months: 6,
                metrics: metrics6Months.totalInvoices > 0 ? metrics6Months : null,
                comparison: comparison6vs12,
            },
            last12Months: {
                period: 'Últimos 12 meses',
                months: 12,
                metrics: metrics12Months.totalInvoices > 0 ? metrics12Months : null,
                comparison: comparison12vs24,
            },
            last24Months: {
                period: 'Últimos 24 meses',
                months: 24,
                metrics: metrics24Months.totalInvoices > 0 ? metrics24Months : null,
            },
        },
    };
};

/**
 * Get all unique customer names from reconciled data
 */
export const getUniqueCustomers = (reconciledData: ReconciledRow[]): string[] => {
    const customers = new Set(reconciledData.map(invoice => invoice.clientName).filter(Boolean));
    return Array.from(customers).sort();
};

/**
 * Calculate cash flow projection for future months based on historical data
 */
export interface CashFlowProjection {
    month: string;
    projectedRevenue: number;
    projectedPayments: number;
    netFlow: number;
}

export const generateCashFlowProjections = (
    data: ReconciledRow[],
    monthsToProject: number = 6
): CashFlowProjection[] => {
    if (data.length === 0) {
        return [];
    }

    // Group data by invoice month to calculate average monthly revenue
    const monthlyData = new Map<string, { revenue: number; recovered: number }>();
    
    data.forEach(invoice => {
        const invoiceDate = invoice.invoiceDate instanceof Date 
            ? invoice.invoiceDate 
            : parseExcelDate(invoice.invoiceDate);
        
        if (!invoiceDate) return;
        
        const monthKey = invoiceDate.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit' });
        const current = monthlyData.get(monthKey) || { revenue: 0, recovered: 0 };
        
        // Track total invoiced (revenue) and actual collected amount
        current.revenue += invoice.total;
        current.recovered += invoice.totalPaid; // Actual cash collected
        
        monthlyData.set(monthKey, current);
    });

    // Calculate average monthly metrics
    const monthlyValues = Array.from(monthlyData.values());
    if (monthlyValues.length === 0) {
        return [];
    }
    
    // Calculate totals from all historical data
    const totalRevenue = monthlyValues.reduce((sum, m) => sum + m.revenue, 0);
    const totalRecovered = monthlyValues.reduce((sum, m) => sum + m.recovered, 0);
    
    // Calculate averages
    const averageMonthlyRevenue = totalRevenue / monthlyValues.length;

    // Historical recovery rate (% of invoiced amount actually collected)
    const historicalRecoveryRate = totalRevenue > 0 ? (totalRecovered / totalRevenue) * 100 : 0;

    // Generate projections for future months
    const projections: CashFlowProjection[] = [];
    const today = new Date();
    
    for (let i = 1; i <= monthsToProject; i++) {
        const projectionDate = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const monthLabel = projectionDate.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' }).toLowerCase();
        
        // Projected revenue = average monthly invoicing from historical data
        const projectedRevenue = averageMonthlyRevenue;
        
        // Projected payments = expected cash collection based on historical recovery rate
        // This represents the actual cash we expect to collect
        const projectedPayments = averageMonthlyRevenue * (historicalRecoveryRate / 100);
        
        // Net cash flow = projected collections (positive cash flow)
        // In this context, netFlow represents the expected cash inflow
        const netFlow = projectedPayments;
        
        projections.push({
            month: monthLabel,
            projectedRevenue,
            projectedPayments,
            netFlow
        });
    }

    return projections;
};

