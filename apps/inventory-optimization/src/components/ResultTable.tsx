import React, { useState, useEffect } from 'react';
import type { AnalysisResult } from '../types';
import { StatusBadge, LevelStatusBadge, cn, Modal } from './ui';
import SuggestedPO from './SuggestedPO';
import DeadStock from './DeadStock';
import { ArrowUpDown, Download, Settings2 } from 'lucide-react';
import {
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import AbcXyzMatrix from './AbcXyzMatrix';

import { ABC_XYZ_COLORS, DEMAND_PATTERN_COLORS } from './abcXyz';
import {
    computeEoq, filterByTab, filterResults, sortResults, uniqueManufacturers, uniqueCategories, isUrgentItem,
} from '../utils/resultTableLogic';
import { exportInventoryToExcel, exportInventoryToErpCsv } from '../utils/resultTableExport';
import { type ColumnConfig } from './SortableColumnItem';
import { SortableColumnList } from './SortableColumnList';

interface ResultsTableProps {
    data: AnalysisResult[];
    // Los parámetros del EOQ los gobierna App: además de la columna EOQ, alimentan
    // la cantidad óptima (Q) que se calcula en el análisis, así que cambiarlos
    // obliga a recalcular y no basta con re-renderizar la tabla.
    eoqOrderCost: number;
    eoqHoldingRate: number;
    onEoqOrderCostChange: (v: number) => void;
    onEoqHoldingRateChange: (v: number) => void;
}

export const ResultsTable: React.FC<ResultsTableProps> = ({
    data, eoqOrderCost, eoqHoldingRate, onEoqOrderCostChange, onEoqHoldingRateChange,
}) => {
    const [selectedItem, setSelectedItem] = useState<AnalysisResult | null>(null);
    const [showColumnPicker, setShowColumnPicker] = useState(false);
    const [showHistoryColumnPicker, setShowHistoryColumnPicker] = useState(false);

    // Initial columns for each tab
    const defaultColumns: Record<string, ColumnConfig[]> = {
        main: [
            { key: 'sku', label: 'SKU' },
            { key: 'itemName', label: 'Artículo' },
            { key: 'unitPrice', label: 'Precio de Venta (USD)' },
            { key: 'unitCost', label: 'Precio de Compra (USD)' },
            { key: 'category', label: 'Categoría' },
            { key: 'status', label: 'Estatus' },
            { key: 'abcXyz', label: 'ABC-XYZ' },
            { key: 'abcClass', label: 'ABC' },
            { key: 'xyzClass', label: 'XYZ' },
            { key: 'demandPattern', label: 'Patrón' },
            { key: 'currentLevel', label: 'Nivel ERP' },
            { key: 'physicalHandQuantity', label: 'Existencias Físicas' },
            { key: 'orderedQuantity', label: 'Por Recibir' },
            { key: 'reorderPoint', label: 'PdP Propuesto' },
            { key: 'optimalQuantity', label: 'Q Sugerida' },
            { key: 'eoq', label: 'EOQ' },
            { key: 'leadTimeDays', label: 'LT (Días)' },
            { key: 'leadTimeStdDays', label: 'σ LT (Días)' },
            { key: 'leadTimeSource', label: 'Fuente LT' },
            { key: 'coverageDays', label: 'Cobertura (Días)' },
            { key: 'etaDate', label: 'ETA (llegada)' },
            { key: 'deviation', label: 'Desviación' },
        ],
        service: [
            { key: 'sku', label: 'SKU' },
            { key: 'itemName', label: 'Artículo' },
            { key: 'unitPrice', label: 'Precio de Venta (USD)' },
            { key: 'unitCost', label: 'Precio de Compra (USD)' },
            { key: 'category', label: 'Categoría' },
            { key: 'status', label: 'Estatus' },
            { key: 'abcXyz', label: 'ABC-XYZ' },
            { key: 'abcClass', label: 'ABC' },
            { key: 'xyzClass', label: 'XYZ' },
            { key: 'demandPattern', label: 'Patrón' },
            { key: 'currentLevel', label: 'Nivel ERP' },
            { key: 'reorderPoint', label: 'PdP Propuesto' },
            { key: 'optimalQuantity', label: 'Q Sugerida' },
            { key: 'eoq', label: 'EOQ' },
            { key: 'leadTimeDays', label: 'LT (Días)' },
            { key: 'leadTimeStdDays', label: 'σ LT (Días)' },
            { key: 'leadTimeSource', label: 'Fuente LT' },
            { key: 'coverageDays', label: 'Cobertura (Días)' },
            { key: 'etaDate', label: 'ETA (llegada)' },
            { key: 'deviation', label: 'Desviación' },
        ],
        urgent: [
            { key: 'manufacturer', label: 'Fabricante' },
            { key: 'sku', label: 'SKU' },
            { key: 'itemName', label: 'Artículo' },
            { key: 'category', label: 'Categoría' },
            { key: 'handQuantity', label: 'Contable' },
            { key: 'physicalHandQuantity', label: 'Física' },
            { key: 'orderedQuantity', label: 'Pedido Fábrica' },
            { key: 'committedQuantity', label: 'Comprometido' },
            { key: 'availableQuantity', label: 'Disponible' },
            { key: 'coverageDays', label: 'Cobertura (Días)' },
            { key: 'etaDate', label: 'ETA (llegada)' },
            { key: 'reorderPoint', label: 'PdP' },
            { key: 'erpLevel', label: 'Nivel ERP' },
            { key: 'suggestedOrder', label: 'Sugerencia Pedido' },
        ],
        current_inventory: [
            { key: 'manufacturer', label: 'Fabricante' },
            { key: 'sku', label: 'SKU' },
            { key: 'itemName', label: 'Artículo' },
            { key: 'category', label: 'Categoría' },
            { key: 'handQuantity', label: 'Contable' },
            { key: 'physicalHandQuantity', label: 'Física' },
            { key: 'orderedQuantity', label: 'Pedido Fábrica' },
            { key: 'committedQuantity', label: 'Comprometido' },
            { key: 'availableQuantity', label: 'Disponible' },
            { key: 'coverageDays', label: 'Cobertura (Días)' },
            { key: 'etaDate', label: 'ETA (llegada)' },
            { key: 'reorderPoint', label: 'PDP Propuesto' },
            { key: 'erpLevel', label: 'Nivel ERP' },
        ],
        history: [
            { key: 'year', label: 'Año' },
            { key: '0', label: 'Ene' },
            { key: '1', label: 'Feb' },
            { key: '2', label: 'Mar' },
            { key: '3', label: 'Abr' },
            { key: '4', label: 'May' },
            { key: '5', label: 'Jun' },
            { key: '6', label: 'Jul' },
            { key: '7', label: 'Ago' },
            { key: '8', label: 'Sep' },
            { key: '9', label: 'Oct' },
            { key: '10', label: 'Nov' },
            { key: '11', label: 'Dic' },
            { key: 'total', label: 'Total' },
        ],
        // OC Sugerida y Capital Inmovilizado se renderizan con su propio componente;
        // entradas vacías para no romper la maquinaria de columnas.
        suggested_po: [],
        dead_stock: []
    };

    const [columns, setColumns] = useState<Record<string, ColumnConfig[]>>(() => {
        const saved = localStorage.getItem('table_columns_order');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                // Ensure all default keys and individual columns are present (for migration/updates)
                Object.keys(defaultColumns).forEach(key => {
                    if (!parsed[key]) {
                        parsed[key] = defaultColumns[key];
                    } else {
                        // Check for missing individual columns (like erpLevel)
                        const currentKeys = new Set(parsed[key].map((c: any) => c.key));
                        defaultColumns[key].forEach(defaultCol => {
                            if (!currentKeys.has(defaultCol.key)) {
                                parsed[key].push(defaultCol);
                            }
                        });
                    }
                });
                return parsed;
            } catch (e) {
                console.error('Error parsing saved columns order', e);
            }
        }
        return defaultColumns;
    });

    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem('table_column_widths');
        return saved ? JSON.parse(saved) : {};
    });

    const [resizing, setResizing] = useState<{ key: string; startX: number; startWidth: number } | null>(null);

    const handleMouseDown = (e: React.MouseEvent, key: string, currentWidth: number) => {
        e.preventDefault();
        e.stopPropagation();
        setResizing({ key, startX: e.pageX, startWidth: currentWidth });
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!resizing) return;
            const delta = e.pageX - resizing.startX;
            const newWidth = Math.max(50, resizing.startWidth + delta);
            setColumnWidths(prev => ({
                ...prev,
                [resizing.key]: newWidth
            }));
        };

        const handleMouseUp = () => {
            if (resizing) {
                setResizing(null);
                localStorage.setItem('table_column_widths', JSON.stringify(columnWidths));
            }
        };

        if (resizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizing, columnWidths]);

    const [filter, setFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [manufacturerFilter, setManufacturerFilter] = useState<string>('all');
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [onlyCommitted, setOnlyCommitted] = useState<boolean>(false);
    const [activeTab, setActiveTab] = useState<'main' | 'service' | 'urgent' | 'current_inventory' | 'suggested_po' | 'dead_stock'>('main');
    const [sortField, setSortField] = useState<keyof AnalysisResult>('deviation');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [variabilityFilter, setVariabilityFilter] = useState<string>('all');
    const [demandTypeFilter, setDemandTypeFilter] = useState<string>('all');
    const [valueTypeFilter, setValueTypeFilter] = useState<string>('all');
    const [trackingFilter, setTrackingFilter] = useState<'all' | 'tracked' | 'untracked'>('all');
    const [abcFilter, setAbcFilter] = useState<string>('all');
    const [xyzFilter, setXyzFilter] = useState<string>('all');
    const [abcBasis, setAbcBasis] = useState<'cost' | 'revenue'>('cost');
    const [patternFilter, setPatternFilter] = useState<string>('all');
    // El filtro de estatus cambia de dominio entre pestañas (operativo vs nivel ERP);
    // se resetea al cambiar de pestaña para no dejar un valor inexistente en la otra.
    useEffect(() => { setStatusFilter('all'); }, [activeTab]);

    const [visibleColumns, setVisibleColumns] = useState<Record<string, Set<string>>>(() => {
        const saved = localStorage.getItem('table_columns_visibility');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                const result: Record<string, Set<string>> = {};
                Object.keys(parsed).forEach(key => {
                    result[key] = new Set(parsed[key]);
                });
                // Ensure all tabs are present and new columns are added if they were missing
                Object.keys(defaultColumns).forEach(key => {
                    if (!result[key]) {
                        result[key] = new Set(defaultColumns[key].map(c => c.key));
                    } else {
                        // Check if specific new columns like 'erpLevel' are missing and add them
                        const currentKeys = result[key];
                        if (key === 'urgent' && !currentKeys.has('erpLevel')) currentKeys.add('erpLevel');
                        if (key === 'current_inventory' && !currentKeys.has('erpLevel')) currentKeys.add('erpLevel');
                        if (key === 'main' && !currentKeys.has('physicalHandQuantity')) currentKeys.add('physicalHandQuantity');
                        if (key === 'main' && !currentKeys.has('orderedQuantity')) currentKeys.add('orderedQuantity');
                        if ((key === 'main' || key === 'service') && !currentKeys.has('unitCost')) currentKeys.add('unitCost');
                    }
                });
                return result;
            } catch (e) {
                console.error('Error parsing saved columns visibility', e);
            }
        }
        return {
            main: new Set(defaultColumns.main.map(c => c.key)),
            service: new Set(defaultColumns.service.map(c => c.key)),
            urgent: new Set(defaultColumns.urgent.map(c => c.key)),
            current_inventory: new Set(defaultColumns.current_inventory.map(c => c.key)),
            history: new Set(defaultColumns.history.map(c => c.key)),
            suggested_po: new Set(),
            dead_stock: new Set(),
        };
    });

    // Save to localStorage whenever columns or visibility changes
    useEffect(() => {
        localStorage.setItem('table_columns_order', JSON.stringify(columns));
    }, [columns]);

    useEffect(() => {
        const toSave: Record<string, string[]> = {};
        Object.keys(visibleColumns).forEach(key => {
            toSave[key] = Array.from(visibleColumns[key]);
        });
        localStorage.setItem('table_columns_visibility', JSON.stringify(toSave));
    }, [visibleColumns]);

    const toggleColumnVisibility = (tab: string, key: string) => {
        setVisibleColumns(prev => {
            const newSet = new Set(prev[tab]);
            if (newSet.has(key)) {
                if (newSet.size > 1) newSet.delete(key);
            } else {
                newSet.add(key);
            }
            return { ...prev, [tab]: newSet };
        });
    };

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event: DragEndEvent, tab: string) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            setColumns((prev) => {
                const oldIndex = prev[tab].findIndex((col) => col.key === active.id);
                const newIndex = prev[tab].findIndex((col) => col.key === over.id);

                return {
                    ...prev,
                    [tab]: arrayMove(prev[tab], oldIndex, newIndex),
                };
            });
        }
    };


    const currentTabColumns = columns[activeTab].filter(c => visibleColumns[activeTab].has(c.key));

    const handleSort = (field: keyof AnalysisResult) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const displayData = filterByTab(data, activeTab);

    const filteredData = sortResults(
        filterResults(displayData, activeTab, {
            filter, statusFilter, manufacturerFilter, categoryFilter, onlyCommitted,
            variabilityFilter, demandTypeFilter, valueTypeFilter, trackingFilter,
            abcBasis, abcFilter, xyzFilter, patternFilter,
        }),
        sortField, sortDirection,
    );

    const exportToExcel = () => exportInventoryToExcel(data, eoqOrderCost, eoqHoldingRate);

    const exportToERP = () => exportInventoryToErpCsv(data);


    const manufacturers = uniqueManufacturers(data, activeTab);

    const categories = uniqueCategories(data, activeTab);

    return (
        <div className="bg-white shadow rounded-lg overflow-hidden border border-gray-200">
            {/* Tabs */}
            <div className="flex border-b border-gray-200">
                <button
                    onClick={() => {
                        setActiveTab('main');
                        setManufacturerFilter('all');
                        setCategoryFilter('all');
                    }}
                    className={cn(
                        "px-6 py-3 text-sm font-medium transition-colors",
                        activeTab === 'main'
                            ? "border-b-2 border-indigo-600 text-indigo-600 bg-indigo-50/30"
                            : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    )}
                >
                    Análisis Principal ({data.filter(r => !r.isService).length})
                </button>
                <button
                    onClick={() => {
                        setActiveTab('service');
                        setManufacturerFilter('all');
                        setCategoryFilter('all');
                    }}
                    className={cn(
                        "px-6 py-3 text-sm font-medium transition-colors",
                        activeTab === 'service'
                            ? "border-b-2 border-indigo-600 text-indigo-600 bg-indigo-50/30"
                            : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    )}
                >
                    Artículos sin Seguimiento ({data.filter(r => r.isService).length})
                </button>
                <button
                    onClick={() => {
                        setActiveTab('urgent');
                        setSortField('manufacturer');
                        setSortDirection('asc');
                        setManufacturerFilter('all');
                        setCategoryFilter('all');
                    }}
                    className={cn(
                        "px-6 py-3 text-sm font-medium transition-colors",
                        activeTab === 'urgent'
                            ? "border-b-2 border-red-600 text-red-600 bg-red-50/30"
                            : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    )}
                >
                    Pedidos Urgentes ({data.filter(isUrgentItem).length})
                </button>
                <button
                    onClick={() => {
                        setActiveTab('current_inventory');
                        setManufacturerFilter('all');
                        setCategoryFilter('all');
                        setTrackingFilter('all');
                    }}
                    className={cn(
                        "px-6 py-3 text-sm font-medium transition-colors",
                        activeTab === 'current_inventory'
                            ? "border-b-2 border-indigo-600 text-indigo-600 bg-indigo-50/30"
                            : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    )}
                >
                    Inventario Actual ({data.length})
                </button>
                <button
                    onClick={() => {
                        setActiveTab('suggested_po');
                        setManufacturerFilter('all');
                        setCategoryFilter('all');
                    }}
                    className={cn(
                        "px-6 py-3 text-sm font-medium transition-colors",
                        activeTab === 'suggested_po'
                            ? "border-b-2 border-emerald-600 text-emerald-700 bg-emerald-50/40"
                            : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    )}
                >
                    OC Sugerida ({data.filter(item => {
                        if (item.status !== 'Urgente' && item.status !== 'Pedir') return false;
                        const threshold = Math.max(item.reorderPoint, Math.max(item.erpLevel ?? 0, 0));
                        return Math.max(0, Math.round(threshold + item.optimalQuantity - (item.availableQuantity + item.orderedQuantity))) > 0;
                    }).length})
                </button>
                <button
                    onClick={() => {
                        setActiveTab('dead_stock');
                        setManufacturerFilter('all');
                        setCategoryFilter('all');
                    }}
                    className={cn(
                        "px-6 py-3 text-sm font-medium transition-colors",
                        activeTab === 'dead_stock'
                            ? "border-b-2 border-red-600 text-red-700 bg-red-50/40"
                            : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    )}
                >
                    Capital Inmovilizado ({data.filter(item => item.deadStockClass !== 'Activo' || item.overstockUnits > 0).length})
                </button>
            </div>

            {activeTab === 'suggested_po' ? (
                <SuggestedPO data={data} />
            ) : activeTab === 'dead_stock' ? (
                <DeadStock data={data} />
            ) : (
            <>
            <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row gap-4 justify-between items-center bg-gray-50">
                <div className="flex flex-wrap gap-3 w-full sm:w-auto">
                    <input
                        type="text"
                        placeholder="Buscar SKU o Nombre..."
                        className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-indigo-500 focus:border-indigo-500 w-full sm:w-64"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />

                    <select
                        className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-indigo-500 focus:border-indigo-500"
                        value={manufacturerFilter}
                        onChange={(e) => setManufacturerFilter(e.target.value)}
                    >
                        <option value="all">Fabricante</option>
                        {manufacturers.map(m => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>

                    <select
                        className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-indigo-500 focus:border-indigo-500"
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                    >
                        <option value="all">Categoría</option>
                        {categories.map(c => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>

                    {activeTab !== 'urgent' && activeTab !== 'current_inventory' && (
                        <select
                            className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-indigo-500 focus:border-indigo-500"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="all">Estatus</option>
                            {(activeTab === 'main' || activeTab === 'service') ? (
                                <>
                                    <option value="Subir">Subir nivel</option>
                                    <option value="Bajar">Bajar nivel</option>
                                    <option value="OK">Nivel OK</option>
                                    <option value="NoStockear">No stockear</option>
                                    <option value="SinConfigurar">Sin configurar</option>
                                    <option value="SinDatos">Sin datos</option>
                                </>
                            ) : (
                                <>
                                    <option value="Urgente">Urgente</option>
                                    <option value="EnCamino">En camino</option>
                                    <option value="Pedir">Pedir</option>
                                    <option value="Overstock">Sobrestock</option>
                                    <option value="Optimized">Optimizado</option>
                                    <option value="Ignored">Ignorado</option>
                                </>
                            )}
                        </select>
                    )}
                    {activeTab === 'current_inventory' && (
                        <select
                            className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-indigo-500 focus:border-indigo-500"
                            value={trackingFilter}
                            onChange={(e) => setTrackingFilter(e.target.value as any)}
                        >
                            <option value="all">Seguimiento (Todos)</option>
                            <option value="tracked">Con Seguimiento</option>
                            <option value="untracked">Sin Seguimiento</option>
                        </select>
                    )}
                    {activeTab !== 'urgent' && activeTab !== 'current_inventory' && (
                        <>
                            <select
                                className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-indigo-500 focus:border-indigo-500"
                                value={variabilityFilter}
                                onChange={(e) => setVariabilityFilter(e.target.value)}
                            >
                                <option value="all">Variabilidad</option>
                                <option value="Alta">Alta</option>
                                <option value="Media">Media</option>
                                <option value="Baja">Baja</option>
                            </select>
                            <select
                                className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-indigo-500 focus:border-indigo-500"
                                value={demandTypeFilter}
                                onChange={(e) => setDemandTypeFilter(e.target.value)}
                            >
                                <option value="all">Tipo Demanda</option>
                                <option value="Normal">Normal</option>
                                <option value="Anormal">Anormal</option>
                            </select>
                            <select
                                className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-indigo-500 focus:border-indigo-500"
                                value={valueTypeFilter}
                                onChange={(e) => setValueTypeFilter(e.target.value)}
                            >
                                <option value="all">Tipo Valor</option>
                                <option value="Ultra Alto">Ultra Alto</option>
                                <option value="Alto">Alto</option>
                                <option value="Estándar">Estándar</option>
                            </select>
                            <select
                                className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-indigo-500 focus:border-indigo-500"
                                value={abcFilter}
                                onChange={(e) => setAbcFilter(e.target.value)}
                            >
                                <option value="all">ABC</option>
                                <option value="A">A · alto valor</option>
                                <option value="B">B · medio</option>
                                <option value="C">C · bajo</option>
                            </select>
                            <select
                                className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-indigo-500 focus:border-indigo-500"
                                value={xyzFilter}
                                onChange={(e) => setXyzFilter(e.target.value)}
                            >
                                <option value="all">XYZ</option>
                                <option value="X">X · estable</option>
                                <option value="Y">Y · variable</option>
                                <option value="Z">Z · errática</option>
                            </select>
                            <select
                                className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-indigo-500 focus:border-indigo-500"
                                value={patternFilter}
                                onChange={(e) => setPatternFilter(e.target.value)}
                            >
                                <option value="all">Patrón demanda</option>
                                <option value="Suave">Suave</option>
                                <option value="Intermitente">Intermitente</option>
                                <option value="Errática">Errática</option>
                                <option value="Lumpy">Lumpy</option>
                            </select>
                        </>
                    )}
                    {activeTab === 'urgent' && (
                        <>
                            <select
                                className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-indigo-500 focus:border-indigo-500"
                                value={valueTypeFilter}
                                onChange={(e) => setValueTypeFilter(e.target.value)}
                            >
                                <option value="all">Tipo Valor</option>
                                <option value="Ultra Alto">Ultra Alto</option>
                                <option value="Alto">Alto</option>
                                <option value="Estándar">Estándar</option>
                            </select>
                            <label className="flex items-center gap-2 cursor-pointer ml-2">
                                <input
                                    type="checkbox"
                                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                                    checked={onlyCommitted}
                                    onChange={(e) => setOnlyCommitted(e.target.checked)}
                                />
                                <span className="text-xs text-gray-700 font-medium">Solo Compromisos</span>
                            </label>
                        </>
                    )}
                </div>
                <div className="flex gap-2">
                    <div className="relative">
                        <button
                            onClick={() => setShowColumnPicker(!showColumnPicker)}
                            className={cn(
                                "inline-flex items-center px-4 py-2 border text-xs font-medium rounded-md shadow-sm transition-colors",
                                showColumnPicker
                                    ? "bg-indigo-50 border-indigo-600 text-indigo-600"
                                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                            )}
                        >
                            <Settings2 className="w-4 h-4 mr-2" />
                            Columnas
                        </button>

                        {showColumnPicker && (
                            <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 z-50 animate-in fade-in zoom-in-95 duration-100">
                                <div className="p-3 border-b border-gray-100 bg-gray-50">
                                    <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider">Configurar Columnas</h3>
                                </div>
                                <div className="p-2 max-h-80 overflow-y-auto">
                                    <SortableColumnList
                                        columns={columns[activeTab]}
                                        visibleKeys={visibleColumns[activeTab]}
                                        onToggle={(key) => toggleColumnVisibility(activeTab, key)}
                                        onDragEnd={(e) => handleDragEnd(e, activeTab)}
                                        sensors={sensors}
                                    />
                                </div>
                                <div className="p-2 bg-gray-50 border-t border-gray-100 text-center">
                                    <button
                                        onClick={() => setShowColumnPicker(false)}
                                        className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 uppercase"
                                    >
                                        Cerrar
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={exportToExcel}
                        className="inline-flex items-center px-4 py-2 border border-blue-600 text-xs font-medium rounded-md shadow-sm text-blue-600 bg-white hover:bg-blue-50 transition-colors"
                    >
                        <Download className="w-4 h-4 mr-2" />
                        Excel Detallado
                    </button>
                    <button
                        onClick={exportToERP}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                    >
                        <Download className="w-4 h-4 mr-2" />
                        Carga ERP (CSV)
                    </button>
                </div>
            </div>

            {(activeTab === 'main' || activeTab === 'service') && (
                <div className="px-4 pt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs bg-gray-50">
                    <span className="font-semibold text-gray-600">Parámetros EOQ:</span>
                    <label className="flex items-center gap-1.5 text-gray-500">
                        Costo por pedido (USD)
                        <input
                            type="number"
                            min={0}
                            value={eoqOrderCost}
                            onChange={(e) => onEoqOrderCostChange(Math.max(0, Number(e.target.value)))}
                            className="w-20 border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </label>
                    <label className="flex items-center gap-1.5 text-gray-500">
                        Mantenimiento anual (%)
                        <input
                            type="number"
                            min={0}
                            max={100}
                            value={eoqHoldingRate}
                            onChange={(e) => onEoqHoldingRateChange(Math.min(100, Math.max(0, Number(e.target.value))))}
                            className="w-16 border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </label>
                    <span className="text-gray-400 italic">EOQ = √(2·D·S / (H%·costo)) · comparación, no cambia los pedidos</span>
                </div>
            )}

            {(activeTab === 'main' || activeTab === 'service') && (
                <div className="p-4 border-b border-gray-200 bg-gray-50 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <AbcXyzMatrix
                        data={data.filter(r => activeTab === 'service' ? r.isService : !r.isService)}
                        basis="cost"
                        activeAbc={abcFilter}
                        activeXyz={xyzFilter}
                        isActiveBasis={abcBasis === 'cost'}
                        onSelect={(abc, xyz) => { setAbcBasis('cost'); setAbcFilter(abc); setXyzFilter(xyz); }}
                    />
                    <AbcXyzMatrix
                        data={data.filter(r => activeTab === 'service' ? r.isService : !r.isService)}
                        basis="revenue"
                        activeAbc={abcFilter}
                        activeXyz={xyzFilter}
                        isActiveBasis={abcBasis === 'revenue'}
                        onSelect={(abc, xyz) => { setAbcBasis('revenue'); setAbcFilter(abc); setXyzFilter(xyz); }}
                    />
                </div>
            )}

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            {currentTabColumns.map((col) => (
                                <th
                                    key={col.key}
                                    scope="col"
                                    style={{ width: columnWidths[col.key] || 'auto', minWidth: columnWidths[col.key] || 'auto' }}
                                    className={cn(
                                        "px-3 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 relative group/th",
                                        col.key === 'status' && !columnWidths[col.key] && "min-w-[150px]"
                                    )}
                                    onClick={() => handleSort(col.key as keyof AnalysisResult)}
                                >
                                    <div className="flex items-center gap-1 truncate">
                                        {col.label}
                                        <ArrowUpDown className="w-3 h-3 text-gray-300" />
                                    </div>
                                    <div
                                        onMouseDown={(e) => {
                                            const th = e.currentTarget.parentElement;
                                            if (th) handleMouseDown(e, col.key, th.offsetWidth);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className={cn(
                                            "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-indigo-400 transition-colors",
                                            resizing?.key === col.key ? "bg-indigo-600 w-0.5" : "bg-transparent"
                                        )}
                                    />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {filteredData.length > 0 ? (
                            filteredData.map((row) => (
                                <tr
                                    key={row.sku}
                                    onClick={() => setSelectedItem(row)}
                                    className={cn(
                                        "hover:bg-gray-50 transition-colors cursor-pointer",
                                        row.manualReview && "bg-amber-50/50"
                                    )}>
                                    {currentTabColumns.map((col) => {
                                        const value = row[col.key as keyof AnalysisResult] as string | number | undefined;

                                        // Special renderers
                                        if (col.key === 'status') {
                                            return (
                                                <td key={col.key} className="px-3 py-4 whitespace-normal min-w-[150px]">
                                                    <div className="flex flex-col gap-1">
                                                        {(activeTab === 'main' || activeTab === 'service')
                                                            ? <LevelStatusBadge status={row.levelStatus} />
                                                            : <StatusBadge status={row.status} />}
                                                        <span className={cn(
                                                            "text-[9px] font-bold uppercase",
                                                            row.variabilityClass === 'Alta' ? "text-red-600" :
                                                                row.variabilityClass === 'Media' ? "text-amber-600" : "text-emerald-600"
                                                        )}>
                                                            {row.variabilityClass === 'Alta' || row.variabilityClass === 'Media' ? '⚠️ ' : '✅ '}
                                                            Variabilidad {row.variabilityClass}
                                                        </span>
                                                        {row.demandSource === 'Promedio Trienal' && (
                                                            <span className="text-[9px] font-bold text-purple-600 uppercase">
                                                                🔄 Demanda Anormal
                                                            </span>
                                                        )}
                                                        {(row.demandSource === 'Ventas 2026' || (row.sales2026 ?? 0) > 0) && (
                                                            <span className="text-[9px] font-bold text-emerald-600 uppercase">
                                                                📅 Prioridad 2026
                                                            </span>
                                                        )}
                                                        {row.unitPrice > 10000 && (
                                                            <span className="text-[9px] font-bold text-blue-600 uppercase">
                                                                💎 Ultra-Alto Valor
                                                            </span>
                                                        )}
                                                        {row.unitPrice >= 1500 && row.unitPrice <= 10000 && (
                                                            <span className="text-[9px] font-bold text-indigo-600 uppercase">
                                                                💰 Alto Valor
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        }

                                        if ((col.key === 'unitPrice' || col.key === 'unitCost') && typeof value === 'number') {
                                            return (
                                                <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm text-gray-500">
                                                    {value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                                                </td>
                                            );
                                        }

                                        // Nivel del ERP: tres estados distintos. null = el campo
                                        // no existe en Zoho; -1 = marca manual "solo bajo demanda";
                                        // cualquier otro número = el nivel real (0 incluido).
                                        if (col.key === 'currentLevel' || col.key === 'erpLevel') {
                                            return (
                                                <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                                                    {value === null || value === undefined ? (
                                                        <span className="text-gray-400 italic" title="El artículo no tiene nivel de reposición configurado en el ERP">Sin configurar</span>
                                                    ) : value === -1 ? (
                                                        <span className="text-indigo-600 font-medium" title="Marcado en el ERP como -1: solo se pide bajo demanda, no se mantiene stock">Bajo demanda</span>
                                                    ) : value}
                                                </td>
                                            );
                                        }

                                        if ((col.key === 'reorderPoint' || col.key === 'optimalQuantity') && typeof value === 'number') {
                                            return (
                                                <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 font-semibold">
                                                    {value.toFixed(0)}
                                                </td>
                                            );
                                        }

                                        if (col.key === 'abcXyz') {
                                            const code = String(value ?? '');
                                            return (
                                                <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm">
                                                    <span className={cn(
                                                        'text-xs font-bold px-2 py-0.5 rounded',
                                                        ABC_XYZ_COLORS[code] || 'bg-gray-100 text-gray-400'
                                                    )}>
                                                        {code || '—'}
                                                    </span>
                                                </td>
                                            );
                                        }

                                        if (col.key === 'abcClass' || col.key === 'xyzClass') {
                                            return (
                                                <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm text-center font-semibold text-gray-700">
                                                    {String(value ?? '—')}
                                                </td>
                                            );
                                        }

                                        if (col.key === 'demandPattern') {
                                            const code = String(value ?? '');
                                            return (
                                                <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm">
                                                    <span
                                                        className={cn('text-xs font-semibold px-2 py-0.5 rounded', DEMAND_PATTERN_COLORS[code] || 'bg-gray-100 text-gray-400')}
                                                        title={`ADI ${row.adi === Infinity ? '∞' : row.adi.toFixed(2)} · CV² ${row.cv2.toFixed(2)}${row.demandSource === 'Croston (SBA)' ? ' · PdP por Croston' : ''}`}
                                                    >
                                                        {code || '—'}
                                                    </span>
                                                </td>
                                            );
                                        }

                                        if (col.key === 'eoq') {
                                            const eoq = computeEoq(row.annualSales, row.unitCost, eoqOrderCost, eoqHoldingRate);
                                            if (eoq <= 0) {
                                                return <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm text-gray-400">—</td>;
                                            }
                                            const q = Math.round(row.optimalQuantity);
                                            const diff = q > 0 ? (eoq - q) / q : 0;
                                            return (
                                                <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm">
                                                    <span className="font-semibold text-gray-900" title={`EOQ ${eoq} vs Q heurística ${q} (S=${eoqOrderCost} USD, H=${eoqHoldingRate}%)`}>
                                                        {eoq}
                                                    </span>
                                                    {q > 0 && Math.abs(diff) >= 0.2 && (
                                                        <span className={cn('ml-1 text-[10px] font-medium', eoq < q ? 'text-emerald-600' : 'text-amber-600')}>
                                                            {eoq < q ? '↓' : '↑'}{Math.abs(Math.round(diff * 100))}%
                                                        </span>
                                                    )}
                                                </td>
                                            );
                                        }

                                        if (col.key === 'etaDate') {
                                            if (!row.etaDate) {
                                                return <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm text-gray-400">—</td>;
                                            }
                                            const d = row.etaDays;
                                            const cls = d < 0 ? 'text-red-600' : d <= 15 ? 'text-amber-600' : 'text-emerald-600';
                                            const label = d < 0 ? `atrasada ${Math.abs(d)}d` : `en ${d}d`;
                                            return (
                                                <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm">
                                                    <span className="text-gray-900">{row.etaDate}</span>
                                                    <span className={cn('ml-1 text-[10px] font-medium', cls)} title={`OC ${row.orderDate} + lead time`}>
                                                        {label}
                                                    </span>
                                                </td>
                                            );
                                        }

                                        if (col.key === 'coverageDays') {
                                            const cov = row.coverageDays;
                                            if (cov < 0) {
                                                return (
                                                    <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm text-gray-400">—</td>
                                                );
                                            }
                                            return (
                                                <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm">
                                                    <span className={cn(
                                                        "font-semibold",
                                                        row.coverageRisk ? "text-red-600" : "text-emerald-600"
                                                    )} title={row.coverageRisk ? `Cobertura (${cov} d) menor que el lead time (${row.leadTimeDays} d): riesgo de quiebre` : `${cov} días de cobertura`}>
                                                        {cov} d
                                                    </span>
                                                </td>
                                            );
                                        }

                                        if (col.key === 'deviation' && typeof value === 'number') {
                                            return (
                                                <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm">
                                                    <span className={cn(
                                                        "font-medium",
                                                        value < 0 ? "text-red-600" : "text-emerald-600"
                                                    )}>
                                                        {value > 0 ? '+' : ''}{value.toFixed(0)}
                                                    </span>
                                                </td>
                                            );
                                        }

                                        if (col.key === 'availableQuantity' && typeof value === 'number') {
                                            return (
                                                <td key={col.key} className={cn(
                                                    "px-3 py-4 whitespace-nowrap text-sm font-bold",
                                                    value < 0 ? "text-red-600" : "text-gray-900"
                                                )}>{value}</td>
                                            );
                                        }

                                        if (col.key === 'committedQuantity') {
                                            return (
                                                <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm text-red-600 font-medium">{value}</td>
                                            );
                                        }

                                        if (col.key === 'suggestedOrder') {
                                            const threshold = Math.max(row.reorderPoint, Math.max(row.erpLevel ?? 0, 0));
                                            const suggested = Math.max(0, Math.round(threshold + row.optimalQuantity - (row.availableQuantity + row.orderedQuantity)));
                                            return (
                                                <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm text-indigo-600 font-bold">
                                                    {suggested}
                                                </td>
                                            );
                                        }

                                        // Default text renderer
                                        return (
                                            <td key={col.key} className={cn(
                                                "px-3 py-4 whitespace-nowrap text-sm text-gray-500",
                                                col.key === 'manufacturer' && "font-medium text-gray-900",
                                                col.key === 'sku' && "font-medium text-gray-900",
                                                (col.key === 'itemName' || col.key === 'category') && "max-w-xs truncate"
                                            )} title={String(value)}>
                                                {value !== undefined ? String(value) : '-'}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={currentTabColumns.length} className="px-6 py-10 text-center text-sm text-gray-500">
                                    No se encontraron resultados
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex justify-between">
                <span>Total en Vista: {filteredData.length}</span>
                <span className="italic">Ambientalia Inventory Optimization v1.2</span>
            </div>
            </>
            )}

            <Modal
                isOpen={!!selectedItem}
                onClose={() => setSelectedItem(null)}
                title={`Detalle de Justificación: ${selectedItem?.sku} - ${selectedItem?.itemName}`}
            >
                {selectedItem && (
                    <div className="space-y-4">
                        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <h4 className="font-medium text-gray-900 mb-2">📊 Variabilidad: <span className={cn(
                                "font-bold",
                                selectedItem.variabilityClass === 'Alta' ? "text-red-600" :
                                    selectedItem.variabilityClass === 'Media' ? "text-amber-600" : "text-emerald-600"
                            )}>{selectedItem.variabilityClass}</span></h4>
                            <p className="text-sm text-gray-600 mb-1">Ratio calculado: <strong>{selectedItem.variabilityRatio.toFixed(2)}</strong></p>
                            <p className="text-xs text-gray-500">
                                Se basa en la relación entre la volatilidad histórica (2023-2024) y la actual (2025).
                                <br />• Alta: Ratio &ge; 2.0 (Alta volatilidad histórica vs reciente)
                                <br />• Media: 1.2 &le; Ratio &lt; 2.0
                                <br />• Baja: Ratio &lt; 1.2 (Estable o volatilidad en aumento reciente)
                            </p>
                        </div>

                        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <h4 className="font-medium text-gray-900 mb-2">📉 Tipo de Demanda: <span className={cn(
                                "font-bold",
                                selectedItem.demandType === 'Anormal' ? "text-purple-600" : "text-blue-600"
                            )}>{selectedItem.demandType}</span></h4>
                            <p className="text-sm text-gray-600 mb-1">Fuente: <strong>{selectedItem.demandSource}</strong></p>
                            <p className="text-xs text-gray-500">
                                Determina si el comportamiento de ventas es consistente.
                                <br />• Anormal: Caída mayor al 20% en la proyección (usa Promedio Trienal).
                                <br />• Normal: Comportamiento estable (usa Ventas recientes).
                            </p>
                        </div>

                        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <h4 className="font-medium text-gray-900 mb-2">💰 Clasificación de Valor: <span className={cn(
                                "font-bold",
                                selectedItem.valueClass === 'Ultra Alto' ? "text-blue-700" :
                                    selectedItem.valueClass === 'Alto' ? "text-indigo-600" : "text-gray-600"
                            )}>{selectedItem.valueClass}</span></h4>
                            <p className="text-sm text-gray-600 mb-1">Precio Unitario: <strong>{selectedItem.unitPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</strong></p>
                            <p className="text-xs text-gray-500">
                                Segmentación basada en el costo del artículo.
                                <br />• Ultra Alto: &gt; $10,000
                                <br />• Alto: $1,500 - $10,000
                                <br />• Estándar: &lt; $1,500
                            </p>
                        </div>

                        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 overflow-x-auto relative">
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="font-medium text-gray-900">📅 Movimientos Históricos</h4>
                                <div className="relative">
                                    <button
                                        onClick={() => setShowHistoryColumnPicker(!showHistoryColumnPicker)}
                                        className={cn(
                                            "p-1.5 rounded-md border shadow-sm transition-colors",
                                            showHistoryColumnPicker
                                                ? "bg-indigo-50 border-indigo-600 text-indigo-600"
                                                : "bg-white border-gray-300 text-gray-500 hover:text-gray-700"
                                        )}
                                        title="Configurar columnas de historial"
                                    >
                                        <Settings2 className="w-3.5 h-3.5" />
                                    </button>

                                    {showHistoryColumnPicker && (
                                        <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 z-50 animate-in fade-in zoom-in-95 duration-100">
                                            <div className="p-2 border-b border-gray-100 bg-gray-50">
                                                <h3 className="text-[10px] font-bold text-gray-900 uppercase tracking-wider">Configurar Historial</h3>
                                            </div>
                                            <div className="p-1 max-h-64 overflow-y-auto">
                                                <SortableColumnList
                                                    columns={columns['history']}
                                                    visibleKeys={visibleColumns['history']}
                                                    onToggle={(key) => toggleColumnVisibility('history', key)}
                                                    onDragEnd={(e) => handleDragEnd(e, 'history')}
                                                    sensors={sensors}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <table className="min-w-full divide-y divide-gray-200 text-xs">
                                <thead>
                                    <tr>
                                        {columns['history'].filter(col => visibleColumns['history'].has(col.key)).map(col => (
                                            <th
                                                key={col.key}
                                                style={{ width: columnWidths[col.key] || 'auto', minWidth: columnWidths[col.key] || 'auto' }}
                                                className={cn(
                                                    "font-semibold text-gray-600 px-2 py-1 relative group/th",
                                                    col.key === 'year' ? "text-left" : "text-right"
                                                )}
                                            >
                                                {col.label}
                                                <div
                                                    onMouseDown={(e) => {
                                                        const th = e.currentTarget.parentElement;
                                                        if (th) handleMouseDown(e, col.key, th.offsetWidth);
                                                    }}
                                                    className={cn(
                                                        "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-indigo-400 transition-colors",
                                                        resizing?.key === col.key ? "bg-indigo-600 w-0.5" : "bg-transparent"
                                                    )}
                                                />
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {['2026', '2025', '2024', '2023'].map(yearStr => {
                                        const values = selectedItem.history[yearStr] || new Array(12).fill(0);
                                        const total = values.reduce((a, b) => a + b, 0);
                                        if (total === 0 && yearStr === '2026') return null;
                                        return (
                                            <tr key={yearStr} className="hover:bg-gray-100/50">
                                                {columns['history'].filter(col => visibleColumns['history'].has(col.key)).map(col => {
                                                    if (col.key === 'year') {
                                                        return <td key={col.key} className="font-medium text-gray-900 px-2 py-1">{yearStr}</td>;
                                                    }
                                                    if (col.key === 'total') {
                                                        return <td key={col.key} className="font-bold text-gray-900 px-2 py-1 text-right">{total}</td>;
                                                    }
                                                    const monthIdx = parseInt(col.key);
                                                    const v = values[monthIdx];
                                                    return (
                                                        <td key={col.key} className={cn(
                                                            "px-2 py-1 text-right font-mono",
                                                            v > 0 ? "text-gray-900" : "text-gray-300"
                                                        )}>
                                                            {v > 0 ? v : '-'}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </Modal>
        </div >
    );
};
