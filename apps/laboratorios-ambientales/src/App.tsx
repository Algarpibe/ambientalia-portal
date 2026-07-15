import { useCallback, useEffect, useMemo, useState } from 'react';
import '../index.css';
import type { FilterState, Laboratorio } from './types';
import { EMPTY_FILTERS } from './types';
import { fetchLaboratorios } from './services/api';
import Buscador from './pages/Buscador';
import Dashboard from './pages/Dashboard';

type View = 'main' | 'buscador' | 'dashboard';

function App() {
  const [view, setView] = useState<View>('main');
  const [data, setData] = useState<Laboratorio[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [progreso, setProgreso] = useState<number>(0);
  const [error, setError] = useState<string>('');
  // Los filtros viven aquí y no en Buscador: así sobreviven a ir al menú y volver.
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  // En un useCallback para poder reintentar desde el botón de error.
  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    setProgreso(0);
    try {
      const result = await fetchLaboratorios(setProgreso);
      setData(result);
    } catch (err) {
      // fetchLaboratorios lanza cuando la red falla y no hay cache. Tragarse el
      // error dejaría la app enseñando «0 registros» como si fuera un dato real.
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los datos de datos.gov.co.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Cada fila es un parámetro acreditado, no un laboratorio: los laboratorios se
  // cuentan por nombre único.
  const totalLaboratorios = useMemo(
    () => new Set(data.map((registro) => registro.nombreLaboratorio).filter(Boolean)).size,
    [data],
  );
  // 'Activa' es el literal real del dataset (18 689 registros).
  const totalActivas = useMemo(() => data.filter((registro) => registro.estado === 'Activa').length, [data]);

  if (view === 'buscador') {
    return (
      <div className="w-full flex-grow bg-[#F7F8FA]" style={{ minHeight: '100vh' }}>
        <Buscador data={data} filters={filters} onFiltersChange={setFilters} onBack={() => setView('main')} />
      </div>
    );
  }

  if (view === 'dashboard') {
    return (
      <div className="w-full flex-grow bg-[#F7F8FA]" style={{ minHeight: '100vh' }}>
        <Dashboard data={data} onBack={() => setView('main')} />
      </div>
    );
  }

  return (
    <div className="w-full flex-grow bg-[#F7F8FA]" style={{ minHeight: '100vh' }}>
      <div className="flex items-center justify-center min-h-screen p-6">
        <div className="text-center p-12 bg-white rounded-xl shadow-lg max-w-3xl mx-auto ring-1 ring-slate-200">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">
            Plataforma de Análisis de Laboratorios Ambientales
          </h1>
          <p className="text-lg text-gray-600 mb-8">
            Laboratorios acreditados por el IDEAM, según la fuente oficial de datos.gov.co.
          </p>

          {loading && (
            <div className="mb-6 flex flex-col justify-center items-center">
              <div className="w-8 h-8 rounded-full border-4 border-t-indigo-600 border-gray-200 animate-spin" />
              <p className="mt-3 text-sm text-gray-600">
                {progreso > 0
                  ? `Cargando ${progreso.toLocaleString('es-CO')} registros...`
                  : 'Conectando con datos.gov.co...'}
              </p>
            </div>
          )}

          {!loading && error !== '' && (
            <div className="mb-6">
              <div className="bg-red-50 ring-1 ring-red-200 rounded-lg p-4 mb-4 text-left">
                <p className="text-sm font-bold text-red-800 mb-1">No se pudieron cargar los datos</p>
                <p className="text-sm text-red-700 break-words">{error}</p>
              </div>
              <button
                onClick={() => void cargar()}
                className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-md transition-colors"
              >
                Reintentar
              </button>
            </div>
          )}

          {!loading && error === '' && (
            <>
              <div className="flex flex-wrap gap-4 justify-center">
                <button
                  onClick={() => setView('buscador')}
                  className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-md text-lg transition-colors"
                >
                  Buscador de Laboratorios
                </button>
                <button
                  onClick={() => setView('dashboard')}
                  className="px-8 py-4 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg shadow-md text-lg transition-colors"
                >
                  Análisis de Marcas
                </button>
              </div>
              <p className="mt-6 text-sm text-gray-500">
                {totalLaboratorios.toLocaleString('es-CO')} laboratorios &middot;{' '}
                {data.length.toLocaleString('es-CO')} acreditaciones &middot;{' '}
                {totalActivas.toLocaleString('es-CO')} activas
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
