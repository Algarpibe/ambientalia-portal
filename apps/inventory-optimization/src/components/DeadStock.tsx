import { useMemo } from 'react';
import type { AnalysisResult } from '../types';
import { cn } from './ui';

const usd = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const DEAD_COLORS: Record<string, string> = {
    Lento: 'bg-amber-100 text-amber-700',
    Muerto: 'bg-orange-100 text-orange-700',
    Obsoleto: 'bg-red-100 text-red-700',
    Sobrestock: 'bg-indigo-100 text-indigo-700',
};

interface KpiProps {
    label: string;
    value: string;
    hint?: string;
    accent?: string;
}
function Kpi({ label, value, hint, accent }: KpiProps) {
    return (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs text-gray-500">{label}</div>
            <div className={cn('text-2xl font-bold mt-1', accent || 'text-gray-900')}>{value}</div>
            {hint && <div className="text-xs text-gray-400 mt-0.5">{hint}</div>}
        </div>
    );
}

export default function DeadStock({ data }: { data: AnalysisResult[] }) {
    const { rows, kpis } = useMemo(() => {
        // Afectados: stock muerto (Lento/Muerto/Obsoleto) o con sobrestock.
        const rows = data
            .filter((r) => r.deadStockClass !== 'Activo' || r.overstockUnits > 0)
            .map((r) => ({
                ...r,
                locked: r.deadStockValue + r.overstockValue,
                // Etiqueta principal: si es muerto/obsoleto/lento usa esa; si no, Sobrestock.
                tag: r.deadStockClass !== 'Activo' ? r.deadStockClass : 'Sobrestock',
            }))
            .sort((a, b) => b.locked - a.locked || b.inventoryValue - a.inventoryValue);

        const kpis = {
            totalInventory: data.reduce((s, r) => s + r.inventoryValue, 0),
            deadValue: data.reduce((s, r) => s + r.deadStockValue, 0),
            overstockValue: data.reduce((s, r) => s + r.overstockValue, 0),
            deadCount: data.filter((r) => r.deadStockClass === 'Muerto' || r.deadStockClass === 'Obsoleto').length,
            slowCount: data.filter((r) => r.deadStockClass === 'Lento').length,
            overstockCount: data.filter((r) => r.overstockUnits > 0).length,
        };
        return { rows, kpis };
    }, [data]);

    const exportExcel = async () => {
        const XLSX = await import('xlsx');
        const out = rows.map((r) => ({
            SKU: r.sku,
            'Artículo': r.itemName,
            Proveedor: r.vendor,
            'Física': r.physicalHandQuantity,
            'Meses sin venta': r.monthsSinceLastSale < 0 ? 'Nunca' : r.monthsSinceLastSale,
            Clase: r.tag,
            'Costo (USD)': r.unitCost,
            'Valor inventario (USD)': Math.round(r.inventoryValue),
            'Capital dead (USD)': Math.round(r.deadStockValue),
            'Uds sobrestock': r.overstockUnits,
            'Capital sobrestock (USD)': Math.round(r.overstockValue),
            'Capital inmovilizado (USD)': Math.round(r.locked),
        }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), 'Capital Inmovilizado');
        XLSX.writeFile(wb, 'Capital_Inmovilizado.xlsx');
    };

    return (
        <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi label="Capital total en inventario" value={usd(kpis.totalInventory)} hint="físico × costo" />
                <Kpi
                    label="Capital en dead stock"
                    value={usd(kpis.deadValue)}
                    hint={`${kpis.deadCount} ítems (Muerto/Obsoleto)`}
                    accent="text-red-600"
                />
                <Kpi
                    label="Capital en sobrestock"
                    value={usd(kpis.overstockValue)}
                    hint={`${kpis.overstockCount} ítems por encima del techo`}
                    accent="text-indigo-600"
                />
                <Kpi
                    label="Inmovilizado total"
                    value={usd(kpis.deadValue + kpis.overstockValue)}
                    hint={`${kpis.slowCount} lentos (aviso)`}
                    accent="text-amber-600"
                />
            </div>

            <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400 italic">
                    Dead stock = existencia física sin ventas (Lento ≥6m · Muerto ≥12m · Obsoleto ≥24m o nunca).
                    Sobrestock = unidades por encima de PdP + Q óptima en ítems que rotan.
                </p>
                {rows.length > 0 && (
                    <button
                        onClick={exportExcel}
                        className="px-4 py-2 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors whitespace-nowrap"
                    >
                        Exportar a Excel
                    </button>
                )}
            </div>

            {rows.length === 0 ? (
                <div className="p-10 text-center text-sm text-gray-500">
                    Sin capital inmovilizado detectado (ni dead stock ni sobrestock). 🎉
                </div>
            ) : (
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50">
                            <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                                <th className="px-4 py-2 font-medium">SKU</th>
                                <th className="px-4 py-2 font-medium">Artículo</th>
                                <th className="px-4 py-2 font-medium">Proveedor</th>
                                <th className="px-4 py-2 font-medium text-center">Clase</th>
                                <th className="px-4 py-2 font-medium text-right">Física</th>
                                <th className="px-4 py-2 font-medium text-right">Meses s/venta</th>
                                <th className="px-4 py-2 font-medium text-right">Costo</th>
                                <th className="px-4 py-2 font-medium text-right">Valor inv.</th>
                                <th className="px-4 py-2 font-medium text-right">Inmovilizado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {rows.map((r) => (
                                <tr key={r.sku} className="hover:bg-gray-50">
                                    <td className="px-4 py-2 font-medium text-gray-900 whitespace-nowrap">{r.sku}</td>
                                    <td className="px-4 py-2 text-gray-600 max-w-xs truncate" title={r.itemName}>{r.itemName}</td>
                                    <td className="px-4 py-2 text-gray-500 max-w-[10rem] truncate" title={r.vendor}>{r.vendor}</td>
                                    <td className="px-4 py-2 text-center">
                                        <span className={cn('text-[10px] font-bold uppercase px-2 py-0.5 rounded-full', DEAD_COLORS[r.tag] || 'bg-gray-100 text-gray-500')}>
                                            {r.tag}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2 text-right text-gray-700">{r.physicalHandQuantity}</td>
                                    <td className="px-4 py-2 text-right text-gray-500">
                                        {r.monthsSinceLastSale < 0 ? 'Nunca' : r.monthsSinceLastSale}
                                    </td>
                                    <td className="px-4 py-2 text-right text-gray-500">{usd(r.unitCost)}</td>
                                    <td className="px-4 py-2 text-right text-gray-700">{usd(r.inventoryValue)}</td>
                                    <td className="px-4 py-2 text-right font-bold text-red-600">{usd(r.locked)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
