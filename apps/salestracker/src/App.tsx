import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import './ui/warm.css';
import { QueryProvider } from './components/QueryProvider';
import Nav from './components/Nav';
import { APP_BASE } from './appBase';

// FE-410 — páginas bajo demanda: cada ruta es su propio chunk y recharts (24
// archivos) sale del bundle inicial de la sub-app, cargándose solo al abrir la
// página que lo usa.
const Home = lazy(() => import('./pages/Home'));
const Articulos = lazy(() => import('./pages/Articulos'));
const Tablas = lazy(() => import('./pages/Tablas'));
const Clientes = lazy(() => import('./pages/Clientes'));
const ClienteDetalle = lazy(() => import('./pages/ClienteDetalle'));
const ClienteArticulo = lazy(() => import('./pages/ClienteArticulo'));
const Analisis = lazy(() => import('./pages/Analisis'));
const Categorias = lazy(() => import('./pages/Categorias'));

// Layout con la navegación compartida (Nav + página vía <Outlet/>).
function Layout() {
  return (
    <>
      <Nav />
      <Suspense fallback={<div style={{ padding: '2.5rem', textAlign: 'center', color: '#9a8c7d' }}>Cargando…</div>}>
        <Outlet />
      </Suspense>
    </>
  );
}

export default function App() {
  return (
    <QueryProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="articulos" element={<Articulos />} />
          <Route path="tablas" element={<Tablas />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="clientes/:customer" element={<ClienteDetalle />} />
          <Route path="cliente-articulo" element={<ClienteArticulo />} />
          <Route path="analisis" element={<Analisis />} />
          <Route path="categorias" element={<Categorias />} />
          {/* Ruta absoluta: bajo el splat, un `to="."` se resolvía contra la ruta
              actual y no volvía a la raíz de la sub-app. Ver appBase.ts. */}
          <Route path="*" element={<Navigate to={APP_BASE} replace />} />
        </Route>
      </Routes>
    </QueryProvider>
  );
}
