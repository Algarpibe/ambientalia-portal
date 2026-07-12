import { useState } from 'react';
import { Package, RefreshCw, BarChart3, AlertCircle } from 'lucide-react';
import { FileUpload } from './components/ui';
import { ResultsTable } from './components/ResultTable';
import { parseExcel, processInventoryData } from './utils/calculations';
import type { AnalysisResult, RawSalesData, RawInventoryData, RawLeadTimeData } from './types';

function App() {
  const [salesFile2025, setSalesFile2025] = useState<File | null>(null);
  const [salesFile2024, setSalesFile2024] = useState<File | null>(null);
  const [salesFile2023, setSalesFile2023] = useState<File | null>(null);
  const [salesFiles2026, setSalesFiles2026] = useState<File[]>([]);
  const [inventoryFile, setInventoryFile] = useState<File | null>(null);
  const [leadTimeFile, setLeadTimeFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<AnalysisResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!salesFile2025 || !salesFile2024 || !salesFile2023 || !inventoryFile || !leadTimeFile) {
      setError('Por favor carga los 5 archivos para continuar.');
      return;
    }
    setError(null);
    setIsProcessing(true);

    try {
      const sales2026 = await Promise.all(salesFiles2026.map(file => parseExcel(file)))
        .then(results => results.flat()) as RawSalesData[];

      const sales2025 = await parseExcel(salesFile2025) as RawSalesData[];
      const sales2024 = await parseExcel(salesFile2024) as RawSalesData[];
      const sales2023 = await parseExcel(salesFile2023) as RawSalesData[];
      const inventoryData = await parseExcel(inventoryFile) as RawInventoryData[];
      const leadTimeData = await parseExcel(leadTimeFile) as RawLeadTimeData[];

      // Basic validation
      if (!sales2025.length || !sales2024.length || !sales2023.length || !inventoryData.length || !leadTimeData.length) {
        throw new Error('Uno de los archivos está vacío o no tiene el formato correcto.');
      }

      const analyzedResults = processInventoryData(
        sales2026,
        sales2025,
        sales2024,
        sales2023,
        inventoryData,
        leadTimeData
      );
      setResults(analyzedResults);
    } catch (err: any) {
      console.error('Error in handleAnalyze:', err);
      setError(err?.message || 'Error desconocido al procesar los archivos. Verifica que los archivos tengan el formato correcto.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setSalesFile2025(null);
    setSalesFile2024(null);
    setSalesFile2023(null);
    setSalesFiles2026([]);
    setInventoryFile(null);
    setLeadTimeFile(null);
    setResults(null);
    setError(null);
  };

  // Metrics for summary cards
  const summaryMetrics = results ? {
    totalItems: results.length,
    riskItems: results.filter(r => r.status === 'Risk').length,
    overstockItems: results.filter(r => r.status === 'Overstock').length,
    optimizedItems: results.filter(r => r.status === 'Optimized').length,
  } : null;

  return (
    <div className="flex-grow w-full bg-[#F7F8FA] flex flex-col font-sans text-gray-900">
      {/* Header */}
      {/* Header */}
      <header className="sticky top-0 z-20 px-8 py-5 bg-white/80 backdrop-blur-xl border-b border-white/20 shadow-sm">
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl text-white shadow-lg shadow-blue-500/20">
              <Package size={24} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Análisis de Inventario</h1>
              <p className="text-xs text-slate-500 font-medium">Optimización basada en datos históricos</p>
            </div>
          </div>
          {results && (
            <button
              onClick={handleReset}
              className="text-sm text-slate-600 hover:text-blue-500 flex items-center gap-2 transition-colors font-medium px-4 py-2 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-200"
            >
              <RefreshCw className="w-4 h-4" />
              Nuevo Análisis
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 w-full px-6 py-8">
        {!results ? (
          <div className="max-w-6xl mx-auto">
            <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-slate-200/50 border border-slate-100 p-10 overflow-hidden relative">
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-400 via-cyan-400 to-teal-400"></div>

              <div className="text-center mb-10">
                <div className="inline-flex items-center justify-center p-4 bg-blue-50 rounded-2xl mb-4 shadow-sm">
                  <BarChart3 className="w-10 h-10 text-blue-600" />
                </div>
                <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Cargar Datos de Inventario</h2>
                <p className="text-lg text-slate-500 mt-2 max-w-2xl mx-auto">Sube los archivos anuales y el resumen de inventario para comenzar el análisis.</p>
              </div>

              <div className="space-y-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  <FileUpload
                    label="Ventas 2026 (Opcional)"
                    selectedFile={salesFiles2026.length > 0 ? {
                      name: `${salesFiles2026.length} archivos cargados`,
                      size: salesFiles2026.reduce((acc, f) => acc + f.size, 0)
                    } as any : null}
                    onFileSelect={(file) => setSalesFiles2026(prev => [...prev, file])}
                  />
                  <FileUpload
                    label="Ventas 2025 (Prioridad 50%)"
                    selectedFile={salesFile2025}
                    onFileSelect={setSalesFile2025}
                  />
                  <FileUpload
                    label="Ventas 2024 (Prioridad 30%)"
                    selectedFile={salesFile2024}
                    onFileSelect={setSalesFile2024}
                  />
                  <FileUpload
                    label="Ventas 2023 (Prioridad 20%)"
                    selectedFile={salesFile2023}
                    onFileSelect={setSalesFile2023}
                  />
                  <FileUpload
                    label="Logística (Lead_Time.xlsx)"
                    selectedFile={leadTimeFile}
                    onFileSelect={setLeadTimeFile}
                  />
                  <FileUpload
                    label="Resumen de Inventario (ERP)"
                    selectedFile={inventoryFile}
                    onFileSelect={setInventoryFile}
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                    <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700 font-medium">{error}</p>
                  </div>
                )}

                <button
                  onClick={handleAnalyze}
                  disabled={!salesFile2025 || !salesFile2024 || !salesFile2023 || !inventoryFile || !leadTimeFile || isProcessing}
                  className={
                    `w-full py-5 px-6 rounded-2xl text-white font-bold text-lg shadow-lg transition-all transform duration-200
                                ${(!salesFile2025 || !salesFile2024 || !salesFile2023 || !inventoryFile || !leadTimeFile || isProcessing)
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                      : 'bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 hover:shadow-blue-500/30 hover:-translate-y-1'
                    }`
                  }
                >
                  {isProcessing ? 'Procesando...' : 'Generar Análisis Trienal'}
                </button>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
              <div className="p-6 bg-white/60 backdrop-blur-sm rounded-2xl border border-slate-200/60 shadow-sm">
                <span className="block font-bold text-slate-900 mb-1">Lógica de Política</span>
                <span className="text-sm text-slate-500">Detección de demanda anormal</span>
              </div>
              <div className="p-6 bg-white/60 backdrop-blur-sm rounded-2xl border border-slate-200/60 shadow-sm">
                <span className="block font-bold text-slate-900 mb-1">Sigma Ponderado</span>
                <span className="text-sm text-slate-500">50% '25, 30% '24, 20% '23</span>
              </div>
              <div className="p-6 bg-white/60 backdrop-blur-sm rounded-2xl border border-slate-200/60 shadow-sm">
                <span className="block font-bold text-slate-900 mb-1">Seguimiento</span>
                <span className="text-sm text-slate-500">Exclusión de servicios y LT 0</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-6 mb-8">
              <div className="bg-white p-6 rounded-3xl shadow-soft border border-slate-100">
                <span className="text-sm font-medium text-slate-500">Total Artículos</span>
                <div className="text-3xl font-extrabold text-slate-900 mt-2 tracking-tight">{summaryMetrics?.totalItems}</div>
              </div>
              <div className="bg-white p-6 rounded-3xl shadow-soft border-l-4 border-l-red-500 border border-slate-100">
                <span className="text-sm font-medium text-red-600">En Riesgo (Quiebre)</span>
                <div className="text-3xl font-extrabold text-slate-900 mt-2 tracking-tight">{summaryMetrics?.riskItems}</div>
              </div>
              <div className="bg-white p-6 rounded-3xl shadow-soft border-l-4 border-l-amber-500 border border-slate-100">
                <span className="text-sm font-medium text-amber-600">Sobrestock</span>
                <div className="text-3xl font-extrabold text-slate-900 mt-2 tracking-tight">{summaryMetrics?.overstockItems}</div>
              </div>
              <div className="bg-white p-6 rounded-3xl shadow-soft border-l-4 border-l-emerald-500 border border-slate-100">
                <span className="text-sm font-medium text-emerald-600">Optimizado</span>
                <div className="text-3xl font-extrabold text-slate-900 mt-2 tracking-tight">{summaryMetrics?.optimizedItems}</div>
              </div>
            </div>

            <ResultsTable data={results} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
