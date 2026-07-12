import React, { useMemo, useState } from 'react';
import type { ReconciledRow, DateRangeOption } from './types';
import { analyzeCustomerPayments, getUniqueCustomers, getFilteredDataByDate, getDPDColor, getOnTimeColor, getSeverityColor, getVolatilityColor, getPreviousPeriodBounds, getDateRangeBounds, parseExcelDate } from './customerAnalysisUtils';
import { ArrowUpDown, FileDown, Filter, DollarSign, TrendingUp, TrendingDown, AlertTriangle, Info, Eye, X, GripVertical } from 'lucide-react';
import * as XLSX from 'xlsx';
import { SkeletonAnalytics } from './SkeletonLoader';

interface TooltipProps {
  title: string;
  description: string;
  formula?: string;
}

const InfoTooltip: React.FC<TooltipProps> = ({ title, description, formula }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        className="p-1 hover:bg-white/50 rounded-full transition-colors"
        type="button"
      >
        <Info size={16} className="text-slate-400 hover:text-slate-600" />
      </button>
      {isVisible && (
        <div className="absolute z-50 w-72 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-xl -left-32 top-8">
          <div className="font-bold mb-1">{title}</div>
          <div className="text-slate-200 mb-2">{description}</div>
          {formula && (
            <div className="bg-slate-700 p-2 rounded mt-2 font-mono text-xs">
              {formula}
            </div>
          )}
          <div className="absolute -top-2 left-36 w-0 h-0 border-l-8 border-r-8 border-b-8 border-transparent border-b-slate-800"></div>
        </div>
      )}
    </div>
  );
};

interface GeneralAnalysisProps {
  reconciledData: ReconciledRow[];
  dateRange?: DateRangeOption;
  customStartDate?: string;
  customEndDate?: string;
  onDateRangeChange?: (range: DateRangeOption) => void;
  onCustomStartDateChange?: (date: string) => void;
  onCustomEndDateChange?: (date: string) => void;
  onCustomerClick?: (customerName: string) => void;
  loading?: boolean;
  mode?: 'analysis' | 'kpis';
}

const GeneralAnalysis: React.FC<GeneralAnalysisProps> = ({
  reconciledData,
  dateRange = 'all',
  customStartDate = '',
  customEndDate = '',
  onDateRangeChange,
  onCustomStartDateChange,
  onCustomEndDateChange,
  onCustomerClick,
  loading = false,
  mode = 'analysis',
}) => {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({
    key: 'customerName',
    direction: 'asc',
  });
  const [selectedCustomer, setSelectedCustomer] = useState('all');
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState<string[]>([]);
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [dpdMin, setDpdMin] = useState('');
  const [dpdMax, setDpdMax] = useState('');
  const [onTimeMin, setOnTimeMin] = useState('');
  const [onTimeMax, setOnTimeMax] = useState('');
  const [columnVisibility, setColumnVisibility] = useState({
    customerName: true,
    averageDPD: true,
    onTimePercentage: true,
    weightedDPD: true,
    volatility: true,
    volatilityMora: true,
  });
  
  const [columnOrder, setColumnOrder] = useState<string[]>(['customerName', 'averageDPD', 'onTimePercentage', 'weightedDPD', 'volatility', 'volatilityMora']);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);

  const handleDragStart = (columnKey: string) => {
    setDraggedColumn(columnKey);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (targetColumnKey: string) => {
    if (!draggedColumn || draggedColumn === targetColumnKey) {
      setDraggedColumn(null);
      return;
    }

    const newOrder = [...columnOrder];
    const draggedIndex = newOrder.indexOf(draggedColumn);
    const targetIndex = newOrder.indexOf(targetColumnKey);

    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedColumn);

    setColumnOrder(newOrder);
    setDraggedColumn(null);
  };

  const filteredDataByDate = useMemo(() => {
    let data = getFilteredDataByDate(reconciledData, dateRange, customStartDate, customEndDate);
    
    // Apply payment status filter
    if (selectedPaymentStatus.length > 0) {
      data = data.filter(row => {
        let status = 'pending';
        if (row.balance === 0) status = 'paid';
        else if (row.balance < row.total) status = 'partial';
        return selectedPaymentStatus.includes(status);
      });
    }

    // Apply amount range filter
    if (minAmount || maxAmount) {
      data = data.filter(row => {
        const min = minAmount ? parseFloat(minAmount) : 0;
        const max = maxAmount ? parseFloat(maxAmount) : Infinity;
        return row.total >= min && row.total <= max;
      });
    }

    return data;
  }, [reconciledData, dateRange, customStartDate, customEndDate, selectedPaymentStatus, minAmount, maxAmount]);

  const uniqueCustomers = useMemo(() => {
    return getUniqueCustomers(filteredDataByDate);
  }, [filteredDataByDate]);

  const customersMetrics = useMemo(() => {
    return uniqueCustomers
      .map((customer) => analyzeCustomerPayments(filteredDataByDate, customer))
      .filter((metrics) => metrics.totalInvoices > 0);
  }, [filteredDataByDate, uniqueCustomers]);

  const sortedAndFilteredMetrics = useMemo(() => {
    let result = customersMetrics.filter((m) => {
      return selectedCustomer === 'all' || m.customerName === selectedCustomer;
    });

    const term = searchTerm.trim().toLowerCase();
    if (term) {
      result = result.filter((m) => m.customerName.toLowerCase().includes(term));
    }

    if (dpdMin) {
      const minVal = parseFloat(dpdMin);
      result = result.filter((m) => m.averageDPD !== null && m.averageDPD >= minVal);
    }
    if (dpdMax) {
      const maxVal = parseFloat(dpdMax);
      result = result.filter((m) => m.averageDPD !== null && m.averageDPD <= maxVal);
    }

    if (onTimeMin) {
      const minVal = parseFloat(onTimeMin);
      result = result.filter((m) => m.onTimePercentage !== null && m.onTimePercentage >= minVal);
    }
    if (onTimeMax) {
      const maxVal = parseFloat(onTimeMax);
      result = result.filter((m) => m.onTimePercentage !== null && m.onTimePercentage <= maxVal);
    }

    if (sortConfig) {
      result.sort((a: any, b: any) => {
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];

        if (valA === null) return 1;
        if (valB === null) return -1;

        if (typeof valA === 'string') {
          valA = valA.toLowerCase();
          valB = valB.toLowerCase();
        }

        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [customersMetrics, selectedCustomer, searchTerm, dpdMin, dpdMax, onTimeMin, onTimeMax, sortConfig]);

  const totalReconciledAmount = useMemo(() => {
    return filteredDataByDate.reduce((sum, invoice) => sum + invoice.total, 0);
  }, [filteredDataByDate]);

  const previousPeriodAmount = useMemo(() => {
    if (dateRange === 'all' || dateRange === 'custom') {
      return 0;
    }
    const prevBounds = getPreviousPeriodBounds(dateRange, customStartDate, customEndDate);
    if (!prevBounds.start || !prevBounds.end) return 0;

    return reconciledData
      .filter((invoice) => {
        const invoiceDate = invoice.invoiceDate instanceof Date ? invoice.invoiceDate : parseExcelDate(invoice.invoiceDate);
        if (!invoiceDate) return false;
        return invoiceDate >= prevBounds.start! && invoiceDate <= prevBounds.end!;
      })
      .reduce((sum, invoice) => sum + invoice.total, 0);
  }, [reconciledData, dateRange, customStartDate, customEndDate]);

  const revenueVariation = useMemo(() => {
    if (previousPeriodAmount === 0) return null;
    return ((totalReconciledAmount - previousPeriodAmount) / previousPeriodAmount) * 100;
  }, [totalReconciledAmount, previousPeriodAmount]);

  const recoveryRate = useMemo(() => {
    const totalInvoices = filteredDataByDate.length;
    if (totalInvoices === 0) return 0;
    
    const invoicesWithPayments = filteredDataByDate.filter(
      invoice => invoice.paymentDetails && invoice.paymentDetails.length > 0
    ).length;
    
    return (invoicesWithPayments / totalInvoices) * 100;
  }, [filteredDataByDate]);

  const averageDSO = useMemo(() => {
    const invoicesWithPayments = filteredDataByDate.filter(
      invoice => invoice.paymentDetails && invoice.paymentDetails.length > 0
    );

    if (invoicesWithPayments.length === 0) return 0;

    const totalDays = invoicesWithPayments.reduce((sum, invoice) => {
      // Use DUE DATE (Fecha de Vencimiento), not invoice date
      const dueDate = invoice.dueDate instanceof Date 
        ? invoice.dueDate 
        : parseExcelDate(invoice.dueDate);
      
      if (!dueDate || !invoice.paymentDetails || invoice.paymentDetails.length === 0) {
        return sum;
      }

      // Take the LAST payment date to measure when collection was completed
      const lastPaymentDateStr = invoice.paymentDetails[invoice.paymentDetails.length - 1].date;
      let paymentDate: Date | null = null;

      // Parse the payment date from string format
      if (lastPaymentDateStr) {
        const parsed = parseExcelDate(lastPaymentDateStr as any);
        if (parsed instanceof Date && !isNaN(parsed.getTime())) {
          paymentDate = parsed;
        }
      }
      
      if (!paymentDate) {
        return sum;
      }

      // Calculate days between DUE DATE and LAST payment (DSO = DPD)
      const daysToPayment = Math.round((paymentDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      
      return sum + daysToPayment;
    }, 0);

    return Math.round(totalDays / invoicesWithPayments.length);
  }, [filteredDataByDate]);

  const overdueMetrics = useMemo(() => {
    const overdueInvoices = filteredDataByDate.filter(
      invoice => invoice.isOverdue && invoice.balance > 0
    );

    const overdueClientsSet = new Set(
      overdueInvoices.map(invoice => invoice.clientName)
    );

    const totalOverdueAmount = overdueInvoices.reduce(
      (sum, invoice) => sum + invoice.balance, 
      0
    );

    return {
      customerCount: overdueClientsSet.size,
      invoiceCount: overdueInvoices.length,
      totalAmount: totalOverdueAmount
    };
  }, [filteredDataByDate]);

  const topCustomersByVolume = useMemo(() => {
    const customerTotals = new Map<string, number>();

    filteredDataByDate.forEach(invoice => {
      // Skip invoices with empty or null client names
      if (!invoice.clientName || invoice.clientName.trim() === '') {
        return;
      }
      
      const current = customerTotals.get(invoice.clientName) || 0;
      customerTotals.set(invoice.clientName, current + invoice.total);
    });

    return Array.from(customerTotals.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [filteredDataByDate]);

  const customerRetention = useMemo(() => {
    const { start } = getDateRangeBounds(dateRange, customStartDate, customEndDate);
    
    // Get unique customers in current period
    const currentPeriodCustomers = new Set(
      filteredDataByDate.map(invoice => invoice.clientName)
    );

    if (!start || currentPeriodCustomers.size === 0) {
      return { newCustomers: 0, recurringCustomers: 0, retentionRate: 0 };
    }

    // Check which customers had invoices BEFORE the current period
    const recurringCustomers = new Set<string>();
    const newCustomers = new Set<string>();

    currentPeriodCustomers.forEach(customerName => {
      const hadPreviousInvoices = reconciledData.some(invoice => {
        if (invoice.clientName !== customerName) return false;
        
        const invoiceDate = invoice.invoiceDate instanceof Date 
          ? invoice.invoiceDate 
          : parseExcelDate(invoice.invoiceDate);
        
        return invoiceDate && invoiceDate < start;
      });

      if (hadPreviousInvoices) {
        recurringCustomers.add(customerName);
      } else {
        newCustomers.add(customerName);
      }
    });

    const retentionRate = currentPeriodCustomers.size > 0
      ? (recurringCustomers.size / currentPeriodCustomers.size) * 100
      : 0;

    return {
      newCustomers: newCustomers.size,
      recurringCustomers: recurringCustomers.size,
      retentionRate
    };
  }, [filteredDataByDate, reconciledData, dateRange, customStartDate, customEndDate]);

  const handleSort = (key: string) => {
    setSortConfig((current) => {
      if (current?.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const toggleColumnVisibility = (column: string) => {
    setColumnVisibility((prev) => ({
      ...prev,
      [column]: !prev[column as keyof typeof prev],
    }));
  };

  const columnLabels: Record<string, string> = {
    customerName: 'Nombre de Cliente',
    averageDPD: 'DPD Promedio',
    onTimePercentage: '% A Tiempo',
    weightedDPD: 'Índice de Severidad',
    volatility: 'Volatilidad',
    volatilityMora: 'Volatilidad Mora',
  };

  const formatNumber = (num: number, decimals: number = 2) => {
    return num.toLocaleString('es-CO', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const downloadExcel = () => {
    const exportData = sortedAndFilteredMetrics.map((m) => ({
      'Nombre de Cliente': m.customerName,
      'DPD Promedio': m.averageDPD,
      '% A Tiempo': m.onTimePercentage / 100,
      'Severidad (DPD Ponderado)': m.weightedDPD,
      Volatilidad: m.volatility === null ? 'Evidencia insuficiente' : m.volatility,
      'Volatilidad Mora': m.volatilityMora === null ? 'Evidencia insuficiente' : m.volatilityMora,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);

    // Formatting for spreadsheet
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:F1');
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const pctCell = worksheet[XLSX.utils.encode_cell({ r: R, c: 2 })];
      if (pctCell) pctCell.z = '0.00%';
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Análisis General');
    XLSX.writeFile(workbook, 'Analisis_General_Clientes.xlsx');
  };

  return (
    <div className="space-y-6 fade-in">
      {/* Header con controles */}
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1">
            <button
              onClick={() => setShowFilterPanel(!showFilterPanel)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors shadow-md hover:shadow-lg ${
                showFilterPanel
                  ? 'text-white bg-indigo-700 hover:bg-indigo-800'
                  : 'text-white bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              <Filter size={18} />
              Filtros Avanzados
              {(selectedPaymentStatus.length > 0 || minAmount || maxAmount) && (
                <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                  {(selectedPaymentStatus.length > 0 ? 1 : 0) + (minAmount || maxAmount ? 1 : 0)}
                </span>
              )}
            </button>
            
            {(selectedPaymentStatus.length > 0 || minAmount || maxAmount) && (
              <button
                onClick={() => {
                  setSelectedPaymentStatus([]);
                  setMinAmount('');
                  setMaxAmount('');
                }}
                className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors border border-red-200 hover:border-red-300"
              >
                <X size={16} />
                Limpiar Filtros
              </button>
            )}
          </div>
          
          <button
            onClick={downloadExcel}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-md hover:shadow-lg text-sm font-semibold"
          >
            <FileDown size={18} />
            Exportar a Excel
          </button>
        </div>
      </div>

      {/* Advanced Filters Side Panel */}
      {showFilterPanel && (
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-800">Opciones de Filtrado</h3>
            <button
              onClick={() => {
                setSelectedCustomer('all');
                onDateRangeChange?.('all');
                onCustomStartDateChange?.('');
                onCustomEndDateChange?.('');
                setSelectedPaymentStatus([]);
                setMinAmount('');
                setMaxAmount('');
                setSearchTerm('');
                setDpdMin('');
                setDpdMax('');
                setOnTimeMin('');
                setOnTimeMax('');
              }}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-3 py-1 rounded transition-colors"
            >
              Resetear Filtros
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Search by Customer Name */}
            <div className="flex flex-col gap-2">
              <label htmlFor="customer-search" className="text-sm font-semibold text-slate-700">
                Buscar cliente
              </label>
              <input
                id="customer-search"
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Nombre o parte del nombre"
                className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
              />
            </div>

            {/* Client Filter */}
            <div className="flex flex-col gap-2">
              <label htmlFor="client-filter-general" className="text-sm font-semibold text-slate-700">
                Filtrar por Cliente
              </label>
              <div className="relative">
                <select
                  id="client-filter-general"
                  value={selectedCustomer}
                  onChange={(e) => setSelectedCustomer(e.target.value)}
                  className="appearance-none bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent block w-full p-2.5 pr-8 shadow-sm cursor-pointer hover:border-indigo-400 transition-colors"
                >
                  <option value="all">Todos los clientes ({uniqueCustomers.length})</option>
                  {uniqueCustomers.map(customer => (
                    <option key={customer} value={customer}>{customer}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
              </div>
            </div>

            {/* Date Range Filter */}
            <div className="flex flex-col gap-2">
              <label htmlFor="date-filter-general" className="text-sm font-semibold text-slate-700">
                Período
              </label>
              <div className="relative">
                <select
                  id="date-filter-general"
                  value={dateRange}
                  onChange={(e) => onDateRangeChange?.(e.target.value as DateRangeOption)}
                  className="appearance-none bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent block w-full p-2.5 pr-8 shadow-sm cursor-pointer hover:border-indigo-400 transition-colors"
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

            {/* Custom Date Range */}
            {dateRange === 'custom' && (
              <div className="flex flex-col gap-2">
                <label htmlFor="start-date-general" className="text-sm font-semibold text-slate-700">
                  Fecha de Inicio
                </label>
                <input
                  id="start-date-general"
                  type="date"
                  value={customStartDate}
                  onChange={(e) => onCustomStartDateChange?.(e.target.value)}
                  className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
                />
              </div>
            )}
            
            {dateRange === 'custom' && (
              <div className="flex flex-col gap-2">
                <label htmlFor="end-date-general" className="text-sm font-semibold text-slate-700">
                  Fecha de Fin
                </label>
                <input
                  id="end-date-general"
                  type="date"
                  value={customEndDate}
                  onChange={(e) => onCustomEndDateChange?.(e.target.value)}
                  className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
                />
              </div>
            )}

            {/* Payment Status Filter */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-700">
                Estado de Pago
              </label>
              <div className="space-y-2 p-3 bg-slate-50 border border-slate-300 rounded-lg">
                <label className="flex items-center gap-2 cursor-pointer hover:bg-white p-2 rounded transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedPaymentStatus.includes('paid')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedPaymentStatus([...selectedPaymentStatus, 'paid']);
                      } else {
                        setSelectedPaymentStatus(selectedPaymentStatus.filter(s => s !== 'paid'));
                      }
                    }}
                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded cursor-pointer"
                  />
                  <span className="text-sm text-slate-700">✓ Pagado</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer hover:bg-white p-2 rounded transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedPaymentStatus.includes('partial')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedPaymentStatus([...selectedPaymentStatus, 'partial']);
                      } else {
                        setSelectedPaymentStatus(selectedPaymentStatus.filter(s => s !== 'partial'));
                      }
                    }}
                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded cursor-pointer"
                  />
                  <span className="text-sm text-slate-700">◐ Parcial</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer hover:bg-white p-2 rounded transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedPaymentStatus.includes('pending')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedPaymentStatus([...selectedPaymentStatus, 'pending']);
                      } else {
                        setSelectedPaymentStatus(selectedPaymentStatus.filter(s => s !== 'pending'));
                      }
                    }}
                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded cursor-pointer"
                  />
                  <span className="text-sm text-slate-700">○ Pendiente</span>
                </label>
              </div>
            </div>

            {/* DPD Range Filter */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-700">
                DPD Promedio (días)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  value={dpdMin}
                  onChange={(e) => setDpdMin(e.target.value)}
                  placeholder="Mín"
                  className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
                />
                <input
                  type="number"
                  value={dpdMax}
                  onChange={(e) => setDpdMax(e.target.value)}
                  placeholder="Máx"
                  className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
                />
              </div>
            </div>

            {/* % On Time Range */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-700">
                % A Tiempo
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  value={onTimeMin}
                  onChange={(e) => setOnTimeMin(e.target.value)}
                  placeholder="Mín %"
                  min="0"
                  max="100"
                  className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
                />
                <input
                  type="number"
                  value={onTimeMax}
                  onChange={(e) => setOnTimeMax(e.target.value)}
                  placeholder="Máx %"
                  min="0"
                  max="100"
                  className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
                />
              </div>
            </div>

            {/* Amount Range Filter */}
            <div className="flex flex-col gap-2">
              <label htmlFor="min-amount-general" className="text-sm font-semibold text-slate-700">
                Monto Mínimo (USD)
              </label>
              <input
                id="min-amount-general"
                type="number"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                placeholder="0"
                className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="max-amount-general" className="text-sm font-semibold text-slate-700">
                Monto Máximo (USD)
              </label>
              <input
                id="max-amount-general"
                type="number"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                placeholder="Ilimitado"
                className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
              />
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonAnalytics cards={9} />
      ) : (
        <>
          {mode === 'kpis' && (
            <>
              {/* KPIs Financieros */}
              <div>
                <h3 className="text-lg font-bold text-slate-700 mb-4 flex items-center gap-2">
                  <DollarSign size={24} className="text-emerald-600" />
                  KPIs Financieros
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                  <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-xl shadow-md shadow-emerald-200/20 border border-emerald-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-1 mb-1">
                          <p className="text-emerald-600 text-xs font-semibold uppercase tracking-wide">Monto Total</p>
                          <InfoTooltip
                            title="Monto Total Reconciliado"
                            description="Suma de todas las facturas emitidas en el período seleccionado, independientemente de su estado de pago."
                            formula="Σ(Total de cada factura)"
                          />
                        </div>
                        <p className="text-2xl font-bold text-emerald-700 leading-tight">
                          ${formatNumber(totalReconciledAmount, 0)}
                        </p>
                        <p className="text-emerald-600 text-xs mt-1">{filteredDataByDate.length} facturas</p>
                      </div>
                      <div className="bg-emerald-600/10 p-2 rounded-lg flex-shrink-0">
                        <DollarSign size={24} className="text-emerald-600" />
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl shadow-md shadow-blue-200/20 border border-blue-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-1 mb-1">
                          <p className="text-blue-600 text-xs font-semibold uppercase tracking-wide">Clientes</p>
                          <InfoTooltip
                            title="Clientes Activos"
                            description="Número de clientes únicos que tienen al menos una factura registrada en el período seleccionado."
                            formula="COUNT(DISTINCT clientes con facturas)"
                          />
                        </div>
                        <p className="text-2xl font-bold text-blue-700 leading-tight">
                          {uniqueCustomers.length}
                        </p>
                        <p className="text-blue-600 text-xs mt-1">Activos</p>
                      </div>
                      <div className="bg-blue-600/10 p-2 rounded-lg flex-shrink-0">
                        <span className="text-xl">👥</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 rounded-xl shadow-md shadow-purple-200/20 border border-purple-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-1 mb-1">
                          <p className="text-purple-600 text-xs font-semibold uppercase tracking-wide">Promedio</p>
                          <InfoTooltip
                            title="Promedio por Cliente"
                            description="Monto promedio de facturación por cliente en el período seleccionado."
                            formula="Monto Total / Número de Clientes Activos"
                          />
                        </div>
                        <p className="text-2xl font-bold text-purple-700 leading-tight">
                          ${formatNumber(totalReconciledAmount / (uniqueCustomers.length || 1), 0)}
                        </p>
                        <p className="text-purple-600 text-xs mt-1">Por cliente</p>
                      </div>
                      <div className="bg-purple-600/10 p-2 rounded-lg flex-shrink-0">
                        <span className="text-xl">📊</span>
                      </div>
                    </div>
                  </div>

                  <div
                    className={`bg-gradient-to-br rounded-xl shadow-md border p-4 ${
                      revenueVariation === null
                        ? 'from-slate-50 to-slate-100/50 shadow-slate-200/20 border-slate-200'
                        : revenueVariation >= 0
                        ? 'from-green-50 to-green-100/50 shadow-green-200/20 border-green-200'
                        : 'from-red-50 to-red-100/50 shadow-red-200/20 border-red-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-1 mb-1">
                          <p
                            className={`text-xs font-semibold uppercase tracking-wide ${
                              revenueVariation === null
                                ? 'text-slate-600'
                                : revenueVariation >= 0
                                ? 'text-green-600'
                                : 'text-red-600'
                            }`}
                          >
                            Variación
                          </p>
                          <InfoTooltip
                            title="Variación vs. Período Anterior"
                            description="Cambio porcentual en el monto total reconciliado comparado con el período inmediatamente anterior de igual duración."
                            formula="((Monto Actual - Monto Anterior) / Monto Anterior) × 100%"
                          />
                        </div>
                        {revenueVariation !== null ? (
                          <>
                            <p
                              className={`text-2xl font-bold leading-tight ${
                                revenueVariation >= 0 ? 'text-green-700' : 'text-red-700'
                              }`}
                            >
                              {revenueVariation >= 0 ? '+' : ''}
                              {formatNumber(revenueVariation, 1)}%
                            </p>
                            <p
                              className={`text-xs mt-1 ${
                                revenueVariation >= 0 ? 'text-green-600' : 'text-red-600'
                              }`}
                            >
                              ${formatNumber(Math.abs(totalReconciledAmount - previousPeriodAmount), 0)}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-2xl font-bold text-slate-700 leading-tight">—</p>
                            <p className="text-slate-600 text-xs mt-1">No disponible</p>
                          </>
                        )}
                      </div>
                      <div
                        className={`p-2 rounded-lg flex-shrink-0 ${
                          revenueVariation === null
                            ? 'bg-slate-600/10'
                            : revenueVariation >= 0
                            ? 'bg-green-600/10'
                            : 'bg-red-600/10'
                        }`}
                      >
                        {revenueVariation === null ? (
                          <span className="text-xl">—</span>
                        ) : revenueVariation >= 0 ? (
                          <TrendingUp size={24} className="text-green-600" />
                        ) : (
                          <TrendingDown size={24} className="text-red-600" />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-cyan-50 to-cyan-100/50 rounded-xl shadow-md shadow-cyan-200/20 border border-cyan-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-1 mb-1">
                          <p className="text-cyan-600 text-xs font-semibold uppercase tracking-wide">Recuperación</p>
                          <InfoTooltip
                            title="Tasa de Recuperación"
                            description="Porcentaje de facturas que han recibido al menos un pago, respecto al total de facturas emitidas en el período."
                            formula="(Facturas con Pagos / Total de Facturas) × 100%"
                          />
                        </div>
                        <p className="text-2xl font-bold text-cyan-700 leading-tight">
                          {formatNumber(recoveryRate, 1)}%
                        </p>
                        <p className="text-cyan-600 text-xs mt-1">% pagadas</p>
                      </div>
                      <div className="bg-cyan-600/10 p-2 rounded-lg flex-shrink-0">
                        <span className="text-xl">✓</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-orange-50 to-orange-100/50 rounded-xl shadow-md shadow-orange-200/20 border border-orange-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-1 mb-1">
                          <p className="text-orange-600 text-xs font-semibold uppercase tracking-wide">DSO</p>
                          <InfoTooltip
                            title="DSO Promedio (Days Sales Outstanding)"
                            description="Promedio de días transcurridos desde la fecha de vencimiento hasta que se recibe el último pago de una factura, es decir, cuando se completa la cobranza. Valores positivos indican atraso, negativos indican pago anticipado. Este valor es equivalente al DPD Promedio."
                            formula="AVG(Fecha Último Pago - Fecha Vencimiento)"
                          />
                        </div>
                        <p className="text-2xl font-bold text-orange-700 leading-tight">
                          {averageDSO} días
                        </p>
                        <p className="text-orange-600 text-xs mt-1">Desde vencimiento</p>
                      </div>
                      <div className="bg-orange-600/10 p-2 rounded-lg flex-shrink-0">
                        <span className="text-xl">📅</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* KPIs de Performance */}
              <div>
                <h3 className="text-lg font-bold text-slate-700 mb-4 flex items-center gap-2">
                  <AlertTriangle size={24} className="text-orange-600" />
                  KPIs de Performance
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="bg-gradient-to-br from-red-50 to-red-100/50 rounded-xl shadow-md shadow-red-200/20 border border-red-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-1 mb-1">
                          <p className="text-red-600 text-xs font-semibold uppercase tracking-wide">Atrasos</p>
                          <InfoTooltip
                            title="Clientes con Pagos Atrasados"
                            description="Número de clientes únicos que tienen al menos una factura vencida con saldo pendiente en el período seleccionado."
                            formula="COUNT(DISTINCT clientes con facturas vencidas y balance > 0)"
                          />
                        </div>
                        <p className="text-2xl font-bold text-red-700 leading-tight">
                          {overdueMetrics.customerCount}
                        </p>
                        <p className="text-red-600 text-xs mt-1">
                          {overdueMetrics.invoiceCount} facturas
                        </p>
                        <p className="text-red-600 text-xs text-sm font-medium">
                          ${formatNumber(overdueMetrics.totalAmount, 0)}
                        </p>
                      </div>
                      <div className="bg-red-600/10 p-2 rounded-lg flex-shrink-0">
                        <AlertTriangle size={24} className="text-red-600" />
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-indigo-50 to-indigo-100/50 rounded-xl shadow-md shadow-indigo-200/20 border border-indigo-200 p-4">
                    <div className="flex flex-col h-full">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-1">
                          <p className="text-indigo-600 text-xs font-semibold uppercase tracking-wide">Top 10</p>
                          <InfoTooltip
                            title="Top 10 Clientes por Volumen"
                            description="Ranking de los 10 clientes con mayor monto total de facturación en el período seleccionado, ordenados de mayor a menor."
                            formula="ORDER BY Σ(Total facturas por cliente) DESC LIMIT 10"
                          />
                        </div>
                        <div className="bg-indigo-600/10 p-1 rounded-lg">
                          <span className="text-lg">🏆</span>
                        </div>
                      </div>
                      <div className="flex-1 overflow-y-auto max-h-48">
                        {topCustomersByVolume.length > 0 ? (
                          <div className="space-y-2">
                            {topCustomersByVolume.map((customer, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between bg-white/50 rounded-lg p-2 hover:bg-white/80 transition-colors"
                              >
                                <div className="flex items-center gap-2 flex-1">
                                  <span
                                    className={`text-xs font-bold px-2 py-1 rounded ${
                                      idx === 0
                                        ? 'bg-yellow-500 text-white'
                                        : idx === 1
                                        ? 'bg-slate-400 text-white'
                                        : idx === 2
                                        ? 'bg-amber-700 text-white'
                                        : 'bg-indigo-100 text-indigo-700'
                                    }`}
                                  >
                                    {idx + 1}
                                  </span>
                                  <button
                                    onClick={() => onCustomerClick?.(customer.name)}
                                    className="text-sm font-medium text-slate-700 hover:text-indigo-600 truncate max-w-[200px] text-left transition-colors cursor-pointer underline decoration-dotted"
                                    title={`Ver análisis de ${customer.name}`}
                                  >
                                    {customer.name}
                                  </button>
                                </div>
                                <span className="text-sm font-bold text-indigo-700">
                                  ${formatNumber(customer.total, 0)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-slate-500 text-sm text-center py-8">No hay datos disponibles</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Retención */}
              <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 rounded-xl shadow-md shadow-purple-200/20 border border-purple-200 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-1 mb-1">
                      <p className="text-purple-600 text-xs font-semibold uppercase tracking-wide">Retención</p>
                      <InfoTooltip
                        title="Análisis de Retención de Clientes"
                        description="Comparación entre clientes nuevos (primera factura en el período) y recurrentes (con historial anterior). La tasa de retención indica el porcentaje de clientes recurrentes sobre el total."
                        formula="Tasa Retención = (Clientes Recurrentes / Total Clientes Período) × 100%"
                      />
                    </div>
                    <div className="flex items-baseline gap-2 mb-2">
                      <div>
                        <p className="text-2xl font-bold text-purple-700 leading-tight">
                          {customerRetention.retentionRate.toFixed(1)}%
                        </p>
                        <p className="text-purple-600 text-xs mt-0.5">Tasa</p>
                      </div>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <div className="bg-emerald-100 px-2 py-1 rounded text-center min-w-fit">
                        <p className="text-emerald-700 font-bold">{customerRetention.recurringCustomers}</p>
                        <p className="text-emerald-600 text-xs">Recurrentes</p>
                      </div>
                      <div className="bg-blue-100 px-2 py-1 rounded text-center min-w-fit">
                        <p className="text-blue-700 font-bold">{customerRetention.newCustomers}</p>
                        <p className="text-blue-600 text-xs">Nuevos</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-purple-600/10 p-2 rounded-lg flex-shrink-0">
                    <span className="text-xl">🔄</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {mode !== 'kpis' && (
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-6 bg-slate-50/50">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 flex-1">
                {/* Customer Filter removed from header; available via Advanced Filters panel */}

                {/* Period Filter */}
                <div className="flex items-center gap-3">
                  <label htmlFor="gen-date-filter" className="text-sm font-semibold text-slate-600 whitespace-nowrap">
                    Período:
                  </label>
                  <div className="relative">
                    <select
                      id="gen-date-filter"
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

                  <div className="flex items-center gap-6">
                <div className="hidden lg:block text-sm font-medium text-slate-500">
                  Mostrando <span className="text-indigo-600 font-bold">{sortedAndFilteredMetrics.length}</span> clientes
                </div>

                <div className="relative">
                  <button
                    onClick={() => setShowColumnPanel(!showColumnPanel)}
                    className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded-lg transition-all font-medium text-sm"
                  >
                    <Eye size={18} />
                    Columnas
                  </button>
                  {showColumnPanel && (
                    <div className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-lg shadow-lg z-10 p-4 min-w-[250px]">
                      <div className="text-xs text-slate-500 mb-3 font-medium">Arrastra para reordenar</div>
                      <div className="space-y-1">
                        {columnOrder.map((key) => (
                          <label 
                            key={key} 
                            draggable
                            onDragStart={() => handleDragStart(key)}
                            onDragOver={handleDragOver}
                            onDrop={() => handleDrop(key)}
                            className={`flex items-center gap-2 p-2 rounded transition-all ${
                              draggedColumn === key 
                                ? 'opacity-50 cursor-grabbing' 
                                : 'cursor-grab hover:bg-slate-50'
                            } ${
                              draggedColumn && draggedColumn !== key
                                ? 'border-2 border-dashed border-indigo-300'
                                : 'border-2 border-transparent'
                            }`}
                          >
                            <GripVertical size={16} className="text-slate-400 flex-shrink-0" />
                            <input
                              type="checkbox"
                              checked={columnVisibility[key as keyof typeof columnVisibility]}
                              onChange={() => toggleColumnVisibility(key)}
                              className="w-4 h-4 rounded border-slate-300 text-indigo-600 cursor-pointer flex-shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="text-sm text-slate-700 flex-1">{columnLabels[key]}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={downloadExcel}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-emerald-200/50 font-bold text-sm active:scale-95 whitespace-nowrap"
                >
                  <FileDown size={18} />
                  Exportar Reporte
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200">
                    {columnOrder.map((column) => {
                      if (!columnVisibility[column as keyof typeof columnVisibility]) return null;
                      
                      if (column === 'customerName') {
                        return (
                          <th
                            key={column}
                            onClick={() => handleSort('customerName')}
                            className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors group"
                          >
                            <div className="flex items-center gap-1">
                              Nombre de Cliente
                              <ArrowUpDown size={14} className={sortConfig?.key === 'customerName' ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'} />
                            </div>
                          </th>
                        );
                      }
                      if (column === 'averageDPD') {
                        return (
                          <th
                            key={column}
                            onClick={() => handleSort('averageDPD')}
                            className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors group text-right"
                          >
                            <div className="flex items-center justify-end gap-1">
                              DPD Promedio
                              <ArrowUpDown size={14} className={sortConfig?.key === 'averageDPD' ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'} />
                            </div>
                          </th>
                        );
                      }
                      if (column === 'onTimePercentage') {
                        return (
                          <th
                            key={column}
                            onClick={() => handleSort('onTimePercentage')}
                            className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors group text-right"
                          >
                            <div className="flex items-center justify-end gap-1">
                              % A Tiempo
                              <ArrowUpDown size={14} className={sortConfig?.key === 'onTimePercentage' ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'} />
                            </div>
                          </th>
                        );
                      }
                      if (column === 'weightedDPD') {
                        return (
                          <th
                            key={column}
                            onClick={() => handleSort('weightedDPD')}
                            className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors group text-right"
                          >
                            <div className="flex items-center justify-end gap-1">
                              Severidad
                              <ArrowUpDown size={14} className={sortConfig?.key === 'weightedDPD' ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'} />
                            </div>
                          </th>
                        );
                      }
                      if (column === 'volatility') {
                        return (
                          <th
                            key={column}
                            onClick={() => handleSort('volatility')}
                            className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors group text-right"
                          >
                            <div className="flex items-center justify-end gap-1">
                              Volatilidad
                              <ArrowUpDown size={14} className={sortConfig?.key === 'volatility' ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'} />
                            </div>
                          </th>
                        );
                      }
                      if (column === 'volatilityMora') {
                        return (
                          <th
                            key={column}
                            onClick={() => handleSort('volatilityMora')}
                            className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors group text-right"
                          >
                            <div className="flex items-center justify-end gap-1">
                              Volatilidad Mora
                              <ArrowUpDown size={14} className={sortConfig?.key === 'volatilityMora' ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'} />
                            </div>
                          </th>
                        );
                      }
                      return null;
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedAndFilteredMetrics.map((m, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/30 transition-colors">
                      {columnOrder.map((column) => {
                        if (!columnVisibility[column as keyof typeof columnVisibility]) return null;
                        
                        if (column === 'customerName') {
                          return (
                            <td key={column} className="px-6 py-4 text-sm font-semibold text-slate-600">
                              <button
                                onClick={() => onCustomerClick?.(m.customerName)}
                                className="text-slate-600 hover:text-slate-900 transition-colors cursor-pointer text-left font-bold"
                              >
                                {m.customerName}
                              </button>
                            </td>
                          );
                        }
                        if (column === 'averageDPD') {
                          return (
                            <td key={column} className="px-6 py-4 text-sm text-right font-semibold">
                              <span className={getDPDColor(m.averageDPD, true)}>
                                {formatNumber(m.averageDPD)} días
                              </span>
                            </td>
                          );
                        }
                        if (column === 'onTimePercentage') {
                          return (
                            <td key={column} className="px-6 py-4 text-sm text-right font-semibold">
                              <span className={getOnTimeColor(m.onTimePercentage, true)}>
                                {formatNumber(m.onTimePercentage, 1)}%
                              </span>
                            </td>
                          );
                        }
                        if (column === 'weightedDPD') {
                          return (
                            <td key={column} className={`px-6 py-4 text-sm text-right font-semibold ${getSeverityColor(m.weightedDPD, true)}`}>
                              {formatNumber(m.weightedDPD)}
                            </td>
                          );
                        }
                        if (column === 'volatility') {
                          return (
                            <td key={column} className={`px-6 py-4 text-sm text-right font-semibold ${getVolatilityColor(m.volatility, true)}`}>
                              {m.volatility !== null ? formatNumber(m.volatility) : <span className="text-slate-400 italic text-xs">Evidencia insuficiente</span>}
                            </td>
                          );
                        }
                        if (column === 'volatilityMora') {
                          return (
                            <td key={column} className={`px-6 py-4 text-sm text-right font-semibold ${getVolatilityColor(m.volatilityMora, true)}`}>
                              {m.volatilityMora !== null ? formatNumber(m.volatilityMora) : <span className="text-slate-400 italic text-xs">Evidencia insuficiente</span>}
                            </td>
                          );
                        }
                        return null;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </>
      )}
    </div>
  );
};

export default GeneralAnalysis;
