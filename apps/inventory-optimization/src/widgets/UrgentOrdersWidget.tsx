import { useEffect, useMemo, useState } from 'react';
import { useInventoryData } from './useInventoryData';
import { urgentOrders, manufacturersOf, type UrgentRow } from './analysis';
import { useSortable, sortArrow } from './useSortable';
import { useColumnOrder } from './useColumnOrder';
import ColumnOrderMenu from './ColumnOrderMenu';

// Widget: tabla "Pedidos Urgentes" (artículos con estado 'Urgente'), con las
// mismas columnas que la pantalla de la app y un filtro por fabricante.
// Autocontenido: carga sus propios datos y no recibe props del Portal.

const COLS: { key: keyof UrgentRow; label: string; numeric?: boolean }[] = [
  { key: 'manufacturer', label: 'Fabricante' },
  { key: 'sku', label: 'SKU' },
  { key: 'itemName', label: 'Artículo' },
  { key: 'category', label: 'Categoría' },
  { key: 'physical', label: 'Ex. Físicas', numeric: true },
  { key: 'accounting', label: 'Ex. Contab.', numeric: true },
  { key: 'factoryOrder', label: 'Pedido Fábrica', numeric: true },
  { key: 'committed', label: 'Comprometido', numeric: true },
  { key: 'available', label: 'Disponible', numeric: true },
  { key: 'futureAvailable', label: 'Disp. Futuro', numeric: true },
];

export default function UrgentOrdersWidget() {
  const { sales2026, sales2025, sales2024, sales2023, inventory, leadTime, loading, error } = useInventoryData();

  const rows = useMemo(
    () => urgentOrders({ sales2026, sales2025, sales2024, sales2023, inventory, leadTime, loading, error, reload: () => {} }),
    [sales2026, sales2025, sales2024, sales2023, inventory, leadTime, loading, error],
  );
  const manufacturers = useMemo(() => manufacturersOf(rows), [rows]);

  // null = aún sin inicializar; al primer dato, por defecto filtra a Horiba si existe.
  const [manufacturer, setManufacturer] = useState<string | null>(null);
  useEffect(() => {
    if (manufacturer === null && manufacturers.length > 0) {
      setManufacturer(manufacturers.find((m) => /horiba/i.test(m)) ?? '');
    }
  }, [manufacturer, manufacturers]);

  const [category, setCategory] = useState<string>('all');
  const selected = manufacturer ?? '';
  // Filtra primero por fabricante; las categorías disponibles salen de ese subconjunto.
  const byManufacturer = useMemo(
    () => (selected ? rows.filter((r) => r.manufacturer === selected) : rows),
    [rows, selected],
  );
  const categories = useMemo(
    () => [...new Set(byManufacturer.map((r) => r.category).filter((c) => c && c !== '—'))].sort(),
    [byManufacturer],
  );
  const filtered = useMemo(
    () => (category === 'all' ? byManufacturer : byManufacturer.filter((r) => r.category === category)),
    [byManufacturer, category],
  );
  const { sorted, sortKey, sortDir, toggle } = useSortable<UrgentRow>(filtered);
  const { order, move } = useColumnOrder('cols_urgent_orders', COLS.map((c) => c.key));
  const colMap = useMemo(() => Object.fromEntries(COLS.map((c) => [c.key, c])) as Record<string, (typeof COLS)[number]>, []);
  const orderedCols = order.map((k) => colMap[k]).filter(Boolean);

  if (loading) return <StateMsg>Cargando…</StateMsg>;
  if (error) return <StateMsg tone="error">{error}</StateMsg>;
  if (rows.length === 0) return <StateMsg>No hay pedidos urgentes. 🎉</StateMsg>;

  const cellTone = (key: keyof UrgentRow, value: number): string => {
    if (key === 'available') return value < 0 ? 'text-red-600 font-semibold' : 'text-gray-800';
    if (key === 'committed') return value > 0 ? 'text-amber-600 font-semibold' : 'text-gray-800';
    return 'text-gray-800';
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 mb-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
        <select
          aria-label="Filtrar por fabricante"
          value={selected}
          onChange={(e) => { setManufacturer(e.target.value); setCategory('all'); }}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none max-w-[10rem]"
        >
          <option value="">Todos los fabricantes</option>
          {manufacturers.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select
          aria-label="Filtrar por categoría"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none max-w-[10rem]"
        >
          <option value="all">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ColumnOrderMenu columns={orderedCols.map((c) => ({ key: String(c.key), label: c.label }))} onMove={move} />
          <span className="text-xs text-gray-400 whitespace-nowrap">{filtered.length} en vista</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-xs border-collapse min-w-[640px]">
          <thead className="sticky top-0 bg-gray-50 z-10">
            <tr>
              {orderedCols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggle(c.key)}
                  title={`Ordenar por ${c.label}`}
                  className={`px-2 py-1.5 font-semibold text-gray-500 border-b border-gray-200 whitespace-nowrap cursor-pointer select-none hover:text-gray-700 ${c.numeric ? 'text-right' : 'text-left'}`}
                >
                  {c.label} <span className="text-gray-300">{sortArrow(sortKey === c.key, sortDir)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={`${r.sku}-${i}`} className="border-b border-gray-100 hover:bg-gray-50">
                {orderedCols.map((c) => {
                  const value = r[c.key];
                  return (
                    <td
                      key={c.key}
                      className={`px-2 py-1.5 whitespace-nowrap ${c.numeric ? `text-right tabular-nums ${cellTone(c.key, value as number)}` : 'text-left text-gray-700'} ${c.key === 'itemName' ? 'max-w-[220px] truncate' : ''}`}
                      title={c.key === 'itemName' ? String(value) : undefined}
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StateMsg({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div className={`h-full flex items-center justify-center text-sm ${tone === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
      {children}
    </div>
  );
}
