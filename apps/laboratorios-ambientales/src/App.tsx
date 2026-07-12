import { useState, useEffect, useMemo } from 'react';
import '../index.css';
import type { Laboratorio, FilterState } from './types';
import { fetchLaboratorios, analyzeWithAI } from './services/api';

function App() {
    console.log("Laboratorios App: Component Mounting");

    const [view, setView] = useState<'main' | 'buscador' | 'dashboard' | 'analisis'>('main');
    const [loading, setLoading] = useState<boolean>(true);
    const [data, setData] = useState<Laboratorio[]>([]);
    const [filters, setFilters] = useState<FilterState>({
        nombre: '',
        estado: '',
        matriz: '',
        componente: '',
        actividad: '',
        variable: '',
        metodo: ''
    });
    const [aiQuery, setAiQuery] = useState('');
    const [aiResponse, setAiResponse] = useState('');
    const [aiLoading, setAiLoading] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            console.log("Laboratorios App: Starting Data Load");
            setLoading(true);
            try {
                const result = await fetchLaboratorios();
                console.log("Laboratorios App: Data Loaded", result.length);
                setData(result);
            } catch (error) {
                console.error("Laboratorios App: Failed to load data", error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, []);

    const uniqueValues = (key: keyof Laboratorio) => {
        return Array.from(new Set(data.map(item => item[key]).filter(Boolean))).sort();
    };

    const filteredData = useMemo(() => {
        return data.filter(item => {
            try {
                return (
                    (!filters.nombre ||
                        item.nombre_laboratorio?.toLowerCase().includes(filters.nombre.toLowerCase()) ||
                        item.parametro?.toLowerCase().includes(filters.nombre.toLowerCase())
                    ) &&
                    (!filters.estado || item.estado === filters.estado) &&
                    (!filters.matriz || item.matriz === filters.matriz) &&
                    (!filters.componente || item.parametro === filters.componente) &&
                    (!filters.metodo || item.metodo === filters.metodo)
                );
            } catch (e) {
                console.error("Error filtering item", item, e);
                return false;
            }
        });
    }, [data, filters]);

    const handleAiAnalysis = async () => {
        if (!aiQuery.trim()) return;
        setAiLoading(true);
        try {
            const response = await analyzeWithAI(aiQuery, data);
            setAiResponse(response);
        } catch (e) {
            setAiResponse("Hubo un error al procesar tu consulta.");
        } finally {
            setAiLoading(false);
        }
    };

    // Derived stats for Dashboard
    const totalLabs = data.length;
    const activeLabs = data.filter(d => d.estado === 'Activo' || d.estado === 'VIGENTE').length;

    return (
        <div className="w-full flex-grow bg-[#F7F8FA]" style={{ minHeight: '100vh' }}>

            {/* VISTA PRINCIPAL */}
            {view === 'main' && (
                <div id="main-page">
                    <div className="flex items-center justify-center h-screen">
                        <div className="text-center p-12 bg-white rounded-xl shadow-lg max-w-3xl mx-auto">
                            <h1 className="text-4xl font-bold text-gray-800 mb-4">Plataforma de Análisis de Laboratorios Ambientales</h1>
                            <p className="text-lg text-gray-600 mb-8">Conectando con la fuente de datos oficial para obtener la información más reciente.</p>

                            {loading ? (
                                <div className="mb-6 h-20 flex flex-col justify-center items-center">
                                    <div className="w-8 h-8 rounded-full border-4 border-t-indigo-600 border-gray-200 animate-spin mx-auto mt-4"></div>
                                    <p className="mt-3 text-sm text-gray-600">Conectando con datos.gov.co...</p>
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-4 justify-center">
                                    <button onClick={() => setView('buscador')} className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-md text-lg transition-colors">
                                        Buscador de Laboratorios
                                    </button>
                                    <button onClick={() => setView('dashboard')} className="px-8 py-4 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg shadow-md text-lg transition-colors">
                                        Análisis de Marcas
                                    </button>
                                    <button onClick={() => setView('analisis')} className="px-8 py-4 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg shadow-md text-lg transition-colors">
                                        Análisis con IA
                                    </button>
                                </div>
                            )}
                            {!loading && <p className="mt-4 text-sm text-gray-500">Datos cargados: {data.length} registros</p>}
                        </div>
                    </div>
                </div>
            )}

            {/* VISTA BUSCADOR */}
            {view === 'buscador' && (
                <div id="buscador-page">
                    <div className="max-w-7xl mx-auto p-6">
                        <button onClick={() => setView('main')} className="mb-4 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors">
                            &larr; Volver al Menú Principal
                        </button>
                        <div className="text-center mb-8">
                            <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">Buscador por Parámetros Ambientales</h1>
                            <p className="mt-2 text-lg text-gray-600">Encuentra laboratorios acreditados filtrando por parámetros y variables técnicas.</p>
                        </div>

                        {/* Filters */}
                        <div className="bg-white p-6 rounded-xl shadow-md mb-8 ring-1 ring-slate-200">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Buscar Parámetro o Laboratorio</label>
                                    <input
                                        type="text"
                                        value={filters.nombre}
                                        onChange={(e) => setFilters(prev => ({ ...prev, nombre: e.target.value }))}
                                        placeholder="Ej: pH, Alcalinidad, Corantioquia..."
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Matriz</label>
                                    <select
                                        value={filters.matriz}
                                        onChange={(e) => setFilters(prev => ({ ...prev, matriz: e.target.value }))}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                                    >
                                        <option value="">Todas las Matrices</option>
                                        {uniqueValues('matriz').map(val => <option key={val} value={val}>{val}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Estado</label>
                                    <select
                                        value={filters.estado}
                                        onChange={(e) => setFilters(prev => ({ ...prev, estado: e.target.value }))}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                                    >
                                        <option value="">Cualquier Estado</option>
                                        {uniqueValues('estado').map(val => <option key={val} value={val}>{val}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="mt-4 flex justify-end gap-3">
                                <button
                                    onClick={() => setFilters({ nombre: '', estado: '', matriz: '', componente: '', actividad: '', variable: '', metodo: '' })}
                                    className="px-6 py-2 bg-slate-100 text-slate-700 font-semibold rounded-lg hover:bg-slate-200 transition-colors"
                                >
                                    Limpiar Filtros
                                </button>
                            </div>
                        </div>

                        {/* Results centered on Parameters */}
                        <div className="space-y-6">
                            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                                <h3 className="text-xl font-bold text-gray-800">Vista por Parámetro ({filteredData.length} registros)</h3>
                                <p className="text-sm text-gray-500 italic">Mostrando resultados individuales por parámetro</p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                {filteredData.slice(0, 60).map((lab, idx) => (
                                    <div key={idx} className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-all border border-slate-100 overflow-hidden flex flex-col group">
                                        <div className="bg-indigo-50 p-4 border-b border-indigo-100 group-hover:bg-indigo-100 transition-colors">
                                            <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1 block">{lab.matriz}</span>
                                            <h4 className="font-extrabold text-indigo-900 leading-tight line-clamp-2 min-h-[3rem]">{lab.parametro || 'Parámetro no especificado'}</h4>
                                        </div>
                                        <div className="p-5 flex-grow space-y-3">
                                            <div>
                                                <p className="text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Laboratorio</p>
                                                <p className="text-sm font-bold text-slate-800 line-clamp-2">{lab.nombre_laboratorio}</p>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3 pt-2">
                                                <div>
                                                    <p className="text-[10px] font-semibold text-slate-400 uppercase">Ubicación</p>
                                                    <p className="text-xs text-slate-600 font-medium">{lab.municipio}, {lab.departamento}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-[10px] font-semibold text-slate-400 uppercase">Estado</p>
                                                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${lab.estado === 'VIGENTE' ? 'bg-emerald-500' : 'bg-slate-400'}`}>
                                                        {lab.estado}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="bg-slate-50 p-2 rounded-lg border border-slate-100 mt-2">
                                                <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Método de Análisis</p>
                                                <p className="text-[11px] text-slate-600 leading-relaxed italic line-clamp-3">{lab.metodo}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {filteredData.length > 60 && (
                                <div className="text-center py-8">
                                    <p className="text-gray-500 italic">Se muestran los primeros 60 registros. Ajusta los filtros para refinar la búsqueda.</p>
                                </div>
                            )}
                            {filteredData.length === 0 && (
                                <div className="text-center py-20 bg-white rounded-3xl shadow-sm border border-dashed border-slate-300">
                                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <span className="text-2xl text-slate-300">🔍</span>
                                    </div>
                                    <p className="text-lg font-bold text-slate-400">No se encontraron parámetros con los filtros seleccionados</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* VISTA DASHBOARD */}
            {view === 'dashboard' && (
                <div id="dashboard-page">
                    <div className="max-w-7xl mx-auto p-6">
                        <button onClick={() => setView('main')} className="mb-4 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors">
                            &larr; Volver al Menú Principal
                        </button>
                        <div className="text-center mb-8">
                            <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">Dashboard de Análisis</h1>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                            <div className="bg-white p-6 rounded-xl shadow-md border-t-4 border-blue-500">
                                <h3 className="text-gray-500 text-sm font-medium uppercase">Total Laboratorios</h3>
                                <p className="text-4xl font-bold text-gray-800 mt-2">{totalLabs}</p>
                            </div>
                            <div className="bg-white p-6 rounded-xl shadow-md border-t-4 border-green-500">
                                <h3 className="text-gray-500 text-sm font-medium uppercase">Acreditación Vigente</h3>
                                <p className="text-4xl font-bold text-gray-800 mt-2">{activeLabs}</p>
                            </div>
                            {/* More placeholder stats */}
                            <div className="bg-white p-6 rounded-xl shadow-md border-t-4 border-purple-500">
                                <h3 className="text-gray-500 text-sm font-medium uppercase">Total Matrices</h3>
                                <p className="text-4xl font-bold text-gray-800 mt-2">{uniqueValues('matriz').length}</p>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-md">
                            <h3 className="text-xl font-bold text-gray-800 mb-4">Distribución por Departamento</h3>
                            <div className="h-64 overflow-y-auto custom-scroll">
                                {/* Simple List for now */}
                                {Object.entries(data.reduce((acc, curr) => {
                                    acc[curr.departamento] = (acc[curr.departamento] || 0) + 1;
                                    return acc;
                                }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]).map(([dept, count]) => (
                                    <div key={dept} className="flex items-center justify-between py-2 border-b last:border-0 border-gray-100">
                                        <span className="text-gray-700 font-medium">{dept}</span>
                                        <span className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-sm font-bold">{count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* VISTA ANALISIS IA */}
            {view === 'analisis' && (
                <div id="analisis-page">
                    <div className="max-w-4xl mx-auto p-6">
                        <button onClick={() => setView('main')} className="mb-4 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors">
                            &larr; Volver al Menú Principal
                        </button>
                        <div className="text-center mb-8">
                            <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">Módulo de Análisis con IA</h1>
                            <p className="mt-2 text-lg text-gray-600">Realiza consultas en lenguaje natural sobre los datos.</p>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-md mb-8">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Tu consulta</label>
                                    <textarea
                                        value={aiQuery}
                                        onChange={(e) => setAiQuery(e.target.value)}
                                        rows={4}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        placeholder="Ej: ¿Cuántos laboratorios hay en Antioquia?"
                                    ></textarea>
                                </div>
                                <div className="flex justify-end">
                                    <button
                                        onClick={handleAiAnalysis}
                                        disabled={aiLoading || !aiQuery.trim()}
                                        className="inline-flex items-center px-6 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <span>{aiLoading ? 'Analizando...' : 'Analizar'}</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {(aiLoading || aiResponse) && (
                            <div className="p-6 bg-white rounded-xl shadow-md animate-fade-in">
                                {aiLoading ? (
                                    <div className="text-center py-4">
                                        <div className="w-8 h-8 rounded-full border-4 border-t-indigo-600 border-gray-200 animate-spin mx-auto"></div>
                                        <p className="mt-2 text-gray-500">Procesando consulta...</p>
                                    </div>
                                ) : (
                                    <>
                                        <h3 className="text-xl font-semibold text-gray-800 mb-4 border-b pb-2">Respuesta de la IA</h3>
                                        <div className="prose max-w-none text-gray-700">
                                            {aiResponse}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
