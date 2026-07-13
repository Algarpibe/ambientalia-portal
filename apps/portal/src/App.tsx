import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import Sidebar from './components/Sidebar';
import RequireAuth from './components/RequireAuth';
import RequireAdmin from './components/RequireAdmin';
import AppGuard from './components/AppGuard';
import NotificationHost from './components/NotificationHost';
import { captureError } from './sentry';
import Dashboard from './pages/Dashboard';
import Herramientas from './pages/Herramientas';
import Aplicaciones from './pages/Aplicaciones';
import Auth from './pages/Auth';
import AdminUsers from './pages/admin/AdminUsers';

// Lazy load apps
const ConciliadorPagos = lazy(() => import('../../payment-reconciliation/src/App'));
const AnalisisInventario = lazy(() => import('../../inventory-optimization/src/App'));
const ConsolidadorInventario = lazy(() => import('../../inventory-consolidation'));
const RentabilidadClientes = lazy(() => import('../../customer-profitability/src/App'));
const VentasArticulos = lazy(() => import('../../product-sales/src/App'));
const LaboratoriosAmbientales = lazy(() => import('../../laboratorios-ambientales/src/App.tsx'));
const ValoracionClientes = lazy(() => import('../../customer-valuation/src/App'));

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
    captureError(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-grow bg-red-50 p-12 flex items-center justify-center text-center">
          <div>
            <h2 className="text-2xl font-bold text-red-700 mb-4">Error al cargar la aplicación</h2>
            <p className="text-red-600 mb-6 max-w-md mx-auto">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-red-600 text-white rounded-lg font-semibold"
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function LoadingFallback() {
  return (
    <div className="flex-grow bg-[#F7F8FA] flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-primary mb-4"></div>
        <p className="text-gray-600 font-medium">Cargando aplicación...</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      {/* Host global de notificaciones (toasts) — visible en toda la app. */}
      <NotificationHost />
      <Routes>
        {/* Authentication page - no sidebar */}
        <Route path="/auth" element={<Auth />} />

        {/* Main app with sidebar */}
        <Route
          path="/*"
          element={
            <RequireAuth>
            <div className="flex min-h-screen bg-[#F7F8FA] text-gray-900">
              <Sidebar />
              <ErrorBoundary>
                <Suspense fallback={<LoadingFallback />}>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/herramientas" element={<Herramientas />} />
                    <Route path="/aplicaciones" element={<Aplicaciones />} />
                    {/* Panel de administración — solo admin (Req 5.1-5.3) */}
                    <Route path="/admin/users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
                    {/* Rutas de aplicaciones — protegidas por AppGuard según apps[] del JWT (Req 4.5) */}
                    <Route path="/conciliador-pagos/*" element={<AppGuard appId="payment-reconciliation"><ConciliadorPagos /></AppGuard>} />
                    <Route path="/analisis-inventario/*" element={<AppGuard appId="inventory-optimization"><AnalisisInventario /></AppGuard>} />
                    <Route path="/consolidador-inventario/*" element={<AppGuard appId="inventory-consolidation"><ConsolidadorInventario /></AppGuard>} />
                    <Route path="/rentabilidad-clientes/*" element={<AppGuard appId="customer-profitability"><RentabilidadClientes /></AppGuard>} />
                    <Route path="/ventas-articulos/*" element={<AppGuard appId="product-sales"><VentasArticulos /></AppGuard>} />
                    <Route path="/laboratorios-ambientales/*" element={<AppGuard appId="laboratorios-ambientales"><LaboratoriosAmbientales /></AppGuard>} />
                    <Route path="/valoracion-clientes/*" element={<AppGuard appId="customer-valuation"><ValoracionClientes /></AppGuard>} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </div>
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
