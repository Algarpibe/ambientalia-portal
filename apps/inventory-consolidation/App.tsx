
/// <reference types="vite/client" />
import { useState } from 'react';
import PreviewTable from './components/PreviewTable';
import { processInventoryData, downloadExcelFile } from './services/fileProcessor';
import { cargarDesdeHub, hubARawRows, nombreArchivoDesglosado } from './services/hubData';
import type { ProcessedItem } from './types';
// Auth: JWT emitido por hub-api /api/login (guardado por el portal en localStorage).
import { authHeaders } from '@suite/auth-client';

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

const App: React.FC = () => {
  const [processedData, setProcessedData] = useState<ProcessedItem[] | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Mismo xlsx que antes se obtenía subiendo las 3 exportaciones de Zoho, pero con
  // los listados que sirve el hub desde la réplica. processInventoryData aplica las
  // mismas fórmulas.
  const handleGenerarDesdeBD = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setStatusMessage('Consultando la base de datos...');
    setStatusType('info');
    setProcessedData(null);
    try {
      const datos = await cargarDesdeHub({ apiBase: API_BASE, headers: authHeaders() });
      const { invData, factData, envData } = hubARawRows(datos);
      const finalData = processInventoryData(invData, factData, envData);
      setProcessedData(finalData);
      if (finalData.length > 0) {
        downloadExcelFile(finalData, nombreArchivoDesglosado());
        setStatusMessage('¡Éxito! El archivo ha sido generado desde la base de datos y descargado.');
        setStatusType('success');
      } else {
        setStatusMessage('La base de datos no devolvió artículos de inventario.');
        setStatusType('info');
      }
    } catch (error: any) {
      console.error('Hub error:', error);
      setStatusMessage(`Error al generar desde la base de datos: ${error.message}`);
      setStatusType('error');
    } finally {
      setIsLoading(false);
    }
  };

  const spinner = (
    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );

  return (
    <div className="flex-grow w-full bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="w-full px-6 py-4">
          <h1 className="text-2xl font-bold text-slate-900">Consolidador de Inventario</h1>
          <p className="text-slate-500 mt-1">Genera el reporte consolidado desde la base de datos</p>
        </div>
      </header>
      <main className="w-full px-6 py-6">
      <div className="w-full bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <div className="text-center space-y-4">
          <div>
            <button
              onClick={handleGenerarDesdeBD}
              disabled={isLoading}
              className="w-full max-w-xs bg-emerald-600 text-white font-bold py-3 px-6 rounded-lg shadow-md hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50"
            >
              {isLoading ? spinner : null}
              {isLoading ? 'Generando...' : 'Generar desde la base de datos'}
            </button>
            <p className="text-slate-500 text-xs mt-2">Usa los datos de Zoho sincronizados en el hub.</p>
          </div>
          {statusMessage && (
            <div className={`h-6 text-sm ${
              statusType === 'success' ? 'text-green-600' :
              statusType === 'error' ? 'text-red-600 font-bold' :
              'text-blue-600'
            }`}>
              {statusMessage}
            </div>
          )}
        </div>

        {processedData && processedData.length > 0 && (
          <PreviewTable data={processedData} />
        )}
      </div>      </main>    </div>
  );
};

export default App;
