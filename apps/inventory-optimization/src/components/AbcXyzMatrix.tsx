import { useMemo } from 'react';
import type { AnalysisResult } from '../types';
import { cn } from './ui';
import { ABC_CLASSES, XYZ_CLASSES, ABC_XYZ_COLORS, ABC_XYZ_HINT } from './abcXyz';

const usd = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

interface Cell {
    count: number;
    value: number;
}

// Panel resumen 3×3 (ABC × XYZ). Cada celda: nº de artículos + valor de consumo
// anual (costo). Click en una celda filtra la tabla por esa clase; click de nuevo
// (o en "Todo") la limpia.
export default function AbcXyzMatrix({
    data,
    activeAbc,
    activeXyz,
    onSelect,
}: {
    data: AnalysisResult[];
    activeAbc: string;
    activeXyz: string;
    onSelect: (abc: string, xyz: string) => void;
}) {
    const { cells, totals } = useMemo(() => {
        const cells: Record<string, Cell> = {};
        ABC_CLASSES.forEach((a) => XYZ_CLASSES.forEach((x) => (cells[`${a}${x}`] = { count: 0, value: 0 })));
        let totalCount = 0;
        let totalValue = 0;
        data.forEach((r) => {
            const key = `${r.abcClass}${r.xyzClass}`;
            if (!cells[key]) return;
            cells[key].count += 1;
            cells[key].value += r.annualValue;
            totalCount += 1;
            totalValue += r.annualValue;
        });
        return { cells, totals: { count: totalCount, value: totalValue } };
    }, [data]);

    const isActive = (a: string, x: string) => activeAbc === a && activeXyz === x;

    return (
        <div className="rounded-lg border border-gray-200 p-4 bg-white">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Matriz ABC-XYZ</h3>
                    <p className="text-xs text-gray-400">
                        Valor por costo (vertical) × predictibilidad de demanda (horizontal). Click para filtrar.
                    </p>
                </div>
                {(activeAbc !== 'all' || activeXyz !== 'all') && (
                    <button
                        onClick={() => onSelect('all', 'all')}
                        className="text-xs font-medium text-indigo-600 hover:underline"
                    >
                        Ver todo
                    </button>
                )}
            </div>

            <div className="overflow-x-auto">
                <table className="border-collapse text-xs">
                    <thead>
                        <tr>
                            <th className="p-1"></th>
                            {XYZ_CLASSES.map((x) => (
                                <th key={x} className="p-1 text-center font-medium text-gray-500 min-w-[120px]">
                                    {x} {x === 'X' ? '· estable' : x === 'Y' ? '· variable' : '· errática'}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {ABC_CLASSES.map((a) => (
                            <tr key={a}>
                                <th className="p-1 text-right font-medium text-gray-500 pr-2 whitespace-nowrap">
                                    {a} {a === 'A' ? '· alto valor' : a === 'B' ? '· medio' : '· bajo'}
                                </th>
                                {XYZ_CLASSES.map((x) => {
                                    const code = `${a}${x}`;
                                    const cell = cells[code];
                                    const active = isActive(a, x);
                                    return (
                                        <td key={code} className="p-1">
                                            <button
                                                onClick={() => onSelect(active ? 'all' : a, active ? 'all' : x)}
                                                title={ABC_XYZ_HINT[code]}
                                                className={cn(
                                                    'w-full rounded-md px-2 py-2 text-left transition-all border',
                                                    ABC_XYZ_COLORS[code],
                                                    active
                                                        ? 'ring-2 ring-indigo-500 border-indigo-400'
                                                        : 'border-transparent hover:ring-1 hover:ring-gray-300'
                                                )}
                                            >
                                                <div className="flex items-baseline justify-between gap-2">
                                                    <span className="font-bold">{code}</span>
                                                    <span className="font-semibold">{cell.count}</span>
                                                </div>
                                                <div className="text-[10px] opacity-80">{usd(cell.value)}</div>
                                            </button>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-4">
                <span>
                    Total: <strong className="text-gray-700">{totals.count}</strong> artículos ·{' '}
                    <strong className="text-gray-700">{usd(totals.value)}</strong> valor anual
                </span>
            </div>
        </div>
    );
}
