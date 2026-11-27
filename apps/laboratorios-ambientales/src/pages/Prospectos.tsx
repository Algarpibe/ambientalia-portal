import { useEffect, useMemo, useState } from 'react';
import type { Laboratorio } from '../types';
import type { EstadoVigencia, GrupoProspecto } from '../lib/prospects';
import {
  ETIQUETA_GRUPO,
  ETIQUETA_VIGENCIA,
  GRUPOS,
  departamentosDe,
  estadoVigencia,
  filterProspects,
  groupProspects,
  sortProspects,
} from '../lib/prospects';
import { HOJA_EXCEL, filasExcel, nombreDeFichero } from '../lib/exportProspects';
import { hoyLocal } from '../lib/fechas';
import type { CruceZoho, EstadoCliente, EstadoCruce } from '../lib/clientes';
import { ESTADOS_CLIENTE, ETIQUETA_ESTADO_CLIENTE, filtrarPorCliente, nitsParaConsultar } from '../lib/clientes';
import { fetchClientesZoho } from '../services/clientesZoho';
import CeldaCliente from '../components/CeldaCliente';

type Props = {
  data: Laboratorio[];
  onBack: () => void;
};

const SELECT_CLASS =
  'w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

const INSIGNIA_VIGENCIA: Record<EstadoVigencia, string> = {
  vencida: 'bg-red-100 text-red-800',
  pronto: 'bg-amber-100 text-amber-800',
  vigente: 'bg-emerald-100 text-emerald-800',
  'sin-fecha': 'bg-slate-100 text-slate-600',
};

export default function Prospectos({ data, onBack }: Props) {
  // El estado es local: al volver al menú se pierde. Si hiciera falta
  // conservarlo, se subiría a App, como los filtros del Buscador.
  const [grupo, setGrupo] = useState<GrupoProspecto>('infrarrojo');
  const [departamento, setDepartamento] = useState('');
  const [busqueda, setBusqueda] = useState('');
  // «Hoy» se fija al abrir la vista: las insignias y el Excel usan el mismo día.
  const [hoy] = useState(hoyLocal);
  const [exportando, setExportando] = useState(false);
  const [errorExportar, setErrorExportar] = useState('');
  const [filtroCliente, setFiltroCliente] = useState<EstadoCliente | ''>('');
  const [cruce, setCruce] = useState<CruceZoho | null>(null);
  const [estadoCruce, setEstadoCruce] = useState<EstadoCruce>('cargando');
  // Subirlo repite la consulta: es lo que hace «Reintentar».
  const [intento, setIntento] = useState(0);

  // Agrupar recorre los ~19 000 registros: solo se rehace si cambian los datos.
  const todos = useMemo(() => groupProspects(data), [data]);
  // Las opciones salen de todos los laboratorios y no de la pestaña abierta: así
  // el departamento elegido no desaparece de la lista al cambiar de pestaña.
  const departamentos = useMemo(() => departamentosDe(todos), [todos]);

  // Una sola consulta con los NIT de las dos pestañas. La dependencia es el texto
  // y no la lista: si los datos se refrescan con los mismos NIT, no se repite.
  const claveNits = useMemo(() => nitsParaConsultar(todos).join(','), [todos]);
  useEffect(() => {
    const controller = new AbortController();
    fetchClientesZoho(claveNits === '' ? [] : claveNits.split(','), controller.signal).then(
      (resultado) => {
        setCruce(resultado);
        setEstadoCruce('listo');
      },
      (error: unknown) => {
        // Al cerrar la vista se aborta: eso no es un error que haya que enseñar.
        if (controller.signal.aborted) return;
        console.warn('No se pudo consultar Zoho', error);
        setEstadoCruce('error');
      },
    );
    return () => controller.abort();
  }, [claveNits, intento]);

  const reintentar = () => {
    setEstadoCruce('cargando');
    setIntento((n) => n + 1);
  };

  // Mientras no hay cruce, el filtro «Cliente» no cuenta y el Excel sale sin él.
  const cruceListo = estadoCruce === 'listo' ? cruce : null;
  const clienteElegido = cruceListo === null ? '' : filtroCliente;

  // El número de cada pestaña cuenta su grupo con los demás filtros aplicados.
  const recuentos = useMemo<Record<GrupoProspecto, number>>(
    () => ({
      infrarrojo: filtrarPorCliente(
        filterProspects(todos, { grupo: 'infrarrojo', departamento, busqueda }),
        clienteElegido,
        cruceListo,
        hoy,
      ).length,
      gravimetria: filtrarPorCliente(
        filterProspects(todos, { grupo: 'gravimetria', departamento, busqueda }),
        clienteElegido,
        cruceListo,
        hoy,
      ).length,
    }),
    [todos, departamento, busqueda, clienteElegido, cruceListo, hoy],
  );

  const visibles = useMemo(
    () =>
      sortProspects(
        filtrarPorCliente(filterProspects(todos, { grupo, departamento, busqueda }), clienteElegido, cruceListo, hoy),
      ),
    [todos, grupo, departamento, busqueda, clienteElegido, cruceListo, hoy],
  );

  // SheetJS pesa unos 430 KB: se descarga al pulsar y no con la app. Si falla la
  // descarga del trozo o la escritura del libro, se avisa junto al botón y la
  // vista sigue funcionando.
  const exportar = async () => {
    setExportando(true);
    setErrorExportar('');
    try {
      const XLSX = await import('xlsx');
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasExcel(visibles, hoy, cruceListo)), HOJA_EXCEL);
      XLSX.writeFile(libro, nombreDeFichero(grupo, hoy));
    } catch {
      setErrorExportar('No se pudo generar el Excel. Vuelve a intentarlo.');
    } finally {
      setExportando(false);
    }
  };

  const limpiarFiltros = () => {
    setDepartamento('');
    setBusqueda('');
    setFiltroCliente('');
  };

  return (
    // Todo el ancho: la tabla tiene 8 columnas y la de contacto se cortaba a 1280 px.
    <div className="w-full p-6">
      <button
        onClick={onBack}
        className="mb-4 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors"
      >
        &larr; Volver al Menú Principal
      </button>

      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">Prospectos de grasas y aceites</h1>
        <p className="mt-2 text-lg text-gray-600">
          Laboratorios con una acreditación activa en grasas y aceites, según usen o no un método por infrarrojo.
        </p>
      </div>

      {/* Sin este aviso, «Usan infrarrojo» se leería como «tienen un OCMA». */}
      <div className="bg-amber-50 ring-1 ring-amber-200 rounded-xl p-4 mb-6">
        <p className="text-sm font-semibold text-amber-900 mb-1">Qué dice y qué no dice esta vista</p>
        <p className="text-xs text-amber-800">
          El grupo sale de la técnica o del método acreditado (infrarrojo: SM 5520 C, NTC 3362 C). El dataset no
          identifica el equipo: no dice quién tiene un OCMA ni de qué marca es su equipo de infrarrojo. La columna
          Cliente sale de Zoho: «OCMA vendido» solo cuenta los que facturó Ambientalia.
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
        <div role="group" aria-label="Grupo de laboratorios" className="flex flex-wrap gap-2 mb-4">
          {GRUPOS.map((opcion) => (
            <button
              key={opcion}
              type="button"
              aria-pressed={grupo === opcion}
              onClick={() => setGrupo(opcion)}
              className={`px-4 py-2 font-semibold rounded-lg transition-colors ${
                grupo === opcion ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {ETIQUETA_GRUPO[opcion]} ({recuentos[opcion].toLocaleString('es-CO')})
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label htmlFor="busqueda-prospectos" className="block text-sm font-semibold text-gray-700 mb-1">
              Buscar por nombre o NIT
            </label>
            <input
              id="busqueda-prospectos"
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Ej: nombre del laboratorio o 900123456"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>

          <div>
            <label htmlFor="departamento-prospectos" className="block text-sm font-semibold text-gray-700 mb-1">
              Departamento
            </label>
            <select
              id="departamento-prospectos"
              value={departamento}
              onChange={(e) => setDepartamento(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Todos</option>
              {departamentos.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {opcion}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="cliente-prospectos" className="block text-sm font-semibold text-gray-700 mb-1">
              Cliente
            </label>
            <select
              id="cliente-prospectos"
              value={filtroCliente}
              onChange={(e) => setFiltroCliente(e.target.value as EstadoCliente | '')}
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
            onClick={limpiarFiltros}
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
        <h3 className="text-xl font-bold text-gray-800">{ETIQUETA_GRUPO[grupo]}</h3>
        <p className="text-sm text-gray-500" aria-live="polite">
          {visibles.length.toLocaleString('es-CO')} {visibles.length === 1 ? 'laboratorio' : 'laboratorios'}
          {estadoCruce === 'cargando' && ' · Consultando Zoho…'}
        </p>
      </div>

      {visibles.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl shadow-sm border border-dashed border-slate-300">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-slate-300" aria-hidden="true">
              🔍
            </span>
          </div>
          <p className="text-lg font-bold text-slate-400">Ningún laboratorio con estos filtros</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
          {/* Son 90 laboratorios como mucho: sin paginar. En móvil, que haga scroll la tabla y no la página. */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-left border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Laboratorio
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Cliente
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Ciudad
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Departamento
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Matrices
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Métodos
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Vigencia más próxima
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Contacto
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((prospecto) => {
                  const estado = estadoVigencia(prospecto.vigenciaMasProxima, hoy);
                  return (
                    <tr
                      key={`${prospecto.codigo}|${prospecto.nombre}`}
                      className="border-t border-slate-100 align-top hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-800">{prospecto.nombre || 'Sin nombre'}</p>
                        <p className="text-xs text-slate-500">
                          NIT {prospecto.nit || '—'} &middot; Código {prospecto.codigo || '—'}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <CeldaCliente nit={prospecto.nit} cruce={cruce} estadoCruce={estadoCruce} hoy={hoy} />
                      </td>
                      <td className="px-3 py-2 text-slate-600">{prospecto.ciudad || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{prospecto.departamento || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{prospecto.matrices.join(', ') || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {prospecto.metodos.length === 0
                          ? '—'
                          : prospecto.metodos.map((metodo) => (
                              <p key={metodo} className="whitespace-nowrap">
                                {metodo}
                              </p>
                            ))}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <p className="text-slate-700">{prospecto.vigenciaMasProxima ?? '—'}</p>
                        <span
                          className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${INSIGNIA_VIGENCIA[estado]}`}
                        >
                          {ETIQUETA_VIGENCIA[estado]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600 max-w-xs">
                        {prospecto.contacto && <p className="font-medium text-slate-700">{prospecto.contacto}</p>}
                        {prospecto.telefono && <p>{prospecto.telefono}</p>}
                        {prospecto.correo && <p className="break-words">{prospecto.correo}</p>}
                        {!prospecto.contacto && !prospecto.telefono && !prospecto.correo && '—'}
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
