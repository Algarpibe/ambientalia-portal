
import React, { useState, useCallback, useEffect } from 'react';
import FileDropzone from './components/FileDropzone';
import PreviewTable from './components/PreviewTable';
import { readFileData, processInventoryData, downloadExcelFile } from './services/fileProcessor';
import { FileData, ProcessedItem, RawRowData, FileInputConfig } from './types';

type ActiveView = 'consolidation';

const initialFileStates: [FileData, FileData, FileData] = [
  { file: null, name: '', error: null },
  { file: null, name: '', error: null },
  { file: null, name: '', error: null },
];

const fileInputConfigs: FileInputConfig[] = [
  { id: 'file-input-1', label: '1. Resumen de Inventario', description: 'Arrastra o haz clic para subir', colorClass: 'text-sky-600' },
  { id: 'file-input-2', label: '2. Comprometido (FACT)', description: 'Arrastra o haz clic para subir', colorClass: 'text-amber-600' },
  { id: 'file-input-3', label: '3. Comprometido (ENV)', description: 'Arrastra o haz clic para subir', colorClass: 'text-teal-600' },
];

const App: React.FC = () => {
  const [filesData, setFilesData] = useState<[FileData, FileData, FileData]>(initialFileStates);
  const [processedData, setProcessedData] = useState<ProcessedItem[] | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isProcessButtonEnabled, setIsProcessButtonEnabled] = useState<boolean>(false);

  useEffect(() => {
    const allFilesPresent = filesData.every(fd => fd.file !== null && fd.error === null);
    setIsProcessButtonEnabled(allFilesPresent);
  }, [filesData]);

  const handleFileChange = useCallback((index: number, file: File | null) => {
    setFilesData(prev => {
      const newFilesData = [...prev] as [FileData, FileData, FileData];
      newFilesData[index] = {
        file: file,
        name: file ? file.name : '',
        error: null, 
      };
      return newFilesData;
    });
    setProcessedData(null); // Clear previous results on new file upload
    setStatusMessage(''); // Clear status message
  }, []);

  const handleProcessFiles = async () => {
    if (!isProcessButtonEnabled) return;

    setIsLoading(true);
    setStatusMessage('Procesando archivos...');
    setStatusType('info');
    setProcessedData(null); // Clear previous results before processing

    // Reset errors for all files before starting
    setFilesData(prev => prev.map(fd => ({ ...fd, error: null })) as [FileData, FileData, FileData]);

    try {
      const rawDataPromises = filesData.map((fd, index) => {
        if (!fd.file) {
          // This case should ideally be prevented by button disable logic
          const errorMsg = `Archivo ${index + 1} no seleccionado.`;
           setFilesData(prev => {
            const newFilesData = [...prev] as [FileData, FileData, FileData];
            newFilesData[index].error = errorMsg;
            return newFilesData;
          });
          throw new Error(errorMsg);
        }
        return readFileData(fd.file).catch(err => {
          setFilesData(prev => {
            const newFilesData = [...prev] as [FileData, FileData, FileData];
            newFilesData[index].error = err.message || `Error al leer archivo ${index + 1}`;
            return newFilesData;
          });
          throw err; // Re-throw to be caught by Promise.all
        });
      });

      const [invRawData, factRawData, envRawData] = await Promise.all(rawDataPromises) as [RawRowData[], RawRowData[], RawRowData[]];
      
      const finalData = processInventoryData(invRawData, factRawData, envRawData);
      setProcessedData(finalData);

      if (finalData.length > 0) {
        // Deriva el token de fecha (ej. "300626") del nombre del archivo de origen
        // para nombrar la salida como Resumen_Inventario_<fecha>_Desglosado.xlsx
        const dateToken = filesData
          .map(fd => fd.name.match(/(\d{6})/)?.[1])
          .find(Boolean);
        const outputFilename = dateToken
          ? `Resumen_Inventario_${dateToken}_Desglosado.xlsx`
          : 'Resumen_Inventario_Desglosado.xlsx';
        downloadExcelFile(finalData, outputFilename);
        setStatusMessage('¡Éxito! El archivo ha sido generado y descargado.');
        setStatusType('success');
      } else {
        setStatusMessage('Procesamiento completado, pero no se generaron datos. Verifica los archivos.');
        setStatusType('info');
      }

    } catch (error: any) {
      console.error("Processing error:", error);
      // Specific file errors are set by readFileData's catch block.
      // General processing errors or if a file wasn't selected correctly (should be rare)
      if (!filesData.some(fd => fd.error)) {
        setStatusMessage(`Error en el procesamiento: ${error.message}`);
      } else {
        setStatusMessage('Error en uno o más archivos. Por favor, revisa los mensajes individuales.');
      }
      setStatusType('error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-grow w-full bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="w-full px-6 py-4">
          <h1 className="text-2xl font-bold text-slate-900">Consolidador de Inventario</h1>
          <p className="text-slate-500 mt-1">Carga los 3 archivos para generar un reporte consolidado</p>
        </div>
      </header>
      <main className="w-full px-6 py-6">
      <div className="w-full bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-900">Carga de Archivos</h2>
          <p className="text-slate-500 mt-2">Selecciona los 3 archivos requeridos para procesar</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {fileInputConfigs.map((config, index) => (
            <FileDropzone
              key={config.id}
              config={config}
              fileName={filesData[index].name}
              fileError={filesData[index].error}
              onFileChange={(file) => handleFileChange(index, file)}
            />
          ))}
        </div>
        
        <div className="text-center space-y-4">
          <button
            onClick={handleProcessFiles}
            disabled={!isProcessButtonEnabled || isLoading}
            className="w-full max-w-xs bg-indigo-600 text-white font-bold py-3 px-6 rounded-lg shadow-md hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-50"
          >
            {isLoading ? (
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : null}
            {isLoading ? 'Procesando...' : 'Procesar y Descargar'}
          </button>
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
    