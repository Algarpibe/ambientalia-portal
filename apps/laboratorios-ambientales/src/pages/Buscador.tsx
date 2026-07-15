import { useMemo } from 'react';
import type { FilterState, Laboratorio } from '../types';
import { EMPTY_FILTERS } from '../types';
import type { ChangedField } from '../lib/filters';
import { applyFilters, clearDownstream, optionsFor } from '../lib/filters';

type Props = {
  data: Laboratorio[];
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onBack: () => void;
};

// Tope de tarjetas pintadas. El encabezado sigue informando del total real: un
// recorte de render no debe disfrazarse de recuento de resultados.
const MAX_VISIBLE = 60;

// El dataset solo tiene estos dos estados (18 689 activas / 367 suspendidas), así
// que la lista es fija y no se deriva de los datos.
const ESTADOS = ['Activa', 'Suspendida'];

const SELECT_CLASS =
  'w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-400';

export default function Buscador({ data, filters, onFiltersChange, onBack }: Props) {
  // Todo lo derivado va memoizado: se recalcula sobre ~19 000 registros en cada
  // pulsación de tecla del campo de búsqueda.
  const resultados = useMemo(() => applyFilters(data, filters), [data, filters]);

  const matrices = useMemo(
    () =>
      [...new Set(data.map((registro) => registro.matriz).filter((valor) => valor !== ''))].sort((a, b) =>
        a.localeCompare(b, 'es'),
      ),
    [data],
  );

  const componentes = useMemo(() => optionsFor(data, 'componente', filters), [data, filters]);
  const actividades = useMemo(() => optionsFor(data, 'actividad', filters), [data, filters]);
  const variables = useMemo(() => optionsFor(data, 'variable', filters), [data, filters]);
  const metodos = useMemo(() => optionsFor(data, 'metodo', filters), [data, filters]);

  // Al mover un filtro de la cascada, los de aguas abajo pueden haber quedado con
  // un valor que ya no existe en el nuevo recorte: clearDownstream los limpia.
  // 'variable' queda fuera: es el multiselect y su campo en FilterState es
  // 'variables' (un array), así que tiene su propio manejador.
  const cambiarCascada = (campo: Exclude<ChangedField, 'variable'>, valor: string) => {
    onFiltersChange(clearDownstream({ ...filters, [campo]: valor }, campo));
  };

  const alternarVariable = (variable: string) => {
    const seleccionadas = filters.variables.includes(variable)
      ? filters.variables.filter((v) => v !== variable)
      : [...filters.variables, variable];
    onFiltersChange(clearDownstream({ ...filters, variables: seleccionadas }, 'variable'));
  };

  const visibles = resultados.slice(0, MAX_VISIBLE);

  return (
    <div className="max-w-7xl mx-auto p-6">
      <button
        onClick={onBack}
        className="mb-4 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors"
      >
        &larr; Volver al Menú Principal
      </button>

      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">Buscador por Parámetros Ambientales</h1>
        <p className="mt-2 text-lg text-gray-600">
          Encuentra laboratorios acreditados filtrando por parámetros y variables técnicas.
        </p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-md mb-8 ring-1 ring-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Búsqueda y Estado quedan fuera de la cascada: no limpian nada. */}
          <div className="md:col-span-2">
            <label htmlFor="busqueda" className="block text-sm font-semibold text-gray-700 mb-1">
              Buscar Parámetro o Laboratorio
            </label>
            <input
              id="busqueda"
              type="text"
              value={filters.busqueda}
              onChange={(e) => onFiltersChange({ ...filters, busqueda: e.target.value })}
              placeholder="Ej: pH, Alcalinidad, Corantioquia..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>

          <div>
            <label htmlFor="estado" className="block text-sm font-semibold text-gray-700 mb-1">
              Estado
            </label>
            <select
              id="estado"
              value={filters.estado}
              onChange={(e) => onFiltersChange({ ...filters, estado: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">Cualquier Estado</option>
              {ESTADOS.map((estado) => (
                <option key={estado} value={estado}>
                  {estado}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="matriz" className="block text-sm font-semibold text-gray-700 mb-1">
              Matriz
            </label>
            <select
              id="matriz"
              value={filters.matriz}
              onChange={(e) => cambiarCascada('matriz', e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Todas las Matrices</option>
              {matrices.map((matriz) => (
                <option key={matriz} value={matriz}>
                  {matriz}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="componente" className="block text-sm font-semibold text-gray-700 mb-1">
              Componente
            </label>
            <select
              id="componente"
              value={filters.componente}
              onChange={(e) => cambiarCascada('componente', e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Todos los Componentes</option>
              {componentes.map((componente) => (
                <option key={componente} value={componente}>
                  {componente}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="actividad" className="block text-sm font-semibold text-gray-700 mb-1">
              Actividad
            </label>
            <select
              id="actividad"
              value={filters.actividad}
              onChange={(e) => cambiarCascada('actividad', e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Todas las Actividades</option>
              {actividades.map((actividad) => (
                <option key={actividad} value={actividad}>
                  {actividad}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label htmlFor="metodo" className="block text-sm font-semibold text-gray-700 mb-1">
              Método
            </label>
            <select
              id="metodo"
              value={filters.metodo}
              onChange={(e) => onFiltersChange({ ...filters, metodo: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">Todos los Métodos</option>
              {metodos.map((metodo) => (
                <option key={metodo} value={metodo}>
                  {metodo}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <p className="block text-sm font-semibold text-gray-700 mb-1">
            Variables{' '}
            {filters.variables.length > 0 && (
              <span className="text-indigo-600 font-bold">({filters.variables.length} seleccionadas)</span>
            )}
          </p>
          <div className="custom-scroll max-h-48 overflow-y-auto border border-gray-300 rounded-lg p-3 bg-white">
            {variables.length === 0 ? (
              <p className="text-sm text-slate-400 italic">No hay variables dentro de los filtros elegidos.</p>
            ) : (
              variables.map((variable) => (
                <label
                  key={variable}
                  className="flex items-center gap-2 py-1 px-1 rounded hover:bg-slate-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={filters.variables.includes(variable)}
                    onChange={() => alternarVariable(variable)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-slate-700">{variable}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
            className="px-6 py-2 bg-slate-100 text-slate-700 font-semibold rounded-lg hover:bg-slate-200 transition-colors"
          >
            Limpiar Filtros
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2">
          <h3 className="text-xl font-bold text-gray-800">
            Vista por Parámetro ({resultados.length.toLocaleString('es-CO')} registros)
          </h3>
          {resultados.length > MAX_VISIBLE && (
            <p className="text-sm text-gray-500 italic">
              Mostrando {MAX_VISIBLE} de {resultados.length.toLocaleString('es-CO')} registros
            </p>
          )}
        </div>

        {resultados.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl shadow-sm border border-dashed border-slate-300">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl text-slate-300">🔍</span>
            </div>
            <p className="text-lg font-bold text-slate-400">No se encontraron parámetros con los filtros seleccionados</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibles.map((registro, idx) => (
              <div
                key={`${registro.codigo}-${registro.variable}-${idx}`}
                className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-all ring-1 ring-slate-200 overflow-hidden flex flex-col group"
              >
                <div className="bg-indigo-50 p-4 border-b border-indigo-100 group-hover:bg-indigo-100 transition-colors">
                  <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1 block">
                    {registro.matriz || 'Sin matriz'}
                  </span>
                  <h4 className="font-extrabold text-indigo-900 leading-tight line-clamp-2 min-h-[3rem]">
                    {registro.variable || 'Parámetro no especificado'}
                  </h4>
                </div>
                <div className="p-5 flex-grow space-y-3">
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Laboratorio</p>
                    <p className="text-sm font-bold text-slate-800 line-clamp-2">{registro.nombreLaboratorio}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase">Ubicación</p>
                      <p className="text-xs text-slate-600 font-medium">
                        {[registro.ciudad, registro.departamento].filter(Boolean).join(', ')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase">Estado</p>
                      {/* 'Activa' es el literal real del dataset. */}
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${
                          registro.estado === 'Activa' ? 'bg-emerald-500' : 'bg-slate-400'
                        }`}
                      >
                        {registro.estado || 'Sin estado'}
                      </span>
                    </div>
                  </div>
                  <div className="bg-slate-50 p-2 rounded-lg border border-slate-100 mt-2">
                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Método de Análisis</p>
                    <p className="text-[11px] text-slate-600 leading-relaxed italic line-clamp-3">
                      {registro.metodo || 'No especificado'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
