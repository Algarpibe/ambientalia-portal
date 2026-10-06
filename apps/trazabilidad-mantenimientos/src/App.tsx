import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { api, type Inventario } from './api';
import type { EstadoCalibracion } from './dominio';
import { fmtFecha } from './lib/vistas';
import { Alert, Button, Loading } from './ui';
import Resumen from './vistas/Resumen';
import Equipos, { FILTRO_VACIO, type Filtro } from './vistas/Equipos';
import Calendario from './vistas/Calendario';
import Avisos from './vistas/Avisos';
import FichaEquipo from './vistas/FichaEquipo';
import Importar from './vistas/Importar';

/**
 * Trazabilidad Mantenimientos Clientes: vencimientos de calibración de los
 * GRIMM EDM 180 de los clientes (hoja F-ST-022), para avisarles antes de que
 * se les venza y programar el servicio.
 *
 * Pestañas por hash (#resumen, #equipos, #calendario, #avisos), igual que el
 * resto de apps del portal: el router del portal sólo ve /trazabilidad-mantenimientos/*.
 */
const TABS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'equipos', label: 'Equipos' },
  { id: 'calendario', label: 'Calendario Calibraciones' },
  { id: 'avisos', label: 'Avisos a clientes' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const tabDeHash = (): Tab => {
  const h = window.location.hash.replace(/^#/, '');
  return (TABS.find((t) => t.id === h)?.id ?? 'resumen') as Tab;
};

export default function App() {
  const [inv, setInv] = useState<Inventario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [tab, setTab] = useState<Tab>(tabDeHash);
  const [filtro, setFiltro] = useState<Filtro>(FILTRO_VACIO);
  const [calMes, setCalMes] = useState<{ anio: number; mes: number } | null>(null);
  const [ficha, setFicha] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const avisoTimer = useRef<number | undefined>(undefined);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setInv(await api.inventario());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    const onHash = () => setTab(tabDeHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const irA = useCallback((t: Tab) => {
    window.history.pushState(null, '', `#${t}`);
    setTab(t);
    window.scrollTo({ top: 0 });
  }, []);

  const notificar = useCallback((msg: string) => {
    setAviso(msg);
    window.clearTimeout(avisoTimer.current);
    avisoTimer.current = window.setTimeout(() => setAviso(null), 3000);
  }, []);

  const verEquipos = useCallback(
    (f: Partial<Filtro>) => {
      setFiltro({ ...FILTRO_VACIO, ...f });
      irA('equipos');
    },
    [irA],
  );
  const verEstados = useCallback((estados: EstadoCalibracion[]) => verEquipos({ estados }), [verEquipos]);
  const verMes = useCallback(
    (anio: number, mes: number) => {
      setCalMes({ anio, mes });
      irA('calendario');
    },
    [irA],
  );

  const equipos = inv?.equipos ?? [];
  const equipoFicha = ficha ? equipos.find((e) => e.clave === ficha) ?? null : null;
  const ult = inv?.ultimaImportacion;

  return (
    <main className="min-w-0 flex-grow bg-transparent p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-7 w-7 text-blue-600" aria-hidden />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Trazabilidad Mantenimientos Clientes</h1>
            <p className="max-w-2xl text-sm text-gray-500">
              GRIMM EDM 180 · vigencia de calibración de 365 días · hoy {fmtFecha(inv?.hoy)}
              {ult && (
                <>
                  {' '}
                  · importado el {fmtFecha(ult.en)} desde «{ult.archivo}» por {ult.por}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => void cargar()} busy={cargando} aria-label="Actualizar">
            {!cargando && <RefreshCw className="h-4 w-4" aria-hidden />} Actualizar
          </Button>
          <Button variant="primary" onClick={() => setImportando(true)}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden /> Importar F-ST-022
          </Button>
        </div>
      </header>

      {error && (
        <div className="mb-4">
          <Alert tone="red">{error}</Alert>
        </div>
      )}
      {!inv && !error && <Loading texto="Cargando el inventario de GRIMM EDM 180…" />}

      {inv && equipos.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-sm">
          <FileSpreadsheet className="mx-auto mb-3 h-10 w-10 text-gray-300" aria-hidden />
          <p className="mb-1 font-semibold text-gray-800">Todavía no hay equipos cargados</p>
          <p className="mx-auto mb-4 max-w-md text-sm text-gray-500">
            Importa la hoja F-ST-022 «Trazabilidad Mttos Clientes» para ver los GRIMM EDM 180, sus vencimientos de calibración y el calendario.
          </p>
          <Button variant="primary" onClick={() => setImportando(true)}>
            Importar F-ST-022
          </Button>
        </div>
      )}

      {inv && equipos.length > 0 && (
        <>
          <nav aria-label="Secciones" className="mb-5 flex gap-1 overflow-x-auto border-b border-gray-200">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => irA(t.id)}
                className={`-mb-px min-h-[44px] whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors ${
                  tab === t.id ? 'border-blue-500 font-semibold text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === 'resumen' && (
            <Resumen equipos={equipos} hoy={inv.hoy} onEstados={verEstados} onCliente={(cliente) => verEquipos({ cliente })} onEnCasa={() => verEquipos({ enAmbientalia: true })} onMes={verMes} onAvisos={() => irA('avisos')} onFicha={setFicha} />
          )}
          {tab === 'equipos' && <Equipos equipos={equipos} filtro={filtro} onFiltro={setFiltro} onFicha={setFicha} />}
          {tab === 'calendario' && <Calendario equipos={equipos} hoy={inv.hoy} mes={calMes} onMes={setCalMes} onFicha={setFicha} />}
          {tab === 'avisos' && <Avisos equipos={equipos} hoy={inv.hoy} onFicha={setFicha} onCambio={cargar} notificar={notificar} />}
        </>
      )}

      {equipoFicha && <FichaEquipo equipo={equipoFicha} onClose={() => setFicha(null)} onGuardado={async () => { await cargar(); notificar('Seguimiento guardado'); }} />}
      {importando && (
        <Importar
          onClose={() => setImportando(false)}
          onHecho={async (n) => {
            setImportando(false);
            await cargar();
            notificar(`Importación aplicada: ${n} equipos`);
          }}
        />
      )}
      {aviso && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {aviso}
        </div>
      )}
    </main>
  );
}
