import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryProvider } from './components/QueryProvider';
import Nav from './components/Nav';
import { APP_BASE } from './appBase';
import Home from './pages/Home';
import Articulos from './pages/Articulos';
import Tablas from './pages/Tablas';
import Clientes from './pages/Clientes';
import ClienteDetalle from './pages/ClienteDetalle';
import ClienteArticulo from './pages/ClienteArticulo';
import Analisis from './pages/Analisis';

// Layout con la navegación compartida (Nav + página vía <Outlet/>).
function Layout() {
  return (
    <>
      <Nav />
      <Outlet />
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
          {/* Ruta absoluta: bajo el splat, un `to="."` se resolvía contra la ruta
              actual y no volvía a la raíz de la sub-app. Ver appBase.ts. */}
          <Route path="*" element={<Navigate to={APP_BASE} replace />} />
        </Route>
      </Routes>
    </QueryProvider>
  );
}
