import { useState, useEffect, useCallback, useRef } from 'react';
import { Package, RefreshCw, AlertCircle } from 'lucide-react';
import { ResultsTable } from './components/ResultTable';
import { runInventoryAnalysis } from './runInventoryWorker';
import type { InventoryWorkerInput } from './workers/inventory.worker';
import type { AnalysisResult, RawSalesData, RawInventoryData, RawLeadTimeData } from './types';

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;
// Auth: JWT emitido por hub-api /api/login (guardado por el portal en localStorage).
const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

type RawPayload = Omit<InventoryWorkerInput, 'eoqOrderCost' | 'eoqHoldingRate'>;

function App() {
  const [results, setResults] = useState<AnalysisResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Los parámetros del EOQ viven aquí, no en la tabla: alimentan la cantidad óptima
  // (Q), que se calcula dentro del análisis → cambiarlos exige recalcular.
  const [eoqOrderCost, setEoqOrderCost] = useState<number>(() => Number(localStorage.getItem('eoq_order_cost')) || 100);
  const [eoqHoldingRate, setEoqHoldingRate] = useState<number>(() => Number(localStorage.getItem('eoq_holding_rate')) || 25);
  useEffect(() => { localStorage.setItem('eoq_order_cost', String(eoqOrderCost)); }, [eoqOrderCost]);
  useEffect(() => { localStorage.setItem('eoq_holding_rate', String(eoqHoldingRate)); }, [eoqHoldingRate]);

  // Datos crudos del hub: se cachean para poder recalcular al cambiar los parámetros
  // sin volver a pedirlos. En refs (no en estado) porque solo los lee el análisis.
  const rawRef = useRef<RawPayload | null>(null);
  const eoqRef = useRef({ S: eoqOrderCost, H: eoqHoldingRate });
  eoqRef.current = { S: eoqOrderCost, H: eoqHoldingRate };

  const loadFromHub = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      if (!API_BASE) throw new Error('Configuración incompleta: falta VITE_HUB_API_URL');
      const res = await fetch(`${API_BASE}/api/inventory/data`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const keys = ['sales2026', 'sales2025', 'sales2024', 'sales2023', 'inventory', 'leadTime'];
      if (!keys.every((k) => Array.isArray(d?.[k]))) {
        throw new Error('Respuesta del hub con formato inesperado');
      }
      const raw: RawPayload = {
        sales2026: d.sales2026 as RawSalesData[],
        sales2025: d.sales2025 as RawSalesData[],
        sales2024: d.sales2024 as RawSalesData[],
        sales2023: d.sales2023 as RawSalesData[],
        inventory: d.inventory as RawInventoryData[],
        leadTime: d.leadTime as RawLeadTimeData[],
      };
      rawRef.current = raw;
      const analyzed = await runInventoryAnalysis({
        ...raw,
        eoqOrderCost: eoqRef.current.S,
        eoqHoldingRate: eoqRef.current.H,
      });
      setResults(analyzed);
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

  // Recalcula al tocar los parámetros del EOQ, reusando los datos ya descargados.
  // Con debounce para no lanzar un análisis por cada tecla. Se salta la primera
  // ejecución: de la carga inicial ya se encarga loadFromHub.
  const skipFirstEoqRun = useRef(true);
  useEffect(() => {
    if (skipFirstEoqRun.current) { skipFirstEoqRun.current = false; return; }
    const raw = rawRef.current;
    if (!raw) return;
    const t = setTimeout(() => {
      runInventoryAnalysis({ ...raw, eoqOrderCost, eoqHoldingRate })
        .then(setResults)
        .catch((err) => console.error(err));
    }, 500);
    return () => clearTimeout(t);
  }, [eoqOrderCost, eoqHoldingRate]);

  const summaryMetrics = results
    ? {
        totalItems: results.length,
        urgentItems: results.filter((r) => r.status === 'Urgente').length,
        reorderItems: results.filter((r) => r.status === 'Pedir').length,
        inTransitItems: results.filter((r) => r.status === 'EnCamino').length,
      }
    : null;

  return (
    <div className="flex-grow w-full bg-[#F7F8FA] flex flex-col font-sans text-gray-900">
      <header className="sticky top-0 z-20 px-8 py-5 bg-white/80 backdrop-blur-xl border-b border-white/20 shadow-sm">
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl text-white shadow-lg shadow-blue-500/20">
              <Package size={24} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Análisis de Inventario</h1>
              <p className="text-xs text-slate-500 font-medium">Optimización basada en datos de Zoho</p>
            </div>
          </div>
          {results && (
            <button
              onClick={loadFromHub}
              className="text-sm text-slate-600 hover:text-blue-500 flex items-center gap-2 transition-colors font-medium px-4 py-2 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-200"
            >
              <RefreshCw className="w-4 h-4" />
              Actualizar
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 w-full px-6 py-8">
        {loading && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            <span className="text-slate-500 font-medium">Cargando datos de Zoho…</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3 max-w-xl">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 font-medium">{error}</p>
            </div>
            <button
              onClick={loadFromHub}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold"
            >
              Reintentar
            </button>
          </div>
        )}

        {!loading && !error && results && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-6 mb-8">
              <div className="bg-white p-6 rounded-3xl shadow-soft border border-slate-100">
                <span className="text-sm font-medium text-slate-500">Total Artículos</span>
                <div className="text-3xl font-extrabold text-slate-900 mt-2 tracking-tight">{summaryMetrics?.totalItems}</div>
              </div>
              <div className="bg-white p-6 rounded-3xl shadow-soft border-l-4 border-l-red-500 border border-slate-100">
                <span className="text-sm font-medium text-red-600">Urgente (pedir ya)</span>
                <div className="text-3xl font-extrabold text-slate-900 mt-2 tracking-tight">{summaryMetrics?.urgentItems}</div>
              </div>
              <div className="bg-white p-6 rounded-3xl shadow-soft border-l-4 border-l-yellow-500 border border-slate-100">
                <span className="text-sm font-medium text-yellow-700">Por Pedir</span>
                <div className="text-3xl font-extrabold text-slate-900 mt-2 tracking-tight">{summaryMetrics?.reorderItems}</div>
              </div>
              <div className="bg-white p-6 rounded-3xl shadow-soft border-l-4 border-l-orange-500 border border-slate-100">
                <span className="text-sm font-medium text-orange-600">En Camino</span>
                <div className="text-3xl font-extrabold text-slate-900 mt-2 tracking-tight">{summaryMetrics?.inTransitItems}</div>
              </div>
            </div>

            <ResultsTable
              data={results}
              eoqOrderCost={eoqOrderCost}
              eoqHoldingRate={eoqHoldingRate}
              onEoqOrderCostChange={setEoqOrderCost}
              onEoqHoldingRateChange={setEoqHoldingRate}
            />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
