import { useMemo, useState } from 'react';
import type { AnalysisResult } from '../types';
import { cn } from './ui';
import { isReplenishable, suggestedOrderFor } from '../utils/resultTableLogic';

interface SuggestedLine {
    sku: string;
    itemName: string;
    physicalAvailable: number;
    reorderPoint: number;
    incoming: number;
    suggestedQty: number;
    unitPrice: number;
    amount: number;
    status: AnalysisResult['status'];
    leadTimeDays: number;
    coverageRisk: boolean;
}

interface VendorGroup {
    vendor: string;
    lines: SuggestedLine[];
    totalUnits: number;
    totalAmount: number;
    urgentCount: number;
}

const usd = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function buildGroups(data: AnalysisResult[]): VendorGroup[] {
    const byVendor = new Map<string, SuggestedLine[]>();
    data.forEach((item) => {
        // Alcance: Urgente + Pedir (lo que hay que ordenar ya).
        if (item.status !== 'Urgente' && item.status !== 'Pedir') return;
        // Misma puerta que Pedidos Urgentes: fuera inactivos, servicios y los "bajo
        // demanda" a los que no les debes unidades.
        if (!isReplenishable(item)) return;
        const suggestedQty = suggestedOrderFor(item);
        if (suggestedQty <= 0) return;
        const line: SuggestedLine = {
            sku: item.sku,
            itemName: item.itemName,
            physicalAvailable: item.physicalHandQuantity - item.committedQuantity,
            reorderPoint: item.reorderPoint,
            incoming: item.orderedQuantity,
            suggestedQty,
            unitPrice: item.unitPrice,
            amount: suggestedQty * item.unitPrice,
            status: item.status,
            leadTimeDays: item.leadTimeDays,
            coverageRisk: item.coverageRisk,
        };
        const vendor = (item.vendor || 'Sin proveedor').trim() || 'Sin proveedor';
        if (!byVendor.has(vendor)) byVendor.set(vendor, []);
        byVendor.get(vendor)!.push(line);
    });

    const groups: VendorGroup[] = Array.from(byVendor.entries()).map(([vendor, lines]) => {
        // Urgentes primero dentro del proveedor, luego por importe.
        lines.sort((a, b) =>
            a.status === b.status ? b.amount - a.amount : a.status === 'Urgente' ? -1 : 1
        );
        return {
            vendor,
            lines,
            totalUnits: lines.reduce((s, l) => s + l.suggestedQty, 0),
            totalAmount: lines.reduce((s, l) => s + l.amount, 0),
            urgentCount: lines.filter((l) => l.status === 'Urgente').length,
        };
    });

    // Proveedores con urgentes primero, luego por importe estimado desc.
    groups.sort((a, b) => b.urgentCount - a.urgentCount || b.totalAmount - a.totalAmount);
    return groups;
}

export default function SuggestedPO({ data }: { data: AnalysisResult[] }) {
    const groups = useMemo(() => buildGroups(data), [data]);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [copied, setCopied] = useState<string | null>(null);

    const totals = useMemo(
        () => ({
            vendors: groups.length,
            items: groups.reduce((s, g) => s + g.lines.length, 0),
            units: groups.reduce((s, g) => s + g.totalUnits, 0),
            amount: groups.reduce((s, g) => s + g.totalAmount, 0),
            urgent: groups.reduce((s, g) => s + g.urgentCount, 0),
        }),
        [groups]
    );

    const toggle = (vendor: string) =>
        setCollapsed((prev) => {
            const next = new Set(prev);
            next.has(vendor) ? next.delete(vendor) : next.add(vendor);
            return next;
        });

    // Copia "SKU<TAB>Nombre<TAB>Cantidad" por línea, para pegar en un correo/OC.
    const copyGroup = async (g: VendorGroup) => {
        const text = g.lines.map((l) => `${l.sku}\t${l.itemName}\t${l.suggestedQty}`).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            setCopied(g.vendor);
            window.setTimeout(() => setCopied((c) => (c === g.vendor ? null : c)), 1800);
        } catch {
            /* clipboard no disponible */
        }
    };

    const exportExcel = async () => {
        const XLSX = await import('xlsx');
        const rows = groups.flatMap((g) =>
            g.lines.map((l) => ({
                Proveedor: g.vendor,
                SKU: l.sku,
                'Artículo': l.itemName,
                Estatus: l.status,
                'Física disponible': l.physicalAvailable,
                'Punto de pedido': Math.round(l.reorderPoint),
                'En camino': l.incoming,
                'Cantidad sugerida': l.suggestedQty,
                'Lead time (días)': l.leadTimeDays,
                'Precio (USD)': l.unitPrice,
                'Importe estimado (USD)': l.amount,
            }))
        );
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'OC Sugerida');
        XLSX.writeFile(wb, 'OC_Sugerida_por_proveedor.xlsx');
    };

    if (groups.length === 0) {
        return (
            <div className="p-10 text-center text-sm text-gray-500">
                No hay artículos que requieran pedido (Urgente o Pedir) en este momento. 🎉
            </div>
        );
    }

    return (
        <div className="p-4 space-y-4">
            {/* Resumen */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex flex-wrap gap-4 text-sm">
                    <span className="text-gray-600">
                        <strong className="text-gray-900">{totals.vendors}</strong> proveedores
                    </span>
                    <span className="text-gray-600">
                        <strong className="text-gray-900">{totals.items}</strong> artículos
                    </span>
                    <span className="text-gray-600">
                        <strong className="text-gray-900">{totals.units}</strong> unidades
                    </span>
                    {totals.urgent > 0 && (
                        <span className="text-red-600">
                            <strong>{totals.urgent}</strong> urgentes
                        </span>
                    )}
                    <span className="text-gray-600">
                        Estimado: <strong className="text-indigo-600">{usd(totals.amount)}</strong>
                    </span>
                </div>
                <button
                    onClick={exportExcel}
                    className="px-4 py-2 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                >
                    Exportar a Excel
                </button>
            </div>

            <p className="text-xs text-gray-400 italic">
                Sugerencia interna (no crea nada en Zoho). Agrupada por el proveedor más frecuente de
                las órdenes de compra pasadas de cada artículo.
            </p>

            {/* Grupos por proveedor */}
            {groups.map((g) => {
                const isCollapsed = collapsed.has(g.vendor);
                return (
                    <div key={g.vendor} className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="flex items-center justify-between bg-gray-50 px-4 py-3">
                            <button
                                onClick={() => toggle(g.vendor)}
                                className="flex items-center gap-2 text-left"
                            >
                                <span className="text-gray-400 text-xs w-3">{isCollapsed ? '▸' : '▾'}</span>
                                <span className="font-semibold text-gray-900">{g.vendor}</span>
                                <span className="text-xs text-gray-500">
                                    ({g.lines.length} art. · {g.totalUnits} u.)
                                </span>
                                {g.urgentCount > 0 && (
                                    <span className="text-[10px] font-bold uppercase tracking-wide bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                                        {g.urgentCount} urgente{g.urgentCount > 1 ? 's' : ''}
                                    </span>
                                )}
                            </button>
                            <div className="flex items-center gap-3">
                                <span className="text-sm font-semibold text-indigo-600">
                                    {usd(g.totalAmount)}
                                </span>
                                <button
                                    onClick={() => copyGroup(g)}
                                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
                                    title="Copiar SKU / Nombre / Cantidad para pegar en un correo u OC"
                                >
                                    {copied === g.vendor ? '¡Copiado!' : 'Copiar lista'}
                                </button>
                            </div>
                        </div>

                        {!isCollapsed && (
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200 text-sm">
                                    <thead className="bg-white">
                                        <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                                            <th className="px-4 py-2 font-medium">SKU</th>
                                            <th className="px-4 py-2 font-medium">Artículo</th>
                                            <th className="px-4 py-2 font-medium text-center">Estatus</th>
                                            <th className="px-4 py-2 font-medium text-right">Física disp.</th>
                                            <th className="px-4 py-2 font-medium text-right">PdP</th>
                                            <th className="px-4 py-2 font-medium text-right">En camino</th>
                                            <th className="px-4 py-2 font-medium text-right">Sugerido</th>
                                            <th className="px-4 py-2 font-medium text-right">Importe</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {g.lines.map((l) => (
                                            <tr key={l.sku} className="hover:bg-gray-50">
                                                <td className="px-4 py-2 font-medium text-gray-900 whitespace-nowrap">{l.sku}</td>
                                                <td className="px-4 py-2 text-gray-600 max-w-xs truncate" title={l.itemName}>
                                                    {l.itemName}
                                                </td>
                                                <td className="px-4 py-2 text-center">
                                                    <span
                                                        className={cn(
                                                            'text-[10px] font-bold uppercase px-2 py-0.5 rounded-full',
                                                            l.status === 'Urgente'
                                                                ? 'bg-red-100 text-red-700'
                                                                : 'bg-amber-100 text-amber-700'
                                                        )}
                                                    >
                                                        {l.status}
                                                    </span>
                                                </td>
                                                <td
                                                    className={cn(
                                                        'px-4 py-2 text-right font-medium',
                                                        l.physicalAvailable <= 0 ? 'text-red-600' : 'text-gray-700'
                                                    )}
                                                >
                                                    {l.physicalAvailable}
                                                </td>
                                                <td className="px-4 py-2 text-right text-gray-500">{Math.round(l.reorderPoint)}</td>
                                                <td className="px-4 py-2 text-right text-gray-500">{l.incoming || '—'}</td>
                                                <td className="px-4 py-2 text-right font-bold text-indigo-600">{l.suggestedQty}</td>
                                                <td className="px-4 py-2 text-right text-gray-700">{usd(l.amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-gray-50 font-semibold text-gray-700">
                                            <td className="px-4 py-2" colSpan={6}>
                                                Subtotal {g.vendor}
                                            </td>
                                            <td className="px-4 py-2 text-right text-indigo-700">{g.totalUnits} u.</td>
                                            <td className="px-4 py-2 text-right text-indigo-700">{usd(g.totalAmount)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
