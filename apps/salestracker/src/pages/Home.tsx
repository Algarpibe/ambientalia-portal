import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchSales, type SalesRow } from '../api';
import { totalsByCategory, grandTotal } from '../lib/rollup';

const fmtUsd = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export default function Home() {
  const [rows, setRows] = useState<SalesRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSales().then(setRows).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!rows) return <div className="p-8 text-gray-600">Cargando ventas…</div>;

  const facturado = grandTotal(rows, 'INVOICE');
  const porCategoria = totalsByCategory(rows, 'INVOICE').slice(0, 10);

  return (
    <div className="p-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">SalesTracker</h1>
        <p className="text-gray-500">Ventas facturadas (USD)</p>
      </header>

      <div className="rounded-xl border bg-white p-6 w-fit">
        <div className="text-sm text-gray-500">Total facturado</div>
        <div className="text-3xl font-bold text-gray-900">{fmtUsd(facturado)}</div>
      </div>

      <div className="rounded-xl border bg-white p-6">
        <h2 className="text-lg font-semibold mb-4">Top categorías (facturado)</h2>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={porCategoria} layout="vertical" margin={{ left: 24 }}>
            <XAxis type="number" tickFormatter={(v) => fmtUsd(Number(v))} />
            <YAxis type="category" dataKey="categoryName" width={140} />
            <Tooltip formatter={(v) => fmtUsd(Number(v))} />
            <Bar dataKey="total" fill="#2563eb" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
