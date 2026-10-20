import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, useState } from 'react';
import { lazyConReintento } from './lib/lazyConReintento';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import RequireAuth from './components/RequireAuth';
import RequireAdmin from './components/RequireAdmin';
import AppGuard from './components/AppGuard';
import NotificationHost from './components/NotificationHost';
import ErrorBoundary from './components/ErrorBoundary';
import Dashboard from './pages/Dashboard';
import Herramientas from './pages/Herramientas';
import Aplicaciones from './pages/Aplicaciones';
import Auth from './pages/Auth';
import Configuracion from './pages/Configuracion';
import AdminUsers from './pages/admin/AdminUsers';

// Lazy load apps
const ConciliadorPagos = lazyConReintento(() => import('../../payment-reconciliation/src/App'));
const AnalisisInventario = lazyConReintento(() => import('../../inventory-optimization/src/App'));
const ConsolidadorInventario = lazyConReintento(() => import('../../inventory-consolidation'));
const LaboratoriosAmbientales = lazyConReintento(() => import('../../laboratorios-ambientales/src/App.tsx'));
const ValoracionClientes = lazyConReintento(() => import('../../customer-valuation/src/App'));
const CargaPedidosWO = lazyConReintento(() => import('../../WO-sales/src/App'));
const Contabilidad = lazyConReintento(() => import('../../contabilidad/src/App'));
const OvPendientes = lazyConReintento(() => import('../../contabilidad/src/AppOV'));
const Ausencias = lazyConReintento(() => import('../../ausencias/src/App'));
const Calibraciones = lazyConReintento(() => import('../../calibraciones/src/App'));
const TrazabilidadMantenimientos = lazyConReintento(() => import('../../trazabilidad-mantenimientos/src/App'));

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
  // La navegación móvil vive aquí porque la abre la TopBar y la pinta el
  // Sidebar, que son hermanos: este es su ancestro común más cercano.
  const [menuMovil, setMenuMovil] = useState(false);

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
              <Sidebar mobileOpen={menuMovil} onMobileClose={() => setMenuMovil(false)} />
              <div className="flex-1 flex flex-col min-w-0">
                <TopBar onOpenMenu={() => setMenuMovil(true)} menuOpen={menuMovil} />
                <ErrorBoundary>
                  <Suspense fallback={<LoadingFallback />}>
                    <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/herramientas" element={<Herramientas />} />
                    <Route path="/aplicaciones" element={<Aplicaciones />} />
                    <Route path="/configuracion" element={<Configuracion />} />
                    {/* Panel de administración — solo admin (Req 5.1-5.3) */}
                    <Route path="/admin/users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
                    {/* Rutas de aplicaciones — protegidas por AppGuard según apps[] del JWT (Req 4.5) */}
                    <Route path="/conciliador-pagos/*" element={<AppGuard appId="payment-reconciliation"><ConciliadorPagos /></AppGuard>} />
                    <Route path="/analisis-inventario/*" element={<AppGuard appId="inventory-optimization"><AnalisisInventario /></AppGuard>} />
                    <Route path="/consolidador-inventario/*" element={<AppGuard appId="inventory-consolidation"><ConsolidadorInventario /></AppGuard>} />
                    <Route path="/laboratorios-ambientales/*" element={<AppGuard appId="laboratorios-ambientales"><LaboratoriosAmbientales /></AppGuard>} />
                    <Route path="/valoracion-clientes/*" element={<AppGuard appId="customer-valuation"><ValoracionClientes /></AppGuard>} />
                    <Route path="/carga-pedidos-wo/*" element={<AppGuard appId="WO-sales"><CargaPedidosWO /></AppGuard>} />
                    <Route path="/contabilidad/*" element={<AppGuard appId="contabilidad"><Contabilidad /></AppGuard>} />
                    <Route path="/ov-pendientes/*" element={<AppGuard appId="ov-pendientes"><OvPendientes /></AppGuard>} />
                    <Route path="/ausencias/*" element={<AppGuard appId="ausencias"><Ausencias /></AppGuard>} />
                    <Route path="/calibraciones/*" element={<AppGuard appId="calibraciones"><Calibraciones /></AppGuard>} />
                    <Route path="/trazabilidad-mantenimientos/*" element={<AppGuard appId="trazabilidad-mantenimientos"><TrazabilidadMantenimientos /></AppGuard>} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
              </div>
            </div>
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
