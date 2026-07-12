import { Package, TrendingUp, AlertCircle } from 'lucide-react'

function App() {
  return (
    <div className="w-full bg-slate-50 flex-grow">
      <div className="bg-white border-b border-slate-200">
        <div className="w-full px-6 py-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-lg flex items-center justify-center">
              <Package size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Consolidador de Inventario</h1>
              <p className="text-sm text-slate-500 mt-0.5">Balance de existencias optimizado</p>
            </div>
          </div>
        </div>
      </div>
      
      <div className="w-full px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Stock Total</h3>
              <TrendingUp className="text-indigo-500" size={24} />
            </div>
            <p className="text-3xl font-bold text-slate-900">152,340</p>
            <p className="text-sm text-slate-500 mt-2">Unidades consolidadas</p>
          </div>

          <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Centros Activos</h3>
              <Package className="text-indigo-500" size={24} />
            </div>
            <p className="text-3xl font-bold text-slate-900">8</p>
            <p className="text-sm text-slate-500 mt-2">Ubicaciones monitoreadas</p>
          </div>

          <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Alertas</h3>
              <AlertCircle className="text-amber-500" size={24} />
            </div>
            <p className="text-3xl font-bold text-slate-900">12</p>
            <p className="text-sm text-slate-500 mt-2">Requieren atención</p>
          </div>
        </div>

        <div className="bg-white rounded-lg p-8 border border-slate-200 shadow-sm">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Estado del Sistema</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <span className="text-slate-600">Última sincronización</span>
              <span className="text-indigo-600 font-medium">Hace 5 minutos</span>
            </div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <span className="text-slate-600">Precisión de datos</span>
              <span className="text-indigo-600 font-medium">98.5%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Estado del servicio</span>
              <span className="flex items-center gap-2 text-indigo-600 font-medium">
                <div className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></div>
                Operacional
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
