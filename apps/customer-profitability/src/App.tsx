import React, { useState } from 'react';
import './index.css';
import { Upload, FileText, AlertCircle, TrendingUp, DollarSign, Users } from 'lucide-react';
import * as XLSX from 'xlsx';
import Dashboard from './components/Dashboard';

function App() {
  const [salesData, setSalesData] = useState([]);
  const [productData, setProductData] = useState([]);
  const [salesFileName, setSalesFileName] = useState(null);
  const [productFileName, setProductFileName] = useState(null);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const processFile = async (file, type) => {
    setIsProcessing(true);
    setError(null);
    try {
      const rawData = await parseExcel(file);
      if (!rawData || rawData.length === 0) throw new Error("El archivo está vacío.");

      // 1. Find the first meaningful row (skip empty top rows)
      const cleanRows = rawData.filter(r => r && r.length > 0);
      if (cleanRows.length === 0) throw new Error("El archivo no contiene datos legibles.");

      // 2. Try to identify headers in the first few rows
      let headerRowIndex = -1;
      let hasHeaders = false;

      for (let i = 0; i < Math.min(10, cleanRows.length); i++) {
        const row = cleanRows[i].map(c => String(c).toLowerCase().trim());
        if (type === 'sales') {
          if (row.includes('sku') || row.includes('código de artículo') || row.includes('codigo de articulo')) {
            headerRowIndex = i;
            hasHeaders = true;
            break;
          }
        } else { // products
          if (row.includes('fabricante') || row.includes('precio de compra') || row.includes('sku')) {
            headerRowIndex = i;
            hasHeaders = true;
            break;
          }
        }
      }

      let formattedData = [];

      if (hasHeaders) {
        const keys = cleanRows[headerRowIndex];
        const dataRows = cleanRows.slice(headerRowIndex + 1);
        formattedData = dataRows.map(row => {
          const obj = {};
          keys.forEach((key, k) => {
            if (key) obj[key] = row[k];
          });
          return obj;
        });
      } else {
        // No headers found. Fallback logic.
        if (type === 'sales') {
          // Find the first row that looks like data (at least 5 columns)
          // This skips Title rows or metadata in the first few lines
          const dataStartIndex = cleanRows.findIndex(row => row.length >= 5);

          if (dataStartIndex === -1) {
            throw new Error(`El archivo de Ventas no tiene encabezados reconocibles y ninguna fila tiene 5 o más columnas. (La primera fila encontrada tiene ${cleanRows[0]?.length || 0} columnas).`);
          }

          // Use rows starting from the one with enough columns
          const salesRows = cleanRows.slice(dataStartIndex);

          let currentCustomer = 'Cliente General';

          formattedData = [];

          salesRows.forEach(row => {
            // Check if this row is likely a Customer Header
            // Condition: Has content in Col 0 (SKU/Cliente) and Col 1 (Marca) is empty
            // This identifies rows with customer names instead of article data
            const col0 = row[0];
            const col1 = row[1]; // Marca
            const col2 = row[2]; // Name
            const col3 = row[3]; // Qty
            const col4 = row[4]; // Amount

            const isCustomerHeader = col0 && !col1;

            if (isCustomerHeader) {
              // Clean up customer name (remove special chars if any)
              currentCustomer = String(col0).trim();
              return; // Skip adding this row to data, just update state
            }

            // Valid Data Row check: Must have SKU(0), Qty(3), Amount(4)
            if (col0 && col3) {
              formattedData.push({
                'SKU': row[0],
                'Cliente': currentCustomer, // Use the state-tracked customer
                'Nombre del artículo': row[2],
                'Cantidad vendida': row[3],
                'Importe': row[4]
              });
            }
          });

          if (formattedData.length === 0) {
            console.warn("Parsing Warning: No valid data rows extracted using hierarchical logic.");
            // Fallback or just let it fail downstream if empty
          }
        } else {
          throw new Error("El archivo Base Maestra requiere encabezados (ej: Fabricante, SKU, Precio).");
        }
      }

      if (formattedData.length === 0) throw new Error("No se pudieron extraer datos válidos del archivo.");

      if (type === 'sales') {
        setSalesData(formattedData);
        setSalesFileName(file.name);
      } else {
        setProductData(formattedData);
        setProductFileName(file.name);
      }

    } catch (err) {
      console.error(err);
      setError(err.message);
      if (type === 'sales') {
        setSalesData([]);
        setSalesFileName(null);
      } else {
        setProductData([]);
        setProductFileName(null);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const parseExcel = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          // Use header:1 and blankrows:false to skip totally keys empty rows
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });
          resolve(jsonData);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = (error) => reject(error);
      reader.readAsArrayBuffer(file);
    });
  };

  const hasData = salesData.length > 0 && productData.length > 0;

  const resetApp = () => {
    setSalesData([]);
    setProductData([]);
    setSalesFileName(null);
    setProductFileName(null);
    setError(null);
  };

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
        {!hasData ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-10">
            <div className="text-center max-w-2xl space-y-4">
              <h2 className="text-4xl font-extrabold text-slate-900 tracking-tight">
                Configuración de Datos
              </h2>
              <p className="text-lg text-slate-500 leading-relaxed">
                Para generar el análisis de rentabilidad, por favor carga los archivos correspondientes.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-5xl">
              {/* Sales Upload Card */}
              <div className={`relative group transition-all duration-500 ease-out hover:-translate-y-2
                ${salesData.length > 0
                  ? 'bg-emerald-50/50 border-2 border-emerald-400/30'
                  : 'bg-white border text-center border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)]'} 
                rounded-[2rem] overflow-hidden h-80`
              }>
                {salesData.length > 0 && (
                  <div className="absolute top-4 right-4 bg-emerald-500 text-white px-4 py-1.5 rounded-full text-xs font-bold shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 animate-in fade-in zoom-in">
                    <div className="bg-white text-emerald-600 rounded-full p-0.5"><TrendingUp size={10} /></div>
                    Cargado correctamente
                  </div>
                )}
                <label className="flex flex-col items-center justify-center h-full w-full cursor-pointer p-8 relative z-10">
                  <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-6 transition-all duration-300 shadow-xl
                    ${salesData.length > 0
                      ? 'bg-emerald-500 text-white shadow-emerald-500/30 rotate-3 scale-110'
                      : 'bg-indigo-50 text-indigo-600 shadow-indigo-500/10 group-hover:scale-110 group-hover:bg-indigo-600 group-hover:text-white group-hover:shadow-indigo-500/30'}`}>
                    {salesData.length > 0 ? <FileText size={36} /> : <Upload size={36} />}
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">Archivo de Ventas</h3>
                  <p className="text-sm text-slate-500 mb-6 text-center max-w-[200px]">
                    {salesFileName || "Sube el reporte de ventas con SKU, Cliente y Cantidades"}
                  </p>

                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={(e) => processFile(e.target.files[0], 'sales')}
                    className="hidden"
                    disabled={salesData.length > 0}
                  />

                  {salesData.length > 0 ? (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        setSalesData([]);
                        setSalesFileName(null);
                      }}
                      className="text-sm font-semibold text-rose-500 hover:text-rose-600 hover:bg-rose-50 px-4 py-2 rounded-xl transition-colors"
                    >
                      Eliminar archivo
                    </button>
                  ) : (
                    <div className="px-6 py-2.5 bg-slate-50 text-slate-600 text-sm font-semibold rounded-xl group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                      Seleccionar archivo
                    </div>
                  )}
                </label>
              </div>

              {/* Master Data Upload Card */}
              <div className={`relative group transition-all duration-500 ease-out hover:-translate-y-2
                ${productData.length > 0
                  ? 'bg-blue-50/50 border-2 border-blue-400/30'
                  : 'bg-white border text-center border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)]'} 
                rounded-[2rem] overflow-hidden h-80`
              }>
                {productData.length > 0 && (
                  <div className="absolute top-4 right-4 bg-blue-500 text-white px-4 py-1.5 rounded-full text-xs font-bold shadow-lg shadow-blue-500/20 flex items-center gap-1.5 animate-in fade-in zoom-in">
                    <div className="bg-white text-blue-600 rounded-full p-0.5"><TrendingUp size={10} /></div>
                    Cargado correctamente
                  </div>
                )}
                <label className="flex flex-col items-center justify-center h-full w-full cursor-pointer p-8 relative z-10">
                  <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-6 transition-all duration-300 shadow-xl
                    ${productData.length > 0
                      ? 'bg-blue-500 text-white shadow-blue-500/30 rotate-3 scale-110'
                      : 'bg-teal-50 text-teal-600 shadow-teal-500/10 group-hover:scale-110 group-hover:bg-teal-600 group-hover:text-white group-hover:shadow-teal-500/30'}`}>
                    {productData.length > 0 ? <FileText size={36} /> : <Upload size={36} />}
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">Base Maestra</h3>
                  <p className="text-sm text-slate-500 mb-6 text-center max-w-[200px]">
                    {productFileName || "Sube el archivo R22 con los costos y fabricantes"}
                  </p>
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={(e) => processFile(e.target.files[0], 'products')}
                    className="hidden"
                    disabled={productData.length > 0}
                  />
                  {productData.length > 0 ? (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        setProductData([]);
                        setProductFileName(null);
                      }}
                      className="text-sm font-semibold text-rose-500 hover:text-rose-600 hover:bg-rose-50 px-4 py-2 rounded-xl transition-colors"
                    >
                      Eliminar archivo
                    </button>
                  ) : (
                    <div className="px-6 py-2.5 bg-slate-50 text-slate-600 text-sm font-semibold rounded-xl group-hover:bg-teal-50 group-hover:text-teal-600 transition-colors">
                      Seleccionar archivo
                    </div>
                  )}
                </label>
              </div>
            </div>

            {isProcessing && (
              <div className="flex items-center gap-2 text-blue-600 animate-pulse">
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span>Procesando archivo...</span>
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-50 text-red-600 rounded-xl flex items-center gap-2 max-w-xl text-sm border border-red-100">
                <AlertCircle size={18} />
                {error}
              </div>
            )}

            {/* Guide Step */}
            {!isProcessing && !error && !hasData && (
              <div className="flex gap-2 text-sm text-slate-400 bg-slate-100 px-4 py-2 rounded-full">
                <AlertCircle size={16} />
                <span>Sube ambos archivos para desbloquear el tablero</span>
              </div>
            )}
          </div>
        ) : (
          <Dashboard sales={salesData} products={productData} onReset={resetApp} />
        )}
      </main>
    </div>
  );
}

export default App;
