import { useMemo, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { DollarSign, Users, ArrowUpRight, RefreshCcw, Filter, Download, AlertCircle, TrendingUp } from 'lucide-react';

type SortState = { key: string | null; direction: 'asc' | 'desc' };

type Analysis = {
    error?: string;
    totalSales: number;
    totalCost: number;
    totalMargin: number;
    marginPercent: number;
    items: any[];
    customers: any[];
    brands: any[];
    customerKey: string;
};

const formatMoney = (value: number) => {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
};

const formatPercent = (value: number) => {
    return new Intl.NumberFormat('en-US', {
        style: 'percent',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    }).format(value);
};

export default function Dashboard({ sales, products, onReset }: { sales: any[]; products: any[]; onReset: () => void }) {
    const [activeTab, setActiveTab] = useState('overview'); // overview, customers, items
    const [filterBrand, setFilterBrand] = useState('All');
    const [filterCategory, setFilterCategory] = useState('All');
    const [filterCustomer, setFilterCustomer] = useState('All'); // For filtering customers table
    const [sortConfig, setSortConfig] = useState<SortState>({ key: null, direction: 'asc' }); // For table sorting
    const [selectedCustomer, setSelectedCustomer] = useState<any>(null); // For customer detail view
    const [selectedSku, setSelectedSku] = useState<any>(null); // For SKU detail view
    const [customerItemsSort, setCustomerItemsSort] = useState<SortState>({ key: null, direction: 'asc' }); // For customer items sort
    const [itemsSearchFilter, setItemsSearchFilter] = useState(''); // For items search filter
    const [itemsTableSort, setItemsTableSort] = useState<SortState>({ key: null, direction: 'asc' }); // For items table sorting

    const analysis: Analysis = useMemo<any>(() => {
        try {
            // 1. Build Product Map
            const productMap = new Map();
            if (Array.isArray(products)) {
                products.forEach(p => {
                    const sku = p['Código de Producto'] || p['SKU'];
                    if (sku) {
                        productMap.set(String(sku).trim(), {
                            cost: parseFloat(p['Precio de Compra por unidad']) || 0,
                            manufacturer: p['Fabricante'] || 'Desconocido',
                            category: p['Categoría'] || 'Sin Categoría',
                            name: p['Nombre de Producto'] || p['Nombre del artículo']
                        });
                    }
                });
            }

            // 2. Process Sales
            let totalSales = 0;
            let totalCost = 0;
            let processedItems: any[] = [];

            if (!Array.isArray(sales) || sales.length === 0) {
                return { error: "No hay datos de ventas disponibles para procesar." };
            }

            const sampleSale = sales[0] || {};
            // Robustly find customer key
            const customerKeys = Object.keys(sampleSale).filter(k =>
                k && (
                    k.toLowerCase().includes('cliente') ||
                    k.toLowerCase().includes('customer') ||
                    k.toLowerCase().includes('razón social') ||
                    k.toLowerCase().includes('razon social')
                )
            );
            const customerKey = customerKeys[0] || 'Cliente';

            sales.forEach(sale => {
                const customerName = sale[customerKey] || 'Cliente General';

                // Excluir transacciones de Ambientalia S.A.S.
                if (customerName === 'Ambientalia S.A.S.') return;

                const sku = String(sale['SKU'] || sale['Código de artículo'] || '').trim();

                const parseCurrency = (val: any) => {
                    if (typeof val === 'number') return val;
                    if (!val) return 0;
                    const clean = String(val).replace(/[^0-9.-]+/g, '');
                    return parseFloat(clean) || 0;
                };

                const qty = parseFloat(sale['Cantidad vendida']) || 0;
                const amount = parseCurrency(sale['Importe']);

                if (!sku || qty === 0) return;

                const unitSoldPrice = qty !== 0 ? amount / qty : 0;

                const productInfo = productMap.get(sku) || { cost: 0, manufacturer: sale['Marca'] || 'Desconocido', name: sale['Nombre del artículo'] || 'Item Desconocido' };
                const unitCost = productInfo.cost;

                const totalItemCost = unitCost * qty;
                const margin = amount - totalItemCost;

                totalSales += amount;
                totalCost += totalItemCost;

                processedItems.push({
                    sku,
                    name: sale['Nombre del artículo'] || productInfo.name,
                    brand: productInfo.manufacturer || sale['Marca'] || 'Genérico',
                    category: productInfo.category || 'Sin Categoría',
                    customer: customerName,
                    qty,
                    amount,
                    unitSoldPrice,
                    unitCost,
                    margin,
                    marginPercent: amount !== 0 ? margin / amount : (margin < 0 ? -1 : 0)
                });
            });

            // 3. Aggregate Data
            const byCustomer: Record<string, any> = {};
            const byBrand: Record<string, any> = {};

            processedItems.forEach(item => {
                // Customer Agg
                if (!byCustomer[item.customer]) {
                    byCustomer[item.customer] = { name: item.customer, sales: 0, cost: 0, margin: 0, items: 0 };
                }
                byCustomer[item.customer].sales += item.amount;
                byCustomer[item.customer].cost += (item.unitCost * item.qty);
                byCustomer[item.customer].margin += item.margin;
                byCustomer[item.customer].items += item.qty;

                // Brand Agg
                const brand = item.brand || 'Desconocido';
                if (!byBrand[brand]) {
                    byBrand[brand] = { name: brand, sales: 0, margin: 0 };
                }
                byBrand[brand].sales += item.amount;
                byBrand[brand].margin += item.margin;
            });

            const customerList = Object.values(byCustomer).map(c => ({
                ...c,
                marginPercent: c.sales ? c.margin / c.sales : (c.margin < 0 ? -1 : 0)
            })).sort((a, b) => b.margin - a.margin);

            const brandList = Object.values(byBrand).map(b => ({
                ...b,
                marginPercent: b.sales ? b.margin / b.sales : (b.margin < 0 ? -1 : 0)
            })).sort((a, b) => b.sales - a.sales);

            return {
                totalSales,
                totalCost,
                totalMargin: totalSales - totalCost,
                marginPercent: totalSales ? (totalSales - totalCost) / totalSales : 0,
                items: processedItems,
                customers: customerList,
                brands: brandList,
                customerKey
            };
        } catch (e) {
            console.error("Dashboard Analysis Error:", e);
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }, [sales, products]);

    // Handle column sorting
    const handleSort = (key: string) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    // Sort data based on current sort config
    const getSortedCustomers = () => {
        const key = sortConfig.key;
        if (!key) return analysis.customers;

        const sorted = [...analysis.customers].sort((a: any, b: any) => {
            const aVal = a[key];
            const bVal = b[key];

            if (typeof aVal === 'string') {
                return sortConfig.direction === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            }

            return sortConfig.direction === 'asc'
                ? aVal - bVal
                : bVal - aVal;
        });

        return sorted;
    };

    // Get articles for selected customer
    const getCustomerItems = (customerName: string) => {
        if (!analysis || !analysis.items) return [];
        return analysis.items.filter(item => item.customer === customerName);
    };

    // Handle customer items sorting
    const handleCustomerItemSort = (key: string) => {
        setCustomerItemsSort(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    // Sort customer items based on current sort config
    const getSortedCustomerItems = (customerName: string) => {
        const items = getCustomerItems(customerName);
        const key = customerItemsSort.key;
        if (!key) return items;

        const sorted = [...items].sort((a: any, b: any) => {
            let aVal = a[key];
            let bVal = b[key];

            // Handle numeric values
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return customerItemsSort.direction === 'asc'
                    ? aVal - bVal
                    : bVal - aVal;
            }

            // Handle string values
            aVal = String(aVal || '');
            bVal = String(bVal || '');
            return customerItemsSort.direction === 'asc'
                ? aVal.localeCompare(bVal)
                : bVal.localeCompare(aVal);
        });

        return sorted;
    };

    // Sort icon indicator
    const SortIndicator = ({ columnKey }: { columnKey: string }) => {
        if (sortConfig.key !== columnKey) return <span className="text-slate-300 ml-1">⇅</span>;
        return <span className="ml-1">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>;
    };

    // Sort icon indicator for customer items
    const CustomerItemsSortIndicator = ({ columnKey }: { columnKey: string }) => {
        if (customerItemsSort.key !== columnKey) return <span className="text-slate-300 ml-1">⇅</span>;
        return <span className="ml-1">{customerItemsSort.direction === 'asc' ? '▲' : '▼'}</span>;
    };

    // Handle items table sorting
    const handleItemsTableSort = (key: string) => {
        setItemsTableSort(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    // Sort icon indicator for items table
    const ItemsTableSortIndicator = ({ columnKey }: { columnKey: string }) => {
        if (itemsTableSort.key !== columnKey) return <span className="text-slate-300 ml-1">⇅</span>;
        return <span className="ml-1">{itemsTableSort.direction === 'asc' ? '▲' : '▼'}</span>;
    };

    // Filter Logic - Safe Access with SKU/Name search and average prices by SKU
    const filteredItems = useMemo(() => {
        if (!analysis || analysis.error || !analysis.items) return []; // Safety check
        let items = analysis.items;
        if (filterBrand !== 'All') {
            items = items.filter(i => i.brand === filterBrand);
        }

        if (filterCategory !== 'All') {
            items = items.filter(i => i.category === filterCategory);
        }

        // Apply search filter
        if (itemsSearchFilter.trim()) {
            const searchLower = itemsSearchFilter.toLowerCase();
            items = items.filter(i =>
                i.sku.toLowerCase().includes(searchLower) ||
                i.name.toLowerCase().includes(searchLower)
            );
        }

        // Calculate average price per SKU
        const skuMap = new Map();
        items.forEach(item => {
            if (!skuMap.has(item.sku)) {
                skuMap.set(item.sku, {
                    ...item,
                    qty: item.qty,
                    totalAmount: item.amount,
                    totalCost: item.qty * item.unitCost,
                    totalMargin: item.margin
                });
            } else {
                const existing = skuMap.get(item.sku);
                existing.qty += item.qty;
                existing.totalAmount += item.amount;
                existing.totalCost += item.qty * item.unitCost;
                existing.totalMargin += item.margin;
            }
        });

        // Create aggregated items with totals and weighted averages
        const aggregated = Array.from(skuMap.values()).map(item => {
            const totalQty = item.qty;
            const totalAmount = item.totalAmount;
            const totalCost = item.totalCost;
            const totalMargin = item.totalMargin;
            const marginPercent = totalAmount > 0 ? totalMargin / totalAmount : 0;

            return {
                ...item,
                qty: totalQty,
                amount: totalAmount,
                unitSoldPrice: totalQty > 0 ? totalAmount / totalQty : item.unitSoldPrice,
                unitCost: totalQty > 0 ? totalCost / totalQty : item.unitCost,
                margin: totalMargin,
                marginPercent: marginPercent
            };
        });

        return aggregated.sort((a, b) => b.amount - a.amount);
    }, [analysis, filterBrand, filterCategory, itemsSearchFilter]);

    // Get sorted items table
    const getSortedItemsTable = () => {
        const key = itemsTableSort.key;
        if (!key) return filteredItems;

        const sorted = [...filteredItems].sort((a: any, b: any) => {
            let aVal = a[key];
            let bVal = b[key];

            // Handle numeric values
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return itemsTableSort.direction === 'asc'
                    ? aVal - bVal
                    : bVal - aVal;
            }

            // Handle string values
            aVal = String(aVal || '');
            bVal = String(bVal || '');
            return itemsTableSort.direction === 'asc'
                ? aVal.localeCompare(bVal)
                : bVal.localeCompare(aVal);
        });

        return sorted;
    };

    const uniqueBrands = useMemo(() => {
        if (!analysis || analysis.error || !analysis.brands) return ['All']; // Safety check
        return ['All', ...analysis.brands.map(b => b.name)];
    }, [analysis]);

    const uniqueCategories = useMemo(() => {
        if (!analysis || analysis.error || !analysis.items) return ['All']; // Safety check
        const categories = new Set(analysis.items.map(i => i.category));
        return ['All', ...Array.from(categories).sort()];
    }, [analysis]);

    const uniqueCustomers = useMemo(() => {
        if (!analysis || analysis.error || !analysis.customers) return ['All']; // Safety check
        return ['All', ...analysis.customers.map(c => c.name).sort((a, b) => a.localeCompare(b))];
    }, [analysis]);

    // Handle Error State - Returned LAST after all hooks
    if (analysis?.error) {
        return (
            <div className="p-8 flex flex-col items-center justify-center text-red-600 bg-white rounded-xl shadow border border-red-100 mt-10">
                <AlertCircle size={48} className="mb-4 text-red-500" />
                <h3 className="text-xl font-bold mb-2">Error en el análisis de datos</h3>
                <p className="text-slate-600">{analysis.error}</p>
                <button onClick={onReset} className="mt-6 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 font-medium transition-colors">
                    Intentar de nuevo
                </button>
            </div>
        );
    }

    const exportToExcel = async () => {
        // Import dinámico: xlsx (424 KB) solo se carga al exportar, no en el bundle inicial (FE-001).
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();

        // Summary Sheet
        const summaryData = [
            ['Métrica', 'Valor'],
            ['Ventas Totales', analysis.totalSales],
            ['Costo Total', analysis.totalCost],
            ['Margen Total', analysis.totalMargin],
            ['% Margen', analysis.marginPercent]
        ];
        const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, wsSummary, "Resumen");

        // Customers Sheet
        const wsCustomers = XLSX.utils.json_to_sheet(analysis.customers);
        XLSX.utils.book_append_sheet(wb, wsCustomers, "Rentabilidad Clientes");

        // Items Sheet
        const wsItems = XLSX.utils.json_to_sheet(analysis.items);
        XLSX.utils.book_append_sheet(wb, wsItems, "Detalle Items");

        XLSX.writeFile(wb, "Reporte_Rentabilidad.xlsx");
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-12">
            {/* Top Controls */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-2 rounded-[2rem] shadow-sm border border-slate-100 pr-4">
                <div className="flex items-center gap-2 w-full md:w-auto p-2">
                    <div className="flex items-center gap-3 bg-slate-50 px-4 py-3 rounded-2xl border border-slate-100 hover:border-slate-300 transition-colors w-full md:w-auto">
                        <Filter size={18} className="text-slate-400" />
                        <select
                            value={filterBrand}
                            onChange={(e) => setFilterBrand(e.target.value)}
                            className="bg-transparent text-sm font-semibold text-slate-700 focus:outline-none cursor-pointer min-w-[140px]"
                        >
                            {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto justify-end">
                    <button
                        onClick={onReset}
                        className="flex items-center gap-2 text-slate-500 hover:text-rose-600 px-4 py-2 rounded-xl hover:bg-rose-50 transition-all text-sm font-medium"
                    >
                        <RefreshCcw size={18} />
                        <span className="hidden md:inline">Reiniciar</span>
                    </button>
                    <button
                        onClick={exportToExcel}
                        className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-2xl font-semibold transition-all shadow-lg shadow-slate-200 hover:shadow-xl transform hover:-translate-y-0.5"
                    >
                        <Download size={18} />
                        Exportar
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KpiCard
                    title="Ingresos Totales"
                    value={formatMoney(analysis.totalSales)}
                    icon={<DollarSign size={24} className="text-blue-600" />}
                    color="blue"
                    trend={0.079}
                />
                <KpiCard
                    title="Margen Bruto"
                    value={formatMoney(analysis.totalMargin)}
                    icon={<ArrowUpRight size={24} className="text-emerald-600" />}
                    color="emerald"
                    trend={analysis.marginPercent}
                />
                <KpiCard
                    title="% Rentabilidad"
                    value={formatPercent(analysis.marginPercent)}
                    icon={<TrendingUpIcon percent={analysis.marginPercent} />}
                    color={analysis.marginPercent > 0.2 ? 'emerald' : 'amber'}
                />
                <KpiCard
                    title="Clientes Activos"
                    value={analysis.customers.length}
                    icon={<Users size={24} className="text-indigo-600" />}
                    color="indigo"
                    trend={0.02}
                />
            </div>

            {/* Main Content Tabs */}
            <div className="bg-transparent space-y-6">
                <div className="flex justify-center md:justify-start bg-white p-1.5 rounded-full inline-flex w-auto mx-auto md:mx-0 shadow-sm border border-slate-100">
                    <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>Visión General</TabButton>
                    <TabButton active={activeTab === 'customers'} onClick={() => setActiveTab('customers')}>Análisis Clientes</TabButton>
                    <TabButton active={activeTab === 'items'} onClick={() => setActiveTab('items')}>Detalle Items</TabButton>
                </div>

                <div className="min-h-[500px]">
                    {activeTab === 'overview' && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                                    <h3 className="text-lg font-bold text-slate-900 mb-6 tracking-tight">Rentabilidad por Marca (USD)</h3>
                                    <div className="h-[600px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={analysis.brands.slice(0, 10)} layout="vertical" margin={{ left: 150 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                                                <XAxis type="number" hide />
                                                <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 13, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <Tooltip
                                                    cursor={{ fill: '#f8fafc' }}
                                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                    formatter={(val) => [formatMoney(Number(val)), 'Margen']}
                                                />
                                                <Bar dataKey="margin" fill="#3b82f6" radius={[0, 6, 6, 0]} barSize={32} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                                    <h3 className="text-lg font-bold text-slate-900 mb-6 tracking-tight">Rentabilidad por Marca (%)</h3>
                                    <div className="h-[600px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={analysis.brands.slice(0, 10)} layout="vertical" margin={{ left: 150 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                                                <XAxis type="number" hide />
                                                <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 13, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <Tooltip
                                                    cursor={{ fill: '#f8fafc' }}
                                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                    formatter={(val) => [formatPercent(Number(val)), '% Rentabilidad']}
                                                />
                                                <Bar dataKey="marginPercent" fill="#10b981" radius={[0, 6, 6, 0]} barSize={32} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                                <h3 className="text-lg font-bold text-slate-900 mb-2 tracking-tight">Rentabilidad por Cliente</h3>
                                <p className="text-sm text-slate-500 mb-6">Haz click en cualquier barra para ver detalles</p>
                                <div style={{ height: `${Math.max(600, analysis.customers.length * 40)}px` }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            data={analysis.customers}
                                            layout="vertical"
                                            margin={{ left: 250, right: 20 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                                            <XAxis type="number" hide />
                                            <YAxis
                                                dataKey="name"
                                                type="category"
                                                width={240}
                                                tick={{ fontSize: 13, cursor: 'pointer', fill: '#3b82f6', fontWeight: 'bold' }}
                                                axisLine={false}
                                                tickLine={false}
                                                onClick={(e) => {
                                                    setSelectedCustomer(e.value);
                                                }}
                                            />
                                            <Tooltip
                                                cursor={{ fill: '#f8fafc' }}
                                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                formatter={(val) => [formatMoney(Number(val)), 'Margen']}
                                            />
                                            <Bar
                                                dataKey="margin"
                                                fill="#3b82f6"
                                                radius={[0, 6, 6, 0]}
                                                barSize={32}
                                                cursor="pointer"
                                                onClick={(data) => {
                                                    setSelectedCustomer(data.name);
                                                }}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                                <h3 className="text-lg font-bold text-slate-900 mb-2 tracking-tight">Rentabilidad por Cliente (%)</h3>
                                <p className="text-sm text-slate-500 mb-6">Haz click en cualquier barra para ver detalles</p>
                                <div style={{ height: `${Math.max(600, analysis.customers.length * 40)}px` }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            data={[...analysis.customers].sort((a, b) => b.marginPercent - a.marginPercent)}
                                            layout="vertical"
                                            margin={{ left: 250, right: 20 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                                            <XAxis type="number" hide />
                                            <YAxis
                                                dataKey="name"
                                                type="category"
                                                width={240}
                                                tick={{ fontSize: 13, cursor: 'pointer', fill: '#10b981', fontWeight: 'bold' }}
                                                axisLine={false}
                                                tickLine={false}
                                                onClick={(e) => {
                                                    setSelectedCustomer(e.value);
                                                }}
                                            />
                                            <Tooltip
                                                cursor={{ fill: '#f8fafc' }}
                                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                formatter={(val) => [formatPercent(Number(val)), '% Rentabilidad']}
                                            />
                                            <Bar
                                                dataKey="marginPercent"
                                                fill="#10b981"
                                                radius={[0, 6, 6, 0]}
                                                barSize={32}
                                                cursor="pointer"
                                                onClick={(data) => {
                                                    setSelectedCustomer(data.name);
                                                }}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'customers' && (
                        <div className="space-y-6">
                            <div className="flex items-center gap-2 bg-white px-4 py-3 rounded-[2rem] border border-slate-100 shadow-sm w-full md:w-auto self-start">
                                <Filter size={18} className="text-slate-400" />
                                <div className="h-4 w-px bg-slate-200 mx-2"></div>
                                <select
                                    value={filterCustomer}
                                    onChange={(e) => setFilterCustomer(e.target.value)}
                                    className="bg-transparent text-sm font-semibold text-slate-700 focus:outline-none flex-1 min-w-[200px] cursor-pointer"
                                >
                                    {uniqueCustomers.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-100">
                                            <tr>
                                                <th className="px-6 py-5 cursor-pointer hover:bg-slate-100/50 select-none text-xs uppercase tracking-wider transition-colors" onClick={() => handleSort('name')}>
                                                    Cliente <SortIndicator columnKey="name" />
                                                </th>
                                                <th className="px-6 py-5 text-right cursor-pointer hover:bg-slate-100/50 select-none text-xs uppercase tracking-wider transition-colors" onClick={() => handleSort('sales')}>
                                                    Ventas <SortIndicator columnKey="sales" />
                                                </th>
                                                <th className="px-6 py-5 text-right cursor-pointer hover:bg-slate-100/50 select-none text-xs uppercase tracking-wider transition-colors" onClick={() => handleSort('cost')}>
                                                    Costo <SortIndicator columnKey="cost" />
                                                </th>
                                                <th className="px-6 py-5 text-right cursor-pointer hover:bg-slate-100/50 select-none text-xs uppercase tracking-wider transition-colors" onClick={() => handleSort('margin')}>
                                                    Margen <SortIndicator columnKey="margin" />
                                                </th>
                                                <th className="px-6 py-5 text-right cursor-pointer hover:bg-slate-100/50 select-none text-xs uppercase tracking-wider transition-colors" onClick={() => handleSort('marginPercent')}>
                                                    % Rentabilidad <SortIndicator columnKey="marginPercent" />
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {getSortedCustomers().filter(c => filterCustomer === 'All' || c.name === filterCustomer).map((c, i) => (
                                                <tr key={i} className="hover:bg-slate-50/80 transition-colors group">
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setSelectedCustomer(c.name)}>
                                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs shadow-sm shadow-indigo-100
                                                                ${i % 4 === 0 ? 'bg-indigo-100 text-indigo-600' :
                                                                    i % 4 === 1 ? 'bg-rose-100 text-rose-600' :
                                                                        i % 4 === 2 ? 'bg-amber-100 text-amber-600' :
                                                                            'bg-emerald-100 text-emerald-600'}`}>
                                                                {c.name.substring(0, 2).toUpperCase()}
                                                            </div>
                                                            <span className="font-semibold text-slate-700 group-hover:text-slate-900 transition-colors">{c.name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-right font-medium text-slate-600">{formatMoney(c.sales)}</td>
                                                    <td className="px-6 py-4 text-right text-slate-400 font-medium">{formatMoney(c.cost)}</td>
                                                    <td className="px-6 py-4 text-right font-bold text-slate-800">{formatMoney(c.margin)}</td>
                                                    <td className="px-6 py-4 text-right">
                                                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold inline-block w-20 text-center shadow-sm ${c.marginPercent > 0.3 ? 'bg-emerald-100 text-emerald-700' :
                                                                c.marginPercent > 0.15 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                                                            }`}>
                                                            {formatPercent(c.marginPercent)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Customer Detail Modal */}
                    {selectedCustomer && (
                        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all">
                            <div className="bg-white rounded-3xl shadow-2xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col border border-slate-200 animate-in zoom-in-95 duration-200">
                                <div className="bg-white border-b border-slate-100 p-6 flex justify-between items-center">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 font-bold text-lg">
                                            {selectedCustomer.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-slate-800 tracking-tight">{selectedCustomer}</h2>
                                            <p className="text-sm text-slate-500">Detalle de rentabilidad por artículo</p>
                                        </div>
                                    </div>
                                    <button onClick={() => setSelectedCustomer(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600">✕</button>
                                </div>

                                <div className="p-0 overflow-auto flex-1 bg-slate-50/50">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left whitespace-nowrap">
                                            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                                                <tr>
                                                    <th className="px-4 py-3 cursor-pointer hover:bg-slate-100" onClick={() => handleCustomerItemSort('sku')}>SKU <CustomerItemsSortIndicator columnKey="sku" /></th>
                                                    <th className="px-4 py-3 cursor-pointer hover:bg-slate-100" onClick={() => handleCustomerItemSort('name')}>Artículo <CustomerItemsSortIndicator columnKey="name" /></th>
                                                    <th className="px-4 py-3 cursor-pointer hover:bg-slate-100" onClick={() => handleCustomerItemSort('brand')}>Marca <CustomerItemsSortIndicator columnKey="brand" /></th>
                                                    <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100" onClick={() => handleCustomerItemSort('qty')}>Cant. <CustomerItemsSortIndicator columnKey="qty" /></th>
                                                    <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100" onClick={() => handleCustomerItemSort('unitSoldPrice')}>P.Venta <CustomerItemsSortIndicator columnKey="unitSoldPrice" /></th>
                                                    <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100" onClick={() => handleCustomerItemSort('amount')}>Total <CustomerItemsSortIndicator columnKey="amount" /></th>
                                                    <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100" onClick={() => handleCustomerItemSort('unitCost')}>Costo U. <CustomerItemsSortIndicator columnKey="unitCost" /></th>
                                                    <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100" onClick={() => handleCustomerItemSort('margin')}>Margen <CustomerItemsSortIndicator columnKey="margin" /></th>
                                                    <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100" onClick={() => handleCustomerItemSort('marginPercent')}>% <CustomerItemsSortIndicator columnKey="marginPercent" /></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 bg-white">
                                                {getSortedCustomerItems(selectedCustomer).map((item, i) => (
                                                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{item.sku}</td>
                                                        <td className="px-4 py-3 font-medium text-slate-900">{item.name}</td>
                                                        <td className="px-4 py-3 text-slate-500 text-xs">{item.brand || '-'}</td>
                                                        <td className="px-4 py-3 text-right font-medium text-slate-600">{item.qty}</td>
                                                        <td className="px-4 py-3 text-right text-slate-500">{formatMoney(item.unitSoldPrice)}</td>
                                                        <td className="px-4 py-3 text-right font-bold text-slate-800">{formatMoney(item.amount)}</td>
                                                        <td className="px-4 py-3 text-right text-slate-400">{formatMoney(item.unitCost)}</td>
                                                        <td className="px-4 py-3 text-right font-semibold text-emerald-600">{formatMoney(item.margin)}</td>
                                                        <td className="px-4 py-3 text-right">
                                                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${item.marginPercent > 0.3 ? 'bg-emerald-50 text-emerald-600' : item.marginPercent > 0.15 ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'}`}>
                                                                {item.marginPercent === -1 ? '-100%' : formatPercent(item.marginPercent)}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* SKU Detail Modal - Simplified to match new style */}
                    {selectedSku && (
                        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all">
                            <div className="bg-white rounded-3xl shadow-2xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col border border-slate-200">
                                <div className="bg-white border-b border-slate-100 p-6 flex justify-between items-center">
                                    <div>
                                        <h2 className="text-xl font-bold text-slate-900">{selectedSku}</h2>
                                        <p className="text-sm text-slate-500">{analysis.items.find(i => i.sku === selectedSku)?.name}</p>
                                    </div>
                                    <button onClick={() => setSelectedSku(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">✕</button>
                                </div>
                                <div className="p-0 overflow-auto flex-1 bg-slate-50/50">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left whitespace-nowrap">
                                            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 sticky top-0 shadow-sm">
                                                <tr>
                                                    <th className="px-4 py-3">Cliente</th>
                                                    <th className="px-4 py-3 text-right">Cant.</th>
                                                    <th className="px-4 py-3 text-right">Precio</th>
                                                    <th className="px-4 py-3 text-right">Total</th>
                                                    <th className="px-4 py-3 text-right">Costo</th>
                                                    <th className="px-4 py-3 text-right">Margen</th>
                                                    <th className="px-4 py-3 text-right">%</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 bg-white">
                                                {analysis.items.filter(i => i.sku === selectedSku).sort((a, b) => b.amount - a.amount).map((item, i) => (
                                                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                        <td className="px-4 py-3 font-medium text-slate-900">{item.customer}</td>
                                                        <td className="px-4 py-3 text-right">{item.qty}</td>
                                                        <td className="px-4 py-3 text-right text-slate-500">{formatMoney(item.unitSoldPrice)}</td>
                                                        <td className="px-4 py-3 text-right font-bold text-slate-800">{formatMoney(item.amount)}</td>
                                                        <td className="px-4 py-3 text-right text-slate-400">{formatMoney(item.unitCost * item.qty)}</td>
                                                        <td className="px-4 py-3 text-right font-semibold text-emerald-600">{formatMoney(item.margin)}</td>
                                                        <td className="px-4 py-3 text-right"><span className="text-xs font-bold text-slate-500">{item.marginPercent === -1 ? '-100%' : formatPercent(item.marginPercent)}</span></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'items' && (
                        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                            <div className="p-6 border-b border-slate-100 space-y-4 bg-slate-50/30">
                                <input
                                    type="text"
                                    placeholder="Buscar por SKU o nombre de artículo..."
                                    value={itemsSearchFilter}
                                    onChange={(e) => setItemsSearchFilter(e.target.value)}
                                    className="w-full px-5 py-3 text-sm font-medium border border-slate-200 rounded-2xl focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all shadow-sm"
                                />
                                <div className="flex items-center gap-3 flex-wrap">
                                    <select
                                        value={filterBrand}
                                        onChange={(e) => setFilterBrand(e.target.value)}
                                        className="px-4 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 bg-white shadow-sm cursor-pointer hover:border-slate-300 transition-colors"
                                    >
                                        {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
                                    </select>
                                    <select
                                        value={filterCategory}
                                        onChange={(e) => setFilterCategory(e.target.value)}
                                        className="px-4 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 bg-white shadow-sm cursor-pointer hover:border-slate-300 transition-colors"
                                    >
                                        {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="max-h-[800px] overflow-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            <th className="px-4 py-4 cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap text-xs uppercase tracking-wide" onClick={() => handleItemsTableSort('sku')}>SKU <ItemsTableSortIndicator columnKey="sku" /></th>
                                            <th className="px-4 py-4 cursor-pointer hover:bg-slate-100 select-none text-xs uppercase tracking-wide" onClick={() => handleItemsTableSort('name')}>Nombre <ItemsTableSortIndicator columnKey="name" /></th>
                                            <th className="px-4 py-4 cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap text-xs uppercase tracking-wide" onClick={() => handleItemsTableSort('brand')}>Marca <ItemsTableSortIndicator columnKey="brand" /></th>
                                            <th className="px-4 py-4 cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap text-xs uppercase tracking-wide" onClick={() => handleItemsTableSort('category')}>Cat. <ItemsTableSortIndicator columnKey="category" /></th>
                                            <th className="px-4 py-4 text-right cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap text-xs uppercase tracking-wide" onClick={() => handleItemsTableSort('qty')}>Cant. <ItemsTableSortIndicator columnKey="qty" /></th>
                                            <th className="px-4 py-4 text-right cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap text-xs uppercase tracking-wide" onClick={() => handleItemsTableSort('unitSoldPrice')}>P.Vta <ItemsTableSortIndicator columnKey="unitSoldPrice" /></th>
                                            <th className="px-4 py-4 text-right cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap text-xs uppercase tracking-wide" onClick={() => handleItemsTableSort('unitCost')}>Costo <ItemsTableSortIndicator columnKey="unitCost" /></th>
                                            <th className="px-4 py-4 text-right cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap text-xs uppercase tracking-wide" onClick={() => handleItemsTableSort('margin')}>Margen <ItemsTableSortIndicator columnKey="margin" /></th>
                                            <th className="px-4 py-4 text-right cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap text-xs uppercase tracking-wide" onClick={() => handleItemsTableSort('marginPercent')}>% <ItemsTableSortIndicator columnKey="marginPercent" /></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {getSortedItemsTable().slice(0, 500).map((item, i) => ( // Limit render for perf
                                            <tr key={i} className="hover:bg-blue-50/50 transition-colors text-sm group">
                                                <td className="px-4 py-3 font-mono text-xs text-slate-500 cursor-pointer hover:text-indigo-600 hover:underline whitespace-nowrap" onClick={() => setSelectedSku(item.sku)}>{item.sku}</td>
                                                <td className="px-4 py-3 font-medium text-slate-700 cursor-pointer hover:text-indigo-600 hover:underline min-w-[200px]" onClick={() => setSelectedSku(item.sku)}>{item.name}</td>
                                                <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{item.brand}</td>
                                                <td className="px-4 py-3 text-slate-400 whitespace-nowrap text-xs">{item.category}</td>
                                                <td className="px-4 py-3 text-right whitespace-nowrap font-medium text-slate-600">{item.qty}</td>
                                                <td className="px-4 py-3 text-right font-medium whitespace-nowrap text-slate-600">{formatMoney(item.unitSoldPrice)}</td>
                                                <td className="px-4 py-3 text-right text-slate-400 whitespace-nowrap text-xs">{formatMoney(item.unitCost)}</td>
                                                <td className="px-4 py-3 text-right font-bold text-slate-800 whitespace-nowrap">{formatMoney(item.margin)}</td>
                                                <td className="px-4 py-3 text-right">
                                                    <span className={`px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap inline-block ${item.marginPercent > 0.3 ? 'bg-emerald-50 text-emerald-600' : item.marginPercent > 0.15 ? 'bg-amber-50 text-amber-600' : item.marginPercent === -1 ? 'bg-rose-50 text-rose-600' : 'bg-rose-50 text-rose-600'}`}>
                                                        {item.marginPercent === -1 ? '-100%' : formatPercent(item.marginPercent)}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {filteredItems.length > 500 && (
                                    <div className="p-4 text-center text-slate-500 text-sm bg-slate-50 border-t border-slate-200">
                                        Mostrando primeros 500 items. Exporta a Excel para ver todo.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

const KpiCard = ({ title, value, icon, color, trend = null }: { title: string; value: any; icon: any; color: string; trend?: number | null }) => (
    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 group relative overflow-hidden">
        <div className={`absolute top-0 right-0 w-32 h-32 bg-${color}-50/50 rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-125`}></div>

        <div className="relative">
            <div className="flex justify-between items-start mb-4">
                <div className={`p-3.5 bg-${color}-50 rounded-2xl text-${color}-600`}>
                    {icon}
                </div>
                {trend && (
                    <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${trend > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                        {trend > 0 ? '↗' : '↘'} {Math.abs(trend * 100).toFixed(1)}%
                    </div>
                )}
            </div>

            <div>
                <p className="text-slate-500 text-sm font-medium mb-1 tracking-wide">{title}</p>
                <h4 className="text-3xl font-bold text-slate-900 tracking-tight">{value}</h4>
            </div>
        </div>
    </div>
);

const TabButton = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: any }) => (
    <button
        onClick={onClick}
        className={`px-6 py-3 text-sm font-semibold transition-all rounded-full ${active
                ? 'bg-slate-900 text-white shadow-lg shadow-slate-200'
                : 'text-slate-500 hover:text-slate-900 hover:bg-white'
            }`}
    >
        {children}
    </button>
);

const TrendingUpIcon = ({ percent }: { percent: number }) => (
    percent > 0.2 ? <TrendingUp size={24} className="text-emerald-600" /> : <TrendingUp size={24} className="text-amber-500" />
);
