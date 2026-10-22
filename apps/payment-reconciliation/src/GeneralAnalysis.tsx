import React, { useMemo, useState } from 'react';
import type { ReconciledRow, DateRangeOption } from './types';
import { analyzeCustomerPayments, getUniqueCustomers, getFilteredDataByDate, getDPDColor, getOnTimeColor, getSeverityColor, getVolatilityColor } from './customerAnalysisUtils';
import { applyExtraFilters, filterAndSortMetrics } from './metrics/generalAnalysisMetrics';
import { ArrowUpDown, FileDown, Filter, Eye, X, GripVertical } from 'lucide-react';
import { SkeletonAnalytics } from './SkeletonLoader';
import { LoadErrorState } from './components/LoadErrorState';
import { ariaSort } from '@suite/a11y';

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
  /** FE-414: mensaje de la carga fallida; con él no se pinta la tabla vacía. */
  error?: string | null;
  /** Vuelve a pedir los datos desde el aviso de error. */
  onRetry?: () => void;
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
  error,
  onRetry,
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
    const byDate = getFilteredDataByDate(reconciledData, dateRange, customStartDate, customEndDate);
    return applyExtraFilters(byDate, { selectedPaymentStatus, minAmount, maxAmount });
  }, [reconciledData, dateRange, customStartDate, customEndDate, selectedPaymentStatus, minAmount, maxAmount]);

  const uniqueCustomers = useMemo(() => {
    return getUniqueCustomers(filteredDataByDate);
  }, [filteredDataByDate]);

  const customersMetrics = useMemo(() => {
    return uniqueCustomers
      .map((customer) => analyzeCustomerPayments(filteredDataByDate, customer))
      .filter((metrics) => metrics.totalInvoices > 0);
  }, [filteredDataByDate, uniqueCustomers]);

  const sortedAndFilteredMetrics = useMemo(
    () => filterAndSortMetrics(customersMetrics, {
      selectedCustomer, searchTerm, dpdMin, dpdMax, onTimeMin, onTimeMax, sortConfig,
    }),
    [customersMetrics, selectedCustomer, searchTerm, dpdMin, dpdMax, onTimeMin, onTimeMax, sortConfig],
  );

  const handleSort = (key: string) => {
    setSortConfig((current) => {
      if (current?.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  // Encabezado ordenable (antes repetido seis veces a mano con las mismas clases).
  // FE-419 — el contenido es un <button> para que la cabecera se alcance con Tab y se
  // anuncie como accionable; sin onClick propio, su clic (también el de Enter y Espacio)
  // sube al <th>, que ordena como siempre. `uppercase` se repite porque el preflight de
  // Tailwind anula text-transform en los botones. aria-sort declara el sentido.
  const sortableHeader = (key: string, label: string, align: 'left' | 'right') => {
    const active = sortConfig?.key === key;
    return (
      <th
        key={key}
        onClick={() => handleSort(key)}
        aria-sort={ariaSort(active, sortConfig?.direction === 'asc')}
        className={`px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors group${align === 'right' ? ' text-right' : ''}`}
      >
        <button type="button" className={`flex w-full items-center gap-1 uppercase${align === 'right' ? ' justify-end' : ''}`}>
          {label}
          <ArrowUpDown size={14} className={active ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'} />
        </button>
      </th>
    );
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

  const downloadExcel = async () => {
    const XLSX = await import('xlsx');
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
            {/* FE-419: el panel se despliega dentro de la página (no es modal): el botón
                dice con aria-expanded si está abierto. Igual el de «Columnas». */}
            <button
              onClick={() => setShowFilterPanel(!showFilterPanel)}
              aria-expanded={showFilterPanel}
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

            {/* Payment Status Filter. FE-419: este rótulo y los de los dos rangos de abajo
                eran <label> sin control asociado (no nombraban nada); ahora nombran su
                grupo, y cada casilla de mínimo/máximo lleva su propio nombre. */}
            <div className="flex flex-col gap-2">
              <span id="payment-status-label-general" className="text-sm font-semibold text-slate-700">
                Estado de Pago
              </span>
              <div role="group" aria-labelledby="payment-status-label-general" className="space-y-2 p-3 bg-slate-50 border border-slate-300 rounded-lg">
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
              <span id="dpd-range-label-general" className="text-sm font-semibold text-slate-700">
                DPD Promedio (días)
              </span>
              <div role="group" aria-labelledby="dpd-range-label-general" className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  aria-label="DPD promedio mínimo"
                  value={dpdMin}
                  onChange={(e) => setDpdMin(e.target.value)}
                  placeholder="Mín"
                  className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
                />
                <input
                  type="number"
                  aria-label="DPD promedio máximo"
                  value={dpdMax}
                  onChange={(e) => setDpdMax(e.target.value)}
                  placeholder="Máx"
                  className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
                />
              </div>
            </div>

            {/* % On Time Range */}
            <div className="flex flex-col gap-2">
              <span id="on-time-range-label-general" className="text-sm font-semibold text-slate-700">
                % A Tiempo
              </span>
              <div role="group" aria-labelledby="on-time-range-label-general" className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  aria-label="% a tiempo mínimo"
                  value={onTimeMin}
                  onChange={(e) => setOnTimeMin(e.target.value)}
                  placeholder="Mín %"
                  min="0"
                  max="100"
                  className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
                />
                <input
                  type="number"
                  aria-label="% a tiempo máximo"
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
                Monto Mínimo (COP)
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
                Monto Máximo (COP)
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

      {/* FE-414: tras una carga fallida `reconciledData` llega vacío; sin el
          aviso la tabla decía «Mostrando 0 clientes» como si no hubiera datos. */}
      {loading ? (
        <SkeletonAnalytics cards={9} />
      ) : error ? (
        <LoadErrorState message={error} onRetry={onRetry} />
      ) : (
        <>
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

                {/* Custom Dates. FE-419: sin rótulo visible (solo la «a» entre ellas), el
                    nombre de cada fecha va en aria-label. */}
                {dateRange === 'custom' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      aria-label="Fecha de inicio"
                      value={customStartDate}
                      onChange={(e) => onCustomStartDateChange?.(e.target.value)}
                      className="bg-white border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 p-2 shadow-sm shadow-indigo-100/20"
                    />
                    <span className="text-slate-400">a</span>
                    <input
                      type="date"
                      aria-label="Fecha de fin"
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
                    aria-expanded={showColumnPanel}
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
                      
                      if (column === 'customerName') return sortableHeader('customerName', 'Nombre de Cliente', 'left');
                      if (column === 'averageDPD') return sortableHeader('averageDPD', 'DPD Promedio', 'right');
                      if (column === 'onTimePercentage') return sortableHeader('onTimePercentage', '% A Tiempo', 'right');
                      if (column === 'weightedDPD') return sortableHeader('weightedDPD', 'Severidad', 'right');
                      if (column === 'volatility') return sortableHeader('volatility', 'Volatilidad', 'right');
                      if (column === 'volatilityMora') return sortableHeader('volatilityMora', 'Volatilidad Mora', 'right');
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
        </>
      )}
    </div>
  );
};

export default GeneralAnalysis;
