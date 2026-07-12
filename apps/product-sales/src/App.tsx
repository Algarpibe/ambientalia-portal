import React, { useState } from 'react';
import { Upload, FileSpreadsheet, Download, RefreshCw, Trash2 } from 'lucide-react';
import { getMonthFromFilename, parseMonthlyFile, type SalesRecord } from './lib/excel-utils';
import { consolidateData, generateConsolidatedExcel } from './lib/consolidate';
import defaultCategories from './categories.json';

interface ProcessedFile {
  file: File;
  month: string | null;
  status: 'pending' | 'parsed' | 'error';
  records?: SalesRecord[];
  error?: string;
}

function App() {
  const [monthlyFiles, setMonthlyFiles] = useState<ProcessedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [consolidatedBlob, setConsolidatedBlob] = useState<Blob | null>(null);

  const handleMonthlyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map(file => ({
        file,
        month: getMonthFromFilename(file.name),
        status: 'pending' as const
      }));
      setMonthlyFiles(prev => [...prev, ...newFiles]);
      setConsolidatedBlob(null); // Reset result on new upload
    }
  };

  const removeFile = (index: number) => {
    setMonthlyFiles(prev => prev.filter((_, i) => i !== index));
    setConsolidatedBlob(null);
  };

  const processFiles = async () => {
    setIsProcessing(true);
    try {
      // 1. Load Categories from JSON
      const categoryMap = new Map<string, string>();
      Object.entries(defaultCategories).forEach(([sku, cat]) => {
        categoryMap.set(sku, cat);
      });
      console.log(`Loaded ${categoryMap.size} categories from default.`);

      // 2. Parse Monthly Files
      const parsedDataList = [];
      const updatedFiles = [...monthlyFiles];

      for (let i = 0; i < updatedFiles.length; i++) {
        const item = updatedFiles[i];
        if (!item.month) {
          item.status = 'error';
          item.error = 'Mes no identificado en nombre de archivo (ej: _0125)';
          continue;
        }

        try {
          const records = await parseMonthlyFile(item.file);
          item.status = 'parsed';
          item.records = records;
          parsedDataList.push({ month: item.month, records });
        } catch (err) {
          item.status = 'error';
          item.error = 'Error al leer archivo';
          console.error(err);
        }
      }

      setMonthlyFiles(updatedFiles);

      // 3. Consolidate
      const consolidated = consolidateData(parsedDataList, categoryMap);

      // 4. Generate Excel
      const excelBytes = generateConsolidatedExcel(consolidated);
      const blob = new Blob([excelBytes as any], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      setConsolidatedBlob(blob);

    } catch (err) {
      console.error(err);
      alert("Ocurrió un error inesperado durante la consolidación.");
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadFile = () => {
    if (!consolidatedBlob) return;
    const url = window.URL.createObjectURL(consolidatedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Ventas_Consolidado_2025_Generado.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  return (
    <div className="flex-grow w-full bg-gradient-to-br from-slate-50 via-white to-slate-100 p-8 font-sans text-slate-900">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* Header */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl shadow-lg shadow-blue-500/20 p-8 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 shadow-inner">
                <FileSpreadsheet className="w-10 h-10 text-white" strokeWidth={1.5} />
              </div>
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight">Consolidación de Ventas Anual</h1>
                <p className="text-blue-100 mt-2 text-lg font-medium">Generación de Reporte Consolidado</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* Main Upload Zone */}
          <div className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden flex flex-col h-full">
            <div className="bg-slate-50/50 px-8 py-6 border-b border-slate-100">
              <h2 className="font-bold text-xl text-slate-800 flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm">1</span>
                Cargar Archivos Mensuales
              </h2>
            </div>

            <div className="p-8 flex-1 flex flex-col gap-6">
              <div className="border-2 border-dashed border-slate-200 rounded-3xl p-10 hover:border-blue-400 hover:bg-blue-50/30 transition-all relative text-center group cursor-pointer flex-1 flex flex-col items-center justify-center min-h-[200px]">
                <input
                  type="file"
                  multiple
                  accept=".xlsx"
                  onChange={handleMonthlyUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                />
                <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-blue-100 transition-all">
                  <Upload className="w-10 h-10 text-blue-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-700 mb-2 group-hover:text-blue-700">Arrastra tus archivos aquí</h3>
                <p className="text-slate-400 text-sm">Selecciona los reportes mensuales (.xlsx)</p>
              </div>

              {/* File List */}
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {monthlyFiles.length === 0 && (
                  <div className="text-center py-8">
                    <p className="text-sm text-slate-400 italic">Ningún archivo seleccionado</p>
                  </div>
                )}
                {monthlyFiles.map((f, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all ${f.status === 'error'
                        ? 'bg-red-50 border-red-200 shadow-sm'
                        : f.status === 'parsed'
                          ? 'bg-green-50 border-green-200 shadow-sm'
                          : 'bg-slate-50 border-slate-200 hover:border-indigo-300 hover:shadow-md'
                      }`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`p-2 rounded-lg ${f.status === 'parsed' ? 'bg-green-100' : 'bg-indigo-100'
                        }`}>
                        <FileSpreadsheet className={`w-5 h-5 ${f.status === 'parsed' ? 'text-green-600' : 'text-indigo-600'
                          }`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-800 truncate">{f.file.name}</p>
                        <p className="text-xs text-slate-500">{f.month || "Fecha desconocida"} {f.status === 'parsed' && '✓ Procesado'}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeFile(i)}
                      className="text-slate-400 hover:text-red-500 hover:bg-red-100 p-2 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Settings & Process */}
          <div className="space-y-6">

            {/* Action Card */}
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4 flex items-center justify-between">
                <h2 className="font-bold text-lg text-white">2. Generar Reporte</h2>
                {isProcessing && (
                  <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
                    <RefreshCw className="w-5 h-5 text-white animate-spin" />
                  </div>
                )}
              </div>

              <div className="p-6 space-y-6">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <p className="text-sm text-slate-600 flex items-center gap-2">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                    Se utilizará el catálogo interno automáticamente para las categorías.
                  </p>
                </div>

                <button
                  onClick={processFiles}
                  disabled={monthlyFiles.length === 0 || isProcessing}
                  className={`w-full py-4 rounded-xl flex items-center justify-center gap-2 text-white font-bold transition-all shadow-lg transform hover:scale-[1.02] active:scale-95
                    ${monthlyFiles.length === 0 || isProcessing
                      ? 'bg-slate-300 cursor-not-allowed shadow-none'
                      : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-indigo-300'}`}
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>Procesando...</span>
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-5 h-5" />
                      <span>Consolidar y Generar</span>
                    </>
                  )}
                </button>

                {consolidatedBlob && (
                  <div className="animate-in fade-in slide-in-from-top-4 duration-500 space-y-3">
                    <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-green-700 mb-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        <span className="font-semibold">¡Consolidación completada!</span>
                      </div>
                      <p className="text-sm text-green-600">Tu archivo está listo para descargar</p>
                    </div>
                    <button
                      onClick={downloadFile}
                      className="w-full py-4 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold transition-all shadow-lg shadow-green-300 flex items-center justify-center gap-2 transform hover:scale-[1.02] active:scale-95"
                    >
                      <Download className="w-5 h-5" />
                      <span>Descargar Excel Generado</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
