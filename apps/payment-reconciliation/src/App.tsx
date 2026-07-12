import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileDown, Table as TableIcon, CheckCircle2, AlertCircle, Filter, ArrowUpDown, BarChart3, LayoutGrid, Eye, X, GripVertical } from 'lucide-react';
import './App.css';
import type { InvoiceDetails, PaymentRecord, ReconciledRow, DateRangeOption } from './types';
import CustomerAnalysis from './CustomerAnalysis';
import GeneralAnalysis from './GeneralAnalysis';
import { getDateRangeBounds, parseExcelDate } from './customerAnalysisUtils';
import { SkeletonTableBody, SkeletonHeader, SkeletonFilterPanel } from './SkeletonLoader';

type ActiveView = 'reconciliation' | 'analysis' | 'general' | 'kpis';

function App() {
  const [invoices, setInvoices] = useState<InvoiceDetails[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [reconciledData, setReconciledData] = useState<ReconciledRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<string>('all');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('reconciliation');
  const [dateRange, setDateRange] = useState<DateRangeOption>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState<string[]>([]);
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  type ColumnVisibility = {
    [key: string]: boolean;
  };

  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>({
    invoiceNumber: true,
    clientName: true,
    invoiceDate: true,
    dueDate: true,
    total: true,
    balance: true,
    paymentStatus: true,
    paymentDetails: true,
  });

  const [columnOrder, setColumnOrder] = useState<string[]>([
    'invoiceNumber',
    'clientName',
    'invoiceDate',
    'dueDate',
    'total',
    'balance',
    'paymentStatus',
    'paymentDetails',
  ]);

  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);

  const uniqueClients = useMemo(() => {
    const clients = new Set(invoices.map(inv => inv.clientName).filter(Boolean));
    return Array.from(clients).sort();
  }, [invoices]);

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

  const getDateRangeBoundsLocal = (option: DateRangeOption) => {
    return getDateRangeBounds(option, customStartDate, customEndDate);
  };


  const filteredAndSortedData = useMemo(() => {
    let data = selectedClient === 'all'
      ? reconciledData
      : reconciledData.filter(row => row.clientName === selectedClient);

    // Apply date range filter
    const { start, end } = getDateRangeBoundsLocal(dateRange);
    if (start && end) {
      data = data.filter(row => {
        const invoiceDate = row.invoiceDate instanceof Date ? row.invoiceDate : parseExcelDate(row.invoiceDate);
        if (!invoiceDate) return false;
        return invoiceDate >= start && invoiceDate <= end;
      });
    }

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

    if (sortConfig !== null && sortConfig.key === 'invoiceDate') {
      data = [...data].sort((a, b) => {
        // Safe date parsing for comparison
        const dateA = a.invoiceDate instanceof Date ? a.invoiceDate : parseExcelDate(a.invoiceDate);
        const dateB = b.invoiceDate instanceof Date ? b.invoiceDate : parseExcelDate(b.invoiceDate);

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        if (dateA < dateB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (dateA > dateB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return data;
  }, [reconciledData, selectedClient, sortConfig, dateRange, customStartDate, customEndDate, selectedPaymentStatus, minAmount, maxAmount]);

  const handleSort = () => {
    setSortConfig(current => {
      if (!current || current.key !== 'invoiceDate') {
        return { key: 'invoiceDate', direction: 'asc' };
      }
      if (current.direction === 'asc') {
        return { key: 'invoiceDate', direction: 'desc' };
      }
      // Toggle back to asc
      return { key: 'invoiceDate', direction: 'asc' };
    });
  };

  const toggleColumnVisibility = (column: string) => {
    setColumnVisibility((prev) => ({
      ...prev,
      [column]: !prev[column],
    }));
  };

  const columnLabels: Record<string, string> = {
    invoiceNumber: 'N° Factura',
    clientName: 'Cliente',
    invoiceDate: 'Fecha Factura',
    dueDate: 'Vencimiento',
    total: 'Total',
    balance: 'Saldo',
    paymentStatus: 'Estado de Pago',
    paymentDetails: 'Pagos / Mora',
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

  const parseCurrency = (val: any) => {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return val;
    // Remove "COP", "USD", commas, spaces and parse
    const clean = val.toString().replace(/[A-Z\s,]/g, '').trim();
    return parseFloat(clean) || 0;
  };



  const findHeaderRow = (worksheet: XLSX.WorkSheet, keyColumnName: string) => {
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:Z100');
    // iterate first 20 rows to find headers
    for (let r = range.s.r; r <= Math.min(range.e.r, 20); r++) {
      const row: any[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
        row.push(cell ? cell.v : null);
      }
      if (row.some(val => val?.toString().toLowerCase().includes(keyColumnName.toLowerCase()))) {
        return r;
      }
    }
    return 0; // fallback
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, type: 'invoices' | 'payments') => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        if (type === 'invoices') {
          const headerRow = findHeaderRow(worksheet, 'n.º de factura');
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { range: headerRow });
          const mappedInvoices: InvoiceDetails[] = jsonData.map((row: any) => ({
            invoiceNumber: row['N.º de factura']?.toString() || row['__EMPTY_1']?.toString() || '',
            orderNumber: row['Número de orden']?.toString() || '',
            clientName: row['Nombre del cliente'] || row['__EMPTY'] || '',
            invoiceDate: parseExcelDate(row['Fecha de la factura'] || row['__EMPTY_2']),
            dueDate: parseExcelDate(row['Fecha de vencimiento'] || row['__EMPTY_3']),
            status: row['Estado'] || row['__EMPTY_4'] || '',
            total: parseCurrency(row['Total'] || row['__EMPTY_5']),
            balance: parseCurrency(row['Saldo'] || row['__EMPTY_6']),
          })).filter(inv => inv.invoiceNumber && inv.invoiceNumber !== 'N.º de factura');
          setInvoices(mappedInvoices);
        } else {
          const headerRow = findHeaderRow(worksheet, 'número de pago');
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { range: headerRow });
          const mappedPayments: PaymentRecord[] = jsonData.map((row: any) => ({
            paymentNumber: row['Número de pago']?.toString() || '',
            clientName: row['Nombre del cliente'] || '',
            invoiceNumber: row['N.º de factura']?.toString() || '',
            paymentDate: parseExcelDate(row['Fecha']),
            amountFCY: parseCurrency(row['Cantidad (FCY)']),
            unusedFCY: parseCurrency(row['Importe no usado (FCY)']),
            amountBCY: parseCurrency(row['Importe (BCY)']),
            unusedBCY: parseCurrency(row['Importe no usado (BCY)']),
          })).filter(p => p.invoiceNumber && p.invoiceNumber !== 'N.º de factura');
          setPayments(mappedPayments);
        }
      } catch (err) {
        setError('Error al procesar el archivo Excel. Asegúrate de que el formato sea correcto.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const reconcile = () => {
    if (invoices.length === 0) {
      setError('Por favor, sube el archivo de Detalles de la Factura.');
      return;
    }

    const reconciled = invoices
      .filter(invoice => invoice.clientName !== 'Ambientalia S.A.S.')
      .map(invoice => {
        // Find payments where invoice number matches. 
        const matchingPayments = payments.filter(p =>
          p.invoiceNumber.trim().toUpperCase() === invoice.invoiceNumber.trim().toUpperCase()
        );

        const dueDate = invoice.dueDate instanceof Date ? invoice.dueDate : parseExcelDate(invoice.dueDate);
        const now = new Date(); // Use current date for unpaid calculations

        let isOverdue = false;
        let maxDelayDays = 0;

        const paymentDetails = matchingPayments.map(p => {
          const pDate = p.paymentDate instanceof Date ? p.paymentDate : parseExcelDate(p.paymentDate);
          let delay = 0;

          if (pDate && dueDate && pDate > dueDate) {
            isOverdue = true;
            const diffTime = Math.abs(pDate.getTime() - dueDate.getTime());
            delay = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (delay > maxDelayDays) maxDelayDays = delay;
          }

          return {
            date: formatExcelDate(pDate),
            delay: delay
          };
        });

        // Check for unpaid overdue status
        // If no payments (or partial payments leaving a balance) and current date > due date
        // Note: We use the calculated totalPaid to check properly, though the prompt specifically emphasized "Sin pagos".
        // We'll stick to the logic: if there is a balance > 0 AND now > dueDate, it contributes to overdue status.
        // However, for the "Sin pagos" specific display, checking paymentDetails.length === 0 is the key for the specific UI request.

        if (dueDate && now > dueDate && invoice.balance > 0) {
          // It is overdue properly regardless of payments if there is still a balance.
          // But we specifically need to track the days of delay for the "unpaid" portion.
          isOverdue = true;
          const diffTime = Math.abs(now.getTime() - dueDate.getTime());
          const currentDelay = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          // If this "current delay" is greater than any payment delay (which is likely if it's unpaid), update max.
          if (currentDelay > maxDelayDays) maxDelayDays = currentDelay;
        }

        return {
          ...invoice,
          paymentDates: paymentDetails.map(pd => pd.date),
          paymentAmounts: matchingPayments.map(p => p.amountFCY),
          totalPaid: matchingPayments.reduce((sum, p) => sum + p.amountFCY, 0),
          isOverdue,
          maxDelayDays,
          paymentDetails
        };
      });

    setReconciledData(reconciled);
  };

  const downloadExcel = () => {
    const exportData = reconciledData.map(row => ({
      'N.º de factura': row.invoiceNumber,
      'Número de orden': row.orderNumber,
      'Nombre del cliente': row.clientName,
      'Fecha de factura': formatExcelDate(row.invoiceDate),
      'Fecha de vencimiento': formatExcelDate(row.dueDate),
      'Estado': row.status,
      'Total Factura': row.total,
      'Saldo Pendiente': row.balance,
      'Fechas de Pago': row.paymentDates.length > 0 ? row.paymentDates.join(', ') : (row.isOverdue && row.balance > 0 ? 'Sin pagos (Vencida)' : 'Sin pagos'),
      'Mora Máxima (Días)': row.maxDelayDays,
      'En Mora': row.isOverdue ? 'SÍ' : 'NO'
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reconciliación');
    XLSX.writeFile(workbook, 'Reconciliacion_Facturas_Pagos.xlsx');
  };

  return (
    <div className="flex-grow w-full bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-20 px-8 py-5 bg-white/80 backdrop-blur-xl border-b border-white/20 shadow-sm">
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-xl text-white shadow-lg shadow-indigo-500/20">
              <TableIcon size={24} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Conciliador de Pagos</h1>
              <p className="text-xs text-slate-500 font-medium">Gestión de Cobranza</p>
            </div>
          </div>
          {reconciledData.length > 0 && activeView === 'reconciliation' && (
            <button
              onClick={downloadExcel}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg transition-all shadow-sm font-medium"
            >
              <FileDown size={18} />
              Descargar Excel
            </button>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mt-6">
          <button
            onClick={() => setActiveView('reconciliation')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${activeView === 'reconciliation'
              ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600'
              : 'text-slate-500 hover:bg-slate-50 border-b-2 border-transparent'
              }`}
          >
            <TableIcon size={18} />
            Conciliación
          </button>

          <button
            onClick={() => setActiveView('general')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${activeView === 'general'
              ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600'
              : 'text-slate-500 hover:bg-slate-50 border-b-2 border-transparent'
              }`}
          >
            <LayoutGrid size={18} />
            Análisis General
          </button>
          <button
            onClick={() => setActiveView('kpis')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${activeView === 'kpis'
              ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600'
              : 'text-slate-500 hover:bg-slate-50 border-b-2 border-transparent'
              }`}
          >
            <BarChart3 size={18} />
            KPIs
          </button>
        </div>
      </header>

      <main className="w-full px-6 py-8">
        {/* Reconciliation View */}
        {activeView === 'reconciliation' && (
          <>
            {/* Upload Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
              {/* File 1: Invoices */}
              <div className={`relative group transition-all duration-500 ease-out hover:-translate-y-1
                ${invoices.length > 0
                  ? 'bg-indigo-50/50 border-2 border-indigo-400/30'
                  : 'bg-white border text-center border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)]'} 
                rounded-[2rem] overflow-hidden h-72`}
              >
                <label className="flex flex-col items-center justify-center h-full w-full cursor-pointer p-8 relative z-10">
                  <div className={`w-16 h-16 rounded-3xl flex items-center justify-center mb-6 transition-all duration-300 shadow-xl
                    ${invoices.length > 0
                      ? 'bg-indigo-600 text-white shadow-indigo-500/30 rotate-3 scale-110'
                      : 'bg-indigo-50 text-indigo-600 shadow-indigo-500/10 group-hover:scale-110 group-hover:bg-indigo-600 group-hover:text-white group-hover:shadow-indigo-500/30'}`}>
                    {invoices.length > 0 ? <CheckCircle2 size={32} /> : <Upload size={32} />}
                  </div>
                  <span className="text-xl font-bold text-slate-900 mb-2">Detalles de Factura</span>
                  <span className="text-sm text-slate-500 text-center mb-4 max-w-[200px]">Sube el archivo Excel con los detalles de facturación</span>
                  <input type="file" className="hidden" accept=".xlsx, .xls" onChange={(e) => handleFileUpload(e, 'invoices')} />
                  {invoices.length > 0 ? (
                    <div className="flex items-center gap-2 text-indigo-700 bg-white shadow-sm border border-indigo-100 px-4 py-2 rounded-full text-sm font-bold">
                      <CheckCircle2 size={16} />
                      {invoices.length} facturas
                    </div>
                  ) : (
                    <div className="px-6 py-2.5 bg-slate-50 text-slate-600 text-sm font-semibold rounded-xl group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                      Seleccionar archivo
                    </div>
                  )}
                </label>
              </div>

              {/* File 2: Payments */}
              <div className={`relative group transition-all duration-500 ease-out hover:-translate-y-1
                ${payments.length > 0
                  ? 'bg-emerald-50/50 border-2 border-emerald-400/30'
                  : 'bg-white border text-center border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)]'} 
                rounded-[2rem] overflow-hidden h-72`}
              >
                <label className="flex flex-col items-center justify-center h-full w-full cursor-pointer p-8 relative z-10">
                  <div className={`w-16 h-16 rounded-3xl flex items-center justify-center mb-6 transition-all duration-300 shadow-xl
                    ${payments.length > 0
                      ? 'bg-emerald-500 text-white shadow-emerald-500/30 rotate-3 scale-110'
                      : 'bg-emerald-50 text-emerald-600 shadow-emerald-500/10 group-hover:scale-110 group-hover:bg-emerald-600 group-hover:text-white group-hover:shadow-emerald-500/30'}`}>
                    {payments.length > 0 ? <CheckCircle2 size={32} /> : <Upload size={32} />}
                  </div>
                  <span className="text-xl font-bold text-slate-900 mb-2">Pagos Recibidos</span>
                  <span className="text-sm text-slate-500 text-center mb-4 max-w-[200px]">Sube el reporte de pagos del sistema ERP</span>
                  <input type="file" className="hidden" accept=".xlsx, .xls" onChange={(e) => handleFileUpload(e, 'payments')} />
                  {payments.length > 0 ? (
                    <div className="flex items-center gap-2 text-emerald-700 bg-white shadow-sm border border-emerald-100 px-4 py-2 rounded-full text-sm font-bold">
                      <CheckCircle2 size={16} />
                      {payments.length} pagos
                    </div>
                  ) : (
                    <div className="px-6 py-2.5 bg-slate-50 text-slate-600 text-sm font-semibold rounded-xl group-hover:bg-emerald-50 group-hover:text-emerald-600 transition-colors">
                      Seleccionar archivo
                    </div>
                  )}
                </label>
              </div>
            </div>

            {/* Action Button */}
            <div className="flex justify-center mb-12">
              <button
                onClick={reconcile}
                disabled={invoices.length === 0 || loading}
                className={`px-8 py-3 rounded-xl font-bold text-lg shadow-lg transition-all ${invoices.length > 0 && !loading
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700 hover:-translate-y-0.5 active:translate-y-0'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
              >
                {loading ? 'Procesando...' : 'Generar Conciliación'}
              </button>
            </div>

            {error && (
              <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-red-700">
                <AlertCircle size={20} />
                <p className="font-medium">{error}</p>
              </div>
            )}

            {/* Results Table */}
            {reconciledData.length > 0 && (
              <div className="w-full pb-20 fade-in">
                <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">

                  <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1">
                      <button
                        onClick={() => setShowFilterPanel(!showFilterPanel)}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors shadow-md hover:shadow-lg ${showFilterPanel
                          ? 'text-white bg-indigo-700 hover:bg-indigo-800'
                          : 'text-white bg-indigo-600 hover:bg-indigo-700'
                          }`}
                      >
                        <Filter size={18} />
                        Filtros Avanzados
                        {(selectedClient !== 'all' || dateRange !== 'all' || selectedPaymentStatus.length > 0 || minAmount || maxAmount) && (
                          <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                            {(selectedClient !== 'all' ? 1 : 0) + (dateRange !== 'all' ? 1 : 0) + (selectedPaymentStatus.length > 0 ? 1 : 0) + (minAmount || maxAmount ? 1 : 0)}
                          </span>
                        )}
                      </button>

                      {(selectedClient !== 'all' || dateRange !== 'all' || selectedPaymentStatus.length > 0 || minAmount || maxAmount) && (
                        <button
                          onClick={() => {
                            setSelectedClient('all');
                            setDateRange('all');
                            setCustomStartDate('');
                            setCustomEndDate('');
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

                    <div className="flex items-center gap-4">
                      <div className="text-sm font-medium text-slate-500">
                        Mostrando <span className="text-indigo-600 font-bold">{filteredAndSortedData.length}</span> de {reconciledData.length} facturas
                      </div>

                      <div className="relative">
                        <button
                          onClick={() => setShowColumnPanel(!showColumnPanel)}
                          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200 hover:border-indigo-300"
                        >
                          <Eye size={18} />
                          Columnas
                        </button>

                        {showColumnPanel && (
                          <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-10 p-4">
                            <div className="text-xs text-slate-500 mb-3 font-medium">Arrastra para reordenar</div>
                            <div className="space-y-1">
                              {columnOrder.map((column) => (
                                <label
                                  key={column}
                                  draggable
                                  onDragStart={() => handleDragStart(column)}
                                  onDragOver={handleDragOver}
                                  onDrop={() => handleDrop(column)}
                                  className={`flex items-center gap-2 p-2 rounded transition-all ${draggedColumn === column
                                    ? 'opacity-50 cursor-grabbing'
                                    : 'cursor-grab hover:bg-slate-50'
                                    } ${draggedColumn && draggedColumn !== column
                                      ? 'border-2 border-dashed border-indigo-300'
                                      : 'border-2 border-transparent'
                                    }`}
                                >
                                  <GripVertical size={16} className="text-slate-400 flex-shrink-0" />
                                  <input
                                    type="checkbox"
                                    checked={columnVisibility[column as keyof typeof columnVisibility]}
                                    onChange={() => toggleColumnVisibility(column)}
                                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded cursor-pointer focus:ring-indigo-500 flex-shrink-0"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <span className="text-sm text-slate-700 font-medium flex-1">{columnLabels[column]}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Advanced Filters Side Panel */}
                  {showFilterPanel && loading ? (
                    <SkeletonFilterPanel />
                  ) : showFilterPanel && !loading ? (
                    <div className="border-b border-slate-100 bg-slate-50/50 p-6">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-bold text-slate-800">Opciones de Filtrado</h3>
                        <button
                          onClick={() => {
                            setSelectedClient('all');
                            setDateRange('all');
                            setCustomStartDate('');
                            setCustomEndDate('');
                            setSelectedPaymentStatus([]);
                            setMinAmount('');
                            setMaxAmount('');
                          }}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-3 py-1 rounded transition-colors"
                        >
                          Resetear Filtros
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {/* Client Filter */}
                        <div className="flex flex-col gap-2">
                          <label htmlFor="client-filter" className="text-sm font-semibold text-slate-700">
                            Filtrar por Cliente
                          </label>
                          <div className="relative">
                            <select
                              id="client-filter"
                              value={selectedClient}
                              onChange={(e) => setSelectedClient(e.target.value)}
                              className="appearance-none bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent block w-full p-2.5 pr-8 shadow-sm cursor-pointer hover:border-indigo-400 transition-colors"
                            >
                              <option value="all">Todos los clientes ({uniqueClients.length})</option>
                              {uniqueClients.map(client => (
                                <option key={client} value={client}>{client}</option>
                              ))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                          </div>
                        </div>

                        {/* Date Range Filter */}
                        <div className="flex flex-col gap-2">
                          <label htmlFor="date-filter" className="text-sm font-semibold text-slate-700">
                            Período
                          </label>
                          <div className="relative">
                            <select
                              id="date-filter"
                              value={dateRange}
                              onChange={(e) => setDateRange(e.target.value as DateRangeOption)}
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
                          <>
                            <div className="flex flex-col gap-2">
                              <label htmlFor="start-date" className="text-sm font-semibold text-slate-700">
                                Fecha de Inicio
                              </label>
                              <input
                                id="start-date"
                                type="date"
                                value={customStartDate}
                                onChange={(e) => setCustomStartDate(e.target.value)}
                                className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
                              />
                            </div>
                            <div className="flex flex-col gap-2">
                              <label htmlFor="end-date" className="text-sm font-semibold text-slate-700">
                                Fecha de Fin
                              </label>
                              <input
                                id="end-date"
                                type="date"
                                value={customEndDate}
                                onChange={(e) => setCustomEndDate(e.target.value)}
                                className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
                              />
                            </div>
                          </>
                        )}

                        {/* Payment Status Filter */}
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-semibold text-slate-700">
                            Estado de Pago
                          </label>
                          <div className="space-y-2 p-3 bg-white border border-slate-300 rounded-lg">
                            <label className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-2 rounded transition-colors">
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
                            <label className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-2 rounded transition-colors">
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
                            <label className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-2 rounded transition-colors">
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

                        {/* Amount Range Filter */}
                        <div className="flex flex-col gap-2">
                          <label htmlFor="min-amount" className="text-sm font-semibold text-slate-700">
                            Monto Mínimo (USD)
                          </label>
                          <input
                            id="min-amount"
                            type="number"
                            value={minAmount}
                            onChange={(e) => setMinAmount(e.target.value)}
                            placeholder="0"
                            className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
                          />
                        </div>

                        <div className="flex flex-col gap-2">
                          <label htmlFor="max-amount" className="text-sm font-semibold text-slate-700">
                            Monto Máximo (USD)
                          </label>
                          <input
                            id="max-amount"
                            type="number"
                            value={maxAmount}
                            onChange={(e) => setMaxAmount(e.target.value)}
                            placeholder="Ilimitado"
                            className="bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent p-2.5 shadow-sm hover:border-indigo-400 transition-colors"
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        {loading ? (
                          <SkeletonHeader columns={8} />
                        ) : (
                          <tr className="bg-slate-50 border-b border-slate-200">
                            {columnOrder.map((column) => {
                              if (!columnVisibility[column as keyof typeof columnVisibility]) return null;

                              if (column === 'invoiceNumber') {
                                return <th key={column} className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">Factura</th>;
                              }
                              if (column === 'clientName') {
                                return <th key={column} className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">Cliente</th>;
                              }
                              if (column === 'invoiceDate') {
                                return (
                                  <th
                                    key={column}
                                    className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors group select-none"
                                    onClick={handleSort}
                                    title="Ordenar por fecha"
                                  >
                                    <div className="flex items-center gap-1">
                                      Fecha Factura
                                      <ArrowUpDown size={14} className={`transition-colors ${sortConfig?.key === 'invoiceDate' ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
                                    </div>
                                  </th>
                                );
                              }
                              if (column === 'dueDate') {
                                return <th key={column} className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider whitespace-nowrap">Vencimiento</th>;
                              }
                              if (column === 'total') {
                                return <th key={column} className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">Total</th>;
                              }
                              if (column === 'balance') {
                                return <th key={column} className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">Saldo</th>;
                              }
                              if (column === 'paymentStatus') {
                                return <th key={column} className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">Estado de Pago</th>;
                              }
                              if (column === 'paymentDetails') {
                                return <th key={column} className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">Pagos / Mora</th>;
                              }
                              return null;
                            })}
                          </tr>
                        )}
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {loading ? (
                          <SkeletonTableBody rows={8} columns={8} />
                        ) : (
                          filteredAndSortedData.map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                              {columnOrder.map((column) => {
                                if (!columnVisibility[column as keyof typeof columnVisibility]) return null;

                                if (column === 'invoiceNumber') {
                                  return (
                                    <td key={column} className="px-6 py-4 font-medium text-slate-900">
                                      <div className="flex items-center gap-2">
                                        {row.invoiceNumber}
                                        {row.isOverdue && (
                                          <span title={`Mora detectada: ${row.maxDelayDays} días`} className="text-red-500 animate-pulse">
                                            <AlertCircle size={16} fill="currentColor" className="text-white" />
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                  );
                                }
                                if (column === 'clientName') {
                                  return (
                                    <td key={column} className="px-6 py-4 text-slate-600 text-sm whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px]" title={row.clientName}>{row.clientName}</td>
                                  );
                                }
                                if (column === 'invoiceDate') {
                                  return (
                                    <td key={column} className="px-6 py-4 text-slate-600 text-sm whitespace-nowrap">{formatExcelDate(row.invoiceDate)}</td>
                                  );
                                }
                                if (column === 'dueDate') {
                                  return (
                                    <td key={column} className="px-6 py-4 text-slate-600 text-sm whitespace-nowrap">{formatExcelDate(row.dueDate)}</td>
                                  );
                                }
                                if (column === 'total') {
                                  return (
                                    <td key={column} className="px-6 py-4 text-slate-900 font-semibold">{row.total.toLocaleString('en-US', { style: 'currency', currency: 'USD', currencyDisplay: 'code', maximumFractionDigits: 0 }).replace('USD', 'USD ')}</td>
                                  );
                                }
                                if (column === 'balance') {
                                  return (
                                    <td key={column} className="px-6 py-4">
                                      <span className={`text-sm px-2 py-1 rounded-full font-medium ${row.balance === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                        {row.balance.toLocaleString('en-US', { style: 'currency', currency: 'USD', currencyDisplay: 'code', maximumFractionDigits: 0 }).replace('USD', 'USD ')}
                                      </span>
                                    </td>
                                  );
                                }
                                if (column === 'paymentStatus') {
                                  return (
                                    <td key={column} className="px-6 py-4">
                                      <div className="flex flex-col gap-2 min-w-[150px]">
                                        <div className="flex items-center gap-3">
                                          <div className="flex-1 bg-slate-200 rounded-full h-2.5 overflow-hidden">
                                            <div
                                              className={`h-full transition-all duration-300 ${row.balance === 0 ? 'bg-emerald-500' :
                                                row.balance < row.total ? 'bg-blue-500' :
                                                  'bg-slate-400'
                                                }`}
                                              style={{ width: `${row.total > 0 ? ((row.total - row.balance) / row.total) * 100 : 0}%` }}
                                            />
                                          </div>
                                          <span className="text-xs font-semibold text-slate-700 w-10 text-right">
                                            {row.total > 0 ? Math.round(((row.total - row.balance) / row.total) * 100) : 0}%
                                          </span>
                                        </div>
                                        <span className={`text-xs font-medium px-2 py-1 rounded w-fit ${row.balance === 0 ? 'bg-emerald-100 text-emerald-700' :
                                          row.balance < row.total ? 'bg-blue-100 text-blue-700' :
                                            'bg-slate-100 text-slate-700'
                                          }`}>
                                          {row.balance === 0 ? '✓ Pagado' : row.balance < row.total ? '◐ Parcial' : '○ Pendiente'}
                                        </span>
                                      </div>
                                    </td>
                                  );
                                }
                                if (column === 'paymentDetails') {
                                  return (
                                    <td key={column} className="px-6 py-4">
                                      <div className="flex flex-col gap-1">
                                        {row.paymentDetails.length > 0 ? (
                                          row.paymentDetails.map((pd, i) => (
                                            <div key={i} className="flex items-center gap-2">
                                              <span className={`text-xs px-2 py-1 rounded border font-medium ${pd.delay > 0 ? 'bg-red-50 text-red-700 border-red-100' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>
                                                {pd.date}
                                              </span>
                                              {pd.delay > 0 && (
                                                <span className="text-[10px] font-bold text-red-600 flex items-center gap-0.5">
                                                  <AlertCircle size={10} />
                                                  {pd.delay}d mora
                                                </span>
                                              )}
                                            </div>
                                          ))
                                        ) : (
                                          row.isOverdue && row.balance > 0 ? (
                                            <div className="flex items-center gap-2">
                                              <span className="text-slate-400 italic text-sm">Sin pagos</span>
                                              <span className="text-[10px] font-bold text-red-600 flex items-center gap-0.5 animate-pulse">
                                                <AlertCircle size={10} />
                                                {row.maxDelayDays}d mora
                                              </span>
                                            </div>
                                          ) : (
                                            <span className="text-slate-400 italic text-sm">Sin pagos</span>
                                          )
                                        )}
                                      </div>
                                    </td>
                                  );
                                }
                                return null;
                              })}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Customer Analysis View */}
        {activeView === 'analysis' && (
          <CustomerAnalysis
            reconciledData={reconciledData}
            dateRange={dateRange}
            customStartDate={customStartDate}
            customEndDate={customEndDate}
            onDateRangeChange={(range) => setDateRange(range as DateRangeOption)}
            onCustomStartDateChange={setCustomStartDate}
            onCustomEndDateChange={setCustomEndDate}
            selectedCustomer={selectedClient === 'all' ? '' : selectedClient}
            onCustomerChange={setSelectedClient}
            loading={loading}
          />
        )}

        {/* General Analysis View */}
        {activeView === 'general' && (
          <GeneralAnalysis
            reconciledData={reconciledData}
            dateRange={dateRange}
            customStartDate={customStartDate}
            customEndDate={customEndDate}
            onDateRangeChange={(range) => setDateRange(range as DateRangeOption)}
            onCustomStartDateChange={setCustomStartDate}
            onCustomEndDateChange={setCustomEndDate}
            onCustomerClick={(customerName) => {
              setSelectedClient(customerName);
              setActiveView('analysis');
            }}
            loading={loading}
            mode="analysis"
          />
        )}

        {/* KPIs View */}
        {activeView === 'kpis' && (
          <GeneralAnalysis
            reconciledData={reconciledData}
            dateRange={dateRange}
            customStartDate={customStartDate}
            customEndDate={customEndDate}
            onDateRangeChange={(range) => setDateRange(range as DateRangeOption)}
            onCustomStartDateChange={setCustomStartDate}
            onCustomEndDateChange={setCustomEndDate}
            onCustomerClick={(customerName) => {
              setSelectedClient(customerName);
              setActiveView('analysis');
            }}
            loading={loading}
            mode="kpis"
          />
        )}

      </main>
    </div >
  );
}

export default App;
