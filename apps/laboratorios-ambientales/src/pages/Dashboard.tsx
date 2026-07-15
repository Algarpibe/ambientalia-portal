import { useMemo, useState } from 'react';
import type { Laboratorio } from '../types';
import { groupLabsByEquipment } from '../lib/brands';
import { listBrands, listModels } from '../lib/equipment';

type Props = {
  data: Laboratorio[];
  onBack: () => void;
};

const SELECT_CLASS =
  'w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed';

export default function Dashboard({ data, onBack }: Props) {
  const [brand, setBrand] = useState<string>('');
  const [model, setModel] = useState<string>('');

  const brands = useMemo(() => listBrands(), []);
  const models = useMemo(() => (brand ? listModels(brand) : []), [brand]);

  // El agrupado recorre los ~19 000 registros y extrae el equipo de cada método:
  // solo debe rehacerse cuando cambian los datos o el filtro.
  const labs = useMemo(() => groupLabsByEquipment(data, brand, model), [data, brand, model]);

  const totalEquipos = useMemo(() => labs.reduce((suma, lab) => suma + lab.equipos.length, 0), [labs]);

  // Un modelo pertenece a una sola marca: al cambiar de marca el modelo elegido
  // deja de existir y dejaría la vista vacía.
  const cambiarMarca = (valor: string) => {
    setBrand(valor);
    setModel('');
  };

  const limpiarFiltros = () => {
    setBrand('');
    setModel('');
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <button
        onClick={onBack}
        className="mb-4 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors"
      >
        &larr; Volver al Menú Principal
      </button>

      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">Análisis de Marcas de Calidad del Aire</h1>
        <p className="mt-2 text-lg text-gray-600">
          Equipos identificados a partir del código de designación citado en el método acreditado.
        </p>
      </div>

      {/* El ámbito es fijo y acotado: sin decirlo, el usuario no entendería por qué
          ve 56 laboratorios de los cientos que hay en el buscador. */}
      <div className="bg-teal-50 ring-1 ring-teal-200 rounded-xl p-4 mb-6">
        <p className="text-sm font-semibold text-teal-900 mb-2">Ámbito fijo de este análisis</p>
        <div className="flex flex-wrap gap-2">
          {[
            ['Estado', 'Activa'],
            ['Matriz', 'Aire'],
            ['Componente', 'Calidad del Aire'],
          ].map(([etiqueta, valor]) => (
            <span
              key={etiqueta}
              className="inline-block px-3 py-1 rounded-full bg-white ring-1 ring-teal-200 text-xs font-medium text-teal-800"
            >
              {etiqueta}: <span className="font-bold">{valor}</span>
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-teal-800">
          Solo en las acreditaciones activas de calidad del aire el método cita códigos de designación de equipo.
        </p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-md mb-8 ring-1 ring-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="marca" className="block text-sm font-semibold text-gray-700 mb-1">
              Marca
            </label>
            <select id="marca" value={brand} onChange={(e) => cambiarMarca(e.target.value)} className={SELECT_CLASS}>
              <option value="">Todas las Marcas</option>
              {brands.map((marca) => (
                <option key={marca} value={marca}>
                  {marca}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="modelo" className="block text-sm font-semibold text-gray-700 mb-1">
              Modelo
            </label>
            <select
              id="modelo"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!brand}
              className={SELECT_CLASS}
            >
              <option value="">{brand ? 'Todos los Modelos' : 'Elige una marca primero'}</option>
              {models.map((modelo) => (
                <option key={modelo} value={modelo}>
                  {modelo}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={limpiarFiltros}
            className="px-6 py-2 bg-slate-100 text-slate-700 font-semibold rounded-lg hover:bg-slate-200 transition-colors"
          >
            Limpiar Filtros
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-gray-200 pb-2 mb-6">
        <h3 className="text-xl font-bold text-gray-800">
          {labs.length.toLocaleString('es-CO')} {labs.length === 1 ? 'laboratorio' : 'laboratorios'} &middot;{' '}
          {totalEquipos.toLocaleString('es-CO')} {totalEquipos === 1 ? 'equipo acreditado' : 'equipos acreditados'}
        </h3>
      </div>

      {labs.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl shadow-sm border border-dashed border-slate-300">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-slate-300">🔬</span>
          </div>
          <p className="text-lg font-bold text-slate-400">No se encontraron laboratorios con los filtros seleccionados</p>
        </div>
      ) : (
        <div className="space-y-6">
          {labs.map((lab) => {
            // Los campos de contacto llegan vacíos con frecuencia: se omite lo que
            // no hay en vez de pintar una etiqueta huérfana.
            const contacto = [
              ['Ciudad', lab.ciudad],
              ['Contacto', lab.contacto],
              ['Correo', lab.correo],
              ['Teléfono', lab.telefono],
            ].filter(([, valor]) => valor.trim() !== '');

            return (
              <div key={lab.nombreLaboratorio} className="bg-white rounded-xl shadow-md ring-1 ring-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h4 className="text-lg font-bold text-slate-800">{lab.nombreLaboratorio}</h4>
                  {contacto.length > 0 && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {contacto.map(([etiqueta, valor]) => (
                        <div key={etiqueta}>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase">{etiqueta}</p>
                          <p className="text-xs text-slate-700 font-medium break-words">{valor}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* En móvil la tabla no cabe: que haga scroll ella y no la página. */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                      <tr>
                        <th scope="col" className="px-5 py-2 font-semibold">
                          Marca
                        </th>
                        <th scope="col" className="px-5 py-2 font-semibold">
                          Modelo
                        </th>
                        <th scope="col" className="px-5 py-2 font-semibold">
                          Contaminante
                        </th>
                        <th scope="col" className="px-5 py-2 font-semibold">
                          Código
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {lab.equipos.map((equipo) => (
                        <tr key={equipo.metodo} className="border-t border-slate-100">
                          <td className="px-5 py-2 text-slate-700 whitespace-nowrap">{equipo.brand}</td>
                          <td className="px-5 py-2 font-semibold text-slate-800 whitespace-nowrap">{equipo.model}</td>
                          <td className="px-5 py-2 text-slate-600 whitespace-nowrap">{equipo.pollutant}</td>
                          <td className="px-5 py-2 text-slate-500 font-mono text-xs whitespace-nowrap">{equipo.code}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
