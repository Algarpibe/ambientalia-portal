import { useState, useEffect, useCallback } from 'react';
import './index.css';
import { AlertCircle, TrendingUp } from 'lucide-react';
import Dashboard from './components/Dashboard';

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;
const API_KEY = import.meta.env.VITE_HUB_API_KEY as string | undefined;

function App() {
  const [salesData, setSalesData] = useState<any[]>([]);
  const [productData, setProductData] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadFromHub = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!API_BASE) throw new Error('Configuración incompleta: falta VITE_HUB_API_URL');
      const res = await fetch(`${API_BASE}/api/profitability/data`, {
        headers: API_KEY ? { 'x-api-key': API_KEY } : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data?.sales) || !Array.isArray(data?.products)) {
        throw new Error('Respuesta del hub con formato inesperado');
      }
      setSalesData(data.sales);
      setProductData(data.products);
    } catch (err) {
      setError('No se pudieron cargar los datos del hub de Zoho. Reintenta.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFromHub();
  }, [loadFromHub]);

  const hasData = salesData.length > 0 && productData.length > 0;

  return (
    <div className="flex-grow w-full bg-[#f8fafc] text-slate-800 font-sans min-h-screen">
      <header className="sticky top-0 z-20 px-8 py-5 bg-white/80 backdrop-blur-xl border-b border-white/20 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl text-white shadow-lg shadow-blue-500/20">
            <TrendingUp size={24} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Rentabilidad Clientes
            </h1>
            <p className="text-xs text-slate-500 font-medium">Portal Financiero</p>
          </div>
        </div>
      </header>
      <main className="w-full px-6 py-12">
        {loading && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
            <span className="text-slate-500 font-medium">Cargando datos de Zoho…</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <div className="p-4 bg-red-50 text-red-600 rounded-xl flex items-center gap-2 text-sm border border-red-100">
              <AlertCircle size={18} />
              {error}
            </div>
            <button
              onClick={loadFromHub}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold"
            >
              Reintentar
            </button>
          </div>
        )}

        {!loading && !error && !hasData && (
          <div className="flex items-center justify-center min-h-[60vh] text-slate-500">
            Sin datos de rentabilidad.
          </div>
        )}

        {!loading && !error && hasData && (
          <Dashboard sales={salesData} products={productData} onReset={loadFromHub} />
        )}
      </main>
    </div>
  );
}

export default App;
