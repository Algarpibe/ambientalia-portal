import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, Search, Landmark } from 'lucide-react';
import { fetchContabilidad, guardarCartera, guardarPresupuesto, esAdmin, type ContabilidadData, type FacturaContable } from './api';
import { formatCOP } from './format';
import FacturasTable from './FacturasTable';
import ResumenMensual from './ResumenMensual';
import OVPendientes from './OVPendientes';
import DetalleModal from './DetalleModal';

type Estado = 'todas' | 'pagada' | 'saldo' | 'vencida';

function estadoDe(f: FacturaContable, hoy: string): Estado {
  if (f.porCobrar <= 0) return 'pagada';
  if (f.fechaVencimiento && f.fechaVencimiento < hoy) return 'vencida';
  return 'saldo';
}

export default function App() {
  const [data, setData] = useState<ContabilidadData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [anio, setAnio] = useState(2026);
  const [filtro, setFiltro] = useState('');
  const [cliente, setCliente] = useState('');
  const [estado, setEstado] = useState<Estado>('todas');
  const [mes, setMes] = useState(0); // 0 = todos
  const [guardando, setGuardando] = useState<string | null>(null);
  const [guardandoPpto, setGuardandoPpto] = useState(false);
  const [detalleFactura, setDetalleFactura] = useState<string | null>(null);

  const puedeEditar = esAdmin();
  const hoy = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    fetchContabilidad(anio)
      .then((d) => vivo && (setData(d), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [anio]);

  const clientes = useMemo(
    () => (data ? [...new Set(data.facturas.map((f) => f.razonSocial))].sort((a, b) => a.localeCompare(b, 'es')) : []),
    [data],
  );

  const facturasFiltradas = useMemo(() => {
    if (!data) return [];
    const q = filtro.trim().toLowerCase();
    return data.facturas.filter((f) => {
      if (cliente && f.razonSocial !== cliente) return false;
      if (estado !== 'todas' && estadoDe(f, hoy) !== estado) return false;
      if (mes && Number(f.fechaFactura.slice(5, 7)) !== mes) return false;
      if (q && !(f.razonSocial.toLowerCase().includes(q) || f.ov.toLowerCase().includes(q) || f.invoiceNumber.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data, filtro, cliente, estado, mes, hoy]);

  const totales = useMemo(() => {
    return facturasFiltradas.reduce(
      (a, f) => ({ n: a.n + 1, total: a.total + f.totalConIva, cobrado: a.cobrado + f.cobrado, porCobrar: a.porCobrar + f.porCobrar }),
      { n: 0, total: 0, cobrado: 0, porCobrar: 0 },
    );
  }, [facturasFiltradas]);

  async function onEditarCartera(invoiceNumber: string, cartera: string) {
    if (!data) return;
    const anterior = data.facturas.find((f) => f.invoiceNumber === invoiceNumber)?.cartera ?? '';
    setData({ ...data, facturas: data.facturas.map((f) => (f.invoiceNumber === invoiceNumber ? { ...f, cartera } : f)) });
    setGuardando(invoiceNumber);
    try {
      await guardarCartera(invoiceNumber, cartera);
    } catch (e) {
      setData((d) => (d ? { ...d, facturas: d.facturas.map((f) => (f.invoiceNumber === invoiceNumber ? { ...f, cartera: anterior } : f)) } : d));
      setError((e as Error).message);
    } finally {
      setGuardando(null);
    }
  }

  async function onGuardarPresupuesto(presupuesto: number) {
    if (!data) return;
    const anterior = data.resumen.presupuesto;
    const cumpl = presupuesto > 0 ? data.resumen.totalFacturadoSinIva / presupuesto : null;
    setData({ ...data, resumen: { ...data.resumen, presupuesto, cumplimientoPct: cumpl } });
    setGuardandoPpto(true);
    try {
      await guardarPresupuesto(anio, presupuesto);
    } catch (e) {
      setData((d) => (d ? { ...d, resumen: { ...d.resumen, presupuesto: anterior } } : d));
      setError((e as Error).message);
    } finally {
      setGuardandoPpto(false);
    }
  }

  const selCls = 'rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none';

  return (
    <main className="flex-grow bg-transparent p-6 overflow-y-auto">
      <header className="mb-6 flex items-center gap-3">
        <Landmark className="h-6 w-6 text-blue-600" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Contabilidad — Facturación</h1>
          <p className="text-sm text-gray-500">Datos en vivo desde Zoho. La columna Cartera se guarda al salir de la celda.</p>
        </div>
      </header>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Barra de filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={selCls} value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
          {(data?.aniosDisponibles?.length ? data.aniosDisponibles : [anio]).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select className={selCls} value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Todos los clientes</option>
          {clientes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={selCls} value={estado} onChange={(e) => setEstado(e.target.value as Estado)}>
          <option value="todas">Todos los estados</option>
          <option value="pagada">Pagadas</option>
          <option value="saldo">Con saldo</option>
          <option value="vencida">Vencidas</option>
        </select>
        <select className={selCls} value={mes} onChange={(e) => setMes(Number(e.target.value))}>
          <option value={0}>Todos los meses</option>
          {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Buscar cliente, OV o factura" placeholder="Buscar cliente, OV o factura…" className="w-64 rounded-xl border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-blue-400 focus:outline-none" />
        </div>
      </div>

      {cargando && (
        <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Cargando facturas…</div>
      )}

      {data && !cargando && (
        <>
          {/* Totales de la vista filtrada */}
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <span className="text-gray-500">{totales.n} facturas</span>
            <span className="text-gray-700">Total: <b className="tabular-nums">{formatCOP(totales.total)}</b></span>
            <span className="text-gray-700">Cobrado: <b className="tabular-nums">{formatCOP(totales.cobrado)}</b></span>
            <span className="text-gray-700">Por cobrar: <b className="tabular-nums">{formatCOP(totales.porCobrar)}</b></span>
          </div>

          <FacturasTable facturas={facturasFiltradas} onEditarCartera={onEditarCartera} guardando={guardando} onAbrirDetalle={setDetalleFactura} />
          <ResumenMensual
            resumen={data.resumen}
            anio={data.anioActual}
            puedeEditar={puedeEditar}
            onGuardarPresupuesto={onGuardarPresupuesto}
            guardandoPresupuesto={guardandoPpto}
          />
          <OVPendientes />
        </>
      )}

      {detalleFactura && (
        <DetalleModal tipo="factura" numero={detalleFactura} onClose={() => setDetalleFactura(null)} />
      )}
    </main>
  );
}
