import React, { useState, useMemo } from 'react';
import type { ReconciledRow, CustomerAnalysisResult, DateRangeOption } from './types';
import { performCustomerAnalysis, getUniqueCustomers, parseExcelDate, getDateRangeBounds, getDPDColor, getOnTimeColor, getSeverityColor, getVolatilityColor } from './customerAnalysisUtils';
import { TrendingUp, TrendingDown, Minus, FileDown, BarChart3, AlertTriangle, CheckCircle2, Activity, Info, X, Filter, Table as TableIcon, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { SkeletonAnalytics } from './SkeletonLoader';

interface CustomerAnalysisProps {
    reconciledData: ReconciledRow[];
    dateRange?: DateRangeOption;
    customStartDate?: string;
    customEndDate?: string;
    onDateRangeChange?: (range: DateRangeOption) => void;
    onCustomStartDateChange?: (date: string) => void;
    onCustomEndDateChange?: (date: string) => void;
    selectedCustomer?: string;
    onCustomerChange?: (customerName: string) => void;
    loading?: boolean;
}

const CustomerAnalysis: React.FC<CustomerAnalysisProps> = ({
    reconciledData,
    dateRange = 'all',
    customStartDate = '',
    customEndDate = '',
    onDateRangeChange,
    onCustomStartDateChange,
    onCustomEndDateChange,
    selectedCustomer: selectedCustomerProp,
    onCustomerChange,
    loading = false
}) => {
    const [selectedCustomerInternal, setSelectedCustomerInternal] = useState<string>('');
    const [showInfoModal, setShowInfoModal] = useState(false);
    const [showInvoicesListModal, setShowInvoicesListModal] = useState(false);

    // Use prop if provided, otherwise use internal state
    const selectedCustomer = selectedCustomerProp !== undefined ? selectedCustomerProp : selectedCustomerInternal;
    const handleCustomerChange = (customer: string) => {
        if (onCustomerChange) {
            onCustomerChange(customer);
        } else {
            setSelectedCustomerInternal(customer);
        }
    };
    const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

    const getDateRangeBoundsLocal = (option: DateRangeOption) => {
        return getDateRangeBounds(option, customStartDate, customEndDate);
    };

    // Filter reconciled data by date range
    const filteredReconciledData = useMemo(() => {
        const { start, end } = getDateRangeBoundsLocal(dateRange);

        if (!start || !end) {
            return reconciledData;
        }

        return reconciledData.filter(row => {
            const invoiceDate = row.invoiceDate instanceof Date ? row.invoiceDate : parseExcelDate(row.invoiceDate);
            if (!invoiceDate) return false;
            return invoiceDate >= start && invoiceDate <= end;
        });
    }, [reconciledData, dateRange, customStartDate, customEndDate]);

    const uniqueCustomers = useMemo(() => getUniqueCustomers(filteredReconciledData), [filteredReconciledData]);

    const analysisResult: CustomerAnalysisResult | null = useMemo(() => {
        if (!selectedCustomer) return null;
        return performCustomerAnalysis(filteredReconciledData, selectedCustomer);
    }, [filteredReconciledData, selectedCustomer]);

    const formatNumber = (num: number, decimals: number = 2): string => {
        return num.toFixed(decimals);
    };

    const formatCurrency = (num: number): string => {
        return num.toLocaleString('en-US', {
            style: 'currency',
            currency: 'COP',
            currencyDisplay: 'code',
            maximumFractionDigits: 0
        }).replace('COP', 'COP ');
    };

    const getTrendIcon = (value: number) => {
        if (value > 0.5) return <TrendingUp className="text-red-500" size={16} />;
        if (value < -0.5) return <TrendingDown className="text-green-500" size={16} />;
        return <Minus className="text-slate-400" size={16} />;
    };

    const getTrendColor = (value: number, inverse: boolean = false) => {
        if (inverse) {
            // For metrics where lower is better (like DPD)
            if (value > 0.5) return 'text-red-600';
            if (value < -0.5) return 'text-green-600';
        } else {
            // For metrics where higher is better (like on-time %)
            if (value > 0.5) return 'text-green-600';
            if (value < -0.5) return 'text-red-600';
        }
        return 'text-slate-600';
    };



    const metricInfo: Record<string, { title: string; formula: string; description: string; interpretation: string }> = {
        dpd: {
            title: 'DPD Promedio (Days Past Due)',
            formula: 'DPD Promedio = Σ(DPD de cada factura) / Total de facturas',
            description: 'Calcula el promedio de días de atraso en el pago de todas las facturas del cliente. Para cada factura, el DPD se calcula como la diferencia entre la fecha de pago y la fecha de vencimiento.',
            interpretation: '• Valores negativos: pagos anticipados\n• 0: pagos puntuales\n• Valores positivos: pagos con retraso\n• Ideal: ≤ 0 días'
        },
        onTime: {
            title: '% Facturas a Tiempo',
            formula: '% A Tiempo = (Facturas con DPD ≤ 0 / Total de facturas) × 100',
            description: 'Porcentaje de facturas pagadas en o antes de la fecha de vencimiento. Una factura se considera "a tiempo" cuando su DPD es menor o igual a cero.',
            interpretation: '• >80%: Excelente comportamiento de pago (verde)\n• 60-80%: Comportamiento estable (amarillo)\n• 40-59%: Requiere atención (naranja)\n• <40%: Riesgo alto (rojo)'
        },
        severity: {
            title: 'Severidad de Mora',
            formula: 'Severidad = Σ(DPD_i × V_i) / Σ V_i [Solo para DPD > 0]',
            description: 'Calcula el retraso promedio ponderado por el valor económico, enfocándose exclusivamente en las facturas que presentan mora (DPD > 0). Esto evita que los pagos a tiempo diluyan la percepción del impacto real de los atrasos.',
            interpretation: '• >45: Riesgo Crítico (rojo)\n• 31-45: Riesgo Alto (naranja)\n• 15-30: Riesgo Moderado (amarillo)\n• <15: Comportamiento Ideal (verde)'
        },
        volatility: {
            title: 'Volatilidad Global (s)',
            formula: 's = √[Σ(DPD_i - DPD_promedio)² / (n - 1)] [sobre max(0, DPD)]',
            description: 'Mide la variabilidad del comportamiento de pago general del cliente. Utiliza la desviación estándar muestral (divide por n-1) para ser estadísticamente robusto con pocos datos. Se calcula sobre todos los DPD (los pagos anticipados se toman como 0).',
            interpretation: '• >30: Comportamiento errático (rojo)\n• 21-30: Inconsistencia alta (naranja)\n• 10-20: Inconsistencia moderada (amarillo)\n• <10: Comportamiento estable (verde)'
        },
        volatilityMora: {
            title: 'Volatilidad de Mora (s_mora)',
            formula: 's_mora = √[Σ(DPD_i - DPD_promedio_mora)² / (n_mora - 1)] [solo DPD > 0]',
            description: 'Mide la variabilidad exclusivamente entre las facturas pagadas con retraso (DPD > 0). Permite entender qué tan consistente es el cliente cuando se atrasa.',
            interpretation: '• >30: Retrasos muy variables (rojo)\n• 21-30: Alta fluctuación en mora (naranja)\n• 10-20: Mora relativamente estable (amarillo)\n• <10: Retrasos consistentes (verde)'
        }
    };

    const showMetricInfo = (metric: string) => {
        setSelectedMetric(metric);
        setShowInfoModal(true);
    };

    const downloadExcel = () => {
        if (!analysisResult) return;

        const { current, trends } = analysisResult;

        // Main metrics sheet
        const metricsData = [
            { Métrica: 'Cliente', Valor: current.customerName },
            { Métrica: 'Total de Facturas', Valor: current.totalInvoices },
            { Métrica: 'Facturas con Pagos', Valor: current.totalInvoicesWithPayments },
            { Métrica: 'Valor Total Facturado', Valor: formatCurrency(current.totalInvoiceValue) },
            { Métrica: '', Valor: '' },
            { Métrica: 'DPD Promedio (días)', Valor: formatNumber(current.averageDPD, 1) },
            { Métrica: '% Facturas a Tiempo', Valor: formatNumber(current.onTimePercentage, 1) + '%' },
            { Métrica: 'Severidad de Mora (DPD Ponderado)', Valor: formatNumber(current.weightedDPD, 1) },
            { Métrica: 'Volatilidad Global', Valor: current.volatility !== null ? formatNumber(current.volatility, 1) : 'Evidencia insuficiente' },
            { Métrica: 'Volatilidad de Mora', Valor: current.volatilityMora !== null ? formatNumber(current.volatilityMora, 1) : 'Evidencia insuficiente' },
        ];

        // Late payment bands sheet
        const bandsData = [
            {
                'Banda de Mora': '1-15 días',
                'Cantidad': current.latePaymentBands.band1_15.count,
                'Porcentaje': formatNumber(current.latePaymentBands.band1_15.percentage, 1) + '%',
                'Valor Total': formatCurrency(current.latePaymentBands.band1_15.totalValue),
            },
            {
                'Banda de Mora': '16-30 días',
                'Cantidad': current.latePaymentBands.band16_30.count,
                'Porcentaje': formatNumber(current.latePaymentBands.band16_30.percentage, 1) + '%',
                'Valor Total': formatCurrency(current.latePaymentBands.band16_30.totalValue),
            },
            {
                'Banda de Mora': '31-60 días',
                'Cantidad': current.latePaymentBands.band31_60.count,
                'Porcentaje': formatNumber(current.latePaymentBands.band31_60.percentage, 1) + '%',
                'Valor Total': formatCurrency(current.latePaymentBands.band31_60.totalValue),
            },
            {
                'Banda de Mora': '>60 días',
                'Cantidad': current.latePaymentBands.bandOver60.count,
                'Porcentaje': formatNumber(current.latePaymentBands.bandOver60.percentage, 1) + '%',
                'Valor Total': formatCurrency(current.latePaymentBands.bandOver60.totalValue),
            },
        ];

        // Trends sheet
        const trendsData = [
            {
                'Período': 'Últimos 6 meses',
                'Facturas': trends.last6Months.metrics?.totalInvoices || 0,
                'DPD Promedio': trends.last6Months.metrics ? formatNumber(trends.last6Months.metrics.averageDPD, 1) : 'N/A',
                '% A Tiempo': trends.last6Months.metrics ? formatNumber(trends.last6Months.metrics.onTimePercentage, 1) + '%' : 'N/A',
                'Volatilidad': trends.last6Months.metrics && trends.last6Months.metrics.volatility !== null ? formatNumber(trends.last6Months.metrics.volatility, 1) : 'N/A',
            },
            {
                'Período': 'Últimos 12 meses',
                'Facturas': trends.last12Months.metrics?.totalInvoices || 0,
                'DPD Promedio': trends.last12Months.metrics ? formatNumber(trends.last12Months.metrics.averageDPD, 1) : 'N/A',
                '% A Tiempo': trends.last12Months.metrics ? formatNumber(trends.last12Months.metrics.onTimePercentage, 1) + '%' : 'N/A',
                'Volatilidad': trends.last12Months.metrics && trends.last12Months.metrics.volatility !== null ? formatNumber(trends.last12Months.metrics.volatility, 1) : 'N/A',
            },
            {
                'Período': 'Últimos 24 meses',
                'Facturas': trends.last24Months.metrics?.totalInvoices || 0,
                'DPD Promedio': trends.last24Months.metrics ? formatNumber(trends.last24Months.metrics.averageDPD, 1) : 'N/A',
                '% A Tiempo': trends.last24Months.metrics ? formatNumber(trends.last24Months.metrics.onTimePercentage, 1) + '%' : 'N/A',
                'Volatilidad': trends.last24Months.metrics && trends.last24Months.metrics.volatility !== null ? formatNumber(trends.last24Months.metrics.volatility, 1) : 'N/A',
            },
        ];

        const workbook = XLSX.utils.book_new();

        const metricsSheet = XLSX.utils.json_to_sheet(metricsData);
        XLSX.utils.book_append_sheet(workbook, metricsSheet, 'Métricas Principales');

        const bandsSheet = XLSX.utils.json_to_sheet(bandsData);
        XLSX.utils.book_append_sheet(workbook, bandsSheet, 'Bandas de Mora');

        const trendsSheet = XLSX.utils.json_to_sheet(trendsData);
        XLSX.utils.book_append_sheet(workbook, trendsSheet, 'Tendencias');

        XLSX.writeFile(workbook, `Analisis_Cliente_${current.customerName.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`);
    };

    const formatExcelDate = (date: Date | null | any) => {
        if (!date) return '';
        if (!(date instanceof Date)) {
            date = parseExcelDate(date);
        }
        if (!date || isNaN(date.getTime())) return '';
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    };

    // Invoices List Modal Component
    const InvoicesListModal = () => {
        if (!showInvoicesListModal || !selectedCustomer) return null;

        // Get invoices for the selected customer and current date range
        const customerInvoices = filteredReconciledData.filter(row => row.clientName === selectedCustomer);

        // Sort by date descending by default
        const sortedInvoices = [...customerInvoices].sort((a, b) => {
            const dateA = a.invoiceDate instanceof Date ? a.invoiceDate : parseExcelDate(a.invoiceDate);
            const dateB = b.invoiceDate instanceof Date ? b.invoiceDate : parseExcelDate(b.invoiceDate);
            if (!dateA) return 1;
            if (!dateB) return -1;
            return dateB.getTime() - dateA.getTime();
        });

        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowInvoicesListModal(false)}>
                <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                    <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-6 py-4 rounded-t-2xl flex justify-between items-center shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="bg-white/10 p-2 rounded-lg">
                                <TableIcon className="text-white w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold">Detalle de Facturas</h3>
                                <div className="text-xs text-slate-300 opacity-90">{selectedCustomer} • {sortedInvoices.length} facturas</div>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowInvoicesListModal(false)}
                            className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-1 transition-colors"
                        >
                            <X size={24} />
                        </button>
                    </div>

                    <div className="overflow-auto p-0">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-slate-50 shadow-sm z-10">
                                <tr className="border-b border-slate-200">
                                    <th className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider">Factura</th>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider whitespace-nowrap">
                                        Fecha Factura
                                    </th>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider whitespace-nowrap">Vencimiento</th>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider">Total</th>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider">Saldo</th>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider">Pagos / Mora</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {sortedInvoices.map((row, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="px-6 py-4 font-medium text-slate-900 text-sm">
                                            <div className="flex items-center gap-2">
                                                {row.invoiceNumber}
                                                {row.isOverdue && (
                                                    <span title={`Mora detectada: ${row.maxDelayDays} días`} className="text-red-500">
                                                        <AlertCircle size={14} fill="currentColor" className="text-white bg-red-500 rounded-full" />
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 text-sm whitespace-nowrap">{formatExcelDate(row.invoiceDate)}</td>
                                        <td className="px-6 py-4 text-slate-600 text-sm whitespace-nowrap">{formatExcelDate(row.dueDate)}</td>
                                        <td className="px-6 py-4 text-slate-900 font-semibold text-sm">{formatCurrency(row.total)}</td>
                                        <td className="px-6 py-4">
                                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${row.balance === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                                {formatCurrency(row.balance)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-1">
                                                {row.paymentDetails.length > 0 ? (
                                                    row.paymentDetails.map((pd, i) => (
                                                        <div key={i} className="flex items-center gap-2">
                                                            <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${pd.delay > 0 ? 'bg-red-50 text-red-700 border-red-100' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>
                                                                {pd.date}
                                                            </span>
                                                            {pd.delay > 0 && (
                                                                <span className="text-[10px] font-bold text-red-600 flex items-center gap-0.5">
                                                                    {pd.delay}d
                                                                </span>
                                                            )}
                                                        </div>
                                                    ))
                                                ) : (
                                                    row.isOverdue && row.balance > 0 ? (
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-slate-400 italic text-xs">Sin pagos</span>
                                                            <span className="text-[10px] font-bold text-red-600 flex items-center gap-0.5">
                                                                {row.maxDelayDays}d mora
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-slate-400 italic text-xs">Sin pagos</span>
                                                    )
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex justify-end">
                        <button
                            onClick={() => setShowInvoicesListModal(false)}
                            className="bg-slate-800 hover:bg-slate-900 text-white font-medium py-2 px-6 rounded-lg transition-colors text-sm"
                        >
                            Cerrar
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // Info Modal Component
    const InfoModal = () => {
        if (!showInfoModal || !selectedMetric || !metricInfo[selectedMetric]) return null;

        const info = metricInfo[selectedMetric];

        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowInfoModal(false)}>
                <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    <div className="sticky top-0 bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-6 py-4 rounded-t-2xl flex justify-between items-center">
                        <h3 className="text-xl font-bold">{info.title}</h3>
                        <button
                            onClick={() => setShowInfoModal(false)}
                            className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-1 transition-colors"
                        >
                            <X size={24} />
                        </button>
                    </div>

                    <div className="p-6 space-y-4">
                        <div>
                            <h4 className="text-sm font-bold text-slate-600 uppercase mb-2">Fórmula</h4>
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                                <code className="text-indigo-700 font-mono text-sm">{info.formula}</code>
                            </div>
                        </div>

                        <div>
                            <h4 className="text-sm font-bold text-slate-600 uppercase mb-2">Descripción</h4>
                            <p className="text-slate-700 leading-relaxed">{info.description}</p>
                        </div>

                        <div>
                            <h4 className="text-sm font-bold text-slate-600 uppercase mb-2">Interpretación</h4>
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <pre className="text-slate-700 text-sm whitespace-pre-wrap font-sans">{info.interpretation}</pre>
                            </div>
                        </div>
                    </div>

                    <div className="sticky bottom-0 bg-slate-50 px-6 py-4 rounded-b-2xl border-t border-slate-200">
                        <button
                            onClick={() => setShowInfoModal(false)}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                        >
                            Cerrar
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    if (reconciledData.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                <BarChart3 size={64} className="mb-4 text-slate-300" />
                <p className="text-lg font-medium">No hay datos de conciliación disponibles</p>
                <p className="text-sm">Por favor, sube los archivos y genera la conciliación primero</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 fade-in">
            <InfoModal />
            <InvoicesListModal />

            <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-6 bg-slate-50/50">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 flex-1">
                        {/* Customer Filter */}
                        <div className="flex items-center gap-3">
                            <label htmlFor="customer-select" className="text-sm font-semibold text-slate-600 flex items-center gap-2 whitespace-nowrap">
                                <Filter size={18} className="text-slate-400" />
                                Filtrar por Cliente:
                            </label>
                            <div className="relative">
                                <select
                                    id="customer-select"
                                    value={selectedCustomer}
                                    onChange={(e) => handleCustomerChange(e.target.value)}
                                    className="appearance-none bg-white border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:w-80 p-2.5 pr-10 shadow-sm cursor-pointer hover:border-indigo-300 transition-colors"
                                >
                                    <option value="">-- Seleccione un cliente --</option>
                                    {uniqueCustomers.map(customer => (
                                        <option key={customer} value={customer}>{customer}</option>
                                    ))}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                </div>
                            </div>
                        </div>

                        {/* Period Filter */}
                        <div className="flex items-center gap-3">
                            <label htmlFor="date-filter-analysis" className="text-sm font-semibold text-slate-600 whitespace-nowrap">
                                Período:
                            </label>
                            <div className="relative">
                                <select
                                    id="date-filter-analysis"
                                    value={dateRange}
                                    onChange={(e) => onDateRangeChange?.(e.target.value as DateRangeOption)}
                                    className="appearance-none bg-white border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:w-48 p-2.5 pr-10 shadow-sm cursor-pointer hover:border-indigo-300 transition-colors"
                                >
                                    <option value="all">Todas las fechas</option>
                                    <option value="today">Hoy</option>
                                    <option value="thisWeek">Esta semana</option>
                                    <option value="thisMonth">Este mes</option>
                                    <option value="thisQuarter">Este trimestre</option>
                                    <option value="thisYear">Este año</option>
                                    <option value="yesterday">Ayer</option>
                                    <option value="lastWeek">Semana anterior</option>
                                    <option value="lastMonth">Mes anterior</option>
                                    <option value="lastQuarter">Trimestre anterior</option>
                                    <option value="lastYear">Año anterior</option>
                                    <option value="custom">Personalizada</option>
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                </div>
                            </div>
                        </div>

                        {/* Custom Dates */}
                        {dateRange === 'custom' && (
                            <div className="flex items-center gap-2">
                                <input
                                    type="date"
                                    value={customStartDate}
                                    onChange={(e) => onCustomStartDateChange?.(e.target.value)}
                                    className="bg-white border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 p-2 shadow-sm shadow-indigo-100/20"
                                />
                                <span className="text-slate-400">a</span>
                                <input
                                    type="date"
                                    value={customEndDate}
                                    onChange={(e) => onCustomEndDateChange?.(e.target.value)}
                                    className="bg-white border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 p-2 shadow-sm shadow-indigo-100/20"
                                />
                            </div>
                        )}
                    </div>

                    {analysisResult && (
                        <button
                            onClick={downloadExcel}
                            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-emerald-200/50 font-bold text-sm active:scale-95 whitespace-nowrap"
                        >
                            <FileDown size={18} />
                            Exportar Análisis
                        </button>
                    )}
                </div>
            </div>

            {/* Analysis Results */}
            {loading ? (
                <SkeletonAnalytics cards={9} />
            ) : analysisResult && (
                <div className="space-y-6 fade-in">
                    {/* Main Metrics Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* DPD Promedio */}
                        <div className={`rounded-xl shadow-sm border-2 p-6 transition-colors duration-500 ${getDPDColor(analysisResult.current.averageDPD)}`}>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium">DPD Promedio</span>
                                <div className="flex items-center gap-2">
                                    <Activity size={20} />
                                    <button
                                        onClick={() => showMetricInfo('dpd')}
                                        className="hover:opacity-70 transition-opacity"
                                        title="Ver cómo se calcula"
                                    >
                                        <Info size={18} />
                                    </button>
                                </div>
                            </div>
                            <div className="text-3xl font-bold mb-1">
                                {formatNumber(analysisResult.current.averageDPD, 1)}
                            </div>
                            <div className="text-xs opacity-80">días de atraso promedio</div>
                        </div>

                        {/* % Facturas a Tiempo */}
                        <div className={`rounded-xl shadow-sm border-2 p-6 transition-colors duration-500 ${getOnTimeColor(analysisResult.current.onTimePercentage)}`}>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium">% A Tiempo</span>
                                <div className="flex items-center gap-2">
                                    <CheckCircle2 size={20} />
                                    <button
                                        onClick={() => showMetricInfo('onTime')}
                                        className="hover:opacity-70 transition-opacity"
                                        title="Ver cómo se calcula"
                                    >
                                        <Info size={18} />
                                    </button>
                                </div>
                            </div>
                            <div className="text-3xl font-bold mb-1">
                                {formatNumber(analysisResult.current.onTimePercentage, 1)}%
                            </div>
                            <div className="text-xs opacity-80">
                                {analysisResult.current.totalInvoices - Math.round(analysisResult.current.totalInvoices * analysisResult.current.onTimePercentage / 100)} facturas con mora
                            </div>
                        </div>

                        {/* Severidad de Mora */}
                        <div className={`rounded-xl shadow-sm border-2 p-6 transition-colors duration-500 ${getSeverityColor(analysisResult.current.weightedDPD)}`}>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium">Severidad</span>
                                <div className="flex items-center gap-2">
                                    <AlertTriangle size={20} />
                                    <button
                                        onClick={() => showMetricInfo('severity')}
                                        className="hover:opacity-70 transition-opacity"
                                        title="Ver cómo se calcula"
                                    >
                                        <Info size={18} />
                                    </button>
                                </div>
                            </div>
                            <div className="text-3xl font-bold mb-1">
                                {formatNumber(analysisResult.current.weightedDPD, 1)}
                            </div>
                            <div className="text-xs opacity-80">DPD ponderado (solo mora)</div>
                        </div>

                        {/* Volatilidad Global */}
                        <div className={`rounded-xl shadow-sm border-2 p-6 transition-colors duration-500 ${getVolatilityColor(analysisResult.current.volatility)}`}>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium">Volatilidad</span>
                                <div className="flex items-center gap-2">
                                    <Activity size={20} />
                                    <button
                                        onClick={() => showMetricInfo('volatility')}
                                        className="hover:opacity-70 transition-opacity"
                                        title="Ver cómo se calcula"
                                    >
                                        <Info size={18} />
                                    </button>
                                </div>
                            </div>
                            <div className={`text-3xl font-bold mb-1 ${analysisResult.current.volatility === null ? 'opacity-40 text-xl' : ''}`}>
                                {analysisResult.current.volatility !== null
                                    ? formatNumber(analysisResult.current.volatility, 1)
                                    : 'Evidencia insuficiente'}
                            </div>
                            <div className="text-xs opacity-80">desviación muestral (global)</div>
                        </div>

                        {/* Volatilidad de Mora */}
                        <div className={`rounded-xl shadow-sm border-2 p-6 transition-colors duration-500 ${getVolatilityColor(analysisResult.current.volatilityMora)}`}>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium">Volatilidad Mora</span>
                                <div className="flex items-center gap-2">
                                    <Activity size={20} />
                                    <button
                                        onClick={() => showMetricInfo('volatilityMora')}
                                        className="hover:opacity-70 transition-opacity"
                                        title="Ver cómo se calcula"
                                    >
                                        <Info size={18} />
                                    </button>
                                </div>
                            </div>
                            <div className={`text-3xl font-bold mb-1 ${analysisResult.current.volatilityMora === null ? 'opacity-40 text-xl' : ''}`}>
                                {analysisResult.current.volatilityMora !== null
                                    ? formatNumber(analysisResult.current.volatilityMora, 1)
                                    : 'Evidencia insuficiente'}
                            </div>
                            <div className="text-xs opacity-80">desviación muestral (mora)</div>
                        </div>
                    </div>

                    {/* Summary Stats */}
                    <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-xl border border-indigo-100 p-6">
                        <h3 className="text-lg font-bold text-slate-800 mb-4">Resumen General</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div
                                onClick={() => setShowInvoicesListModal(true)}
                                className="group cursor-pointer p-3 -m-3 rounded-lg hover:bg-white/50 transition-colors"
                            >
                                <div className="text-sm text-slate-600 mb-1 flex items-center gap-2">
                                    Total Facturas
                                    <span className="opacity-0 group-hover:opacity-100 transition-opacity text-indigo-600">
                                        <TableIcon size={14} />
                                    </span>
                                </div>
                                <div className="text-2xl font-bold text-slate-900 group-hover:text-indigo-700 transition-colors underline decoration-dotted decoration-indigo-300 underline-offset-4">
                                    {analysisResult.current.totalInvoices}
                                </div>
                            </div>
                            <div className="p-3 -m-3">
                                <div className="text-sm text-slate-600 mb-1">Con Pagos</div>
                                <div className="text-2xl font-bold text-slate-900">{analysisResult.current.totalInvoicesWithPayments}</div>
                            </div>
                            <div className="col-span-2 p-3 -m-3">
                                <div className="text-sm text-slate-600 mb-1">Valor Total Facturado</div>
                                <div className="text-2xl font-bold text-slate-900">{formatCurrency(analysisResult.current.totalInvoiceValue)}</div>
                            </div>
                        </div>
                    </div>

                    {/* Late Payment Bands */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                            <h3 className="text-lg font-bold text-slate-800">Distribución de Mora por Bandas</h3>
                        </div>
                        <div className="p-6">
                            <div className="space-y-4">
                                {/* Band 1-15 */}
                                <div className="flex items-center gap-4">
                                    <div className="w-32 text-sm font-medium text-slate-700">1-15 días</div>
                                    <div className="flex-1">
                                        <div className="w-full bg-slate-100 rounded-full h-8 relative overflow-hidden">
                                            <div
                                                className="bg-yellow-400 h-full flex items-center justify-end pr-2 transition-all"
                                                style={{ width: `${analysisResult.current.latePaymentBands.band1_15.percentage}%` }}
                                            >
                                                {analysisResult.current.latePaymentBands.band1_15.percentage > 5 && (
                                                    <span className="text-xs font-bold text-slate-800">
                                                        {formatNumber(analysisResult.current.latePaymentBands.band1_15.percentage, 1)}%
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="w-20 text-right text-sm font-semibold text-slate-900">
                                        {analysisResult.current.latePaymentBands.band1_15.count}
                                    </div>
                                </div>

                                {/* Band 16-30 */}
                                <div className="flex items-center gap-4">
                                    <div className="w-32 text-sm font-medium text-slate-700">16-30 días</div>
                                    <div className="flex-1">
                                        <div className="w-full bg-slate-100 rounded-full h-8 relative overflow-hidden">
                                            <div
                                                className="bg-orange-400 h-full flex items-center justify-end pr-2 transition-all"
                                                style={{ width: `${analysisResult.current.latePaymentBands.band16_30.percentage}%` }}
                                            >
                                                {analysisResult.current.latePaymentBands.band16_30.percentage > 5 && (
                                                    <span className="text-xs font-bold text-white">
                                                        {formatNumber(analysisResult.current.latePaymentBands.band16_30.percentage, 1)}%
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="w-20 text-right text-sm font-semibold text-slate-900">
                                        {analysisResult.current.latePaymentBands.band16_30.count}
                                    </div>
                                </div>

                                {/* Band 31-60 */}
                                <div className="flex items-center gap-4">
                                    <div className="w-32 text-sm font-medium text-slate-700">31-60 días</div>
                                    <div className="flex-1">
                                        <div className="w-full bg-slate-100 rounded-full h-8 relative overflow-hidden">
                                            <div
                                                className="bg-red-400 h-full flex items-center justify-end pr-2 transition-all"
                                                style={{ width: `${analysisResult.current.latePaymentBands.band31_60.percentage}%` }}
                                            >
                                                {analysisResult.current.latePaymentBands.band31_60.percentage > 5 && (
                                                    <span className="text-xs font-bold text-white">
                                                        {formatNumber(analysisResult.current.latePaymentBands.band31_60.percentage, 1)}%
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="w-20 text-right text-sm font-semibold text-slate-900">
                                        {analysisResult.current.latePaymentBands.band31_60.count}
                                    </div>
                                </div>

                                {/* Band >60 */}
                                <div className="flex items-center gap-4">
                                    <div className="w-32 text-sm font-medium text-slate-700">&gt;60 días</div>
                                    <div className="flex-1">
                                        <div className="w-full bg-slate-100 rounded-full h-8 relative overflow-hidden">
                                            <div
                                                className="bg-red-600 h-full flex items-center justify-end pr-2 transition-all"
                                                style={{ width: `${analysisResult.current.latePaymentBands.bandOver60.percentage}%` }}
                                            >
                                                {analysisResult.current.latePaymentBands.bandOver60.percentage > 5 && (
                                                    <span className="text-xs font-bold text-white">
                                                        {formatNumber(analysisResult.current.latePaymentBands.bandOver60.percentage, 1)}%
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="w-20 text-right text-sm font-semibold text-slate-900">
                                        {analysisResult.current.latePaymentBands.bandOver60.count}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Trend Analysis */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                            <h3 className="text-lg font-bold text-slate-800">Análisis de Tendencias</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200">
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-600 uppercase">Período</th>
                                        <th className="px-6 py-3 text-center text-xs font-bold text-slate-600 uppercase">Facturas</th>
                                        <th className="px-6 py-3 text-center text-xs font-bold text-slate-600 uppercase">DPD Promedio</th>
                                        <th className="px-6 py-3 text-center text-xs font-bold text-slate-600 uppercase">% A Tiempo</th>
                                        <th className="px-6 py-3 text-center text-xs font-bold text-slate-600 uppercase">Volatilidad</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {/* 6 Months */}
                                    <tr className="hover:bg-slate-50">
                                        <td className="px-6 py-4 font-medium text-slate-900">Últimos 6 meses</td>
                                        <td className="px-6 py-4 text-center text-slate-700">
                                            {analysisResult.trends.last6Months.metrics?.totalInvoices || '-'}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {analysisResult.trends.last6Months.metrics ? (
                                                <div className="flex items-center justify-center gap-2">
                                                    <span className="font-semibold text-slate-900">
                                                        {formatNumber(analysisResult.trends.last6Months.metrics.averageDPD, 1)}
                                                    </span>
                                                    {analysisResult.trends.last6Months.comparison && (
                                                        <div className="flex items-center gap-1">
                                                            {getTrendIcon(analysisResult.trends.last6Months.comparison.dpdChange)}
                                                            <span className={`text-xs font-medium ${getTrendColor(analysisResult.trends.last6Months.comparison.dpdChange, true)}`}>
                                                                {formatNumber(Math.abs(analysisResult.trends.last6Months.comparison.dpdChange), 1)}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : '-'}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {analysisResult.trends.last6Months.metrics ? (
                                                <div className="flex items-center justify-center gap-2">
                                                    <span className="font-semibold text-slate-900">
                                                        {formatNumber(analysisResult.trends.last6Months.metrics.onTimePercentage, 1)}%
                                                    </span>
                                                    {analysisResult.trends.last6Months.comparison && (
                                                        <div className="flex items-center gap-1">
                                                            {getTrendIcon(analysisResult.trends.last6Months.comparison.onTimeChange)}
                                                            <span className={`text-xs font-medium ${getTrendColor(analysisResult.trends.last6Months.comparison.onTimeChange, false)}`}>
                                                                {formatNumber(Math.abs(analysisResult.trends.last6Months.comparison.onTimeChange), 1)}%
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : '-'}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {analysisResult.trends.last6Months.metrics ? (
                                                <span className="font-semibold text-slate-900">
                                                    {analysisResult.trends.last6Months.metrics.volatility !== null
                                                        ? formatNumber(analysisResult.trends.last6Months.metrics.volatility, 1)
                                                        : '-'}
                                                </span>
                                            ) : '-'}
                                        </td>
                                    </tr>

                                    {/* 12 Months */}
                                    <tr className="hover:bg-slate-50">
                                        <td className="px-6 py-4 font-medium text-slate-900">Últimos 12 meses</td>
                                        <td className="px-6 py-4 text-center text-slate-700">
                                            {analysisResult.trends.last12Months.metrics?.totalInvoices || '-'}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {analysisResult.trends.last12Months.metrics ? (
                                                <div className="flex items-center justify-center gap-2">
                                                    <span className="font-semibold text-slate-900">
                                                        {formatNumber(analysisResult.trends.last12Months.metrics.averageDPD, 1)}
                                                    </span>
                                                    {analysisResult.trends.last12Months.comparison && (
                                                        <div className="flex items-center gap-1">
                                                            {getTrendIcon(analysisResult.trends.last12Months.comparison.dpdChange)}
                                                            <span className={`text-xs font-medium ${getTrendColor(analysisResult.trends.last12Months.comparison.dpdChange, true)}`}>
                                                                {formatNumber(Math.abs(analysisResult.trends.last12Months.comparison.dpdChange), 1)}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : '-'}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {analysisResult.trends.last12Months.metrics ? (
                                                <div className="flex items-center justify-center gap-2">
                                                    <span className="font-semibold text-slate-900">
                                                        {formatNumber(analysisResult.trends.last12Months.metrics.onTimePercentage, 1)}%
                                                    </span>
                                                    {analysisResult.trends.last12Months.comparison && (
                                                        <div className="flex items-center gap-1">
                                                            {getTrendIcon(analysisResult.trends.last12Months.comparison.onTimeChange)}
                                                            <span className={`text-xs font-medium ${getTrendColor(analysisResult.trends.last12Months.comparison.onTimeChange, false)}`}>
                                                                {formatNumber(Math.abs(analysisResult.trends.last12Months.comparison.onTimeChange), 1)}%
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : '-'}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {analysisResult.trends.last12Months.metrics ? (
                                                <span className="font-semibold text-slate-900">
                                                    {analysisResult.trends.last12Months.metrics.volatility !== null
                                                        ? formatNumber(analysisResult.trends.last12Months.metrics.volatility, 1)
                                                        : '-'}
                                                </span>
                                            ) : '-'}
                                        </td>
                                    </tr>

                                    {/* 24 Months */}
                                    <tr className="hover:bg-slate-50">
                                        <td className="px-6 py-4 font-medium text-slate-900">Últimos 24 meses</td>
                                        <td className="px-6 py-4 text-center text-slate-700">
                                            {analysisResult.trends.last24Months.metrics?.totalInvoices || '-'}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {analysisResult.trends.last24Months.metrics ? (
                                                <span className="font-semibold text-slate-900">
                                                    {formatNumber(analysisResult.trends.last24Months.metrics.averageDPD, 1)}
                                                </span>
                                            ) : '-'}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {analysisResult.trends.last24Months.metrics ? (
                                                <span className="font-semibold text-slate-900">
                                                    {formatNumber(analysisResult.trends.last24Months.metrics.onTimePercentage, 1)}%
                                                </span>
                                            ) : '-'}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {analysisResult.trends.last24Months.metrics ? (
                                                <span className="font-semibold text-slate-900">
                                                    {analysisResult.trends.last24Months.metrics.volatility !== null
                                                        ? formatNumber(analysisResult.trends.last24Months.metrics.volatility, 1)
                                                        : '-'}
                                                </span>
                                            ) : '-'}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CustomerAnalysis;
