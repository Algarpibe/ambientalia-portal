import { useDeferredValue, useMemo, useState } from 'react';
import type { Laboratorio } from '../types';
import type { EstadoVigencia } from '../lib/prospects';
import { ETIQUETA_VIGENCIA, estadoVigencia } from '../lib/prospects';
import type { FiltrosEquipos } from '../lib/baseInstalada';
import {
  FILTROS_VACIOS,
  SIN_ESTACION,
  SIN_IDENTIFICAR,
  agruparEquipos,
  filtrarEquipos,
  opcionesDeFiltro,
  ordenarEquipos,
  textoRecuento,
} from '../lib/baseInstalada';
import { HOJA_EXCEL, filasExcel, nombreDeFichero } from '../lib/exportBaseInstalada';
import { hoyLocal } from '../lib/fechas';
import type { EstadoCliente } from '../lib/clientes';
import { ESTADOS_CLIENTE, ETIQUETA_ESTADO_CLIENTE, nitsParaConsultar } from '../lib/clientes';
import { useCruceZoho } from '../hooks/useCruceZoho';
import CeldaCliente from '../components/CeldaCliente';

type Props = {
  data: Laboratorio[];
  onBack: () => void;
};

const SELECT_CLASS =
  'w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

// Los mismos colores que en Prospectos. No se comparten: un fichero de vista
// solo exporta su componente (react-refresh).
const INSIGNIA_VIGENCIA: Record<EstadoVigencia, string> = {
  vencida: 'bg-red-100 text-red-800',
  pronto: 'bg-amber-100 text-amber-800',
  vigente: 'bg-emerald-100 text-emerald-800',
  'sin-fecha': 'bg-slate-100 text-slate-600',
};

const COLUMNAS_TABLA = [
  'Laboratorio',
  'Cliente',
  'Ciudad',
  'Departamento',
  'Estación',
  'Marca y modelo',
  'Serie',
  'Variables',
  'Vigencia más próxima',
  'Contacto',
] as const;

export default function BaseInstalada({ data, onBack }: Props) {
  // El estado es local, como en Prospectos: al volver al menú se pierde.
  const [filtros, setFiltros] = useState<FiltrosEquipos>(FILTROS_VACIOS);
  // «Hoy» se fija al abrir la vista: las insignias y el Excel usan el mismo día.
  const [hoy] = useState(hoyLocal);
  const [exportando, setExportando] = useState(false);
  const [errorExportar, setErrorExportar] = useState('');

  // Agrupar recorre los ~18 000 registros: solo se rehace si cambian los datos.
  const todos = useMemo(() => ordenarEquipos(agruparEquipos(data)), [data]);
  const opciones = useMemo(() => opcionesDeFiltro(todos, filtros.departamento), [todos, filtros.departamento]);

  // Una sola consulta con los NIT de todos los equipos (ver useCruceZoho). El
  // cruce llega solo cuando está listo; mientras, es null.
  const nits = useMemo(() => nitsParaConsultar(todos), [todos]);
  const { cruce, estadoCruce, reintentar } = useCruceZoho(nits);

  const visibles = useMemo(() => filtrarEquipos(todos, filtros, cruce, hoy), [todos, filtros, cruce, hoy]);
  // Son ~1.200 filas sin paginar: la tabla se pinta con el valor diferido para
  // que escribir en la búsqueda no se trabe. El recuento y el Excel usan `visibles`.
  const filas = useDeferredValue(visibles);

  const cambiar = (cambio: Partial<FiltrosEquipos>) => setFiltros((previos) => ({ ...previos, ...cambio }));
  // Mientras no hay cruce, el filtro «Cliente» se ve en «Todos» y no cuenta.
  const clienteElegido = cruce === null ? '' : filtros.cliente;

  // SheetJS pesa unos 430 KB: se descarga al pulsar y no con la app. Si falla la
  // descarga del trozo o la escritura del libro, se avisa junto al botón.
  const exportar = async () => {
    setExportando(true);
    setErrorExportar('');
    try {
      const XLSX = await import('xlsx');
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasExcel(visibles, hoy, cruce)), HOJA_EXCEL);
      XLSX.writeFile(libro, nombreDeFichero(hoy));
    } catch {
      setErrorExportar('No se pudo generar el Excel. Vuelve a intentarlo.');
    } finally {
      setExportando(false);
    }
  };

  return (
    // Todo el ancho: la tabla tiene 10 columnas.
    <div className="w-full p-6">
      <button
        onClick={onBack}
        className="mb-4 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors"
      >
        &larr; Volver al Menú Principal
      </button>

      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">Base instalada de aire</h1>
        <p className="mt-2 text-lg text-gray-600">
          Cada equipo de calidad del aire u olores acreditado ante el IDEAM: dueño, dónde está, marca y número de serie.
        </p>
      </div>

      {/* Sin este aviso, una marca con varios fabricantes se leería como un dato seguro. */}
      <div className="bg-amber-50 ring-1 ring-amber-200 rounded-xl p-4 mb-6">
        <p className="text-sm font-semibold text-amber-900 mb-1">Qué dice y qué no dice esta vista</p>
        <p className="text-xs text-amber-800">
          La marca y el modelo salen del código EPA que cita el método acreditado. Un código puede cubrir a varios
          fabricantes, y entonces salen juntos: el dataset no dice cuál de ellos es. «Sin identificar» quiere decir que
          el método no cita un código conocido. La columna Cliente sale de Zoho.
        </p>
      </div>

      {estadoCruce === 'error' && (
        <div
          role="alert"
          className="bg-amber-50 ring-1 ring-amber-200 rounded-xl p-4 mb-6 flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-sm text-amber-900">No se pudo consultar Zoho; la columna Cliente queda vacía.</p>
          <button
            type="button"
            onClick={reintentar}
            className="px-4 py-2 bg-amber-700 text-white font-semibold rounded-lg hover:bg-amber-800 transition-colors"
          >
            Reintentar
          </button>
        </div>
      )}

      <div className="bg-white p-6 rounded-xl shadow-md mb-8 ring-1 ring-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="md:col-span-3 lg:col-span-2">
            <label htmlFor="busqueda-base-aire" className="block text-sm font-semibold text-gray-700 mb-1">
              Buscar por laboratorio, NIT, estación o serie
            </label>
            <input
              id="busqueda-base-aire"
              type="text"
              value={filtros.busqueda}
              onChange={(e) => cambiar({ busqueda: e.target.value })}
              placeholder="Ej: nombre del laboratorio, 900123456 o una serie"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>

          <div>
            <label htmlFor="departamento-base-aire" className="block text-sm font-semibold text-gray-700 mb-1">
              Departamento
            </label>
            {/* Al cambiar de departamento, la ciudad elegida puede no ser suya: se vacía. */}
            <select
              id="departamento-base-aire"
              value={filtros.departamento}
              onChange={(e) => cambiar({ departamento: e.target.value, ciudad: '' })}
              className={SELECT_CLASS}
            >
              <option value="">Todos</option>
              {opciones.departamentos.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {opcion}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ciudad-base-aire" className="block text-sm font-semibold text-gray-700 mb-1">
              Ciudad
            </label>
            <select
              id="ciudad-base-aire"
              value={filtros.ciudad}
              onChange={(e) => cambiar({ ciudad: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">Todas</option>
              {opciones.ciudades.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {opcion}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="marca-base-aire" className="block text-sm font-semibold text-gray-700 mb-1">
              Marca
            </label>
            <select
              id="marca-base-aire"
              value={filtros.marca}
              onChange={(e) => cambiar({ marca: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">Todas</option>
              {opciones.marcas.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {opcion}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="cliente-base-aire" className="block text-sm font-semibold text-gray-700 mb-1">
              Cliente
            </label>
            <select
              id="cliente-base-aire"
              value={clienteElegido}
              onChange={(e) => cambiar({ cliente: e.target.value as EstadoCliente | '' })}
              disabled={estadoCruce !== 'listo'}
              className={`${SELECT_CLASS} disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed`}
            >
              <option value="">Todos</option>
              {ESTADOS_CLIENTE.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {ETIQUETA_ESTADO_CLIENTE[opcion]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {errorExportar !== '' && (
            <p role="alert" className="text-sm text-red-700">
              {errorExportar}
            </p>
          )}
          <button
            onClick={() => setFiltros(FILTROS_VACIOS)}
            className="px-6 py-2 bg-slate-100 text-slate-700 font-semibold rounded-lg hover:bg-slate-200 transition-colors"
          >
            Limpiar Filtros
          </button>
          <button
            type="button"
            onClick={() => void exportar()}
            disabled={exportando || visibles.length === 0}
            className="px-6 py-2 bg-emerald-700 text-white font-semibold rounded-lg shadow-md hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {exportando ? 'Exportando...' : 'Exportar a Excel'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2 mb-6">
        <h3 className="text-xl font-bold text-gray-800">Equipos</h3>
        <p className="text-sm text-gray-500" aria-live="polite">
          {textoRecuento(visibles)}
          {estadoCruce === 'cargando' && ' · Consultando Zoho…'}
        </p>
      </div>

      {filas.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl shadow-sm border border-dashed border-slate-300">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-slate-300" aria-hidden="true">
              🔍
            </span>
          </div>
          <p className="text-lg font-bold text-slate-400">Ningún equipo con estos filtros</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
          {/* En móvil, que haga scroll la tabla y no la página. */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-left border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  {COLUMNAS_TABLA.map((columna) => (
                    <th key={columna} scope="col" className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                      {columna}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((equipo) => {
                  const estado = estadoVigencia(equipo.vigenciaMasProxima, hoy);
                  return (
                    <tr
                      key={`${equipo.codigo}|${equipo.laboratorio}|${equipo.serie}`}
                      className="border-t border-slate-100 align-top hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-800">{equipo.laboratorio || 'Sin nombre'}</p>
                        <p className="text-xs text-slate-500">
                          NIT {equipo.nit || '—'} &middot; Código {equipo.codigo || '—'}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <CeldaCliente
                          nit={equipo.nit}
                          cruce={cruce}
                          estadoCruce={estadoCruce}
                          hoy={hoy}
                          conOcma={false}
                        />
                      </td>
                      <td className="px-3 py-2 text-slate-600">{equipo.ciudad || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{equipo.departamento || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {equipo.estaciones.length === 0 ? (
                          <span className="text-slate-400">{SIN_ESTACION}</span>
                        ) : (
                          equipo.estaciones.map((estacion) => <p key={estacion}>{estacion}</p>)
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {equipo.marcasYModelos.length === 0 ? (
                          <p className="text-slate-500">{SIN_IDENTIFICAR}</p>
                        ) : (
                          equipo.marcasYModelos.map((par) => (
                            <p key={`${par.marca}|${par.modelo}`}>
                              <span className="font-medium text-slate-800">{par.marca}</span>{' '}
                              <span className="text-slate-600">{par.modelo}</span>
                            </p>
                          ))
                        )}
                        {equipo.codigosEpa.length > 0 && (
                          <p className="mt-1 text-xs text-slate-400 whitespace-nowrap">{equipo.codigosEpa.join(', ')}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700 whitespace-nowrap">{equipo.serie}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{equipo.variables.join(', ') || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <p className="text-slate-700">{equipo.vigenciaMasProxima ?? '—'}</p>
                        <span
                          className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${INSIGNIA_VIGENCIA[estado]}`}
                        >
                          {ETIQUETA_VIGENCIA[estado]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600 max-w-xs">
                        {equipo.contacto && <p className="font-medium text-slate-700">{equipo.contacto}</p>}
                        {equipo.telefono && <p>{equipo.telefono}</p>}
                        {equipo.correo && <p className="break-words">{equipo.correo}</p>}
                        {!equipo.contacto && !equipo.telefono && !equipo.correo && '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
