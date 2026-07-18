import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, Search, Landmark } from 'lucide-react';
import { fetchContabilidad, guardarCartera, type ContabilidadData } from './api';
import FacturasTable from './FacturasTable';
import ResumenMensual from './ResumenMensual';

export default function App() {
  const [data, setData] = useState<ContabilidadData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [guardando, setGuardando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    fetchContabilidad()
      .then((d) => vivo && (setData(d), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, []);

  const facturasFiltradas = useMemo(() => {
    if (!data) return [];
    const q = filtro.trim().toLowerCase();
    if (!q) return data.facturas;
    return data.facturas.filter(
      (f) =>
        f.razonSocial.toLowerCase().includes(q) ||
        f.ov.toLowerCase().includes(q) ||
        f.invoiceNumber.toLowerCase().includes(q),
    );
  }, [data, filtro]);

  async function onEditarCartera(invoiceNumber: string, cartera: string) {
    if (!data) return;
    // Optimista: actualiza en memoria y persiste. Si falla, revierte y avisa.
    const anterior = data.facturas.find((f) => f.invoiceNumber === invoiceNumber)?.cartera ?? '';
    setData({
      ...data,
      facturas: data.facturas.map((f) => (f.invoiceNumber === invoiceNumber ? { ...f, cartera } : f)),
    });
    setGuardando(invoiceNumber);
    try {
      await guardarCartera(invoiceNumber, cartera);
    } catch (e) {
      setData((d) =>
        d
          ? { ...d, facturas: d.facturas.map((f) => (f.invoiceNumber === invoiceNumber ? { ...f, cartera: anterior } : f)) }
          : d,
      );
      setError((e as Error).message);
    } finally {
      setGuardando(null);
    }
  }

  return (
    <main className="flex-grow bg-transparent p-6 overflow-y-auto">
      <header className="mb-6 flex items-center gap-3">
        <Landmark className="h-6 w-6 text-blue-600" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Contabilidad — Facturación 2026</h1>
          <p className="text-sm text-gray-500">Datos en vivo desde Zoho. La columna Cartera se guarda al salir de la celda.</p>
        </div>
      </header>

      {cargando && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Cargando facturas…
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {data && !cargando && (
        <>
          <div className="mb-4 flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="Buscar por cliente, OV o factura…"
                className="w-72 rounded-xl border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <span className="text-sm text-gray-500">{facturasFiltradas.length} facturas</span>
          </div>

          <FacturasTable facturas={facturasFiltradas} onEditarCartera={onEditarCartera} guardando={guardando} />
          <ResumenMensual resumen={data.resumen} />
        </>
      )}
    </main>
  );
}
